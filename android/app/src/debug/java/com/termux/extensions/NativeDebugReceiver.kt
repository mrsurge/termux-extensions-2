package com.termux.extensions

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

// Ordered broadcasts return the same bounded JSON result as the console lane.
class NativeDebugReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        val handled = NativeRuntimeDebug.tryDispatch(intent.getStringExtra("code") ?: "") { result ->
            pending.resultCode = if (result.isSuccess) 0 else 1
            pending.resultData = result.fold(
                { it.toString() },
                { JSONObject().put("error", it.javaClass.name)
                    .put("message", it.message?.take(512)).toString() },
            )
            pending.finish()
        }
        if (!handled) {
            pending.resultCode = 1
            pending.resultData = "{\"error\":\"Expected android.debug.* command\"}"
            pending.finish()
        }
    }
}
