package com.termux.extensions.nativeeditor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeEditorMirrorPolicyTest {
    private val document = NativeDocument(
        path = "/project/main.kt",
        projectPath = "/project",
        content = "local-newer",
        baseSha256 = "base",
        contentSha256 = "local-sha",
        languageId = "kotlin",
        unsaved = true,
    )

    @Test
    fun dropsSelfAuthoredMirrorBeforeContentComparison() {
        assertEquals(
            NativeMirrorDropReason.SELF,
            dropReason(
                payload = mirror(content = "older", sourceClient = "editor-sid"),
                editorSocketId = "editor-sid",
            ),
        )
    }

    @Test
    fun dropsRemoteMirrorDuringLocalEditWindow() {
        assertEquals(
            NativeMirrorDropReason.LOCAL_EDIT_HOT_WINDOW,
            dropReason(
                payload = mirror(content = "remote"),
                lastLocalEditAtMs = 900,
                nowMs = 1_000,
            ),
        )
    }

    @Test
    fun acceptsRemoteMirrorAfterLocalEditWindow() {
        assertNull(
            dropReason(
                payload = mirror(content = "remote"),
                lastLocalEditAtMs = 500,
                nowMs = 1_000,
            ),
        )
    }

    @Test
    fun dropsDuplicateAndWrongPathMirrors() {
        assertEquals(
            NativeMirrorDropReason.DUPLICATE,
            dropReason(payload = mirror(content = document.content)),
        )
        assertEquals(
            NativeMirrorDropReason.PATH,
            dropReason(payload = mirror(content = "remote", path = "/project/other.kt")),
        )
    }

    private fun dropReason(
        payload: Map<String, Any?>,
        editorSocketId: String? = "local-sid",
        lastLocalEditAtMs: Long = 0,
        nowMs: Long = 1_000,
    ): NativeMirrorDropReason? = NativeEditorMirrorPolicy.dropReason(
        payload = payload,
        editorSocketId = editorSocketId,
        document = document,
        lastLocalEditAtMs = lastLocalEditAtMs,
        nowMs = nowMs,
        hotWindowMs = 250,
    )

    private fun mirror(
        content: String,
        path: String = document.path,
        sourceClient: String = "remote-sid",
    ): Map<String, Any?> = mapOf(
        "path" to path,
        "content" to content,
        "content_sha256" to "remote-sha",
        "source_client" to sourceClient,
    )
}
