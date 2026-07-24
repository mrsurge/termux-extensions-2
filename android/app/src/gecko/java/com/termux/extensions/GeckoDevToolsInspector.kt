package com.termux.extensions

import android.view.View
import org.json.JSONObject
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebExtension
import org.mozilla.geckoview.WebExtensionController

/**
 * Owns the persistent native Inspector GeckoSession and directly brokers CDP
 * traffic to the inspected page's WebExtension content-script target.
 */
class GeckoDevToolsInspector(
    private val runtime: GeckoRuntime,
    private var targetSession: GeckoSession,
    private val inspectorView: GeckoView,
    private val onStatusChanged: (String) -> Unit,
) {
    private val broker = DevToolsProtocolBroker(
        onQueueOverflow = {
            onStatusChanged("error: developer-tools protocol queue overflow")
            resetClientForCurrentTarget()
        },
    )
    private var extension: WebExtension? = null
    private var inspectorSession: GeckoSession? = null
    private var targetPort: WebExtension.Port? = null
    private var targetEndpoint: DevToolsProtocolBroker.Endpoint? = null
    private var clientPort: WebExtension.Port? = null
    private var clientEndpoint: DevToolsProtocolBroker.Endpoint? = null
    private var clientReady = false
    private var enabled = false

    fun configure(shouldEnable: Boolean, onComplete: (Boolean) -> Unit = {}) {
        enabled = shouldEnable
        if (!shouldEnable) {
            tearDownInspectorSession()
            val installed = extension
            if (installed == null) {
                onStatusChanged("disabled")
                onComplete(true)
                return
            }
            runtime.webExtensionController
                .disable(installed, WebExtensionController.EnableSource.APP)
                .accept(
                    {
                        onStatusChanged("disabled")
                        onComplete(true)
                    },
                    {
                        onStatusChanged("error: failed to disable developer tools")
                        onComplete(false)
                    },
                )
            return
        }

        onStatusChanged("starting")
        resolveCurrentExtension { resolved, error ->
            if (resolved == null) {
                onStatusChanged(error ?: "error: developer-tools extension unavailable")
                onComplete(false)
                return@resolveCurrentExtension
            }
            extension = resolved
            registerTargetDelegate(resolved)
            runtime.webExtensionController
                .enable(resolved, WebExtensionController.EnableSource.APP)
                .accept(
                    {
                        createInspectorSession(resolved)
                        onStatusChanged("waiting for inspected page")
                        onComplete(true)
                    },
                    {
                        onStatusChanged("error: failed to enable developer tools")
                        onComplete(false)
                    },
                )
        }
    }

    fun rebindTargetSession(nextSession: GeckoSession) {
        if (targetSession === nextSession) return

        detachTargetPort()
        extension?.let { installed ->
            targetSession.webExtensionController.setMessageDelegate(
                installed,
                null,
                TARGET_NATIVE_APP_ID,
            )
        }
        targetSession = nextSession
        extension?.let(::registerTargetDelegate)
        if (enabled) {
            sendClientControl("target_waiting")
            onStatusChanged("waiting for inspected page")
        }
    }

    fun setVisible(visible: Boolean) {
        inspectorView.visibility = if (visible) View.VISIBLE else View.GONE
    }

    fun release() {
        tearDownInspectorSession()
        extension?.let {
            targetSession.webExtensionController.setMessageDelegate(
                it,
                null,
                TARGET_NATIVE_APP_ID,
            )
        }
        extension = null
    }

    private fun resolveCurrentExtension(
        onComplete: (WebExtension?, String?) -> Unit,
    ) {
        runtime.webExtensionController
            .ensureBuiltIn(EXTENSION_LOCATION, EXTENSION_ID)
            .accept(
                { installed ->
                    val resolved = installed ?: run {
                        onComplete(null, "error: developer-tools extension unavailable")
                        return@accept
                    }
                    if (resolved.metaData.version == EXTENSION_VERSION) {
                        onComplete(resolved, null)
                        return@accept
                    }

                    runtime.webExtensionController
                        .uninstall(resolved)
                        .accept(
                            {
                                runtime.webExtensionController
                                    .installBuiltIn(EXTENSION_LOCATION)
                                    .accept(
                                        { refreshed ->
                                            if (
                                                refreshed == null ||
                                                refreshed.id != EXTENSION_ID ||
                                                refreshed.metaData.version != EXTENSION_VERSION
                                            ) {
                                                onComplete(
                                                    null,
                                                    "error: developer-tools extension revision mismatch",
                                                )
                                            } else {
                                                onComplete(refreshed, null)
                                            }
                                        },
                                        {
                                            onComplete(
                                                null,
                                                "error: failed to refresh developer tools",
                                            )
                                        },
                                    )
                            },
                            {
                                onComplete(null, "error: failed to replace developer tools")
                            },
                        )
                },
                {
                    onComplete(null, "error: failed to install developer tools")
                },
            )
    }

    private fun registerTargetDelegate(installed: WebExtension) {
        targetSession.webExtensionController.setMessageDelegate(
            installed,
            targetMessageDelegate,
            TARGET_NATIVE_APP_ID,
        )
    }

    private fun createInspectorSession(installed: WebExtension) {
        if (inspectorSession != null) return

        val session = GeckoSession(
            GeckoSessionSettings.Builder().usePrivateMode(false).build(),
        )
        inspectorSession = session
        session.webExtensionController.setMessageDelegate(
            installed,
            clientMessageDelegate,
            CLIENT_NATIVE_APP_ID,
        )
        session.open(runtime)
        inspectorView.setSession(session)
        inspectorView.visibility = View.GONE
        session.setActive(true)
        session.loadUri(installed.metaData.baseUrl + INSPECTOR_DOCUMENT)
    }

    private val targetMessageDelegate = object : WebExtension.MessageDelegate {
        override fun onConnect(port: WebExtension.Port) {
            val sender = port.sender
            if (sender.session !== targetSession || !sender.isTopLevel) {
                port.disconnect()
                return
            }

            detachTargetPort()
            targetPort = port
            val endpoint = DevToolsProtocolBroker.Endpoint { payload ->
                if (targetPort !== port) return@Endpoint false
                postProtocol(port, payload)
            }
            targetEndpoint = endpoint
            val generation = broker.attachTarget(endpoint)
            port.setDelegate(object : WebExtension.PortDelegate {
                override fun onPortMessage(message: Any, source: WebExtension.Port) {
                    val payload = message as? JSONObject ?: return
                    when (payload.optString("type")) {
                        "protocol" -> payload.optString("payload")
                            .takeIf(String::isNotEmpty)
                            ?.let(broker::routeFromTarget)
                        "target_ready" -> {
                            resetClientForCurrentTarget(generation)
                            onStatusChanged("connected: ${payload.optString("url")}")
                        }
                        "target_status" -> {
                            parseTargetStatus(payload.optString("payload"))?.let(onStatusChanged)
                        }
                    }
                }

                override fun onDisconnect(source: WebExtension.Port) {
                    if (targetPort !== source) return
                    broker.detachTarget(endpoint)
                    targetEndpoint = null
                    targetPort = null
                    sendClientControl("target_waiting")
                    if (enabled) onStatusChanged("waiting for inspected page")
                }
            })
        }
    }

    private val clientMessageDelegate = object : WebExtension.MessageDelegate {
        override fun onConnect(port: WebExtension.Port) {
            val session = inspectorSession
            val sender = port.sender
            if (session == null || sender.session !== session || !sender.isTopLevel) {
                port.disconnect()
                return
            }

            detachClientPort()
            clientPort = port
            clientReady = false
            val endpoint = DevToolsProtocolBroker.Endpoint { payload ->
                if (clientPort !== port || !clientReady) return@Endpoint false
                postProtocol(port, payload)
            }
            clientEndpoint = endpoint
            port.setDelegate(object : WebExtension.PortDelegate {
                override fun onPortMessage(message: Any, source: WebExtension.Port) {
                    val payload = message as? JSONObject ?: return
                    when (payload.optString("type")) {
                        "protocol" -> payload.optString("payload")
                            .takeIf(String::isNotEmpty)
                            ?.let(broker::routeFromClient)
                        "client_ready" -> {
                            clientReady = true
                            broker.attachClient(endpoint)
                            if (broker.hasTarget()) {
                                resetClientForCurrentTarget()
                            } else {
                                sendClientControl("target_waiting")
                            }
                        }
                    }
                }

                override fun onDisconnect(source: WebExtension.Port) {
                    if (clientPort !== source) return
                    broker.detachClient(endpoint)
                    clientEndpoint = null
                    clientPort = null
                    clientReady = false
                    if (enabled) onStatusChanged("inspector surface reconnecting")
                }
            })
        }
    }

    private fun resetClientForCurrentTarget(
        generation: Long = broker.currentGeneration(),
    ) {
        if (!clientReady || !broker.hasTarget()) return
        sendClientControl("target_reset", generation)
    }

    private fun sendClientControl(type: String, generation: Long? = null): Boolean {
        val port = clientPort ?: return false
        if (!clientReady) return false
        return try {
            val message = JSONObject().put("type", type)
            if (generation != null) message.put("generation", generation)
            port.postMessage(message)
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun postProtocol(port: WebExtension.Port, payload: String): Boolean =
        try {
            port.postMessage(
                JSONObject()
                    .put("type", "protocol")
                    .put("payload", payload),
            )
            true
        } catch (_: Exception) {
            false
        }

    private fun detachTargetPort() {
        targetEndpoint?.let(broker::detachTarget)
        targetEndpoint = null
        targetPort?.let(::disconnectPort)
        targetPort = null
    }

    private fun detachClientPort() {
        clientEndpoint?.let(broker::detachClient)
        clientEndpoint = null
        clientReady = false
        clientPort?.let(::disconnectPort)
        clientPort = null
    }

    private fun tearDownInspectorSession() {
        detachTargetPort()
        detachClientPort()
        broker.clear()
        extension?.let { installed ->
            targetSession.webExtensionController.setMessageDelegate(
                installed,
                null,
                TARGET_NATIVE_APP_ID,
            )
            inspectorSession?.webExtensionController?.setMessageDelegate(
                installed,
                null,
                CLIENT_NATIVE_APP_ID,
            )
        }
        try {
            inspectorView.releaseSession()
        } catch (_: Exception) {
        }
        inspectorSession?.close()
        inspectorSession = null
        inspectorView.visibility = View.GONE
    }

    private fun disconnectPort(port: WebExtension.Port) {
        try {
            port.setDelegate(null)
            port.disconnect()
        } catch (_: Exception) {
        }
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

    companion object {
        private const val EXTENSION_LOCATION =
            "resource://android/assets/devtools_inspector/"
        private const val EXTENSION_ID = "devtools_inspector@mrselect6"
        private const val EXTENSION_VERSION = "1.15.5.1"
        private const val TARGET_NATIVE_APP_ID = "te2_devtools_target"
        private const val CLIENT_NATIVE_APP_ID = "te2_devtools_client"
        private const val INSPECTOR_DOCUMENT = "inspector.html"
    }
}
