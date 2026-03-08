package com.termux.extensions

import android.content.Context
import android.text.InputType
import android.util.AttributeSet
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.webkit.WebView

/**
 * WebView subclass that applies the EditorInputFilter to strip IME
 * composition when the Monaco editor is focused. Mirrors FilteredGeckoView.
 */
class FilteredWebView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : WebView(context, attrs, defStyleAttr) {

    var editorInputFilter: EditorInputFilter? = null

    override fun onCheckIsTextEditor(): Boolean {
        // When the editor filter is active, always report as text editor
        // so the IME system will call onCreateInputConnection and "serve" us.
        val filter = editorInputFilter
        if (filter != null && filter.isActive) return true
        return super.onCheckIsTextEditor()
    }

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        val filter = editorInputFilter
        val base = super.onCreateInputConnection(outAttrs)

        // If the filter is inactive, pass through normally
        if (filter == null || !filter.isActive) return base

        // Force VISIBLE_PASSWORD so Gboard sends per-character commits (matches FilteredGeckoView)
        outAttrs.inputType = InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD or
            InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        outAttrs.imeOptions = outAttrs.imeOptions or EditorInfo.IME_FLAG_NO_FULLSCREEN

        // WebView returns null for editable content inside iframes.
        // Provide a fallback BaseInputConnection so the IME system "serves" us.
        val target = base ?: BaseInputConnection(this, false)
        return filter.wrap(target)
    }
}
