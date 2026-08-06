package com.termux.extensions

import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.CacheControl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import org.json.JSONObject

/**
 * Process-local, non-persistent client for the Rust framework's authoritative
 * Run Target projection stream.
 *
 * Every connection begins with a fresh remote snapshot. Nothing from this
 * stream is written to preferences, files, logs, or another cache.
 */
internal class RunTargetProjectionClient(
    private val httpClient: OkHttpClient,
    private val reconnectDelayMs: Long = DEFAULT_RECONNECT_DELAY_MS,
) {
    companion object {
        private const val TAG = "RunTargetProjection"
        private const val EVENTS_PATH = "/api/run-targets/events"
        private const val SNAPSHOT_EVENT = "run_target_routes_snapshot"
        private const val CHANGED_EVENT = "run_target_routes_changed"
        private const val DEFAULT_RECONNECT_DELAY_MS = 2_000L
    }

    private val lock = Any()
    private val handler = Handler(Looper.getMainLooper())
    private val eventSourceFactory = EventSources.createFactory(httpClient)
    private var generation = 0L
    private var frameworkBaseUrl = ""
    private var eventSource: EventSource? = null
    private var pendingReconnect: Runnable? = null

    var onProjection: ((JSONObject) -> Unit)? = null
    var onTransportUnavailable: ((Throwable?) -> Unit)? = null

    fun connect(baseUrl: String) {
        val normalized = baseUrl.trimEnd('/')
        val nextGeneration = synchronized(lock) {
            generation += 1
            pendingReconnect?.let(handler::removeCallbacks)
            pendingReconnect = null
            eventSource?.cancel()
            eventSource = null
            frameworkBaseUrl = normalized
            generation
        }
        open(nextGeneration)
    }

    fun disconnect() {
        synchronized(lock) {
            generation += 1
            pendingReconnect?.let(handler::removeCallbacks)
            pendingReconnect = null
            eventSource?.cancel()
            eventSource = null
            frameworkBaseUrl = ""
        }
    }

    private fun open(candidate: Long) {
        val request = synchronized(lock) {
            if (candidate != generation || frameworkBaseUrl.isBlank()) return
            Request.Builder()
                .url(frameworkBaseUrl + EVENTS_PATH)
                .header("Accept", "text/event-stream")
                .cacheControl(
                    CacheControl.Builder()
                        .noCache()
                        .noStore()
                        .build(),
                )
                .build()
        }
        val source = eventSourceFactory.newEventSource(
            request,
            object : EventSourceListener() {
                override fun onOpen(eventSource: EventSource, response: Response) {
                    if (!isCurrent(candidate, eventSource)) return
                    Log.i(TAG, "Connected to authoritative Run Target stream")
                }

                override fun onEvent(
                    eventSource: EventSource,
                    id: String?,
                    type: String?,
                    data: String,
                ) {
                    if (!isCurrent(candidate, eventSource)) return
                    if (type != SNAPSHOT_EVENT && type != CHANGED_EVENT) return
                    val projection = runCatching { JSONObject(data) }.getOrElse { error ->
                        Log.w(TAG, "Rejected malformed Run Target projection", error)
                        return
                    }
                    onProjection?.invoke(projection)
                }

                override fun onClosed(eventSource: EventSource) {
                    if (!clearCurrent(candidate, eventSource)) return
                    onTransportUnavailable?.invoke(null)
                    scheduleReconnect(candidate)
                }

                override fun onFailure(
                    eventSource: EventSource,
                    t: Throwable?,
                    response: Response?,
                ) {
                    if (!clearCurrent(candidate, eventSource)) return
                    val error = t ?: IllegalStateException(
                        "Run Target stream closed with HTTP ${response?.code ?: "unknown"}",
                    )
                    Log.w(TAG, "Run Target stream unavailable; reconnect scheduled", error)
                    onTransportUnavailable?.invoke(error)
                    scheduleReconnect(candidate)
                }
            },
        )
        synchronized(lock) {
            if (candidate == generation && eventSource == null) {
                eventSource = source
            } else {
                source.cancel()
            }
        }
    }

    private fun isCurrent(candidate: Long, source: EventSource): Boolean = synchronized(lock) {
        candidate == generation && eventSource === source
    }

    private fun clearCurrent(candidate: Long, source: EventSource): Boolean = synchronized(lock) {
        if (candidate != generation || eventSource !== source) return@synchronized false
        eventSource = null
        true
    }

    private fun scheduleReconnect(candidate: Long) {
        val runnable = synchronized(lock) {
            if (candidate != generation || pendingReconnect != null) return
            Runnable {
                synchronized(lock) {
                    if (candidate != generation) return@Runnable
                    pendingReconnect = null
                }
                open(candidate)
            }.also { pendingReconnect = it }
        }
        handler.postDelayed(runnable, reconnectDelayMs)
    }
}
