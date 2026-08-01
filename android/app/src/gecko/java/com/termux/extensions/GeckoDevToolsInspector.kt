package com.termux.extensions

import android.os.SystemClock
import android.view.View
import org.json.JSONArray
import org.json.JSONObject
import org.mozilla.geckoview.GeckoResult
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
    private val onTargetsChanged: (List<TargetSummary>, String?) -> Unit,
) {
    data class TargetSummary(
        val targetId: String,
        val targetLabel: String,
        val url: String,
        val title: String,
    )

    private data class TargetConnection(
        val targetId: String,
        val port: WebExtension.Port,
        val endpoint: DevToolsProtocolBroker.Endpoint,
        val isTopLevel: Boolean,
        var targetLabel: String,
        var url: String,
        var title: String,
        var generation: Long = 0L,
    )

    private val broker = DevToolsProtocolBroker(
        onQueueOverflow = {
            onStatusChanged("error: developer-tools protocol queue overflow")
            resetClientForCurrentTarget()
        },
    )
    private var extension: WebExtension? = null
    private var inspectorSession: GeckoSession? = null
    private val targets = linkedMapOf<String, TargetConnection>()
    private var activeTargetId: String? = null
    private var selectedTargetId: String? = null
    private var clientPort: WebExtension.Port? = null
    private var clientEndpoint: DevToolsProtocolBroker.Endpoint? = null
    private var clientReady = false
    private var clientDebugState: JSONObject? = null
    private var enabled = false
    private var debugSequence = 0L
    private val debugEvents = java.util.ArrayDeque<JSONObject>()
    private val frameProbes = linkedMapOf<String, JSONObject>()

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

        detachAllTargetPorts()
        extension?.let { installed ->
            targetSession.webExtensionController.setMessageDelegate(
                installed,
                null,
                TARGET_NATIVE_APP_ID,
            )
            targetSession.webExtensionController.setMessageDelegate(
                installed,
                null,
                PROBE_NATIVE_APP_ID,
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
        if (visible) {
            sendTargetsChanged()
            sendClientControl("debug_state_request")
        }
    }

    fun release() {
        tearDownInspectorSession()
        extension?.let {
            targetSession.webExtensionController.setMessageDelegate(
                it,
                null,
                TARGET_NATIVE_APP_ID,
            )
            targetSession.webExtensionController.setMessageDelegate(
                it,
                null,
                PROBE_NATIVE_APP_ID,
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
        targetSession.webExtensionController.setMessageDelegate(
            installed,
            probeMessageDelegate,
            PROBE_NATIVE_APP_ID,
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
            recordDebugEvent("target_connect", senderDetails(sender))
            if (sender.session !== targetSession) {
                recordDebugEvent(
                    "target_connect_rejected",
                    senderDetails(sender).put("reason", "unexpected_session"),
                )
                port.disconnect()
                return
            }

            var registeredTargetId: String? = null
            val endpoint = DevToolsProtocolBroker.Endpoint { payload ->
                val targetId = registeredTargetId ?: return@Endpoint false
                if (targets[targetId]?.port !== port) return@Endpoint false
                postProtocol(port, payload)
            }
            port.setDelegate(object : WebExtension.PortDelegate {
                override fun onPortMessage(message: Any, source: WebExtension.Port) {
                    val payload = message as? JSONObject ?: return
                    when (payload.optString("type")) {
                        "protocol" -> {
                            if (registeredTargetId != activeTargetId) return
                            payload.optString("payload")
                                .takeIf(String::isNotEmpty)
                                ?.let(broker::routeFromTarget)
                        }
                        "target_ready" -> {
                            if (!payload.optBoolean("runtimeVerified")) {
                                recordDebugEvent(
                                    "target_ready_rejected",
                                    senderDetails(sender)
                                        .put("reason", "page_runtime_unverified")
                                        .put("targetId", payload.optString("targetId")),
                                )
                                return
                            }
                            recordDebugEvent(
                                "target_ready",
                                senderDetails(sender)
                                    .put("targetId", payload.optString("targetId"))
                                    .put("targetLabel", payload.optString("targetLabel"))
                                    .put("payloadUrl", payload.optString("url")),
                            )
                            registeredTargetId = registerTarget(
                                port = port,
                                endpoint = endpoint,
                                isTopLevel = sender.isTopLevel,
                                payload = payload,
                            )
                        }
                        "target_status" -> {
                            recordDebugEvent(
                                "target_status",
                                senderDetails(sender)
                                    .put("targetId", registeredTargetId ?: JSONObject.NULL)
                                    .put("payload", payload.optString("payload").take(4096)),
                            )
                            if (registeredTargetId != activeTargetId) return
                            parseTargetStatus(payload.optString("payload"))?.let(onStatusChanged)
                        }
                    }
                }

                override fun onDisconnect(source: WebExtension.Port) {
                    recordDebugEvent(
                        "target_disconnect",
                        senderDetails(sender).put(
                            "targetId",
                            registeredTargetId ?: JSONObject.NULL,
                        ),
                    )
                    detachTargetPort(source, registeredTargetId, endpoint)
                }
            })
        }
    }

    private val probeMessageDelegate = object : WebExtension.MessageDelegate {
        override fun onMessage(
            nativeApp: String,
            message: Any,
            sender: WebExtension.MessageSender,
        ): GeckoResult<Any>? {
            val payload = message as? JSONObject ?: return null
            if (nativeApp != PROBE_NATIVE_APP_ID || payload.optString("type") != "frame_probe") {
                return null
            }
            recordFrameProbe(sender, payload)
            return null
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
                            sendTargetsChanged()
                            if (broker.hasTarget()) {
                                resetClientForCurrentTarget()
                            } else {
                                sendClientControl("target_waiting")
                            }
                        }
                        "client_state" -> recordClientState(payload)
                        "target_select" -> {
                            selectTarget(payload.optString("targetId"))
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

    private fun registerTarget(
        port: WebExtension.Port,
        endpoint: DevToolsProtocolBroker.Endpoint,
        isTopLevel: Boolean,
        payload: JSONObject,
    ): String? {
        val targetId = payload.optString("targetId").trim()
        if (targetId.isEmpty()) {
            disconnectPort(port)
            return null
        }
        val targetLabel = payload.optString("targetLabel").trim().ifEmpty { targetId }
        val url = payload.optString("url")
        val title = payload.optString("title")
        val existing = targets[targetId]
        if (existing?.port === port) {
            existing.targetLabel = targetLabel
            existing.url = url
            existing.title = title
            sendTargetsChanged()
            return targetId
        }

        val replacingActive = activeTargetId == targetId
        if (existing != null) {
            if (replacingActive) broker.detachTarget(existing.endpoint)
            targets.remove(targetId)
            disconnectPort(existing.port)
        }
        targets[targetId] = TargetConnection(
            targetId = targetId,
            port = port,
            endpoint = endpoint,
            isTopLevel = isTopLevel,
            targetLabel = targetLabel,
            url = url,
            title = title,
        )

        if (
            replacingActive ||
            (
                activeTargetId == null &&
                (selectedTargetId == targetId || (selectedTargetId == null && isTopLevel))
            )
        ) {
            activeTargetId = null
            selectTarget(targetId)
        } else {
            sendTargetsChanged()
        }
        return targetId
    }

    fun debugSnapshot(): JSONObject {
        val targetItems = JSONArray()
        targets.values.forEach { target ->
            targetItems.put(
                JSONObject()
                    .put("targetId", target.targetId)
                    .put("targetLabel", target.targetLabel)
                    .put("url", target.url)
                    .put("title", target.title)
                    .put("isTopLevel", target.isTopLevel)
                    .put("generation", target.generation),
            )
        }
        val probeItems = JSONArray()
        frameProbes.values.forEach { probeItems.put(JSONObject(it.toString())) }
        val eventItems = JSONArray()
        debugEvents.forEach { eventItems.put(JSONObject(it.toString())) }
        return JSONObject()
            .put("enabled", enabled)
            .put("extensionId", extension?.id ?: JSONObject.NULL)
            .put("extensionVersion", extension?.metaData?.version ?: JSONObject.NULL)
            .put("inspectorSessionCreated", inspectorSession != null)
            .put("clientConnected", clientPort != null)
            .put("clientReady", clientReady)
            .put("brokerHasClient", broker.hasClient())
            .put("brokerHasTarget", broker.hasTarget())
            .put("selectedTargetId", selectedTargetId ?: JSONObject.NULL)
            .put("activeTargetId", activeTargetId ?: JSONObject.NULL)
            .put(
                "clientState",
                clientDebugState?.let { JSONObject(it.toString()) } ?: JSONObject.NULL,
            )
            .put("targets", targetItems)
            .put("frameProbes", probeItems)
            .put("events", eventItems)
    }

    fun clearDebugTelemetry(): JSONObject {
        debugEvents.clear()
        frameProbes.clear()
        return debugSnapshot()
    }

    private fun senderDetails(sender: WebExtension.MessageSender): JSONObject =
        JSONObject()
            .put("senderUrl", sender.url)
            .put("senderIsTopLevel", sender.isTopLevel)
            .put("senderEnvironmentType", sender.environmentType)
            .put("senderSessionMatches", sender.session === targetSession)

    private fun recordFrameProbe(
        sender: WebExtension.MessageSender,
        payload: JSONObject,
    ) {
        val probe = senderDetails(sender)
            .put("sequence", ++debugSequence)
            .put("observedAtElapsedMs", SystemClock.elapsedRealtime())
            .put("payloadUrl", payload.optString("url"))
            .put("windowName", payload.optString("windowName"))
            .put("payloadIsTopLevel", payload.optBoolean("isTopLevel"))
            .put("readyState", payload.optString("readyState"))
            .put("resolvedTargetId", payload.optString("targetId"))
            .put("resolvedTargetLabel", payload.optString("targetLabel"))
        val key = listOf(
            sender.isTopLevel.toString(),
            sender.url,
            payload.optString("windowName"),
        ).joinToString("\u0000")
        frameProbes[key] = probe
        while (frameProbes.size > MAX_FRAME_PROBES) {
            val oldest = frameProbes.entries.iterator()
            if (!oldest.hasNext()) break
            oldest.next()
            oldest.remove()
        }
        recordDebugEvent(
            "frame_probe",
            JSONObject()
                .put("probeSequence", probe.optLong("sequence"))
                .put("senderUrl", sender.url)
                .put("senderIsTopLevel", sender.isTopLevel)
                .put("resolvedTargetId", payload.optString("targetId")),
        )
    }

    private fun recordClientState(payload: JSONObject) {
        clientDebugState = JSONObject(payload.toString()).apply {
            remove("type")
            put("observedAtElapsedMs", SystemClock.elapsedRealtime())
        }
        recordDebugEvent(
            "client_state",
            JSONObject()
                .put("reason", payload.optString("reason"))
                .put("targetCount", payload.optInt("targetCount"))
                .put("optionCount", payload.optJSONArray("options")?.length() ?: 0)
                .put("selectedValue", payload.optString("selectedValue")),
        )
    }

    private fun recordDebugEvent(type: String, details: JSONObject = JSONObject()) {
        val event = JSONObject()
            .put("sequence", ++debugSequence)
            .put("observedAtElapsedMs", SystemClock.elapsedRealtime())
            .put("type", type)
        val keys = details.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            event.put(key, details.opt(key))
        }
        debugEvents.addLast(event)
        while (debugEvents.size > MAX_DEBUG_EVENTS) debugEvents.removeFirst()
    }

    fun selectTarget(targetId: String): Boolean {
        val next = targets[targetId] ?: return false
        selectedTargetId = targetId
        if (activeTargetId == targetId && broker.hasTarget()) {
            sendTargetsChanged()
            return true
        }

        activeTargetId?.let { currentId ->
            targets[currentId]?.let { broker.detachTarget(it.endpoint) }
        }
        activeTargetId = targetId
        next.generation = broker.attachTarget(next.endpoint)
        sendTargetsChanged()
        resetClientForCurrentTarget(next.generation)
        onStatusChanged("connected: ${next.url}")
        return true
    }

    private fun sendTargetsChanged(): Boolean {
        onTargetsChanged(
            targets.values.map { target ->
                TargetSummary(
                    targetId = target.targetId,
                    targetLabel = target.targetLabel,
                    url = target.url,
                    title = target.title,
                )
            },
            activeTargetId,
        )
        val port = clientPort ?: return false
        if (!clientReady) return false
        val items = JSONArray()
        targets.values.forEach { target ->
            items.put(
                JSONObject()
                    .put("targetId", target.targetId)
                    .put("targetLabel", target.targetLabel)
                    .put("url", target.url)
                    .put("title", target.title)
                    .put("isTopLevel", target.isTopLevel),
            )
        }
        val sent = postClientMessage(
            port,
            JSONObject()
                .put("type", "targets_changed")
                .put("activeTargetId", activeTargetId ?: "")
                .put("targets", items),
        )
        recordDebugEvent(
            "targets_changed_sent",
            JSONObject()
                .put("sent", sent)
                .put("targetCount", items.length())
                .put("activeTargetId", activeTargetId ?: ""),
        )
        return sent
    }

    private fun sendClientControl(type: String, generation: Long? = null): Boolean {
        val port = clientPort ?: return false
        if (!clientReady) return false
        val message = JSONObject().put("type", type)
        if (generation != null) message.put("generation", generation)
        return postClientMessage(port, message)
    }

    private fun postClientMessage(port: WebExtension.Port, message: JSONObject): Boolean =
        try {
            port.postMessage(message)
            true
        } catch (_: Exception) {
            false
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

    private fun detachTargetPort(
        port: WebExtension.Port,
        targetId: String?,
        endpoint: DevToolsProtocolBroker.Endpoint,
    ) {
        if (targetId == null || targets[targetId]?.port !== port) return
        val wasActive = activeTargetId == targetId
        if (wasActive) {
            broker.detachTarget(endpoint)
            activeTargetId = null
        }
        targets.remove(targetId)
        if (wasActive) {
            // Keep the selection stable while a navigated iframe recreates its
            // content-script port. The user can still select another live target.
            sendClientControl("target_waiting")
            if (enabled) onStatusChanged("waiting for inspected page")
        }
        sendTargetsChanged()
    }

    private fun detachAllTargetPorts() {
        activeTargetId?.let { currentId ->
            targets[currentId]?.let { broker.detachTarget(it.endpoint) }
        }
        activeTargetId = null
        selectedTargetId = null
        val ports = targets.values.map(TargetConnection::port)
        targets.clear()
        ports.forEach(::disconnectPort)
        sendTargetsChanged()
    }

    private fun detachClientPort() {
        clientEndpoint?.let(broker::detachClient)
        clientEndpoint = null
        clientReady = false
        clientPort?.let(::disconnectPort)
        clientPort = null
    }

    private fun tearDownInspectorSession() {
        detachAllTargetPorts()
        detachClientPort()
        broker.clear()
        extension?.let { installed ->
            targetSession.webExtensionController.setMessageDelegate(
                installed,
                null,
                TARGET_NATIVE_APP_ID,
            )
            targetSession.webExtensionController.setMessageDelegate(
                installed,
                null,
                PROBE_NATIVE_APP_ID,
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
        private const val EXTENSION_VERSION = "1.15.5.4"
        private const val TARGET_NATIVE_APP_ID = "te2_devtools_target"
        private const val PROBE_NATIVE_APP_ID = "te2_devtools_probe"
        private const val CLIENT_NATIVE_APP_ID = "te2_devtools_client"
        private const val INSPECTOR_DOCUMENT = "inspector.html"
        private const val MAX_FRAME_PROBES = 32
        private const val MAX_DEBUG_EVENTS = 96
    }
}
