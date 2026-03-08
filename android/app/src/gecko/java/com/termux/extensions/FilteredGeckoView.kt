package com.termux.extensions

import android.content.Context
import android.text.InputType
import android.util.AttributeSet
import android.util.Log
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import org.mozilla.geckoview.GeckoView

/**
 * GeckoView subclass that intercepts onCreateInputConnection() to wrap
 * the InputConnection with EditorInputFilter when the Monaco editor is focused.
 *
 * When the filter is active, EditorInfo.inputType is set to
 * TYPE_TEXT_VARIATION_VISIBLE_PASSWORD | TYPE_TEXT_FLAG_NO_SUGGESTIONS
 * which forces Gboard into character-by-character mode (the Termux pattern).
 */
class FilteredGeckoView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : GeckoView(context, attrs) {

    var editorInputFilter: EditorInputFilter? = null

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        val base = super.onCreateInputConnection(outAttrs)
        val filter = editorInputFilter
        if (base != null && filter != null && filter.isActive) {
            Log.d(TAG, "onCreateInputConnection: filter ACTIVE — wrapping IC, setting VISIBLE_PASSWORD")
            outAttrs.inputType = InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD or
                InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            return filter.wrap(base)
        }
        Log.d(TAG, "onCreateInputConnection: filter inactive — passthrough")
        return base
    }

    companion object {
        private const val TAG = "FilteredGeckoView"
    }
}
