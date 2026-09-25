package com.termux.extensions

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CefriumDownloadPolicyTest {
    @Test
    fun pickerQueueSerializesRequestsAndDrainsAllOutstandingWork() {
        val queue = CefriumDownloadPickerQueue<String>()

        assertEquals("first", queue.enqueue("first"))
        assertNull(queue.enqueue("second"))
        assertEquals("first", queue.active)
        assertEquals("second", queue.finishActive())
        assertEquals("second", queue.active)
        assertEquals(listOf("second"), queue.drain())
        assertNull(queue.active)
    }

    @Test
    fun suggestedFilenameIsReducedToASafeBoundedLeaf() {
        assertEquals("report_.json", sanitizeCefriumDownloadName("../report?.json"))
        assertEquals("download", sanitizeCefriumDownloadName("..."))
        assertEquals("download", sanitizeCefriumDownloadName(null))
        assertEquals(120, sanitizeCefriumDownloadName("a".repeat(200)).length)
    }

    @Test
    fun terminalUpdatesSelectCopyCleanupOrNoAction() {
        assertEquals(
            CefriumDownloadTerminalAction.COPY_TO_DESTINATION,
            cefriumDownloadTerminalAction(true, false, 0),
        )
        assertEquals(
            CefriumDownloadTerminalAction.CLEAN_UP,
            cefriumDownloadTerminalAction(false, true, 0),
        )
        assertEquals(
            CefriumDownloadTerminalAction.CLEAN_UP,
            cefriumDownloadTerminalAction(false, false, 12),
        )
        assertEquals(
            CefriumDownloadTerminalAction.NONE,
            cefriumDownloadTerminalAction(false, false, 0),
        )
    }

    @Test
    fun stalePrivateStagingFilesAreRemovedWithoutDeletingTheDirectory() {
        val directory = Files.createTempDirectory("cefrium-download-test").toFile()
        val staleFile = directory.resolve("stale.part").apply { writeText("partial") }
        val staleDirectory = directory.resolve("nested").apply { mkdirs() }
        staleDirectory.resolve("stale.part").writeText("partial")

        cleanCefriumDownloadStagingDirectory(directory)

        assertTrue(directory.isDirectory)
        assertFalse(staleFile.exists())
        assertFalse(staleDirectory.exists())
        directory.deleteRecursively()
    }
}
