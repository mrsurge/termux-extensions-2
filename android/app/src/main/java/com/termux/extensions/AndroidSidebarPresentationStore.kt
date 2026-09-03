package com.termux.extensions

import android.content.Context
import java.net.URI
import java.security.MessageDigest
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

private const val SIDEBAR_PRESENTATION_PREFERENCES = "android_sidebar_presentation"
private const val SIDEBAR_PRESENTATION_STORE_KEY = "store_v1"
private const val SIDEBAR_PRESENTATION_STORE_VERSION = 1
private const val SIDEBAR_PRESENTATION_STATE_VERSION = 1
private const val MAX_PRESENTATION_PROJECTS = 32
private const val MAX_PRESENTATION_IDS = 256
private const val MAX_ID_LENGTH = 512
private const val MAX_PROJECT_PATH_LENGTH = 2_048
private const val MAX_PRESENTATION_BYTES = 256 * 1_024

/**
 * Application-private presentation storage implemented once for GeckoView and
 * Cefrium. Each APK retains its own sandboxed records.
 *
 * Browser storage is scoped to the native relay's random loopback port, so it
 * cannot own state that must survive a cold native-client restart. Records are
 * instead partitioned by the stable client id, configured framework origin,
 * and remote project path.
 */
internal class AndroidSidebarPresentationStore internal constructor(
    private val readPayload: () -> String?,
    private val writePayload: (String) -> Boolean,
) {
    constructor(context: Context) : this(
        readPayload = {
            context.applicationContext.getSharedPreferences(
                SIDEBAR_PRESENTATION_PREFERENCES,
                Context.MODE_PRIVATE,
            ).getString(SIDEBAR_PRESENTATION_STORE_KEY, null)
        },
        writePayload = { payload ->
            context.applicationContext.getSharedPreferences(
                SIDEBAR_PRESENTATION_PREFERENCES,
                Context.MODE_PRIVATE,
            ).edit().putString(SIDEBAR_PRESENTATION_STORE_KEY, payload).commit()
        },
    )

    fun read(
        clientInstanceId: String,
        frameworkOrigin: String,
        projectPath: String,
    ): JSONObject? = synchronized(LOCK) {
        val identity = normalizedIdentity(clientInstanceId, frameworkOrigin, projectPath)
        val store = readStore()
        val record = store.optJSONObject("records")?.optJSONObject(identity.key)
            ?: return@synchronized null
        if (
            record.optString("clientInstanceId") != identity.clientInstanceId ||
            record.optString("frameworkOrigin") != identity.frameworkOrigin ||
            record.optString("projectPath") != identity.projectPath
        ) {
            return@synchronized null
        }
        normalizeState(record.optJSONObject("state") ?: return@synchronized null)
    }

    fun write(
        clientInstanceId: String,
        frameworkOrigin: String,
        projectPath: String,
        state: JSONObject,
    ) = synchronized(LOCK) {
        val identity = normalizedIdentity(clientInstanceId, frameworkOrigin, projectPath)
        val normalizedState = normalizeState(state)
        require(normalizedState.toString().toByteArray(Charsets.UTF_8).size <= MAX_PRESENTATION_BYTES) {
            "Sidebar presentation state is too large"
        }
        val store = readStore()
        val records = store.optJSONObject("records") ?: JSONObject().also {
            store.put("records", it)
        }
        records.remove(identity.key)
        records.put(
            identity.key,
            JSONObject()
                .put("clientInstanceId", identity.clientInstanceId)
                .put("frameworkOrigin", identity.frameworkOrigin)
                .put("projectPath", identity.projectPath)
                .put("updatedAt", System.currentTimeMillis())
                .put("state", normalizedState),
        )
        val retained = jsonObjectEntries(records)
            .sortedBy { (_, value) -> value.optLong("updatedAt", 0L) }
            .takeLast(MAX_PRESENTATION_PROJECTS)
        val boundedRecords = JSONObject()
        retained.forEach { (key, value) -> boundedRecords.put(key, value) }
        store.put("records", boundedRecords)
        check(writePayload(store.toString())) { "Unable to persist Sidebar presentation state" }
    }

    private fun readStore(): JSONObject {
        val raw = readPayload() ?: return emptyStore()
        return try {
            JSONObject(raw).takeIf {
                it.optInt("version", 0) == SIDEBAR_PRESENTATION_STORE_VERSION &&
                    it.optJSONObject("records") != null
            } ?: emptyStore()
        } catch (_: Exception) {
            emptyStore()
        }
    }

    private fun emptyStore(): JSONObject = JSONObject()
        .put("version", SIDEBAR_PRESENTATION_STORE_VERSION)
        .put("records", JSONObject())

    private fun normalizedIdentity(
        rawClientInstanceId: String,
        rawFrameworkOrigin: String,
        rawProjectPath: String,
    ): PresentationIdentity {
        val clientInstanceId = rawClientInstanceId.trim().lowercase(Locale.ROOT)
        require(clientInstanceId.matches(Regex("client_[a-z0-9]{12,64}"))) {
            "Sidebar presentation client identity is invalid"
        }
        val frameworkOrigin = normalizedHttpOrigin(rawFrameworkOrigin)
        val projectPath = rawProjectPath.trim().let {
            if (it == "/") it else it.trimEnd('/')
        }
        require(
            projectPath.startsWith('/') &&
                projectPath.length in 1..MAX_PROJECT_PATH_LENGTH,
        ) { "Sidebar presentation project path is invalid" }
        val keySource = "$clientInstanceId\u0000$frameworkOrigin\u0000$projectPath"
        val key = MessageDigest.getInstance("SHA-256")
            .digest(keySource.toByteArray(Charsets.UTF_8))
            .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
        return PresentationIdentity(clientInstanceId, frameworkOrigin, projectPath, key)
    }

    private fun normalizedHttpOrigin(rawValue: String): String {
        val parsed = URI(rawValue.trim())
        val scheme = parsed.scheme?.lowercase(Locale.ROOT).orEmpty()
        require(scheme == "http" || scheme == "https") {
            "Sidebar presentation framework origin is invalid"
        }
        require(parsed.userInfo == null) { "Sidebar presentation framework origin is invalid" }
        val host = parsed.host?.lowercase(Locale.ROOT).orEmpty()
        require(host.isNotEmpty()) { "Sidebar presentation framework origin is invalid" }
        return URI(scheme, null, host, parsed.port, null, null, null).toString()
    }

    private fun normalizeState(raw: JSONObject): JSONObject {
        require(raw.optInt("version", 0) == SIDEBAR_PRESENTATION_STATE_VERSION) {
            "Sidebar presentation state version is unsupported"
        }
        val order = normalizedIdArray(raw.optJSONArray("order") ?: JSONArray())
        val knownIds = buildSet {
            for (index in 0 until order.length()) add(order.getString(index))
        }
        val rawPresentations = raw.optJSONObject("presentations") ?: JSONObject()
        val presentations = JSONObject()
        val keys = rawPresentations.keys()
        while (keys.hasNext() && presentations.length() < MAX_PRESENTATION_IDS) {
            val rawId = keys.next()
            val id = normalizedId(rawId)
            val mode = rawPresentations.optString(rawId)
            if (id !in knownIds) continue
            require(mode in PRESENTATION_MODES) {
                "Sidebar presentation mode is invalid"
            }
            presentations.put(id, mode)
        }
        for (index in 0 until order.length()) {
            val id = order.getString(index)
            if (!presentations.has(id)) presentations.put(id, "embedded")
        }
        return JSONObject()
            .put("version", SIDEBAR_PRESENTATION_STATE_VERSION)
            .put("order", order)
            .put("foregroundHostId", normalizedKnownId(raw.optString("foregroundHostId"), knownIds))
            .put("lastAgentHostId", normalizedKnownId(raw.optString("lastAgentHostId"), knownIds))
            .put("lastAgentPresentationId", "")
            .put("presentations", presentations)
    }

    private fun normalizedIdArray(raw: JSONArray): JSONArray {
        val result = JSONArray()
        val seen = mutableSetOf<String>()
        for (index in 0 until minOf(raw.length(), MAX_PRESENTATION_IDS)) {
            val id = normalizedId(raw.optString(index))
            if (id.isNotEmpty() && seen.add(id)) result.put(id)
        }
        return result
    }

    private fun normalizedKnownId(raw: String, knownIds: Set<String>): String {
        val id = normalizedId(raw)
        return if (id in knownIds) id else ""
    }

    private fun normalizedId(raw: String): String = raw.trim().take(MAX_ID_LENGTH)

    private fun jsonObjectEntries(value: JSONObject): List<Pair<String, JSONObject>> {
        val result = mutableListOf<Pair<String, JSONObject>>()
        val keys = value.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            value.optJSONObject(key)?.let { result += key to it }
        }
        return result
    }

    private data class PresentationIdentity(
        val clientInstanceId: String,
        val frameworkOrigin: String,
        val projectPath: String,
        val key: String,
    )

    private companion object {
        val LOCK = Any()
        val PRESENTATION_MODES = setOf("embedded", "hidden", "detached")
    }
}

internal fun handleAndroidSidebarPresentationRequest(
    context: Context,
    store: AndroidSidebarPresentationStore,
    frameworkOrigin: String,
    method: String,
    params: JSONObject,
): JSONObject {
    val clientInstanceId = params.optString("clientInstanceId").trim().lowercase(Locale.ROOT)
    val allowedClientIds = setOf(
        androidClientInstanceId(context),
        androidClientInstanceId(context, "secondary"),
    )
    require(clientInstanceId in allowedClientIds) {
        "Sidebar presentation client identity does not belong to this installation"
    }
    val projectPath = params.optString("projectPath")
    return when (method) {
        "read" -> {
            val state = store.read(clientInstanceId, frameworkOrigin, projectPath)
            JSONObject()
                .put("ok", true)
                .put("found", state != null)
                .apply { if (state != null) put("state", state) }
        }
        "write" -> {
            val state = params.optJSONObject("state")
                ?: throw IllegalArgumentException("Sidebar presentation state is missing")
            store.write(clientInstanceId, frameworkOrigin, projectPath, state)
            JSONObject().put("ok", true)
        }
        else -> throw IllegalArgumentException("Unsupported Sidebar presentation method")
    }
}
