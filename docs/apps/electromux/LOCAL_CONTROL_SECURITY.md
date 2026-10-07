# Best Practices and Security Alignment Update: TE2 Termux manual local control

Priority: High. Shared-UID execution must not be exposed to remote pages merely because they share the native relay origin.

Scope: AndroidLocalFrameworkRuntime, PersistentNetworkService, CefriumApplication, MainActivity, TermuxLocalFrameworkRegistration, TermuxLocalControlPolicy and TermuxLocalPageBridge; Termux-only pinned Electromux host dependency and packaged browser/actor assets. No new exported component, receiver, PendingIntent or nested-Intent forwarding is introduced. Existing TermuxHelperLauncher retains installed UID/signature checks and an explicit private TermuxService target.

Implementation: exact APK-owned launcher/settings URL and method allowlists; current browser URL plus document/generation fences; bounded request/event queues; native-only helper credentials and backend declarations. Service owns transport; page close unsubscribes; service close disconnects without an implicit process mutation. A newly armed single-use local-selection revision must still match the selected upstream before relay retarget. Observe/refresh cannot manufacture selection intent.

Validation: exact page/port/query/fragment/method rejection, protocol dispatch, stale/retained revision rejection and seed ordering tests; six real-process actor tests; browser bootstrap/platform tests; Termux/Cefrium/Gecko source builds and JVM tests. Physical callback ordering, signing/UID, service recreation, manual launch and remote-selection acceptance remain pending. No device/runtime restart occurred.

## Implementation diff

### State handoff follow-up (2026-10-07)

The native settled-page signal remains restricted by the existing exact-route
gate. It only requests an authoritative state read; no execution authority,
exported component, credentials or mutation retry is added. Termux/Cefrium JVM
builds and browser activation/disposal regressions pass. Pixel APK installation
is recorded separately in TRACKER; fresh actor transition acceptance is pending.

```diff
@@ TermuxLocalPageBridge
+    @Synchronized fun pageReady() {
+        val page = currentPage()
+        gate.changePage(page)
+        if (!closed && gate.captureRequest(page) != null)
+            evaluate("window.dispatchEvent(new Event('electromux:page-ready'))")
+    }
@@ MainActivity: settled loading callback
                 if (!isLoading) {
                     selectionIntegration.installWhenReady()
                     browser.evaluateJavaScript(CefriumPagePolicy.installScript())
+                    termuxLocalPageBridge?.pageReady()
@@ nonTermux adapter
+    fun pageReady() {}
```

Representative exact diffs for service lifecycle and the renderer execution boundary (remaining consumer plumbing is listed above):

