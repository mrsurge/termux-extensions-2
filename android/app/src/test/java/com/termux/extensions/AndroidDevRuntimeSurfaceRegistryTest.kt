package com.termux.extensions

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidDevRuntimeSurfaceRegistryTest {
    @Test
    fun retainsValidatedSurfaceIntentAndLocalRouteOrigins() {
        val ticket = "a".repeat(64)
        val params = JSONObject(
            """{
              "runtime": {
                "surfaceId": "run-profile:project:preview",
                "profileId": "preview",
                "targetId": "run-profile:project:preview",
                "targetLabel": "Preview",
                "devRuntime": true,
                "devTools": false,
                "frameworkOrigin": "http://127.0.0.1:44000",
                "workerIdBase": "rp-prev",
                "workerLabel": "run-profile:preview"
              },
              "url": "http://localhost:43123/",
              "route": {
                "dto": "RunTargetRouteSet",
                "version": 1,
                "ownerId": "code_te2:run-profile:project:preview",
                "shellId": "shell-1",
                "relayGroupId": "$ticket",
                "primary": {
                  "dto": "RunTargetRoute",
                  "version": 1,
                  "ticket": "$ticket",
                  "tunnelPath": "/api/run-targets/$ticket/tunnel",
                  "preferredPort": 43123,
                  "originalUrl": "http://localhost:43123/"
                },
                "additional": []
              }
            }""",
        )
        val registry = AndroidDevRuntimeSurfaceRegistry()

        val surface = registry.register(params, "http://127.0.0.1:44000")

        assertEquals("run-profile:project:preview", surface.surfaceId)
        assertEquals("run-profile:project:preview", surface.targetId)
        assertEquals("Preview", surface.targetLabel)
        assertTrue(surface.devRuntime)
        assertEquals("http://127.0.0.1:44000", surface.frameworkOrigin)
        assertTrue(surface.origins.contains("http://localhost:43123"))
        assertTrue(surface.origins.contains("http://127.0.0.1:43123"))
        assertEquals(1, registry.snapshot().size)
        assertTrue(registry.release(surface.surfaceId))
    }

    @Test
    fun retainsDevToolsOnlySurfaceIntent() {
        val registry = AndroidDevRuntimeSurfaceRegistry()

        val surface = registry.register(
            JSONObject(
                """{
                  "runtime": {
                    "surfaceId": "surface",
                    "profileId": "server",
                    "targetId": "profile:server",
                    "targetLabel": "Server",
                    "devRuntime": false,
                    "devTools": true,
                    "frameworkOrigin": "http://127.0.0.1:44000"
                  },
                  "url": "http://localhost:43123/"
                }""",
            ),
            "http://127.0.0.1:44000",
        )

        assertEquals("profile:server", surface.targetId)
        assertTrue(surface.devTools)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsMismatchedFrameworkOrigin() {
        AndroidDevRuntimeSurfaceRegistry().register(
            JSONObject(
                """{
                  "runtime": {
                    "surfaceId": "surface",
                    "devRuntime": true,
                    "frameworkOrigin": "http://127.0.0.1:44001"
                  },
                  "url": "http://localhost:43123/"
                }""",
            ),
            "http://127.0.0.1:44000",
        )
    }
}
