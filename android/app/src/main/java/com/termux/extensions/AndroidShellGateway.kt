package com.termux.extensions

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets

/**
 * Same-origin API for the locally hosted Android launcher and Settings page.
 * It keeps Android persistence local while proxying only explicit TE2 catalog actions.
 */
class AndroidShellGateway(
    private val settingsStore: AndroidAppSettingsStore,
    private val httpClient: OkHttpClient,
    private val onSettingsChanged: (AndroidAppSettings) -> Unit,
    private val diagnosticsProvider: () -> JSONObject,
) {
    fun handle(request: LocalHttpRequest): LocalHttpResponse? {
        if (!request.path.startsWith(API_PREFIX)) return null
        return try {
            when {
                request.method == "GET" && request.path == "$API_PREFIX/settings" -> {
                    jsonResponse(200, settingsStore.load().toJson())
                }

                request.method == "GET" && request.path == "$API_PREFIX/debug" -> {
                    jsonResponse(200, diagnosticsProvider())
                }

                request.method == "PUT" && request.path == "$API_PREFIX/settings" -> {
                    val payload = JSONObject(request.body.toString(StandardCharsets.UTF_8))
                    val settings = settingsStore.update(payload)
                    onSettingsChanged(settings)
                    jsonResponse(200, settings.toJson())
                }

                request.method == "GET" && request.path == "$API_PREFIX/apps" -> {
                    appsResponse()
                }

                request.method == "POST" && request.path == "$API_PREFIX/apps/reload" -> {
                    forwardJson(settingsStore.load(), "/api/apps/reload", "POST")
                    appsResponse()
                }

                request.method == "GET" && request.path == "$API_PREFIX/framework/status" -> {
                    frameworkStatusResponse()
                }

                request.method == "GET" && request.path == "$API_PREFIX/fws/status" -> {
                    fwsStatusResponse()
                }

                request.method == "POST" -> appActionResponse(request.path)
                else -> jsonError(404, "Unknown Android shell API route")
            }
        } catch (error: IllegalArgumentException) {
            jsonError(400, error.message ?: "Invalid request")
        } catch (error: Exception) {
            jsonError(502, error.message ?: "Framework request failed")
        }
    }

    private fun appsResponse(): LocalHttpResponse {
        val settings = settingsStore.load()
        val apps = JSONArray().put(localSettingsApp())
        var online = false
        var errorMessage: String? = null

        try {
            val remote = forwardJson(settings, "/api/apps/catalog", "GET")
            val catalog = remote.optJSONArray("data")
                ?: throw IllegalStateException("Framework catalog response is missing data")
            for (index in 0 until catalog.length()) {
                val app = catalog.optJSONObject(index) ?: continue
                if (app.optString("id") == LOCAL_SETTINGS_APP_ID) continue
                apps.put(normalizeAppAssets(app, settings.frameworkBaseUrl))
            }
            online = true
        } catch (error: Exception) {
            errorMessage = error.message ?: "Framework unavailable"
        }

        return jsonResponse(200, JSONObject().apply {
            put("apps", apps)
            put("online", online)
            put("frameworkBaseUrl", settings.frameworkBaseUrl)
            if (errorMessage != null) put("error", errorMessage)
        })
    }

    private fun appActionResponse(path: String): LocalHttpResponse {
        val match = APP_ACTION_PATTERN.matchEntire(path)
            ?: return jsonError(404, "Unknown Android shell API route")
        val appId = match.groupValues[1]
        val action = match.groupValues[2]
        require(appId.matches(APP_ID_PATTERN)) { "Invalid app id" }

        if (appId == LOCAL_SETTINGS_APP_ID && action == "open") {
            return jsonResponse(200, JSONObject().put("url", LOCAL_SETTINGS_URL))
        }

        val settings = settingsStore.load()
        val remote = when (action) {
            "open" -> forwardJson(
                settings,
                "/api/apps/$appId/open",
                "POST",
                JSONObject().put("params", JSONObject().put("gv_native", "1")),
            )
            "quit" -> forwardJson(settings, "/api/apps/$appId/quit", "POST")
            else -> throw IllegalArgumentException("Unsupported app action")
        }

        val data = remote.optJSONObject("data") ?: JSONObject()
        if (action == "open") {
            val rawUrl = data.optString("url", "/app/$appId?gv_native=1")
            data.put("url", absoluteFrameworkUrl(settings.frameworkBaseUrl, rawUrl))
        }
        return jsonResponse(200, data)
    }

    private fun frameworkStatusResponse(): LocalHttpResponse {
        val settings = settingsStore.load()
        return try {
            forwardJson(settings, "/api/apps/catalog", "GET")
            jsonResponse(200, JSONObject().apply {
                put("online", true)
                put("frameworkBaseUrl", settings.frameworkBaseUrl)
            })
        } catch (error: Exception) {
            jsonResponse(200, JSONObject().apply {
                put("online", false)
                put("frameworkBaseUrl", settings.frameworkBaseUrl)
                put("error", error.message ?: "Framework unavailable")
            })
        }
    }

    private fun fwsStatusResponse(): LocalHttpResponse {
        val settings = settingsStore.load()
        val url = "${settings.frameworkBaseUrl}/fws"
        return try {
            val response = httpClient.newCall(Request.Builder().url(url).get().build()).execute()
            response.use {
                if (!it.isSuccessful) {
                    throw IllegalStateException("Framework Shells returned HTTP ${it.code}")
                }
            }
            jsonResponse(200, JSONObject().apply {
                put("available", true)
                put("url", url)
            })
        } catch (error: Exception) {
            jsonResponse(200, JSONObject().apply {
                put("available", false)
                put("url", url)
                put("error", error.message ?: "Framework Shells unavailable")
            })
        }
    }

    private fun forwardJson(
        settings: AndroidAppSettings,
        path: String,
        method: String,
        payload: JSONObject? = null,
    ): JSONObject {
        val builder = Request.Builder().url("${settings.frameworkBaseUrl}$path")
        when (method) {
            "GET" -> builder.get()
            "POST" -> builder.post(
                (payload?.toString() ?: "").toRequestBody(JSON_MEDIA_TYPE),
            )
            else -> throw IllegalArgumentException("Unsupported framework request method")
        }

        httpClient.newCall(builder.build()).execute().use { response ->
            val rawBody = response.body?.string().orEmpty()
            val body = if (rawBody.isBlank()) JSONObject() else JSONObject(rawBody)
            if (!response.isSuccessful || body.optBoolean("ok", true).not()) {
                val detail = body.opt("error")?.toString()?.takeIf { it.isNotBlank() }
                throw IllegalStateException(detail ?: "Framework returned HTTP ${response.code}")
            }
            return body
        }
    }

    private fun normalizeAppAssets(app: JSONObject, frameworkBaseUrl: String): JSONObject {
        val normalized = JSONObject(app.toString())
        val assetBase = normalized.optString("asset_base_url")
        if (assetBase.isNotBlank()) {
            normalized.put("asset_base_url", absoluteFrameworkUrl(frameworkBaseUrl, assetBase))
        }
        val iconSource = normalized.optString("icon_src")
        if (iconSource.isNotBlank()) {
            val absoluteIcon = when {
                iconSource.startsWith("http://") || iconSource.startsWith("https://") -> iconSource
                iconSource.startsWith('/') -> absoluteFrameworkUrl(frameworkBaseUrl, iconSource)
                assetBase.isNotBlank() -> {
                    "${absoluteFrameworkUrl(frameworkBaseUrl, assetBase).trimEnd('/')}/${iconSource.trimStart('/')}"
                }
                else -> absoluteFrameworkUrl(frameworkBaseUrl, iconSource)
            }
            normalized.put("icon_src", absoluteIcon)
        }
        return normalized
    }

    private fun localSettingsApp(): JSONObject = JSONObject().apply {
        put("id", LOCAL_SETTINGS_APP_ID)
        put("name", "Settings")
        put("description", "Android connection, transport, and framework options")
        put("icon_text", "S")
        put("local", true)
        put("running", true)
    }

    private fun absoluteFrameworkUrl(frameworkBaseUrl: String, raw: String): String {
        if (raw.startsWith("http://") || raw.startsWith("https://")) return raw
        return if (raw.startsWith('/')) {
            frameworkBaseUrl.trimEnd('/') + raw
        } else {
            frameworkBaseUrl.trimEnd('/') + "/" + raw
        }
    }

    private fun jsonResponse(status: Int, data: Any): LocalHttpResponse {
        val body = JSONObject().apply {
            put("ok", status in 200..299)
            put("data", data)
        }
        return LocalHttpResponse.text(
            status = status,
            body = body.toString(),
            contentType = "application/json; charset=utf-8",
        )
    }

    private fun jsonError(status: Int, message: String): LocalHttpResponse {
        val body = JSONObject().apply {
            put("ok", false)
            put("error", message)
        }
        return LocalHttpResponse.text(
            status = status,
            body = body.toString(),
            contentType = "application/json; charset=utf-8",
        )
    }

    companion object {
        private const val API_PREFIX = "/android-api"
        private const val LOCAL_SETTINGS_APP_ID = "settings"
        private const val LOCAL_SETTINGS_URL = "/android-shell/settings.html"
        private val APP_ACTION_PATTERN =
            Regex("^$API_PREFIX/apps/([^/]+)/(open|quit)$")
        private val APP_ID_PATTERN = Regex("[A-Za-z0-9._-]+")
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}
