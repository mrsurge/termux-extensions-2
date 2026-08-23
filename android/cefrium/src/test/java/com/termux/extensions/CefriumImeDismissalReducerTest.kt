package com.termux.extensions

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CefriumImeDismissalReducerTest {
    private fun state(
        visible: Boolean,
        editorOwnsIme: Boolean = true,
        activityResumed: Boolean = true,
        windowFocused: Boolean = true,
        appPageReady: Boolean = true,
        nativeOverlayHidden: Boolean = true,
    ) = CefriumImeVisibilityState(
        imeVisible = visible,
        editorOwnsIme = editorOwnsIme,
        activityResumed = activityResumed,
        windowFocused = windowFocused,
        appPageReady = appPageReady,
        nativeOverlayHidden = nativeOverlayHidden,
    )

    @Test
    fun emitsOnlyForEligibleVisibleToHiddenTransition() {
        val reducer = CefriumImeDismissalReducer()

        assertFalse(reducer.update(state(visible = false)))
        assertFalse(reducer.update(state(visible = true)))
        assertTrue(reducer.update(state(visible = false)))
        assertFalse(reducer.update(state(visible = false)))
    }

    @Test
    fun rejectsTransitionsWithoutEditorAndLifecycleOwnership() {
        val rejected = listOf(
            state(visible = false, editorOwnsIme = false),
            state(visible = false, activityResumed = false),
            state(visible = false, windowFocused = false),
            state(visible = false, appPageReady = false),
            state(visible = false, nativeOverlayHidden = false),
        )

        for (candidate in rejected) {
            val reducer = CefriumImeDismissalReducer()
            assertFalse(reducer.update(state(visible = true)))
            assertFalse(reducer.update(candidate))
        }
    }

    @Test
    fun hideAnimationDispatchesBeforeEndAndOnlyOncePerVisibleEpoch() {
        val reducer = CefriumImeDismissalReducer()

        assertFalse(reducer.update(state(visible = true)))
        assertTrue(reducer.beginHideAnimation(state(visible = true)))
        assertFalse(reducer.beginHideAnimation(state(visible = true)))
        assertFalse(reducer.update(state(visible = false)))

        assertFalse(reducer.update(state(visible = true)))
        assertTrue(reducer.beginHideAnimation(state(visible = true)))
    }

    @Test
    fun hideAnimationRejectsHiddenAndIneligibleStartStates() {
        val reducer = CefriumImeDismissalReducer()

        assertFalse(reducer.beginHideAnimation(state(visible = false)))
        assertFalse(
            reducer.beginHideAnimation(
                state(visible = true, editorOwnsIme = false),
            ),
        )
    }

    @Test
    fun resetMakesNextHiddenInsetAnInitialObservation() {
        val reducer = CefriumImeDismissalReducer()

        assertFalse(reducer.update(state(visible = true)))
        assertTrue(reducer.update(state(visible = false)))
        reducer.reset()
        assertFalse(reducer.update(state(visible = false)))
    }
}
