package com.termux.extensions

import android.os.Handler
import android.os.Looper
import com.cefrium.CefriumBrowser
import dev.mrsurge.electromux.host.ConsumerPageProtocol
import dev.mrsurge.electromux.host.ConsumerResult
import dev.mrsurge.electromux.host.RendererEventGate
import java.io.Closeable
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject

/** Only exact native-served launcher/settings documents have local execution authority. */
internal class TermuxLocalPageBridge(service: PersistentNetworkService, private val evaluate: (String) -> Unit,
                                   private val currentPage: () -> String) : Closeable {
    private val runtime = checkNotNull(service.localFrameworkRuntime)
    private val main = Handler(Looper.getMainLooper())
    private val origin = service.browserFrameworkBaseUrl().trimEnd('/')
    private val descriptor = TermuxLocalControlPolicy.descriptor(origin)
    private val protocol = ConsumerPageProtocol(descriptor, descriptor.methods.associateWith { method ->
        { params: JSONObject -> ConsumerResult(runtime.request(method, params)) }
    })
    private val gate = RendererEventGate(descriptor.routes.keys)
    private var subscription: Closeable? = null
    private val pendingEvents = AtomicInteger()
    @Volatile private var closed = false

    @Synchronized fun beginNavigation() {
        gate.beginNavigation(); subscription?.close(); subscription = null
    }
    @Synchronized fun changePage(page: String?) {
        gate.changePage(page)
        if (gate.captureEvent() == null) { subscription?.close(); subscription = null }
    }

    @Synchronized fun pageReady() {
        val page = currentPage()
        gate.changePage(page)
        if (!closed && gate.captureRequest(page) != null)
            evaluate("window.dispatchEvent(new Event('electromux:page-ready'))")
    }

    fun handle(request: String, origin: String, callback: CefriumBrowser.QueryCallback): Boolean {
        val method = try { JSONObject(request).optString("method") } catch (_: Exception) { return false }
        if (method !in descriptor.methods) return false
        val generation = gate.captureRequest(origin)
        if (closed || generation == null || currentPage() != origin) {
            callback.failure(403, "Local control requires the packaged launcher"); return true
        }
        val parsed = try { protocol.parse(request, origin) } catch (_: Exception) {
            callback.failure(400, "Invalid local control request"); return true
        }
        try {
            runtime.execute {
                if (closed || !gate.current(generation, origin)) return@execute
                try {
                    synchronized(this) {
                        gate.bind(generation, origin, parsed.documentId)
                        val ticket = gate.captureEvent()
                        if (ticket != null && subscription == null) subscription = runtime.subscribe { name, frame ->
                            val payload = frame.optJSONObject("data") ?: return@subscribe
                            if (!gate.accepts(ticket)) return@subscribe
                            val envelope = JSONObject().put("documentId", ticket.documentId)
                                .put("name", name).put("payload", payload).toString()
                            if (envelope.toByteArray().size > 65536) return@subscribe
                            if (pendingEvents.incrementAndGet() > 16) {
                                pendingEvents.decrementAndGet(); error("Renderer event queue full")
                            }
                            main.post {
                                try {
                                    if (!closed && gate.accepts(ticket) && currentPage() == origin)
                                        evaluate("window.__electromuxReceiveEvent?.(${JSONObject.quote(envelope)})")
                                } finally { pendingEvents.decrementAndGet() }
                            }
                        }
                    }
                    val response = protocol.execute(parsed).toString()
                    main.post {
                        if (!closed && gate.current(generation, origin) && currentPage() == origin)
                            callback.success(response)
                    }
                } catch (_: Exception) {
                    main.post { if (!closed && gate.current(generation, origin))
                        callback.failure(400, "Local control document rejected") }
                }
            }
        } catch (_: Exception) { callback.failure(503, "Local control queue unavailable") }
        return true
    }

    @Synchronized override fun close() {
        closed = true; gate.close(); subscription?.close(); subscription = null
    }
}
