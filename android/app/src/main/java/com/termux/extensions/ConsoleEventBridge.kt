package com.termux.extensions

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.FlutterEngineCache
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel
import org.json.JSONObject

/**
 * Bridges console events from UiIpcClient (Socket.IO) to a Flutter module
 * via EventChannel. Also handles eval commands from Flutter via MethodChannel.
 */
class ConsoleEventBridge(private val context: Context) {

    companion object {
        const val ENGINE_ID = "te2_console_engine"
        const val EVENT_CHANNEL = "com.termux.extensions/console_events"
        const val METHOD_CHANNEL = "com.termux.extensions/console_eval"
        private const val TAG = "ConsoleEventBridge"
    }

    private var flutterEngine: FlutterEngine? = null
    private var eventSink: EventChannel.EventSink? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    /** Reference set by MainActivity after UiIpcClient is created. */
    var uiIpcClient: UiIpcClient? = null

    /**
     * Pre-warm the FlutterEngine and register platform channels.
     * Call this early (e.g. in onCreate) so the engine is ready when the overlay opens.
     */
    fun init() {
        if (flutterEngine != null) return

        flutterEngine = FlutterEngine(context).also { engine ->
            engine.dartExecutor.executeDartEntrypoint(
                DartExecutor.DartEntrypoint.createDefault()
            )

            // EventChannel: Kotlin → Dart (console log events)
            EventChannel(engine.dartExecutor.binaryMessenger, EVENT_CHANNEL).setStreamHandler(
                object : EventChannel.StreamHandler {
                    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                        Log.d(TAG, "Flutter console EventChannel listener attached")
                        eventSink = events
                    }

                    override fun onCancel(arguments: Any?) {
                        Log.d(TAG, "Flutter console EventChannel listener detached")
                        eventSink = null
                    }
                }
            )

            // MethodChannel: Dart → Kotlin (eval commands)
            MethodChannel(engine.dartExecutor.binaryMessenger, METHOD_CHANNEL).setMethodCallHandler { call, result ->
                when (call.method) {
                    "eval" -> {
                        val code = call.argument<String>("code")
                        if (code != null) {
                            uiIpcClient?.sendConsoleEval(code)
                            result.success(null)
                        } else {
                            result.error("INVALID_ARG", "Missing 'code' argument", null)
                        }
                    }
                    else -> result.notImplemented()
                }
            }

            FlutterEngineCache.getInstance().put(ENGINE_ID, engine)
            Log.i(TAG, "FlutterEngine pre-warmed and cached as '$ENGINE_ID'")
        }
    }

    /**
     * Called by UiIpcClient's onConsoleEvent callback.
     * Serializes the event and pushes it to the Flutter EventChannel.
     */
    fun onConsoleEvent(eventName: String, data: JSONObject) {
        val envelope = JSONObject()
        envelope.put("event", eventName)
        val names = data.names()
        if (names != null) {
            for (i in 0 until names.length()) {
                val key = names.getString(i)
                envelope.put(key, data.opt(key))
            }
        }
        val json = envelope.toString()
        mainHandler.post {
            eventSink?.success(json)
        }
    }

    fun destroy() {
        eventSink = null
        FlutterEngineCache.getInstance().remove(ENGINE_ID)
        flutterEngine?.destroy()
        flutterEngine = null
        Log.i(TAG, "FlutterEngine destroyed")
    }
}
