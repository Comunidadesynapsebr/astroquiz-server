package com.astroquiz.game

import android.app.Activity
import android.content.Context
import android.widget.Toast
import com.startapp.sdk.adsbase.Ad
import com.startapp.sdk.adsbase.AdDisplayListener
import com.startapp.sdk.adsbase.StartAppAd
import com.startapp.sdk.adsbase.StartAppSDK
import com.startapp.sdk.adsbase.adlisteners.AdEventListener
import com.startapp.sdk.adsbase.StartAppAd.AdMode
import java.lang.ref.WeakReference
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
    @Volatile private var activityRef: WeakReference<Activity>? = null
    @Volatile private var adOwnerActivityId: Int = 0

    fun initialize(context: Context) {
        (context as? Activity)?.let {
            val previous = activityRef?.get()
            activityRef = WeakReference(it)
            if (previous != null && previous !== it) {
                clearAdStateInternal()
            }
        }

        if (initialized || initializing) return
        initializing = true

        runCatching {
            StartAppSDK.initParams(context.applicationContext, APP_ID)
                .setReturnAdsEnabled(false)
                .setCallback {
                    initialized = true
                    initializing = false
                    preloadInterstitial(context)
                    preloadRewarded(context)
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
        val activity = (context as? Activity) ?: activityRef?.get() ?: return
        if (!initialized || loadingInterstitial || interstitialAd != null) return
        loadingInterstitial = true

        runCatching {
            val ad = StartAppAd(activity)
            ad.loadAd(object : AdEventListener {
                override fun onReceiveAd(received: Ad) {
                    interstitialAd = ad
                    adOwnerActivityId = System.identityHashCode(activity)
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
            preloadInterstitial(activity)
            onDone()
            return
        }

        interstitialAd = null
        showing = true
        val called = AtomicBoolean(false)

        fun finish() {
            if (!called.compareAndSet(false, true)) return
            showing = false
            preloadInterstitial(activity)
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
        val activity = (context as? Activity) ?: activityRef?.get() ?: return
        if (!initialized || loadingRewarded || rewardedAd != null) return
        loadingRewarded = true

        runCatching {
            val ad = StartAppAd(activity)            ad.loadAd(AdMode.REWARDED_VIDEO, object : AdEventListener {
                override fun onReceiveAd(received: Ad) {
                    rewardedAd = ad
                    adOwnerActivityId = System.identityHashCode(activity)
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
            preloadRewarded(activity)
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
            ad.setVideoListener {
                if (rewarded.compareAndSet(false, true)) {
                    onRewarded()
                }
            }
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
        activityRef = null
        clearAdStateInternal()
        loadingInterstitial = false
        loadingRewarded = false
        showing = false
        if (initialized) {
            preloadInterstitial(context.applicationContext)
            preloadRewarded(context.applicationContext)
        }
    }

    fun onResume(context: Context) {
        (context as? Activity)?.let { activityRef = WeakReference(it) }
        if (!initialized) initialize(context)
    }

    private fun clearAdStateInternal() {
        interstitialAd = null
        rewardedAd = null
        loadingInterstitial = false
        loadingRewarded = false
        showing = false
        adOwnerActivityId = 0
    }

    private fun canShow(activity: Activity): Boolean =
        !activity.isFinishing &&
            !activity.isDestroyed &&
            !showing &&
            activity.hasWindowFocus()
}
