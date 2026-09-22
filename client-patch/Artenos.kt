package com.astroquiz.game

import android.content.Context
import android.os.Build
import android.os.Debug
import android.os.Process
import java.io.File
import java.security.MessageDigest

object Artenos {
    data class Verdict(val trusted: Boolean, val reason: String)

    fun inspect(context: Context): Verdict {
        if (BuildConfig.DEBUG) return Verdict(true, "debug")
        if (context.packageName != BuildConfig.APPLICATION_ID) {
            return Verdict(false, "package")
        }

        val expected = BuildConfig.ARTENOS_CERT_SHA256.orEmpty()
            .replace(":", "")
            .trim()
            .lowercase()

        if (expected.isBlank() || !signatureMatches(context, expected)) {
            return Verdict(false, "signature")
        }

        if (rootIndicator()) return Verdict(false, "root")
        if (debuggerAttached()) return Verdict(false, "debugger")
        if (instrumentationIndicator()) return Verdict(false, "instrumentation")
        if (emulatorIndicator()) return Verdict(false, "emulator")

        return Verdict(true, "ok")
    }

    fun enforce(context: Context): Boolean {
        val verdict = inspect(context)
        if (verdict.trusted) return true

        runCatching {
            context.getSharedPreferences("artenos_state", Context.MODE_PRIVATE)
                .edit()
                .putString("last_failure", verdict.reason)
                .putBoolean("locked", true)
                .apply()
        }

        runCatching { (context as? android.app.Activity)?.finishAffinity() }
        return false
    }

    private fun signatureMatches(context: Context, expected: String): Boolean = runCatching {
        val packageInfo = if (Build.VERSION.SDK_INT >= 28) {
            context.packageManager.getPackageInfo(
                context.packageName,
                android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES,
            )
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(
                context.packageName,
                android.content.pm.PackageManager.GET_SIGNATURES,
            )
        }

        val signatures = if (Build.VERSION.SDK_INT >= 28) {
            packageInfo.signingInfo?.apkContentsSigners.orEmpty()
        } else {
            @Suppress("DEPRECATION")
            packageInfo.signatures.orEmpty()
        }

        signatures.any { signature ->
            val digest = MessageDigest.getInstance("SHA-256")
                .digest(signature.toByteArray())
                .joinToString("") { byte -> "%02x".format(byte) }
            digest == expected
        }
    }.getOrDefault(false)

    private fun rootIndicator(): Boolean {
        val known = listOf(
            "/system/bin/su",
            "/system/xbin/su",
            "/sbin/su",
            "/system/app/Superuser.apk",
            "/data/adb/magisk",
            "/debug_ramdisk",
        )
        if (known.any(File::exists)) return true

        return runCatching {
            Runtime.getRuntime().exec(arrayOf("sh", "-c", "command -v su"))
                .inputStream.bufferedReader().use { it.readText().isNotBlank() }
        }.getOrDefault(false)
    }

    private fun debuggerAttached(): Boolean {
        if (Debug.isDebuggerConnected() || Debug.waitingForDebugger()) return true
        return runCatching {
            File("/proc/self/status").useLines { lines ->
                lines.any { it.startsWith("TracerPid:") && !it.endsWith("0") }
            }
        }.getOrDefault(false)
    }

    private fun instrumentationIndicator(): Boolean {
        val markers = listOf("frida", "gum-js-loop", "linjector", "xposedbridge", "lsposed")
        return runCatching {
            val maps = File("/proc/self/maps").readText().lowercase()
            markers.any(maps::contains)
        }.getOrDefault(false)
    }

    private fun emulatorIndicator(): Boolean {
        val fingerprint = Build.FINGERPRINT.lowercase()
        val model = Build.MODEL.lowercase()
        val product = Build.PRODUCT.lowercase()
        val hardware = Build.HARDWARE.lowercase()
        return fingerprint.contains("generic") ||
            fingerprint.contains("emulator") ||
            model.contains("sdk_gphone") ||
            product.contains("sdk") ||
            hardware.contains("goldfish") ||
            hardware.contains("ranchu")
    }
}
