package com.termux.extensions.nativeeditor

import android.util.Log
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

internal data class NativeSidebarProjection(
    val activeHostId: String,
    val loadedUrls: Map<String, String>,
    val loading: Boolean,
    val message: String,
    val error: String? = null,
)

private data class NativeSidebarStartResult(val error: String? = null) {
    val isSuccess: Boolean
        get() = error == null
}

internal data class NativeSidebarSlotPlan(
    val item: NativeSidebarItem,
    val startRequired: Boolean,
)

/**
 * Native sidebar lifecycle subsystem. Backend slot facts remain authoritative;
 * every slot in that ledger owns a loaded view until the backend removes it,
 * while delayed lifecycle results are stale-dropped by projection generation.
 */
internal class NativeSidebarRuntime(private val httpClient: OkHttpClient) {
    companion object {
        private const val TAG = "NativeSidebarRuntime"
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()
    }

    private val projectionGeneration = AtomicLong(0)
    private val inFlightStarts = ConcurrentHashMap<String, CompletableFuture<NativeSidebarStartResult>>()
    private val startedApps = ConcurrentHashMap.newKeySet<String>()
    private val loadedUrls = ConcurrentHashMap<String, String>()
    private val slotErrors = ConcurrentHashMap<String, String>()

    @Volatile
    private var baseUrl = ""

    @Volatile
    private var released = false

    fun bind(nextBaseUrl: String) {
        projectionGeneration.incrementAndGet()
        baseUrl = nextBaseUrl.trimEnd('/')
        startedApps.clear()
        loadedUrls.clear()
        slotErrors.clear()
        released = false
    }

    fun reconcile(
        items: List<NativeSidebarItem>,
        publish: (NativeSidebarProjection) -> Unit,
    ) {
        if (released) return
        val generation = projectionGeneration.incrementAndGet()
        val desiredHostIds = items.mapTo(mutableSetOf()) { it.hostId }
        loadedUrls.keys.removeAll { it !in desiredHostIds }
        slotErrors.keys.removeAll { it !in desiredHostIds }

        val active = items.firstOrNull { it.active }
        items.filter { it.kind != "app" }
            .forEach(::retainLoadedUrl)
        publishCurrent(active, publish)

        fetchRunningApps().whenComplete { runningApps, runningFailure ->
            if (released || projectionGeneration.get() != generation) return@whenComplete
            val running = runningApps.orEmpty()
            if (runningFailure != null) {
                Log.w(
                    TAG,
                    "Sidebar running-app query failed: ${runningFailure.message ?: "unknown error"}",
                )
            }
            nativeSidebarPersistencePlan(items, running).forEach { plan ->
                val item = plan.item
                if (!item.requiresFrameworkStart) {
                    retainLoadedUrl(item)
                    publishCurrent(active, publish)
                    return@forEach
                }
                if (!plan.startRequired) {
                    startedApps.add(startKey(item.appId))
                    retainLoadedUrl(item)
                    publishCurrent(active, publish)
                    return@forEach
                }

                ensureStarted(item.appId).whenComplete startComplete@{ result, startFailure ->
                    if (released || projectionGeneration.get() != generation) return@startComplete
                    val error = startFailure?.message ?: result?.error
                    if (error == null) {
                        slotErrors.remove(item.hostId)
                        retainLoadedUrl(item)
                    } else {
                        slotErrors[item.hostId] = error
                    }
                    publishCurrent(active, publish)
                }
            }
        }
    }

    fun release() {
        released = true
        projectionGeneration.incrementAndGet()
        inFlightStarts.values.forEach { it.cancel(false) }
        inFlightStarts.clear()
        startedApps.clear()
        loadedUrls.clear()
        slotErrors.clear()
    }

    private fun publishCurrent(
        active: NativeSidebarItem?,
        publish: (NativeSidebarProjection) -> Unit,
    ) {
        val activeHostId = active?.hostId.orEmpty()
        val activeUrl = loadedUrls[activeHostId].orEmpty()
        val activeError = slotErrors[activeHostId]
        publish(
            NativeSidebarProjection(
                activeHostId = activeHostId,
                loadedUrls = loadedUrls.toMap(),
                loading = active != null && activeUrl.isBlank() && activeError == null,
                message = when {
                    active == null -> "Select a sidebar app"
                    activeError != null -> "Unable to start ${active.title}"
                    activeUrl.isBlank() -> "Starting ${active.title}..."
                    else -> active.readinessMessage()
                },
                error = activeError,
            ),
        )
    }

