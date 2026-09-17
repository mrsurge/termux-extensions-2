package com.termux.extensions

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Modifier
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.reflect.full.memberProperties

/** Debug-only live-object dispatcher. No interpreter, listener, or polling loop. */
internal object NativeRuntimeDebug {
    private val roots = mutableMapOf<String, WeakReference<Any>>()
    private val handles = linkedMapOf<String, WeakReference<Any>>()
    private var nextHandle = 0L
    private val events = ArrayDeque<JSONObject>()
    private var tracing = false
    private var logcat = false
    private var sequence = 0L
    private val pending = AtomicBoolean(false)

    fun register(name: String, value: Any) {
        roots[name] = WeakReference(value)
        record("register", name)
    }

    fun unregister(name: String, value: Any) {
        if (roots[name]?.get() === value) roots.remove(name)
        // Handles must never keep an old activity alive or target it after teardown.
        handles.clear()
        record("unregister", name)
    }

    private fun record(kind: String, detail: String) {
        if (!tracing) return
        val event = JSONObject().put("sequence", ++sequence)
            .put("unixMs", System.currentTimeMillis()).put("kind", kind)
            .put("detail", detail.take(160))
        if (events.size == 128) events.removeFirst()
        events.addLast(event)
        if (logcat) Log.d("TE2NativeDebug", event.toString())
    }

    fun tryDispatch(code: String, completion: (Result<JSONObject>) -> Unit): Boolean {
        if (code.length > 16384) {
            completion(Result.failure(IllegalArgumentException("Command exceeds 16 KiB")))
            return true
        }
        val request = runCatching { JSONObject(code) }.getOrNull() ?: return false
        val method = request.optString("method")
        if (!method.startsWith("android.debug.")) return false
        if (!pending.compareAndSet(false, true)) {
            completion(Result.failure(IllegalStateException("Native debug dispatcher busy")))
            return true
        }
        val queuedAt = SystemClock.uptimeMillis()
        // Serialize reflection with Android view/lifecycle ownership. Mutation is
        // explicit and never retried; a caller timeout cannot undo invoked code.
        Handler(Looper.getMainLooper()).post {
            val result = runCatching {
                check(SystemClock.uptimeMillis() - queuedAt < 5000) { "Command expired before execution" }
                require(request.optString("jsonrpc") == "2.0") { "Expected jsonrpc 2.0" }
                val raw = request.opt("params")
                require(raw == null || raw == JSONObject.NULL || raw is JSONObject) { "Expected object params" }
                record("command", method)
                execute(method.removePrefix("android.debug."), raw as? JSONObject ?: JSONObject())
            }
            record(if (result.isSuccess) "completed" else "failed", method)
            pending.set(false)
            completion(result)
        }
        return true
    }

    private fun root(name: String): Any {
        val activity = roots["activity"]?.get() as? Activity
        val value = when (name) {
            "decor" -> activity?.window?.decorView
            "focus" -> activity?.currentFocus
            "application" -> activity?.application
            else -> roots[name]?.get() ?: handles[name]?.get()
        }
        return requireNotNull(value) { "Root/handle unavailable or expired: $name" }
    }

    private fun field(type: Class<*>, name: String): java.lang.reflect.Field {
        var current: Class<*>? = type
        while (current != null) {
            try { return current.getDeclaredField(name).apply { isAccessible = true } }
            catch (_: NoSuchFieldException) { current = current.superclass }
        }
        throw NoSuchFieldException(name)
    }

    private fun target(params: JSONObject): Any {
        var value = root(params.optString("target", "activity"))
        val path = params.optJSONArray("path") ?: JSONArray()
        require(path.length() <= 12) { "Path exceeds 12 fields" }
        for (index in 0 until path.length()) {
            value = requireNotNull(field(value.javaClass, path.getString(index)).get(value)) { "Null path member" }
        }
        return value
    }

    // Results never walk arbitrary object graphs or call application toString.
    // Non-scalars get bounded weak handles for subsequent explicit inspection.
    private fun describe(value: Any?): Any = when (value) {
        null -> JSONObject.NULL
        is String -> JSONObject().put("text", value.take(4096)).put("truncated", value.length > 4096)
        is Number, is Boolean -> value
        is Char -> value.toString()
        else -> {
            val id = "object:${++nextHandle}"
            if (handles.size == 64) handles.remove(handles.keys.first())
            handles[id] = WeakReference(value)
            JSONObject().put("class", value.javaClass.name).put("handle", id)
        }
    }

    private fun type(name: String): Class<*> = when (name) {
        "boolean" -> Boolean::class.javaPrimitiveType!!
        "byte" -> Byte::class.javaPrimitiveType!!
        "short" -> Short::class.javaPrimitiveType!!
        "int" -> Int::class.javaPrimitiveType!!
        "long" -> Long::class.javaPrimitiveType!!
        "float" -> Float::class.javaPrimitiveType!!
        "double" -> Double::class.javaPrimitiveType!!
        "char" -> Char::class.javaPrimitiveType!!
        else -> Class.forName(name, false, javaClass.classLoader)
    }

