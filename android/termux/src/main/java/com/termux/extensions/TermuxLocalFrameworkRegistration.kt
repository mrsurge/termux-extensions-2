package com.termux.extensions

import android.os.Handler
import android.os.Looper
import dev.mrsurge.electromux.host.RuntimeOwner
import dev.mrsurge.electromux.node.EmbeddedNodeClient
import java.io.Closeable
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject

internal object TermuxLocalFrameworkRegistration {
    fun install() { AndroidLocalFrameworkRuntimeFactory.create = ::TermuxLocalFrameworkRuntime }
}

/** Consumer policy only. The engine lives in the private isolated Node service. */
internal class TermuxLocalFrameworkRuntime(private val service: PersistentNetworkService) : AndroidLocalFrameworkRuntime {
    private val main = Handler(Looper.getMainLooper())
    private val owner: RuntimeOwner<Pair<String, JSONObject>> = RuntimeOwner { client.close() }
    private val client = EmbeddedNodeClient(service.applicationContext, TermuxNodeService::class.java) { raw ->
        val frame = JSONObject(raw)
        val name = frame.getString("event")
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
    private var selectionBaselineSet = false
    @Volatile private var closed = false

    override fun execute(operation: () -> Unit) = owner.execute(operation)
    override fun subscribe(observer: (String, JSONObject) -> Unit): Closeable =
        owner.subscribe { (name, frame) -> observer(name, frame) }

    private fun actor(method: String, params: JSONObject): JSONObject {
        val reply = client.request(method, params)
        if (reply.has("error")) error(reply.getString("error"))
        return reply.getJSONObject("result")
    }

    override fun request(method: String, params: JSONObject): JSONObject {
        require(method in TermuxLocalControlPolicy.methods)
        check(!closed)
        if (method == "get_settings") {
            val store = AndroidAppSettingsStore(service)
            store.seedTermuxLocalhostBookmark()
            return TermuxStartupSettingsStore(service).load().merge(store.load().toJson())
        }
        if (method == "get_android_settings") return androidSettings()
        if (method == "save_android_settings") {
            TermuxLocalControlPolicy.validateAndroidSettings(params)
            val next = AndroidAppSettingsStore(service).update(params)
            main.post { if (!closed) service.configure(next) }
            return androidSettings()
        }
        if (method == "open_power_settings" || method == "open_notification_settings") {
            require(params.length() == 0)
            main.post { if (!closed) {
                if (method == "open_power_settings") service.openBatteryOptimizationSettings()
                else service.openNotificationSettings()
            } }
            return JSONObject().put("opened", true)
        }
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

    private fun androidSettings(): JSONObject = AndroidAppSettingsStore(service).load().toJson()
        .put("runtime", service.snapshot().toJson())

    override fun beginStartup(onPreferredApp: (String, String) -> Unit, onError: (String) -> Unit): Closeable =
        TermuxStartupCoordinator(TermuxStartupSettingsStore(service).load(), this,
            service::selectedFrameworkBaseUrl, onPreferredApp, onError).also { it.begin() }

}
