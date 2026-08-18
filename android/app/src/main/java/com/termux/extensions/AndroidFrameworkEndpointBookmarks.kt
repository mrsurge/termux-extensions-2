package com.termux.extensions

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

internal data class AndroidFrameworkEndpointBookmark(
    val name: String,
    val frameworkHost: String,
    val frameworkPort: Int,
) {
    val frameworkBaseUrl: String
        get() = androidFrameworkBaseUrl(frameworkHost, frameworkPort)

    fun toJson(): JSONObject = JSONObject()
        .put("name", name)
        .put("frameworkHost", frameworkHost)
        .put("frameworkPort", frameworkPort)
        .put("frameworkBaseUrl", frameworkBaseUrl)
}

internal fun validatedAndroidFrameworkEndpointBookmark(
    name: String,
    frameworkHost: String,
    frameworkPort: Int,
): AndroidFrameworkEndpointBookmark {
    val normalizedName = name.trim()
    require(normalizedName.isNotEmpty()) { "Bookmark name is required" }
    require(normalizedName.length <= MAX_ANDROID_FRAMEWORK_ENDPOINT_BOOKMARK_NAME_LENGTH) {
        "Bookmark name is too long"
    }
    require(normalizedName.none(Char::isISOControl)) {
        "Bookmark name contains unsupported characters"
    }
    val endpoint = validatedAndroidFrameworkEndpoint(frameworkHost, frameworkPort)
    return AndroidFrameworkEndpointBookmark(
        name = normalizedName,
        frameworkHost = endpoint.first,
        frameworkPort = endpoint.second,
    )
}

internal fun decodeAndroidFrameworkEndpointBookmarks(raw: String?): List<AndroidFrameworkEndpointBookmark> {
    if (raw.isNullOrBlank()) return emptyList()
    val payload = try {
        JSONArray(raw)
    } catch (_: Exception) {
        return emptyList()
    }
    val bookmarks = linkedMapOf<String, AndroidFrameworkEndpointBookmark>()
    for (index in 0 until payload.length()) {
        val item = payload.optJSONObject(index) ?: continue
        val bookmark = try {
            validatedAndroidFrameworkEndpointBookmark(
                name = item.optString("name"),
                frameworkHost = item.optString("frameworkHost"),
                frameworkPort = item.optInt("frameworkPort", -1),
            )
        } catch (_: IllegalArgumentException) {
            continue
        }
        val key = bookmark.name.lowercase(Locale.ROOT)
        if (bookmarks.containsKey(key)) continue
        bookmarks[key] = bookmark
        if (bookmarks.size == MAX_ANDROID_FRAMEWORK_ENDPOINT_BOOKMARKS) break
    }
    return bookmarks.values.toList()
}

internal fun encodeAndroidFrameworkEndpointBookmarks(
    bookmarks: List<AndroidFrameworkEndpointBookmark>,
): String = JSONArray().apply {
    bookmarks.forEach { put(it.toJson()) }
}.toString()

internal fun upsertAndroidFrameworkEndpointBookmark(
    bookmarks: List<AndroidFrameworkEndpointBookmark>,
    bookmark: AndroidFrameworkEndpointBookmark,
): List<AndroidFrameworkEndpointBookmark> {
    val key = bookmark.name.lowercase(Locale.ROOT)
    val index = bookmarks.indexOfFirst { it.name.lowercase(Locale.ROOT) == key }
    if (index >= 0) {
        return bookmarks.toMutableList().apply { this[index] = bookmark }
    }
    require(bookmarks.size < MAX_ANDROID_FRAMEWORK_ENDPOINT_BOOKMARKS) {
        "Framework bookmark limit reached"
    }
    return bookmarks + bookmark
}

internal fun deleteAndroidFrameworkEndpointBookmark(
    bookmarks: List<AndroidFrameworkEndpointBookmark>,
    name: String,
): List<AndroidFrameworkEndpointBookmark> {
    val key = name.trim().lowercase(Locale.ROOT)
    require(key.isNotEmpty()) { "Bookmark name is required" }
    return bookmarks.filterNot { it.name.lowercase(Locale.ROOT) == key }
}

internal const val MAX_ANDROID_FRAMEWORK_ENDPOINT_BOOKMARKS = 16
private const val MAX_ANDROID_FRAMEWORK_ENDPOINT_BOOKMARK_NAME_LENGTH = 64