    private fun fetchRunningApps(): CompletableFuture<Set<String>> {
        val future = CompletableFuture<Set<String>>()
        val endpoint = baseUrl.toHttpUrlOrNull()
            ?.newBuilder()
            ?.addPathSegments("api/apps/running")
            ?.build()
        if (endpoint == null) {
            future.completeExceptionally(IllegalStateException("Invalid framework URL"))
            return future
        }
        httpClient.newCall(Request.Builder().url(endpoint).get().build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                future.completeExceptionally(e)
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    try {
                        val body = JSONObject(it.body?.string().orEmpty().ifBlank { "{}" })
                        if (!it.isSuccessful || !body.optBoolean("ok", true)) {
                            throw IllegalStateException(
                                body.opt("error")?.toString()?.takeIf(String::isNotBlank)
                                    ?: "Framework returned HTTP ${it.code}",
                            )
                        }
                        val data = body.optJSONArray("data")
                        val running = buildSet {
                            if (data != null) {
                                for (index in 0 until data.length()) {
                                    val item = data.optJSONObject(index) ?: continue
                                    val appId = item.optString("app_id")
                                        .ifBlank { item.optString("id") }
                                        .trim()
                                    if (appId.isNotBlank()) add(appId)
                                }
                            }
                        }
                        future.complete(running)
                    } catch (error: Exception) {
                        future.completeExceptionally(error)
                    }
                }
            }
        })
        return future
    }

    private fun retainLoadedUrl(item: NativeSidebarItem) {
        loadedUrls.compute(item.hostId) { _, currentUrl ->
            nativeSidebarRetainedLoadUrl(currentUrl, item.url)
        }
    }

    private fun ensureStarted(appId: String): CompletableFuture<NativeSidebarStartResult> {
        val key = startKey(appId)
        if (baseUrl.isBlank() || appId.isBlank()) {
            return CompletableFuture.completedFuture(
                NativeSidebarStartResult("Framework app start target is unavailable"),
            )
        }
        if (key in startedApps) {
            return CompletableFuture.completedFuture(NativeSidebarStartResult())
        }

        val pending = CompletableFuture<NativeSidebarStartResult>()
        val existing = inFlightStarts.putIfAbsent(key, pending)
        if (existing != null) return existing

        val endpoint = baseUrl.toHttpUrlOrNull()
            ?.newBuilder()
            ?.addPathSegments("api/apps")
            ?.addPathSegment(appId)
            ?.addPathSegment("start")
            ?.build()
        if (endpoint == null) {
            completeStart(key, appId, pending, NativeSidebarStartResult("Invalid framework URL"))
            return pending
        }
        val request = Request.Builder()
            .url(endpoint)
            .post(ByteArray(0).toRequestBody(JSON_MEDIA_TYPE))
            .build()
        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                completeStart(
                    key,
                    appId,
                    pending,
                    NativeSidebarStartResult(e.message ?: "Framework app start failed"),
                )
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val rawBody = it.body?.string().orEmpty()
                    val body = runCatching {
                        if (rawBody.isBlank()) JSONObject() else JSONObject(rawBody)
                    }.getOrElse { parseError ->
                        completeStart(
                            key,
                            appId,
                            pending,
                            NativeSidebarStartResult(
                                "Invalid app start response: ${parseError.message ?: "invalid JSON"}",
                            ),
                        )
                        return
                    }
                    val successful = it.isSuccessful && body.optBoolean("ok", true)
                    val error = if (successful) {
                        null
                    } else {
                        body.opt("error")?.toString()?.takeIf(String::isNotBlank)
                            ?: body.opt("detail")?.toString()?.takeIf(String::isNotBlank)
                            ?: "Framework returned HTTP ${it.code}"
                    }
                    completeStart(key, appId, pending, NativeSidebarStartResult(error))
                }
            }
        })
        return pending
    }

    private fun completeStart(
        key: String,
        appId: String,
        future: CompletableFuture<NativeSidebarStartResult>,
        result: NativeSidebarStartResult,
    ) {
        inFlightStarts.remove(key, future)
        if (result.isSuccess) {
            startedApps.add(key)
            Log.i(TAG, "Sidebar framework app ready to load appId=$appId")
        } else {
            Log.w(TAG, "Sidebar framework app start failed appId=$appId error=${result.error}")
        }
        future.complete(result)
    }

    private fun startKey(appId: String): String = "$baseUrl|$appId"
}

internal fun nativeSidebarPersistencePlan(
    items: List<NativeSidebarItem>,
    runningApps: Set<String>,
): List<NativeSidebarSlotPlan> = items.map { item ->
    NativeSidebarSlotPlan(
        item = item,
        startRequired = item.requiresFrameworkStart && item.appId !in runningApps,
    )
}

/** Matches the browser iframe pool: projection updates do not navigate an already loaded slot. */
internal fun nativeSidebarRetainedLoadUrl(currentUrl: String?, projectedUrl: String): String? =
    currentUrl?.takeIf(String::isNotBlank) ?: projectedUrl.takeIf(String::isNotBlank)

private val NativeSidebarItem.requiresFrameworkStart: Boolean
    get() = kind == "app" && appId.isNotBlank()

private fun NativeSidebarItem.readinessMessage(): String = when (readinessStatus.lowercase()) {
    "starting", "loading", "pending" -> "$title is starting"
    "error", "failed" -> readinessMessage.ifBlank { "$title reported an error" }
    else -> readinessMessage
}
