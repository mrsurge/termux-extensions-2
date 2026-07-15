package com.termux.extensions.nativeeditor

internal enum class NativeMirrorDropReason {
    INVALID,
    SELF,
    NO_DOCUMENT,
    PATH,
    DUPLICATE,
    LOCAL_EDIT_HOT_WINDOW,
}

/**
 * Protects the native editor model from stale mirror projections. The backend
 * remains authoritative, while source identity and a short local-edit window
 * prevent its broadcast path from replaying an older buffer over active input.
 */
internal object NativeEditorMirrorPolicy {
    fun dropReason(
        payload: Map<String, Any?>,
        editorSocketId: String?,
        document: NativeDocument?,
        lastLocalEditAtMs: Long,
        nowMs: Long,
        hotWindowMs: Long,
    ): NativeMirrorDropReason? {
        val path = payload["path"] as? String
        val content = payload["content"] as? String
        if (path.isNullOrBlank() || content == null) return NativeMirrorDropReason.INVALID

        val sourceClient = payload["source_client"]?.toString()
        if (
            !sourceClient.isNullOrBlank() &&
            !editorSocketId.isNullOrBlank() &&
            sourceClient == editorSocketId
        ) {
            return NativeMirrorDropReason.SELF
        }
        if (document == null) return NativeMirrorDropReason.NO_DOCUMENT
        if (path != document.path) return NativeMirrorDropReason.PATH

        val contentSha = payload["content_sha256"] as? String
        if (
            (!contentSha.isNullOrBlank() && contentSha == document.contentSha256) ||
            content == document.content
        ) {
            return NativeMirrorDropReason.DUPLICATE
        }

        if (
            hotWindowMs > 0 &&
            lastLocalEditAtMs > 0 &&
            nowMs - lastLocalEditAtMs < hotWindowMs
        ) {
            return NativeMirrorDropReason.LOCAL_EDIT_HOT_WINDOW
        }
        return null
    }
}
