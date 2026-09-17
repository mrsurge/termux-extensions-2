package com.termux.extensions

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeRuntimeDebugTest {
    class Fixture {
        @JvmField var count = 2
        fun plus(value: Int): Int = count + value
        fun plus(value: String): String = value
        fun fail(): Unit = throw IllegalStateException("fixture failure")
    }

    private fun params() = JSONObject().put("target", "fixture")

    @Test fun readsWritesAndResolvesExactOverloads() {
        val fixture = Fixture()
        NativeRuntimeDebug.register("fixture", fixture)
        val changed = NativeRuntimeDebug.execute("set", params().put("field", "count").put("value", 5))
        assertEquals(2, changed.getInt("previous"))
        assertEquals(5, fixture.count)
        assertEquals(5, NativeRuntimeDebug.execute("get", params().put("field", "count")).getInt("value"))
        val result = NativeRuntimeDebug.execute("invoke", params().put("method", "plus")
            .put("parameterTypes", JSONArray().put("int")).put("arguments", JSONArray().put(3)))
        assertEquals(8, result.getInt("value"))
        val methods = NativeRuntimeDebug.execute("inspect", params().put("kind", "methods"))
        assertEquals(0, methods.getJSONArray("fields").length())
        assertTrue(methods.getJSONArray("methods").toString().contains("plus"))
        val next = NativeRuntimeDebug.execute("inspect", params().put("kind", "methods")
            .put("offset", methods.getInt("nextOffset")))
        assertEquals(0, next.getJSONArray("methods").length())
        assertThrows(ArithmeticException::class.java) {
            NativeRuntimeDebug.execute("set", params().put("field", "count").put("value", 1.5))
        }
        assertEquals(5, fixture.count)
        NativeRuntimeDebug.unregister("fixture", fixture)
        assertThrows(IllegalArgumentException::class.java) { NativeRuntimeDebug.execute("inspect", params()) }
    }

    @Test fun invocationErrorsAreUnwrappedAndHandlesExpire() {
        val fixture = Fixture()
        NativeRuntimeDebug.register("fixture", fixture)
        val inspected = NativeRuntimeDebug.execute("inspect", params().put("kotlinMetadata", true))
        assertTrue(inspected.getJSONArray("kotlinProperties").toString().contains("count"))
        val handle = inspected.getJSONObject("object").getString("handle")
        assertEquals(2, NativeRuntimeDebug.execute("get", JSONObject().put("target", handle).put("field", "count")).getInt("value"))
        assertThrows(IllegalStateException::class.java) {
            NativeRuntimeDebug.execute("invoke", params().put("method", "fail")
                .put("parameterTypes", JSONArray()).put("arguments", JSONArray()))
        }
        NativeRuntimeDebug.unregister("fixture", fixture)
        assertThrows(IllegalArgumentException::class.java) {
            NativeRuntimeDebug.execute("inspect", JSONObject().put("target", handle))
        }
    }

    @Test fun oldActivityCannotUnregisterReplacement() {
        val old = Fixture()
        val replacement = Fixture()
        NativeRuntimeDebug.register("fixture", old)
        NativeRuntimeDebug.register("fixture", replacement)
        NativeRuntimeDebug.unregister("fixture", old)
        assertEquals(2, NativeRuntimeDebug.execute("get", params().put("field", "count")).getInt("value"))
        NativeRuntimeDebug.unregister("fixture", replacement)
    }

    @Test fun tracingIsBoundedAndOptIn() {
        NativeRuntimeDebug.execute("trace.configure", JSONObject().put("enabled", true))
        val fixture = Fixture()
        repeat(200) { NativeRuntimeDebug.register("fixture", fixture) }
        assertEquals(128, NativeRuntimeDebug.execute("trace.read", JSONObject()).getJSONArray("events").length())
        NativeRuntimeDebug.execute("trace.configure", JSONObject().put("enabled", false))
        NativeRuntimeDebug.execute("trace.clear", JSONObject())
        NativeRuntimeDebug.unregister("fixture", fixture)
        assertEquals(0, NativeRuntimeDebug.execute("trace.read", JSONObject()).getJSONArray("events").length())
    }

    @Test fun legacyAndMalformedCommandsDoNotEnterDebugDispatch() {
        assertFalse(NativeRuntimeDebug.tryDispatch("not json") { fail("unexpected callback") })
        assertFalse(NativeRuntimeDebug.tryDispatch(
            """{"jsonrpc":"2.0","method":"android.devTools.state.get"}""",
        ) { fail("legacy command intercepted") })
        var rejected = false
        assertTrue(NativeRuntimeDebug.tryDispatch("x".repeat(16385)) { rejected = it.isFailure })
        assertTrue(rejected)
    }
}
