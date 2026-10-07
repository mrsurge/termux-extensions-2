package com.termux.extensions

import android.os.Handler
import android.os.Looper
import dev.mrsurge.electromux.host.BundledBackendSpec
import dev.mrsurge.electromux.host.HelperInstallSpec
import dev.mrsurge.electromux.host.RuntimeOwner
import dev.mrsurge.electromux.host.TermuxHelperClient
import java.io.Closeable
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject

internal object TermuxLocalFrameworkRegistration {
    fun install() { AndroidLocalFrameworkRuntimeFactory.create = ::TermuxLocalFrameworkRuntime }
}

/** Consumer policy only. Generic transport/provisioning lives in the pinned host. */
internal class TermuxLocalFrameworkRuntime(private val service: PersistentNetworkService) : AndroidLocalFrameworkRuntime {
    private val main = Handler(Looper.getMainLooper())
    private val owner: RuntimeOwner<Pair<String, JSONObject>> = RuntimeOwner { client.close() }
    private val client: TermuxHelperClient = TermuxHelperClient(service.applicationContext, HelperInstallSpec(
        "/data/data/com.termux/files/home/.cache/te2-electromux", "te2-electromux-helper",
        mapOf("electromux/__init__.py" to "helper/electromux/__init__.py",
            "electromux/helper.py" to "helper/electromux/helper.py",
            "electromux/protocol.py" to "helper/electromux/protocol.py",
            "backend/local-framework-backend.mjs" to "electromux_backend/local-framework-backend.mjs"),
        BundledBackendSpec("/data/data/com.termux/files/usr/bin/node",
            "backend/local-framework-backend.mjs", environment = mapOf(
                "TE2_ELECTROMUX_CONFIG_HOME" to "/data/data/com.termux/files/home/.config/te2/te2-termux"), stopTimeout = 20.0)),
        setOf("local-framework-state")) { name, frame ->
        if (pendingEvents.incrementAndGet() > 16) {
            pendingEvents.decrementAndGet(); error("Native state queue full")
        }
        main.post {
            try {
                if (!closed) {
                    val data = frame.optJSONObject("data")
                    if (data != null) {
                        reconcileSelection(data)
                        frame.put("data", projectState(data))
                    }
                    owner.emit(name to frame)
                }
            } finally { pendingEvents.decrementAndGet() }
        }
    }
    private val selectionFence = TermuxLocalSelectionFence()
    private val pendingEvents = AtomicInteger()
    private var actorStarted = false
    private var helperInstanceId: String? = null
    private var selectionBaselineSet = false
    @Volatile private var closed = false

    override fun execute(operation: () -> Unit) = owner.execute(operation)
    override fun subscribe(observer: (String, JSONObject) -> Unit): Closeable =
        owner.subscribe { (name, frame) -> observer(name, frame) }

    private fun actor(method: String, params: JSONObject): JSONObject {
        val reply = client.requestBackend(JSONObject().put("method", method).put("params", params))
        if (reply.has("error")) error(reply.getString("error"))
        return reply.getJSONObject("result")
    }

    override fun request(method: String, params: JSONObject): JSONObject {
        require(method in TermuxLocalControlPolicy.methods)
        check(!closed)
        if (method == "get_settings") return TermuxStartupSettingsStore(service).load()
            .merge(AndroidAppSettingsStore(service).load().toJson())
        if (method == "save_settings") {
            val startupStore = TermuxStartupSettingsStore(service)
            val startupValues = startupStore.load().merge(JSONObject())
            for (key in params.keys()) startupValues.put(key, params.get(key))
            val startup = TermuxStartupSettings.parse(startupValues)
            val store = AndroidAppSettingsStore(service)
            val previous = store.load()
            validatedAndroidFrameworkEndpoint(params.optString("frameworkHost", previous.frameworkHost),
                params.optInt("frameworkPort", previous.frameworkPort))
            val next = store.update(params)
            startupStore.save(startup)
            main.post { if (!closed) service.configure(next) }
            return JSONObject().put("settings", startup.merge(next.toJson()))
                .put("browserFrameworkOrigin", service.browserFrameworkBaseUrl())
                .put("connectionChanged", previous.frameworkBaseUrl != next.frameworkBaseUrl)
        }
        val status = client.connect()
        val instance = status.optString("helperInstanceId").takeIf { it.isNotEmpty() }
        if (instance != null && instance != helperInstanceId) {
            actorStarted = false
            selectionBaselineSet = false
            selectionFence.reset()
            helperInstanceId = instance
        }
        // Starting the retained consumer actor does not start the framework.
        if (status.optString("state") != "ready") {
            check(!actorStarted) { "Consumer actor exited; explicit recovery required" }
            client.call("start")
            actorStarted = true
            selectionFence.reset()
            selectionBaselineSet = false
        }
        actorStarted = true
        val origin = service.selectedFrameworkBaseUrl()
        val current = actor("set_selected_framework", JSONObject().put("origin", origin))
        if (!selectionBaselineSet) {
            selectionFence.observe(current.optLong("selectionRevision"))
            selectionBaselineSet = true
            actor("refresh_local_framework", JSONObject())
        }
        if (method in setOf("start_local_framework", "use_local_framework")) selectionFence.arm(origin)
        val result = actor(method, params)
        main.post { if (!closed) reconcileSelection(result) }
        return projectState(result)
    }

    private fun reconcileSelection(state: JSONObject) {
        val (port, expected) = selectionFence.consume(state) ?: return
        service.selectOwnedLocalFramework(port, expected)
    }

    private fun projectState(state: JSONObject): JSONObject {
        if (!state.has("localOrigin")) return state
        val origin = service.selectedFrameworkBaseUrl()
        return JSONObject(state.toString()).put("selectedOrigin", origin)
            .put("selected", origin == state.optString("localOrigin"))
    }

    override fun close() { closed = true; owner.close() }

    override fun beginStartup(onPreferredApp: (String, String) -> Unit, onError: (String) -> Unit): Closeable =
        TermuxStartupCoordinator(TermuxStartupSettingsStore(service).load(), this,
            service::selectedFrameworkBaseUrl, onPreferredApp, onError).also { it.begin() }

}