```diff
diff --git a/android/app/src/main/java/com/termux/extensions/PersistentNetworkService.kt b/android/app/src/main/java/com/termux/extensions/PersistentNetworkService.kt
index 54fb6e99..aee13351 100644
--- a/android/app/src/main/java/com/termux/extensions/PersistentNetworkService.kt
+++ b/android/app/src/main/java/com/termux/extensions/PersistentNetworkService.kt
@@ -101,6 +101,8 @@ class PersistentNetworkService : Service() {
     private val devRuntimeSurfaces = AndroidDevRuntimeSurfaceRegistry()
     private val runTargetProjectionClient = RunTargetProjectionClient(httpClient)
     private lateinit var settingsStore: AndroidAppSettingsStore
+    var localFrameworkRuntime: AndroidLocalFrameworkRuntime? = null
+        private set
 
     @Volatile private var settings = AndroidAppSettings()
     private lateinit var runtimeState: AndroidClientRuntimeState
@@ -162,6 +164,7 @@ class PersistentNetworkService : Service() {
         registerWifiObserver()
         configureProjectionCallbacks()
         frameworkRelay.start(settings.frameworkBaseUrl)
+        localFrameworkRuntime = AndroidLocalFrameworkRuntimeFactory.create?.invoke(this)
         connectControlPlane()
         updateForegroundAndPowerPolicy()
         Log.i(TAG, "Android client runtime ready at ${frameworkRelay.browserOrigin}")
@@ -195,6 +198,8 @@ class PersistentNetworkService : Service() {
     }
 
     override fun onDestroy() {
+        localFrameworkRuntime?.close() // Disconnect only; never stop a retained backend.
+        localFrameworkRuntime = null
         NativeRuntimeDebug.unregister("service", this)
         releaseForegroundAndLocks()
         unregisterWifiObserver()
@@ -262,6 +267,17 @@ class PersistentNetworkService : Service() {
 
     fun browserFrameworkBaseUrl(): String = frameworkRelay.browserOrigin
 
+    fun selectedFrameworkBaseUrl(): String = settings.frameworkBaseUrl
+
+    /** Native actor intent only; a remote selection made during startup wins. */
+    @Synchronized
+    fun selectOwnedLocalFramework(port: Int, expectedOrigin: String) {
+        if (port !in 1..65535 || settings.frameworkBaseUrl != expectedOrigin) return
+        val next = settingsStore.update(JSONObject().put("frameworkHost", "127.0.0.1")
+            .put("frameworkPort", port))
+        configure(next)
+    }
+
     fun rewriteFrameworkUrl(url: String): String = frameworkRelay.rewriteFrameworkUrl(url)
 
     fun frameworkUrl(path: String): String = frameworkRelay.url(path)
diff --git a/android/cefrium/src/main/java/com/termux/extensions/CefriumApplication.kt b/android/cefrium/src/main/java/com/termux/extensions/CefriumApplication.kt
index 372db33f..776eb92e 100644
--- a/android/cefrium/src/main/java/com/termux/extensions/CefriumApplication.kt
+++ b/android/cefrium/src/main/java/com/termux/extensions/CefriumApplication.kt
@@ -5,6 +5,10 @@ import android.content.Context
 import org.chromium.base.CommandLine
 
 class CefriumApplication : Application() {
+    override fun onCreate() {
+        super.onCreate()
+        TermuxLocalFrameworkRegistration.install()
+    }
     override fun attachBaseContext(base: Context) {
         super.attachBaseContext(base)
 

diff --git a/android/termux/src/main/java/com/termux/extensions/TermuxLocalPageBridge.kt b/android/termux/src/main/java/com/termux/extensions/TermuxLocalPageBridge.kt
new file mode 100644
index 00000000..f70328a5
--- /dev/null
+++ b/android/termux/src/main/java/com/termux/extensions/TermuxLocalPageBridge.kt
@@ -0,0 +1,87 @@
+package com.termux.extensions
+
+import android.os.Handler
+import android.os.Looper
+import com.cefrium.CefriumBrowser
+import dev.mrsurge.electromux.host.ConsumerPageProtocol
+import dev.mrsurge.electromux.host.ConsumerResult
+import dev.mrsurge.electromux.host.RendererEventGate
+import java.io.Closeable
+import java.util.concurrent.atomic.AtomicInteger
+import org.json.JSONObject
+
+/** Only exact native-served launcher/settings documents have local execution authority. */
+internal class TermuxLocalPageBridge(service: PersistentNetworkService, private val evaluate: (String) -> Unit,
+                                   private val currentPage: () -> String) : Closeable {
+    private val runtime = checkNotNull(service.localFrameworkRuntime)
+    private val main = Handler(Looper.getMainLooper())
+    private val origin = service.browserFrameworkBaseUrl().trimEnd('/')
+    private val descriptor = TermuxLocalControlPolicy.descriptor(origin)
+    private val protocol = ConsumerPageProtocol(descriptor, descriptor.methods.associateWith { method ->
+        { params: JSONObject -> ConsumerResult(runtime.request(method, params)) }
+    })
+    private val gate = RendererEventGate(descriptor.routes.keys)
+    private var subscription: Closeable? = null
+    private val pendingEvents = AtomicInteger()
+    @Volatile private var closed = false
+
+    @Synchronized fun beginNavigation() {
+        gate.beginNavigation(); subscription?.close(); subscription = null
+    }
+    @Synchronized fun changePage(page: String?) {
+        gate.changePage(page)
+        if (gate.captureEvent() == null) { subscription?.close(); subscription = null }
+    }
+
+    fun handle(request: String, origin: String, callback: CefriumBrowser.QueryCallback): Boolean {
+        val method = try { JSONObject(request).optString("method") } catch (_: Exception) { return false }
+        if (method !in descriptor.methods) return false
+        val generation = gate.captureRequest(origin)
+        if (closed || generation == null || currentPage() != origin) {
+            callback.failure(403, "Local control requires the packaged launcher"); return true
+        }
+        val parsed = try { protocol.parse(request, origin) } catch (_: Exception) {
+            callback.failure(400, "Invalid local control request"); return true
+        }
+        try {
+            runtime.execute {
+                if (closed || !gate.current(generation, origin)) return@execute
+                try {
+                    synchronized(this) {
+                        gate.bind(generation, origin, parsed.documentId)
+                        val ticket = gate.captureEvent()
+                        if (ticket != null && subscription == null) subscription = runtime.subscribe { name, frame ->
+                            val payload = frame.optJSONObject("data") ?: return@subscribe
+                            if (!gate.accepts(ticket)) return@subscribe
+                            val envelope = JSONObject().put("documentId", ticket.documentId)
+                                .put("name", name).put("payload", payload).toString()
+                            if (envelope.toByteArray().size > 65536) return@subscribe
+                            if (pendingEvents.incrementAndGet() > 16) {
+                                pendingEvents.decrementAndGet(); error("Renderer event queue full")
+                            }
+                            main.post {
+                                try {
+                                    if (!closed && gate.accepts(ticket) && currentPage() == origin)
+                                        evaluate("window.__electromuxReceiveEvent?.(${JSONObject.quote(envelope)})")
+                                } finally { pendingEvents.decrementAndGet() }
+                            }
+                        }
+                    }
+                    val response = protocol.execute(parsed).toString()
+                    main.post {
+                        if (!closed && gate.current(generation, origin) && currentPage() == origin)
+                            callback.success(response)
+                    }
+                } catch (_: Exception) {
+                    main.post { if (!closed && gate.current(generation, origin))
+                        callback.failure(400, "Local control document rejected") }
+                }
+            }
+        } catch (_: Exception) { callback.failure(503, "Local control queue unavailable") }
+        return true
+    }
+
+    @Synchronized override fun close() {
+        closed = true; gate.close(); subscription?.close(); subscription = null
+    }
+}

```
