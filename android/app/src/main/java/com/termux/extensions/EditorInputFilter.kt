package com.termux.extensions

import android.util.Log
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper

/**
 * Wraps an InputConnection to strip IME composition when the Monaco
 * editor is focused.  Follows the Termux model: convert setComposingText →
 * commitText so Gboard (and any EditContext-based keyboard) sends
 * character-by-character input instead of composition spans.
 */
class EditorInputFilter {

    @Volatile
    var isActive = false

    fun wrap(base: InputConnection): InputConnection {
        return FilteredInputConnection(base, this)
    }

    private class FilteredInputConnection(
        target: InputConnection,
        private val filter: EditorInputFilter
    ) : InputConnectionWrapper(target, true) {

        override fun setComposingText(text: CharSequence?, newCursorPosition: Int): Boolean {
            if (filter.isActive && text != null) {
                Log.d(TAG, "setComposingText → commitText: \"$text\"")
                return commitText(text, newCursorPosition)
            }
            return super.setComposingText(text, newCursorPosition)
        }

        override fun setComposingRegion(start: Int, end: Int): Boolean {
            if (filter.isActive) {
                Log.d(TAG, "setComposingRegion($start, $end) → no-op")
                return true
            }
            return super.setComposingRegion(start, end)
        }

        override fun finishComposingText(): Boolean {
            if (filter.isActive) {
                Log.d(TAG, "finishComposingText (filter active)")
            }
            return super.finishComposingText()
        }
    }

    companion object {
        private const val TAG = "EditorInputFilter"
    }
}
