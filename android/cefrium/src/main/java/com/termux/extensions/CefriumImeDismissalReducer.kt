package com.termux.extensions

internal data class CefriumImeVisibilityState(
    val imeVisible: Boolean,
    val activityResumed: Boolean,
    val windowFocused: Boolean,
    val appPageReady: Boolean,
    val nativeOverlayHidden: Boolean,
)

internal class CefriumImeDismissalReducer {
    private var dismissalDispatchedForVisibleEpoch = false
    private var hideReleasePending = false

    fun observe(state: CefriumImeVisibilityState) {
        if (state.imeVisible) {
            dismissalDispatchedForVisibleEpoch = false
            hideReleasePending = false
        }
    }

    fun beginHideAnimation(state: CefriumImeVisibilityState): Boolean {
        if (
            !state.imeVisible ||
            dismissalDispatchedForVisibleEpoch ||
            !state.isEligibleForReleaseRuntime()
        ) {
            return false
        }
        dismissalDispatchedForVisibleEpoch = true
        hideReleasePending = true
        return true
    }

    fun completeHideAnimation(state: CefriumImeVisibilityState): Boolean {
        val releasePending = hideReleasePending
        hideReleasePending = false
        if (state.imeVisible) {
            dismissalDispatchedForVisibleEpoch = false
            return false
        }
        return releasePending && state.isEligibleForEditorReleaseCompletion()
    }

    fun reset() {
        dismissalDispatchedForVisibleEpoch = false
        hideReleasePending = false
    }

    private fun CefriumImeVisibilityState.isEligibleForEditorReleaseCompletion(): Boolean =
        !imeVisible &&
            isEligibleForReleaseRuntime()

    private fun CefriumImeVisibilityState.isEligibleForReleaseRuntime(): Boolean =
        activityResumed &&
            windowFocused &&
            appPageReady &&
            nativeOverlayHidden
}
