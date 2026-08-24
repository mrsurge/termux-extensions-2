package com.termux.extensions

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CefriumImeDismissalReducerTest {
    private fun state(
        visible: Boolean,
        activityResumed: Boolean = true,
        windowFocused: Boolean = true,
        appPageReady: Boolean = true,
        nativeOverlayHidden: Boolean = true,
    ) = CefriumImeVisibilityState(
        imeVisible = visible,
        activityResumed = activityResumed,
        windowFocused = windowFocused,
        appPageReady = appPageReady,
        nativeOverlayHidden = nativeOverlayHidden,
    )

    @Test
    fun hideAnimationDispatchesAtStartAndCompletion() {
        val reducer = CefriumImeDismissalReducer()

        reducer.observe(state(visible = true))
        assertTrue(reducer.beginHideAnimation(state(visible = true)))
        assertTrue(reducer.completeHideAnimation(state(visible = false)))
        assertFalse(reducer.completeHideAnimation(state(visible = false)))
    }

    @Test
    fun completionDoesNotDependOnCompositionFilterOwnership() {
        val reducer = CefriumImeDismissalReducer()

        reducer.observe(state(visible = true))
        assertTrue(reducer.beginHideAnimation(state(visible = true)))
        assertTrue(reducer.completeHideAnimation(state(visible = false)))
    }

    @Test
    fun rejectsStartWithoutLifecycleOwnership() {
        val rejected = listOf(
            state(visible = true, activityResumed = false),
            state(visible = true, windowFocused = false),
            state(visible = true, appPageReady = false),
            state(visible = true, nativeOverlayHidden = false),
        )

        for (candidate in rejected) {
            val reducer = CefriumImeDismissalReducer()
            reducer.observe(state(visible = true))
            assertFalse(reducer.beginHideAnimation(candidate))
            assertFalse(reducer.completeHideAnimation(state(visible = false)))
        }
    }

    @Test
    fun startDispatchesOnlyOncePerVisibleEpoch() {
        val reducer = CefriumImeDismissalReducer()

        reducer.observe(state(visible = true))
        assertTrue(reducer.beginHideAnimation(state(visible = true)))
        assertFalse(reducer.beginHideAnimation(state(visible = true)))
        assertTrue(reducer.completeHideAnimation(state(visible = false)))

        reducer.observe(state(visible = true))
        assertTrue(reducer.beginHideAnimation(state(visible = true)))
    }

    @Test
    fun hideAnimationRejectsHiddenAndIneligibleStartStates() {
        val reducer = CefriumImeDismissalReducer()

        assertFalse(reducer.beginHideAnimation(state(visible = false)))
        assertFalse(reducer.beginHideAnimation(state(visible = true, windowFocused = false)))
    }

    @Test
    fun visibleCompletionCancelsPendingReleaseAndStartsANewEpoch() {
        val reducer = CefriumImeDismissalReducer()

        reducer.observe(state(visible = true))
        assertTrue(reducer.beginHideAnimation(state(visible = true)))
        assertFalse(reducer.completeHideAnimation(state(visible = true)))
        assertTrue(reducer.beginHideAnimation(state(visible = true)))
    }

    @Test
    fun completionStillRequiresLiveWindowEligibility() {
        val reducer = CefriumImeDismissalReducer()

        reducer.observe(state(visible = true))
        assertTrue(reducer.beginHideAnimation(state(visible = true)))
        assertFalse(
            reducer.completeHideAnimation(
                state(visible = false, windowFocused = false),
            ),
        )
    }
}
