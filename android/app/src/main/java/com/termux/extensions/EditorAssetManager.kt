package com.termux.extensions

import android.content.Context
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

internal fun compareEditorAssetVersions(a: String, b: String): Int {
    val aParts = a.split(".").map { it.toIntOrNull() ?: 0 }
    val bParts = b.split(".").map { it.toIntOrNull() ?: 0 }
    val length = maxOf(aParts.size, bParts.size)
    for (index in 0 until length) {
        val aValue = aParts.getOrElse(index) { 0 }
        val bValue = bParts.getOrElse(index) { 0 }
        if (aValue != bValue) return aValue.compareTo(bValue)
    }
    return 0
}

internal val REQUIRED_OTA_ASSET_FILES = listOf(
    "version.txt",
    "android-shell/index.html",
    "android-shell/host.js",
    "android-shell/launcher.js",
    "android-shell/settings.html",
    "android-shell/settings.js",
    "android-shell/shell.css",
    "android-shell/extensions/apps.js",
    "android-shell/extensions/registry.js",
    "static/vendor/codemirror.1/codemirror.bundle.js",
)

internal fun findMissingRequiredOtaAsset(root: File): String? =
    REQUIRED_OTA_ASSET_FILES.firstOrNull { relativePath ->
        !File(root, relativePath).isFile
    }

/**
 * Manages bundled editor static assets:
 *  - Seeds filesDir/editor_static/ from APK assets on first boot
 *  - Compares local version.txt with server's for update detection
 *  - Downloads asset bundle zip from server when versions differ
 */
class EditorAssetManager(private val context: Context) {

    private val assetRoot = File(context.filesDir, "editor_static")
    private val versionFile = File(assetRoot, "version.txt")

    fun getAssetRoot(): File = assetRoot

    fun getLocalVersion(): String? =
        if (versionFile.exists()) versionFile.readText().trim() else null

    /**
     * Copy APK assets/editor_static/ → filesDir/editor_static/ if the local
     * copy is missing or has a different version than the bundled one.
     * Returns true if assets were actually copied (not skipped).
     */
    fun seedFromApk(): Boolean {
        val bundledVersion = try {
            context.assets.open("editor_static/version.txt").bufferedReader().readText().trim()
        } catch (e: IOException) {
            Log.w(TAG, "No bundled editor_static/version.txt in APK")
            return false
        }

        val localVersion = getLocalVersion()
        if (localVersion != null && assetRoot.exists()) {
            if (localVersion == bundledVersion) {
                Log.i(TAG, "Local assets up-to-date (v$localVersion), skipping seed")
                return false
            }
            if (compareEditorAssetVersions(localVersion, bundledVersion) > 0) {
                Log.i(TAG, "Local assets newer than APK (local=$localVersion, bundled=$bundledVersion), skipping seed")
                return false
            }
        }

        Log.i(TAG, "Seeding assets: bundled=$bundledVersion local=$localVersion")
        val start = System.currentTimeMillis()

        if (assetRoot.exists()) assetRoot.deleteRecursively()
        assetRoot.mkdirs()

        copyAssetDir("editor_static", assetRoot)

        val elapsed = System.currentTimeMillis() - start
        Log.i(TAG, "Asset seed complete: ${countFiles(assetRoot)} files in ${elapsed}ms")
        return true
    }

