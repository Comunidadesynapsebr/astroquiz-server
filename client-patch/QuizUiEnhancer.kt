package com.astroquiz.game

import android.view.View
import android.widget.TextView

object QuizUiEnhancer {
    fun animateQuestion(image: View?, question: View?, answers: List<TextView>) {
        image?.let {
            it.alpha = 0f
            it.scaleX = 0.97f
            it.scaleY = 0.97f
            it.animate().alpha(1f).scaleX(1f).scaleY(1f)
                .setDuration(220L).start()
        }

        question?.let {
            it.alpha = 0f
            it.translationY = 14f
            it.animate().alpha(1f).translationY(0f)
                .setDuration(200L).start()
        }

        answers.forEachIndexed { index, answer ->
            answer.alpha = 0f
            answer.translationY = 16f
            answer.animate()
                .alpha(1f)
                .translationY(0f)
                .setStartDelay(index * 35L)
                .setDuration(180L)
                .start()
        }
    }

    fun answerFeedback(view: View, correct: Boolean) {
        view.animate()
            .scaleX(if (correct) 1.03f else 0.98f)
            .scaleY(if (correct) 1.03f else 0.98f)
            .setDuration(90L)
            .withEndAction {
                view.animate().scaleX(1f).scaleY(1f).setDuration(120L).start()
            }
            .start()
    }

    fun comboFeedback(view: TextView, multiplier: Int) {
        if (multiplier <= 1) return
        view.animate().cancel()
        view.scaleX = 0.85f
        view.scaleY = 0.85f
        view.alpha = 0.65f
        view.animate()
            .scaleX(1.08f)
            .scaleY(1.08f)
            .alpha(1f)
            .setDuration(160L)
            .withEndAction {
                view.animate().scaleX(1f).scaleY(1f).setDuration(100L).start()
            }
            .start()
    }
}
