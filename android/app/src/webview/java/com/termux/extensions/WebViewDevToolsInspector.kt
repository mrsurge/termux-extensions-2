package com.termux.extensions

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * Owns a persistent native Inspector WebView and directly brokers CDP traffic
 * to Chobitsu running at document start in the separate inspected WebView.
 */
class WebViewDevToolsInspector(
    context: Context,
    private val targetView: WebView,
    private val inspectorView: WebView,
    private val onStatusChanged: (String) -> Unit,
) {
    private val applicationContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())
    private val assetLoader = WebViewAssetLoader.Builder()
        .addPathHandler(
            "/assets/",
            WebViewAssetLoader.AssetsPathHandler(applicationContext),
        )
        .build()
    private val broker = DevToolsProtocolBroker(
        onQueueOverflow = {
            onStatusChanged("error: developer-tools protocol queue overflow")
            resetClientForCurrentTarget()
        },
    )
    private val targetEndpoint = DevToolsProtocolBroker.Endpoint(::sendToTarget)
    private val clientEndpoint = DevToolsProtocolBroker.Endpoint(::sendToClient)
    private val documentStartSource by lazy {
        listOf(
            CHOBITSU_ASSET,
            TARGET_RUNTIME_ASSET,
            TARGET_WEBVIEW_BRIDGE_ASSET,
        ).joinToString("\n") { asset ->
            applicationContext.assets.open(asset).bufferedReader().use { it.readText() }
        }
    }
    private var scriptHandler: ScriptHandler? = null
    private var clientReady = false
    private var enabled = false

    val supported: Boolean
        get() = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

    init {
        targetView.addJavascriptInterface(TargetNativeBridge(), TARGET_BRIDGE_NAME)
        inspectorView.addJavascriptInterface(
            InspectorNativeBridge(),
            INSPECTOR_BRIDGE_NAME,
        )
        configureInspectorView()
    }

    fun configure(shouldEnable: Boolean): Boolean {
        enabled = shouldEnable
        scriptHandler?.remove()
        scriptHandler = null

        if (!shouldEnable) {
            clientReady = false
            broker.clear()
            inspectorView.visibility = View.GONE
            inspectorView.stopLoading()
            inspectorView.loadUrl("about:blank")
            onStatusChanged("disabled")
            return true
        }
        if (!supported) {
            onStatusChanged("error: unsupported by installed System WebView")
            return false
        }

        scriptHandler = WebViewCompat.addDocumentStartJavaScript(
            targetView,
            documentStartSource,
            setOf("*"),
        )
        clientReady = false
        broker.clear()
        onStatusChanged("waiting for inspected page")
        inspectorView.loadUrl(INSPECTOR_URL)
        return true
    }

    fun onTargetNavigationStarted() {
        broker.detachTarget(targetEndpoint)
        if (enabled) {
            sendClientControl("target_waiting")
            onStatusChanged("waiting for inspected page")
        }
    }

    fun setVisible(visible: Boolean) {
        inspectorView.visibility = if (visible) View.VISIBLE else View.GONE
    }

    fun release() {
        enabled = false
        scriptHandler?.remove()
        scriptHandler = null
        broker.clear()
        clientReady = false
        targetView.removeJavascriptInterface(TARGET_BRIDGE_NAME)
        inspectorView.removeJavascriptInterface(INSPECTOR_BRIDGE_NAME)
        inspectorView.stopLoading()
        inspectorView.destroy()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureInspectorView() {
        inspectorView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
        }
        inspectorView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?,
            ): WebResourceResponse? =
                request?.url?.let(assetLoader::shouldInterceptRequest)

            override fun onPageStarted(
                view: WebView?,
                url: String?,
                favicon: Bitmap?,
            ) {
                clientReady = false
                broker.detachClient(clientEndpoint)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                if (enabled && url == INSPECTOR_URL) {
                    onStatusChanged("inspector surface ready; waiting for inspected page")
                }
            }
        }
        inspectorView.visibility = View.GONE
    }

    private fun handleTargetMessage(raw: String) {
        val message = try {
            JSONObject(raw)
        } catch (_: Exception) {
            return
        }
        when (message.optString("type")) {
            "protocol" -> message.optString("payload")
                .takeIf(String::isNotEmpty)
                ?.let(broker::routeFromTarget)
            "target_ready" -> {
                val generation = broker.attachTarget(targetEndpoint)
                resetClientForCurrentTarget(generation)
                onStatusChanged("connected: ${message.optString("url")}")
            }
            "target_status" -> parseTargetStatus(message.optString("payload"))
                ?.let(onStatusChanged)
        }
    }

    private fun handleClientMessage(raw: String) {
        val message = try {
            JSONObject(raw)
        } catch (_: Exception) {
            return
        }
        if (message.optString("type") != "protocol") return
        message.optString("payload")
            .takeIf(String::isNotEmpty)
            ?.let(broker::routeFromClient)
    }

    private fun handleClientReady() {
        if (!enabled) return
        clientReady = true
        broker.attachClient(clientEndpoint)
        if (broker.hasTarget()) {
            resetClientForCurrentTarget()
        } else {
            sendClientControl("target_waiting")
        }
    }

    private fun resetClientForCurrentTarget(
        generation: Long = broker.currentGeneration(),
    ) {
        if (!clientReady || !broker.hasTarget()) return
        sendClientControl("target_reset", generation)
    }

    private fun sendClientControl(type: String, generation: Long? = null): Boolean {
        if (!clientReady) return false
        val message = JSONObject().put("type", type)
        if (generation != null) message.put("generation", generation)
        return sendToClient(message.toString())
    }

    private fun sendToTarget(payload: String): Boolean {
        if (!enabled || !broker.hasTarget()) return false
        mainHandler.post {
            targetView.evaluateJavascript(
                "window.__te2DevToolsTargetReceiveNative?.(${JSONObject.quote(payload)})",
                null,
            )
        }
        return true
    }

    private fun sendToClient(payload: String): Boolean {
        if (!enabled || !clientReady) return false
        mainHandler.post {
            inspectorView.evaluateJavascript(
                "window.__te2DevToolsInspector?.receiveNativeMessage(${JSONObject.quote(payload)})",
                null,
            )
        }
        return true
    }

    private fun parseTargetStatus(raw: String): String? =
        try {
            val payload = JSONObject(raw)
            if (payload.optString("state") == "error") {
                "error: ${payload.optString("detail", "target initialization failed")}"
            } else {
                null
            }
        } catch (_: Exception) {
            null
        }

    private inner class TargetNativeBridge {
        @JavascriptInterface
        fun postMessage(payload: String) {
            handleTargetMessage(payload)
        }
    }

    private inner class InspectorNativeBridge {
        @JavascriptInterface
        fun postMessage(payload: String) {
            handleClientMessage(payload)
        }

        @JavascriptInterface
        fun clientReady() {
            handleClientReady()
        }
    }

    companion object {
        private const val ASSET_ROOT = "devtools_inspector/"
        private const val CHOBITSU_ASSET = ASSET_ROOT + "chobitsu.js"
        private const val TARGET_RUNTIME_ASSET = ASSET_ROOT + "target-runtime.js"
        private const val TARGET_WEBVIEW_BRIDGE_ASSET =
            ASSET_ROOT + "target-webview-bridge.js"
        private const val TARGET_BRIDGE_NAME = "Te2DevToolsTargetNative"
        private const val INSPECTOR_BRIDGE_NAME = "Te2DevToolsInspectorNative"
        private const val INSPECTOR_URL =
            "https://appassets.androidplatform.net/assets/devtools_inspector/inspector.html"
    }
}
