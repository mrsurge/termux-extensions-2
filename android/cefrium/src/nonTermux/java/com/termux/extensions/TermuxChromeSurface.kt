package com.termux.extensions

/** Inert compatibility seam: ordinary Cefrium retains its existing native toolbar. */
internal class TermuxChromeSurface(
    context: android.content.Context,
    container: android.widget.FrameLayout,
    origin: String,
    action: (String) -> Unit,
    state: () -> org.json.JSONObject,
    failure: (String) -> Unit,
) : java.io.Closeable {
    fun update(visible: Boolean) {}
    fun resume() {}
    fun pause() {}
    override fun close() {}
}
