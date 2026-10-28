package com.termux.extensions

import org.jni_zero.GEN_JNI

internal interface CefriumDevToolsNativeApi {
    fun initialize(prefix: String): Long
    fun enable(handle: Long, enabled: Boolean, allowDebugPermission: Boolean)
    fun destroy(handle: Long)
}

private object CefriumDevToolsJni : CefriumDevToolsNativeApi {
    override fun initialize(prefix: String): Long =
        GEN_JNI.org_chromium_chrome_browser_DevToolsServer_initRemoteDebugging(prefix)
    override fun enable(handle: Long, enabled: Boolean, allowDebugPermission: Boolean) =
        GEN_JNI.org_chromium_chrome_browser_DevToolsServer_setRemoteDebuggingEnabled(handle, enabled, allowDebugPermission)
    override fun destroy(handle: Long) =
        GEN_JNI.org_chromium_chrome_browser_DevToolsServer_destroyRemoteDebugging(handle)
}

/** Cefrium 0.15 adapter preserving the previous native calls and security policy.
 * TE2's explicit debug policy owns when this server is enabled.
 * This is not Chrome's profile/enterprise preference implementation.
 */
internal class CefriumNativeDevToolsServer(prefix: String,
    private val native: CefriumDevToolsNativeApi = CefriumDevToolsJni) {
    private var handle = native.initialize(prefix).also { check(it != 0L) { "Native inspector initialization failed" } }
    @Synchronized fun setRemoteDebuggingEnabled(enabled: Boolean) {
        check(handle != 0L) { "Native inspector destroyed" }
        // Preserve the 0.9.0 one-argument wrapper's security=0 behavior.
        native.enable(handle, enabled, false)
    }
    @Synchronized fun destroy() {
        if (handle == 0L) return
        val owned = handle
        handle = 0L
        native.destroy(owned)
    }
}
