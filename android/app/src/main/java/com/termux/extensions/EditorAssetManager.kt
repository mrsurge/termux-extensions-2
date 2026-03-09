package com.termux.extensions

import android.content.Context
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

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
            if (compareVersions(localVersion, bundledVersion) > 0) {
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

    /** Compare dotted version strings segment by segment (e.g. "0.1.6" > "0.1.5"). */
    private fun compareVersions(a: String, b: String): Int {
        val ap = a.split(".").map { it.toIntOrNull() ?: 0 }
        val bp = b.split(".").map { it.toIntOrNull() ?: 0 }
        val len = maxOf(ap.size, bp.size)
        for (i in 0 until len) {
            val av = ap.getOrElse(i) { 0 }
            val bv = bp.getOrElse(i) { 0 }
            if (av != bv) return av.compareTo(bv)
        }
        return 0
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

    /**
     * Check server for a newer asset version. Returns the server version
     * if it's different from local, or null if up-to-date / unreachable.
     */
    fun checkServerVersion(port: Int): String? {
        return try {
            val client = OkHttpClient.Builder()
                .connectTimeout(3, TimeUnit.SECONDS)
                .readTimeout(3, TimeUnit.SECONDS)
                .build()
            val req = Request.Builder()
                .url("http://127.0.0.1:$port/api/editor_version")
                .get()
                .build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return null
                val serverVersion = resp.body?.string()?.trim() ?: return null
                val local = getLocalVersion()
                if (serverVersion != local) serverVersion else null
            }
        } catch (e: Exception) {
            Log.d(TAG, "Version check failed: ${e.message}")
            null
        }
    }

    /**
     * Download the asset bundle zip from the server and extract it to
     * filesDir/editor_static/, replacing the current local copy.
     * Returns true on success, false on failure.
     */
    fun downloadFromServer(port: Int): Boolean {
        return try {
            val client = OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(120, TimeUnit.SECONDS)
                .build()
            val req = Request.Builder()
                .url("http://127.0.0.1:$port/api/editor_assets_bundle")
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

                // Swap: delete old → rename staging
                if (assetRoot.exists()) assetRoot.deleteRecursively()
                staging.renameTo(assetRoot)

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

    /**
     * Force re-download: clear local assets and download fresh bundle.
     * Returns true on success.
     */
    fun forceUpdateFromServer(port: Int): Boolean {
        Log.i(TAG, "Force update: clearing local assets and re-downloading")
        if (assetRoot.exists()) assetRoot.deleteRecursively()
        return downloadFromServer(port)
    }

    companion object {
        private const val TAG = "EditorAssetManager"
    }
}