    private fun copyAssetDir(assetPath: String, destDir: File) {
        val children = context.assets.list(assetPath) ?: return
        if (children.isEmpty()) {
            context.assets.open(assetPath).use { input ->
                destDir.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
        } else {
            destDir.mkdirs()
            for (child in children) {
                copyAssetDir("$assetPath/$child", File(destDir, child))
            }
        }
    }

    private fun countFiles(dir: File): Int =
        dir.walkTopDown().count { it.isFile }

    /** Return a server version only when it is newer than the installed assets. */
    fun checkServerVersion(serverBaseUrl: String): String? {
        val serverVersion = fetchServerVersion(serverBaseUrl) ?: return null
        val localVersion = getLocalVersion() ?: return serverVersion
        val comparison = compareEditorAssetVersions(serverVersion, localVersion)
        if (comparison <= 0) {
            if (comparison < 0) {
                Log.w(
                    TAG,
                    "Ignoring OTA downgrade server=$serverVersion local=$localVersion",
                )
            }
            return null
        }
        return serverVersion
    }

    /**
     * Download the asset bundle zip from the server and extract it to
     * filesDir/editor_static/, replacing the current local copy.
     * Returns true on success, false on failure.
     */
    fun downloadFromServer(serverBaseUrl: String): Boolean {
        return try {
            val client = OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(120, TimeUnit.SECONDS)
                .build()
            val req = Request.Builder()
                .url(serverEndpoint(serverBaseUrl, "/api/editor_assets_bundle"))
                .get()
                .build()

            Log.i(TAG, "Downloading asset bundle from server…")
            val start = System.currentTimeMillis()

            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "Bundle download failed: HTTP ${resp.code}")
                    return false
                }
                val body = resp.body ?: return false

                // Extract to a staging dir first, then swap
                val staging = File(context.filesDir, "editor_static_staging")
                if (staging.exists()) staging.deleteRecursively()
                staging.mkdirs()

                body.byteStream().use { raw ->
                    ZipInputStream(raw).use { zis ->
                        var entry = zis.nextEntry
                        while (entry != null) {
                            val outFile = File(staging, entry.name)
                            // Guard against zip-slip
                            if (!outFile.canonicalPath.startsWith(staging.canonicalPath)) {
                                Log.w(TAG, "Skipping suspicious zip entry: ${entry.name}")
                                zis.closeEntry()
                                entry = zis.nextEntry
                                continue
                            }
                            if (entry.isDirectory) {
                                outFile.mkdirs()
                            } else {
                                outFile.parentFile?.mkdirs()
                                outFile.outputStream().use { out ->
                                    zis.copyTo(out)
                                }
                            }
                            zis.closeEntry()
                            entry = zis.nextEntry
                        }
                    }
                }

                val stagedVersion = File(staging, "version.txt")
                    .takeIf { it.isFile }
                    ?.readText()
                    ?.trim()
                if (stagedVersion.isNullOrBlank()) {
                    Log.e(TAG, "Bundle rejected: missing staged version.txt")
                    staging.deleteRecursively()
                    return false
                }
                // OTA installation replaces the full local tree. Reject an
                // incomplete bundle before preserving or renaming current assets.
                val missingRequiredAsset = findMissingRequiredOtaAsset(staging)
                if (missingRequiredAsset != null) {
                    Log.e(TAG, "Bundle rejected: missing required asset $missingRequiredAsset")
                    staging.deleteRecursively()
                    return false
                }
                val localVersion = getLocalVersion()
                if (
                    localVersion != null &&
                    compareEditorAssetVersions(stagedVersion, localVersion) < 0
                ) {
                    Log.e(
                        TAG,
                        "Bundle rejected: OTA downgrade staged=$stagedVersion local=$localVersion",
                    )
                    staging.deleteRecursively()
                    return false
                }

                // Keep the last valid tree available until the staged tree is installed.
                val backup = File(context.filesDir, "editor_static_backup")
                if (backup.exists()) backup.deleteRecursively()
                if (assetRoot.exists() && !assetRoot.renameTo(backup)) {
                    Log.e(TAG, "Bundle install failed: could not preserve current assets")
                    staging.deleteRecursively()
                    return false
                }
                if (!staging.renameTo(assetRoot)) {
                    Log.e(TAG, "Bundle install failed: staging swap failed")
                    if (backup.exists() && !backup.renameTo(assetRoot)) {
                        Log.e(TAG, "Bundle rollback failed: preserved assets remain at ${backup.path}")
                    }
                    return false
                }
                backup.deleteRecursively()

                val elapsed = System.currentTimeMillis() - start
                val newVersion = getLocalVersion() ?: "unknown"
                Log.i(TAG, "Bundle download complete: v$newVersion, " +
                        "${countFiles(assetRoot)} files in ${elapsed}ms")
                true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Bundle download failed", e)
            false
        }
    }

    /** Reinstall current/newer assets, but never replace local assets with an older OTA. */
    fun forceUpdateFromServer(serverBaseUrl: String): Boolean {
        val serverVersion = fetchServerVersion(serverBaseUrl) ?: return false
        val localVersion = getLocalVersion()
        if (
            localVersion != null &&
            compareEditorAssetVersions(serverVersion, localVersion) < 0
        ) {
            Log.w(
                TAG,
                "Force update rejected OTA downgrade server=$serverVersion local=$localVersion",
            )
            return false
        }
        Log.i(TAG, "Force update: downloading v$serverVersion over local=${localVersion ?: "none"}")
        return downloadFromServer(serverBaseUrl)
    }

    private fun fetchServerVersion(serverBaseUrl: String): String? {
        return try {
            val client = OkHttpClient.Builder()
                .connectTimeout(3, TimeUnit.SECONDS)
                .readTimeout(3, TimeUnit.SECONDS)
                .build()
            val req = Request.Builder()
                .url(serverEndpoint(serverBaseUrl, "/api/editor_version"))
                .get()
                .build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return null
                resp.body?.string()?.trim()?.takeIf { it.isNotEmpty() }
            }
        } catch (e: Exception) {
            Log.d(TAG, "Version check failed: ${e.message}")
            null
        }
    }

    private fun serverEndpoint(serverBaseUrl: String, path: String): String =
        serverBaseUrl.trimEnd('/') + path

    companion object {
        private const val TAG = "EditorAssetManager"
    }
}