    private fun argument(raw: Any?, expected: Class<*>): Any? {
        if (raw == null || raw == JSONObject.NULL) {
            require(!expected.isPrimitive) { "Null primitive argument" }
            return null
        }
        if (raw is JSONObject && raw.has("ref")) {
            return root(raw.getString("ref")).also { require(expected.isInstance(it)) { "Reference type mismatch" } }
        }
        if (expected.isInstance(raw)) return raw
        if (raw is Number) {
            val number = raw.toString().toBigDecimal()
            return when (expected) {
                Byte::class.javaPrimitiveType -> number.byteValueExact()
                Short::class.javaPrimitiveType -> number.shortValueExact()
                Int::class.javaPrimitiveType -> number.intValueExact()
                Long::class.javaPrimitiveType -> number.longValueExact()
                Float::class.javaPrimitiveType -> raw.toFloat().also { require(it.isFinite()) }
                Double::class.javaPrimitiveType -> raw.toDouble().also { require(it.isFinite()) }
                else -> throw IllegalArgumentException("Numeric type mismatch")
            }
        }
        if (expected == Boolean::class.javaPrimitiveType && raw is Boolean) return raw
        if (expected == Char::class.javaPrimitiveType && raw is String && raw.length == 1) return raw[0]
        throw IllegalArgumentException("Argument does not match ${expected.name}")
    }

    // Internal synchronous entry is unit-testable; transports always use tryDispatch.
    internal fun execute(operation: String, params: JSONObject): JSONObject {
        val output = JSONObject()
        when (operation) {
            "roots" -> {
                val names = roots.filterValues { it.get() != null }.keys + listOf("application", "decor", "focus")
                output.put("roots", JSONArray(names)).put("tracing", tracing)
            }
            "trace.configure" -> {
                output.put("previousEnabled", tracing).put("previousLogcat", logcat)
                tracing = params.getBoolean("enabled")
                logcat = params.optBoolean("logcat", false)
                output.put("enabled", tracing).put("logcat", logcat)
            }
            "trace.read" -> output.put("events", JSONArray(events.toList()))
            "trace.clear" -> { events.clear(); output.put("cleared", true) }
            "inspect" -> {
                val value = target(params)
                val fields = JSONArray()
                if (params.optBoolean("kotlinMetadata", false)) {
                    output.put("kotlinProperties", JSONArray(value::class.memberProperties.take(128).map { it.name }))
                }
                val methods = JSONArray()
                val kind = params.optString("kind", "all")
                require(kind in listOf("all", "fields", "methods")) { "Invalid member kind" }
                val offset = params.optInt("offset", 0)
                require(offset in 0..4096) { "Invalid member offset" }
                var seen = 0
                var current: Class<*>? = value.javaClass
                while (current != null && fields.length() + methods.length() < 128) {
                    for (entry in if (kind == "methods") emptyArray() else current.declaredFields) {
                        if (fields.length() + methods.length() == 128) break
                        if (seen++ < offset) continue
                        fields.put(JSONObject().put("name", entry.name).put("type", entry.type.name)
                            .put("declaringClass", current.name))
                    }
                    for (entry in if (kind == "fields") emptyArray() else current.declaredMethods) {
                        if (fields.length() + methods.length() == 128) break
                        if (seen++ < offset) continue
                        methods.put(JSONObject().put("name", entry.name)
                            .put("parameterTypes", JSONArray(entry.parameterTypes.map { it.name }))
                            .put("returns", entry.returnType.name).put("declaringClass", current.name))
                    }
                    current = current.superclass
                }
                output.put("object", describe(value)).put("fields", fields).put("methods", methods)
                    .put("truncated", fields.length() + methods.length() == 128)
                    .put("nextOffset", offset + fields.length() + methods.length())
            }
            "get" -> {
                val value = target(params)
                output.put("value", describe(field(value.javaClass, params.getString("field")).get(value)))
            }
            "set" -> {
                val value = target(params)
                val member = field(value.javaClass, params.getString("field"))
                require(!Modifier.isFinal(member.modifiers)) { "Final fields cannot be written" }
                val previous = member.get(value)
                member.set(value, argument(params.get("value"), member.type))
                output.put("previous", describe(previous)).put("value", describe(member.get(value)))
            }
            "invoke" -> {
                val value = target(params)
                val names = params.getJSONArray("parameterTypes")
                val args = params.getJSONArray("arguments")
                require(names.length() <= 16 && names.length() == args.length()) { "Invalid argument count" }
                val types = Array(names.length()) { type(names.getString(it)) }
                var current: Class<*>? = value.javaClass
                var member: java.lang.reflect.Method? = null
                while (current != null && member == null) {
                    try { member = current.getDeclaredMethod(params.getString("method"), *types) }
                    catch (_: NoSuchMethodException) { current = current.superclass }
                }
                val method = member ?: throw NoSuchMethodException(params.getString("method"))
                method.isAccessible = true
                val converted = Array<Any?>(args.length()) { argument(args.get(it), types[it]) }
                val result = try { method.invoke(value, *converted) }
                catch (error: InvocationTargetException) { throw (error.targetException ?: error) }
                output.put("value", describe(result))
            }
            else -> throw IllegalArgumentException("Unknown native debug operation: $operation")
        }
        require(output.toString().length <= 60000) { "Result exceeds 60 KiB; inspect a narrower target" }
        return output
    }
}
