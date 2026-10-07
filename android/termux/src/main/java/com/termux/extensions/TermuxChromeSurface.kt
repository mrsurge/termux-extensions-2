package com.termux.extensions

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.FrameLayout
import com.cefrium.CefriumBrowser
import dev.mrsurge.electromux.host.ChromeSurfaceHost
import dev.mrsurge.electromux.host.ChromeSurfaceSpec
import dev.mrsurge.electromux.host.ConsumerDescriptor
import dev.mrsurge.electromux.host.ConsumerPageProtocol
import dev.mrsurge.electromux.host.ConsumerResult
import dev.mrsurge.electromux.host.RendererEventGate
import java.io.Closeable
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject

internal object TermuxChromePolicy {
    fun descriptor(origin: String): ConsumerDescriptor {
        val base = origin.trimEnd('/')
        val page = "$base/android-shell/chrome.html"
        return ConsumerDescriptor("te2-termux.chrome", "TE2 Termux toolbar", page,
            setOf("android-shell/chrome.html"), mapOf(page to "android-shell/chrome.html"),
            setOf("view_action", "get_chrome_state"), setOf("chrome-state"), base)
    }

    fun protocol(descriptor: ConsumerDescriptor, action: (String) -> Unit,
                 state: () -> JSONObject) = ConsumerPageProtocol(descriptor, mapOf(
        "get_chrome_state" to { params ->
            require(params.length() == 0)
            ConsumerResult(state())
        },
        "view_action" to { params ->
            require(params.length() == 1)
            val name = params.getString("action")
            require(name in setOf("home", "reload", "recents", "lock", "quit", "tools"))
            action(name)
            ConsumerResult(state())
        },
    ))
}

/** TE2 adapter. Chrome is a separate browser, never the application browser's query handler. */
internal class TermuxChromeSurface(
    context: Activity,
    private val container: FrameLayout,
    origin: String,
    private val action: (String) -> Unit,
    private val state: () -> JSONObject,
    private val failure: (String) -> Unit,
) : Closeable {
    private val page = "${origin.trimEnd('/')}/android-shell/chrome.html"
    private val descriptor = TermuxChromePolicy.descriptor(origin)
    private val spec = ChromeSurfaceSpec(descriptor, 48)
    private val gate = RendererEventGate(descriptor.routes.keys)
    private val main = Handler(Looper.getMainLooper())
    private val pending = AtomicInteger()
    @Volatile private var closed = false
    private var loading = false
    private var recovered = false
    private var renderer: CefriumBrowser? = null
    private val protocol = TermuxChromePolicy.protocol(descriptor, action, state)
    private val attachment = spec.attach(ChromeSurfaceHost { declared ->
        check(declared.placement == ChromeSurfaceSpec.Placement.TOP)
        container.layoutParams = container.layoutParams.apply {
            height = (declared.heightDp * context.resources.displayMetrics.density).toInt()
        }
        val browser = CefriumBrowser.createWithSurface(context)
        renderer = browser
        browser.setPinchToZoomEnabled(false)
        browser.setPullToRefreshEnabled(false)
        browser.setQueryHandler { _, raw, caller, callback ->
            if (closed) {
                callback.failure(503, "Chrome closed")
                return@setQueryHandler true
            }
            if (pending.incrementAndGet() > 8) {
                pending.decrementAndGet()
                callback.failure(503, "Chrome request queue unavailable")
                return@setQueryHandler true
            }
            main.post {
                try {
                    val generation = gate.captureRequest(caller)
                    if (closed || generation == null || browser.url != caller) {
                        callback.failure(403, "Packaged chrome document required")
                    } else try {
                        val request = protocol.parse(raw, caller)
                        require(request.documentId != null)
                        gate.bind(generation, caller, request.documentId)
                        callback.success(protocol.execute(request).toString())
                    } catch (_: Exception) {
                        callback.failure(400, "Invalid chrome request")
                    }
                } finally { pending.decrementAndGet() }
            }
        }
        browser.setOnUrlChangedListener { url -> main.post { gate.changePage(url) } }
        // Cefrium's loading listener also installs its native JS query plumbing.
        browser.setOnLoadingStateChangedListener { busy, _, _ -> main.post {
            if (!closed) {
                if (busy && !loading) gate.beginNavigation()
                loading = busy
                gate.changePage(browser.url)
                if (!busy && browser.url == page) browser.evaluateJavaScript(
                    "window.dispatchEvent(new Event('electromux:page-ready'))")
            }
        } }
        browser.setOnRenderProcessTerminatedListener { _, _ -> main.post {
            if (!closed) {
                gate.beginNavigation()
                if (!recovered) { recovered = true; browser.loadUrl(page) }
                else failure("Toolbar renderer stopped; reopen the client to recover")
            }
        } }
        browser.setPermissionHandler { _, _, callback -> callback.respond(false) }
        container.addView(browser.surfaceContainer,
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        browser.loadUrl(declared.consumer.entrypoint)
        Closeable { container.removeView(browser.surfaceContainer); browser.close() }
    })

    fun update(visible: Boolean) {
        container.visibility = if (visible) View.VISIBLE else View.GONE
        val ticket = gate.captureEvent() ?: return
        if (closed || !gate.accepts(ticket) || renderer?.url != ticket.page) return
        val envelope = JSONObject().put("documentId", ticket.documentId)
            .put("name", "chrome-state").put("payload", state()).toString()
        renderer?.evaluateJavaScript("window.__electromuxReceiveEvent?.(${JSONObject.quote(envelope)})")
    }
    fun resume() { renderer?.onResume() }
    fun pause() { renderer?.onPause() }
    override fun close() {
        if (closed) return
        closed = true
        gate.close()
        main.removeCallbacksAndMessages(null)
        attachment.close()
        renderer = null
    }
}
