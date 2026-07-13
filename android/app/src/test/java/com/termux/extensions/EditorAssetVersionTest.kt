package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EditorAssetVersionTest {
    @Test
    fun ordersDottedAssetVersionsMonotonically() {
        assertTrue(compareEditorAssetVersions("0.2.307", "0.2.306") > 0)
        assertTrue(compareEditorAssetVersions("0.2.306", "0.2.307") < 0)
        assertEquals(0, compareEditorAssetVersions("0.2.307", "0.2.307.0"))
    }
}
