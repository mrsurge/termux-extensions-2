package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidDiagnosticsTest {
    @Test
    fun keepsOnlyLinesAfterCurrentSessionMarker() {
        val marker = "TE2_ANDROID_SESSION:current"
        val lines = selectAndroidLogcatSession(
            rawOutput = """
                old warning
                $marker
                current warning
                current error
            """.trimIndent(),
            sessionMarker = marker,
        )

        assertEquals(listOf("current warning", "current error"), lines)
    }

    @Test
    fun returnsAvailableLinesWhenMarkerHasRolledOut() {
        val lines = selectAndroidLogcatSession(
            rawOutput = "warning\nerror\n",
            sessionMarker = "missing marker",
        )

        assertEquals(listOf("warning", "error"), lines)
    }

    @Test
    fun classifiesThreadtimeErrorLines() {
        assertEquals(
            "error",
            androidLogcatLevel("07-13 18:00:00.000 100 101 E MainActivity: failed"),
        )
        assertEquals(
            "warn",
            androidLogcatLevel("07-13 18:00:00.000 100 101 W MainActivity: warning"),
        )
    }

    @Test
    fun formatsFatalExceptionDetails() {
        assertEquals(
            "Launcher failed (IllegalStateException: bind failed)",
            formatStartupFailure("Launcher failed", IllegalStateException("bind failed")),
        )
    }
}
