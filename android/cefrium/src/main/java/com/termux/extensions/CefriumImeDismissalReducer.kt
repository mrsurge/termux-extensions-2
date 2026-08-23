package com.termux.extensions

internal data class CefriumImeVisibilityState(
    val imeVisible: Boolean,
    val editorOwnsIme: Boolean,
    val activityResumed: Boolean,
    val windowFocused: Boolean,
    val appPageReady: Boolean,
    val nativeOverlayHidden: Boolean,
)

internal class CefriumImeDismissalReducer {
    private var previousImeVisible: Boolean? = null
    private var dismissalDispatchedForVisibleEpoch = false

    fun beginHideAnimation(state: CefriumImeVisibilityState): Boolean {
        previousImeVisible = state.imeVisible
        if (
            !state.imeVisible ||
            dismissalDispatchedForVisibleEpoch ||
            !state.isEligibleForEditorRelease()
        ) {
            return false
        }
        dismissalDispatchedForVisibleEpoch = true
        return true
    }

    fun update(state: CefriumImeVisibilityState): Boolean {
        val previous = previousImeVisible
        previousImeVisible = state.imeVisible
        if (state.imeVisible) {
            dismissalDispatchedForVisibleEpoch = false
            return false
        }
        val shouldRelease = previous == true &&
            !dismissalDispatchedForVisibleEpoch &&
            state.isEligibleForEditorRelease()
        if (shouldRelease) {
            dismissalDispatchedForVisibleEpoch = true
        }
        return shouldRelease
    }

    fun reset() {
        previousImeVisible = null
        dismissalDispatchedForVisibleEpoch = false
    }

    private fun CefriumImeVisibilityState.isEligibleForEditorRelease(): Boolean =
        editorOwnsIme &&
            activityResumed &&
            windowFocused &&
            appPageReady &&
            nativeOverlayHidden
}
