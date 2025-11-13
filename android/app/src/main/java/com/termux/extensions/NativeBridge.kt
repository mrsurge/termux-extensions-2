package com.termux.extensions

import android.content.Context
import android.os.Build
import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONObject

class NativeBridge(private val context: Context) {
    
    @JavascriptInterface
    fun getDeviceInfo(): String {
        val deviceInfo = JSONObject()
        deviceInfo.put("manufacturer", Build.MANUFACTURER)
        deviceInfo.put("model", Build.MODEL)
        deviceInfo.put("androidVersion", Build.VERSION.RELEASE)
        deviceInfo.put("sdkInt", Build.VERSION.SDK_INT)
        deviceInfo.put("brand", Build.BRAND)
        deviceInfo.put("device", Build.DEVICE)
        return deviceInfo.toString()
    }

    @JavascriptInterface
    fun showToast(message: String) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    }

    @JavascriptInterface
    fun callNative(method: String, params: String): String {
        return when (method) {
            "getDeviceInfo" -> getDeviceInfo()
            "showToast" -> {
                showToast(params)
                "{\"success\": true}"
            }
            else -> "{\"error\": \"Unknown method: $method\"}"
        }
    }
}
