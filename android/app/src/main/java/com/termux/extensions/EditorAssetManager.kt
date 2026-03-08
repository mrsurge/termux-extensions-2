package com.termux.extensions

import android.content.Context
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Manages bundled editor static assets:
 *  - Seeds filesDir/editor_static/ from APK assets on first boot
 *  - Compares local version.txt with server's for update detection
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
     */
    fun seedFromApk() {
        val bundledVersion = try {
            context.assets.open("editor_static/version.txt").bufferedReader().readText().trim()
        } catch (e: IOException) {
            Log.w(TAG, "No bundled editor_static/version.txt in APK")
            return
        }

        val localVersion = getLocalVersion()
        if (localVersion == bundledVersion && assetRoot.exists()) {
            Log.i(TAG, "Local assets up-to-date (v$localVersion), skipping seed")
            return
        }

        Log.i(TAG, "Seeding assets: bundled=$bundledVersion local=$localVersion")
        val start = System.currentTimeMillis()

        // Clear old copy
        if (assetRoot.exists()) assetRoot.deleteRecursively()
        assetRoot.mkdirs()

        copyAssetDir("editor_static", assetRoot)

        val elapsed = System.currentTimeMillis() - start
        Log.i(TAG, "Asset seed complete: ${countFiles(assetRoot)} files in ${elapsed}ms")
    }

    private fun copyAssetDir(assetPath: String, destDir: File) {
        val children = context.assets.list(assetPath) ?: return
        if (children.isEmpty()) {
            // It's a file
            context.assets.open(assetPath).use { input ->
                destDir.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
        } else {
            // It's a directory
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

    companion object {
        private const val TAG = "EditorAssetManager"
    }
}
