package com.termux.extensions

import org.json.JSONObject
import java.net.URI

internal data class AndroidDevRuntimeSurface(
    val surfaceId: String,
    val profileId: String,
    val targetId: String,
    val targetLabel: String,
    val devRuntime: Boolean,
    val devTools: Boolean,
    val workerIdBase: String,
    val workerLabel: String,
    val origins: Set<String>,
)

/** Android-owned registry for validated native Run Profile instrumentation intent. */
internal class AndroidDevRuntimeSurfaceRegistry {
    private val surfaces = mutableMapOf<String, AndroidDevRuntimeSurface>()

    @Synchronized
    fun register(params: JSONObject, expectedFrameworkOrigin: String): AndroidDevRuntimeSurface {
        val runtime = params.optJSONObject("runtime")
            ?: throw IllegalArgumentException("Run Profile runtime metadata is missing")
        val devRuntime = runtime.optBoolean("devRuntime", false)
        val devTools = runtime.optBoolean("devTools", false)
        require(devRuntime || devTools) {
            "Run Profile native integration is not enabled"
        }
        val surfaceId = runtime.optString("surfaceId").trim()
        require(surfaceId.isNotEmpty() && surfaceId.length <= 256) {
            "Run Profile surface id is invalid"
        }
        val targetId = runtime.optString("targetId").trim().take(256)
        require(!devTools || targetId.isNotEmpty()) {
            "Run Profile developer-tools target id is invalid"
        }
        val targetLabel = runtime.optString("targetLabel").trim().take(256)
            .ifEmpty { targetId.ifEmpty { surfaceId } }
        val frameworkOrigin = normalizedHttpOrigin(runtime.optString("frameworkOrigin"))
        require(frameworkOrigin == normalizedHttpOrigin(expectedFrameworkOrigin)) {
            "Run Profile framework origin is not trusted"
        }
        val origins = linkedSetOf(normalizedLoopbackOrigin(params.optString("url")))
        params.optJSONObject("route")?.let { route ->
            val routeSet = normalizeAndroidRunTargetRouteSet(route)
            (listOf(routeSet.primary) + routeSet.additional).forEach { entry ->
                origins += normalizedLoopbackOrigin(localAndroidRunTargetUrl(entry))
            }
        }
        val surface = AndroidDevRuntimeSurface(
            surfaceId = surfaceId,
            profileId = runtime.optString("profileId").trim().take(256),
            targetId = targetId,
            targetLabel = targetLabel,
            devRuntime = devRuntime,
            devTools = devTools,
            workerIdBase = runtime.optString("workerIdBase").trim().take(64)
                .ifEmpty { "rp-prof" },
            workerLabel = runtime.optString("workerLabel").trim().take(256)
                .ifEmpty { surfaceId },
            origins = origins,
        )
        surfaces[surfaceId] = surface
        return surface
    }

    @Synchronized
    fun release(surfaceId: String): Boolean = surfaces.remove(surfaceId.trim()) != null

    @Synchronized
    fun clear() = surfaces.clear()

    @Synchronized
    fun snapshot(): List<AndroidDevRuntimeSurface> = surfaces.values.toList()

    private fun normalizedLoopbackOrigin(rawUrl: String): String {
        val uri = URI(rawUrl)
        require(uri.scheme.equals("http", ignoreCase = true) && uri.userInfo == null) {
            "Run Profile URL must be credential-free HTTP"
        }
        require(uri.host?.removeSurrounding("[", "]")?.lowercase() in LOOPBACK_HOSTS) {
            "Run Profile URL must address client loopback"
        }
        return normalizedHttpOrigin(rawUrl)
    }

    private fun normalizedHttpOrigin(rawUrl: String): String {
        val uri = URI(rawUrl)
        require(uri.scheme.equals("http", ignoreCase = true) && uri.userInfo == null) {
            "Native bridge origin must be credential-free HTTP"
        }
        val host = uri.host ?: throw IllegalArgumentException("Native bridge origin has no host")
        val port = if (uri.port >= 0) uri.port else 80
        require(port in 1..65535) { "Native bridge origin port is invalid" }
        return URI("http", null, host.lowercase(), port, null, null, null).toASCIIString()
    }

    companion object {
        private val LOOPBACK_HOSTS = setOf("127.0.0.1", "localhost", "::1")
    }
}
