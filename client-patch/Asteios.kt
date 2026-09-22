package com.astroquiz.game

object Asteios {
    const val STARTING_COINS = 100
    const val REWARD_AD_COINS = 30
    const val MAX_REWARD_ADS_PER_DAY = 3
    const val REWARD_AD_COOLDOWN_MS = 3 * 60 * 60 * 1000L

    const val COINS_PER_CORRECT = 2
    const val MAX_COINS = 999_999
    const val MAX_LIVES = 99
    const val MAX_TIME_BONUS_SECS = 60

    const val LIFE_1_PRICE = 80
    const val LIFE_3_PRICE = 200
    const val LIFE_5_PRICE = 350
    const val TIME_5_PRICE = 130
    const val TIME_10_PRICE = 260
    const val TIME_20_PRICE = 480

    fun categoryPrice(itemId: String): Int? = when (itemId) {
        "p2", "p3", "p5" -> 150
        "p4", "p6", "p8", "p11", "p13" -> 220
        "p7" -> 250
        "p9", "p10", "p12" -> 350
        else -> null
    }

    fun fixedReward(value: Int): Boolean = value == REWARD_AD_COINS
    fun validCoins(value: Int): Boolean = value in 0..MAX_COINS
    fun validLives(value: Int): Boolean = value in 0..MAX_LIVES
    fun validTimeBonusSecs(value: Int): Boolean = value in 0..MAX_TIME_BONUS_SECS
    fun validRewardCount(value: Int): Boolean = value in 0..MAX_REWARD_ADS_PER_DAY

    fun fixedLifePrice(itemId: String): Int? = when (itemId) {
        "life_1" -> LIFE_1_PRICE
        "life_3" -> LIFE_3_PRICE
        "life_5" -> LIFE_5_PRICE
        else -> null
    }

    fun fixedTimePrice(itemId: String): Int? = when (itemId) {
        "time_5" -> TIME_5_PRICE
        "time_10" -> TIME_10_PRICE
        "time_20" -> TIME_20_PRICE
        else -> null
    }

    fun fixedLifeValue(itemId: String): Int? = when (itemId) {
        "life_1" -> 1
        "life_3" -> 3
        "life_5" -> 5
        else -> null
    }

    fun fixedTimeValue(itemId: String): Int? = when (itemId) {
        "time_5" -> 5
        "time_10" -> 10
        "time_20" -> 20
        else -> null
    }
}
