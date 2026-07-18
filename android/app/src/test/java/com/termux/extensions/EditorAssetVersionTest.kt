package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class EditorAssetVersionTest {
    @Test
    fun ordersDottedAssetVersionsMonotonically() {
        assertTrue(compareEditorAssetVersions("0.2.307", "0.2.306") > 0)
        assertTrue(compareEditorAssetVersions("0.2.306", "0.2.307") < 0)
        assertEquals(0, compareEditorAssetVersions("0.2.307", "0.2.307.0"))
    }

    @Test
    fun rejectsAnIncompleteOtaAssetTree() {
        val root = Files.createTempDirectory("te2-editor-assets").toFile()
        try {
            for (relativePath in REQUIRED_OTA_ASSET_FILES) {
                File(root, relativePath).apply {
                    parentFile?.mkdirs()
                    writeText("test")
                }
            }
            assertNull(findMissingRequiredOtaAsset(root))

            val missingPath = "android-shell/launcher.js"
            assertTrue(File(root, missingPath).delete())
            assertEquals(missingPath, findMissingRequiredOtaAsset(root))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun rejectsAnOtaAssetTreeWithoutCodeMirror() {
        val root = Files.createTempDirectory("te2-editor-assets-cm6").toFile()
        try {
            for (relativePath in REQUIRED_OTA_ASSET_FILES) {
                File(root, relativePath).apply {
                    parentFile?.mkdirs()
                    writeText("test")
                }
            }

            val codeMirrorPath = "static/vendor/codemirror.1/codemirror.bundle.js"
            assertTrue(File(root, codeMirrorPath).delete())
            assertEquals(codeMirrorPath, findMissingRequiredOtaAsset(root))
        } finally {
            root.deleteRecursively()
        }
    }
}
