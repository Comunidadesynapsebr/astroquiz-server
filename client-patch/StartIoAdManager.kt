package com.astroquiz.game

import android.app.Activity
import android.content.Context
import android.widget.Toast
import com.startapp.sdk.adsbase.Ad
import com.startapp.sdk.adsbase.AdDisplayListener
import com.startapp.sdk.adsbase.StartAppAd
import com.startapp.sdk.adsbase.StartAppSDK
import com.startapp.sdk.adsbase.adlisteners.AdEventListener
import com.startapp.sdk.adsbase.adlisteners.AdMode
import com.startapp.sdk.adsbase.adlisteners.VideoListener
import java.util.concurrent.atomic.AtomicBoolean

object StartIoAdManager {
    private const val APP_ID = "208555525"
    private const val QUESTIONS_BETWEEN_INTERSTITIALS = 10

    @Volatile private var initialized = false
    @Volatile private var initializing = false
    @Volatile private var loadingInterstitial = false
    @Volatile private var loadingRewarded = false
    @Volatile private var interstitialAd: StartAppAd? = null
    @Volatile private var rewardedAd: StartAppAd? = null
    @Volatile private var showing = false
    @Volatile private var questionCount = 0

    fun initialize(context: Context) {
        if (initialized || initializing) return
        initializing = true

        runCatching {
            StartAppSDK.initParams(context.applicationContext, APP_ID)
                .setReturnAdsEnabled(false)
                .setCallback {
                    initialized = true
                    initializing = false
                    preloadInterstitial(context.applicationContext)
                    preloadRewarded(context.applicationContext)
                }
                .init()
        }.onFailure {
            initializing = false
        }
    }

    fun resetQuestionCounter() {
        questionCount = 0
    }

    fun onQuestionAnswered(activity: Activity, onAfterAd: () -> Unit) {
        questionCount++
        if (questionCount % QUESTIONS_BETWEEN_INTERSTITIALS != 0) {
            onAfterAd()
            return
        }

        activity.window.decorView.post {
            if (!canShow(activity)) {
                onAfterAd()
                return@post
            }
            showInterstitial(activity, onAfterAd)
        }
    }

    private fun preloadInterstitial(context: Context) {
        if (!initialized || loadingInterstitial || interstitialAd != null) return
        loadingInterstitial = true

        runCatching {
            val ad = StartAppAd(context)
            ad.loadAd(object : AdEventListener {
                override fun onReceiveAd(received: Ad) {
                    interstitialAd = ad
                    loadingInterstitial = false
                }

                override fun onFailedToReceiveAd(failed: Ad?) {
                    interstitialAd = null
                    loadingInterstitial = false
                }
            })
        }.onFailure {
            loadingInterstitial = false
            interstitialAd = null
        }
    }

    private fun showInterstitial(activity: Activity, onDone: () -> Unit) {
        if (showing) {
            onDone()
            return
        }

        val ad = interstitialAd ?: run {
            preloadInterstitial(activity.applicationContext)
            onDone()
            return
        }

        interstitialAd = null
        showing = true
        val called = AtomicBoolean(false)

        fun finish() {
            if (!called.compareAndSet(false, true)) return
            showing = false
            preloadInterstitial(activity.applicationContext)
            onDone()
        }

        try {
            ad.showAd(object : AdDisplayListener {
                override fun adHidden(ad: Ad) = finish()
                override fun adDisplayed(ad: Ad) = Unit
                override fun adClicked(ad: Ad) = Unit
                override fun adNotDisplayed(ad: Ad) = finish()
            })
        } catch (_: Throwable) {
            finish()
        }
    }

    private fun preloadRewarded(context: Context) {
        if (!initialized || loadingRewarded || rewardedAd != null) return
        loadingRewarded = true

        runCatching {
            val ad = StartAppAd(context)
            ad.loadAd(AdMode.REWARDED_VIDEO, object : AdEventListener {
                override fun onReceiveAd(received: Ad) {
                    rewardedAd = ad
                    loadingRewarded = false
                }

                override fun onFailedToReceiveAd(failed: Ad?) {
                    rewardedAd = null
                    loadingRewarded = false
                }
            })
        }.onFailure {
            loadingRewarded = false
            rewardedAd = null
        }
    }

    fun isRewardedReady(): Boolean = rewardedAd != null && initialized

    fun showRewarded(
        activity: Activity,
        onRewarded: () -> Unit,
        onDismissed: () -> Unit = {},
        onUnavailable: () -> Unit = onDismissed,
    ) {
        if (!canShow(activity)) {
            onUnavailable()
            return
        }

        val ad = rewardedAd ?: run {
            preloadRewarded(activity.applicationContext)
            Toast.makeText(
                activity,
                "Anúncio ainda carregando. Tente novamente em alguns segundos.",
                Toast.LENGTH_SHORT,
            ).show()
            onUnavailable()
            return
        }

        rewardedAd = null
        showing = true

        val rewarded = AtomicBoolean(false)
        val closed = AtomicBoolean(false)

        fun finish() {
            if (!closed.compareAndSet(false, true)) return
            showing = false
            preloadRewarded(activity.applicationContext)
            onDismissed()
        }

        try {
            ad.setVideoListener(VideoListener {
                if (rewarded.compareAndSet(false, true)) {
                    onRewarded()
                }
            })
            ad.showAd(object : AdDisplayListener {
                override fun adHidden(ad: Ad) = finish()
                override fun adDisplayed(ad: Ad) = Unit
                override fun adClicked(ad: Ad) = Unit
                override fun adNotDisplayed(ad: Ad) = finish()
            })
        } catch (_: Throwable) {
            finish()
        }
    }

    fun clearAdState(context: Context) {
        interstitialAd = null
        rewardedAd = null
        loadingInterstitial = false
        loadingRewarded = false
        showing = false
        if (initialized) {
            preloadInterstitial(context.applicationContext)
            preloadRewarded(context.applicationContext)
        }
    }

    fun onResume(context: Context) {
        if (!initialized) initialize(context)
    }

    private fun canShow(activity: Activity): Boolean =
        !activity.isFinishing &&
            !activity.isDestroyed &&
            !showing &&
            activity.hasWindowFocus()
}
