package com.termux.extensions

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebExtension

class MainActivity : AppCompatActivity() {

    private lateinit var geckoView: GeckoView
    private lateinit var geckoSession: GeckoSession
    private lateinit var runtime: GeckoRuntime

    private lateinit var consoleOverlay: FrameLayout
    private lateinit var consoleScroll: ScrollView
    private lateinit var consoleText: TextView

    private val httpClient = OkHttpClient()
    private val consoleLines = ArrayDeque<String>(2000)

    private var frameworkBaseUrl: String = DEFAULT_FRAMEWORK_URL
    private var currentAppId: String = DEFAULT_APP_ID
    private var isLocked: Boolean = false

    private var canNavigateBack = false

    private fun dpToPx(dp: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            dp.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        geckoView = findViewById(R.id.geckoView)

        consoleOverlay = findViewById(R.id.consoleOverlay)
        consoleScroll = findViewById(R.id.consoleScroll)
        consoleText = findViewById(R.id.consoleText)
        consoleText.typeface = Typeface.MONOSPACE

        findViewById<Button>(R.id.btnHome).setOnClickListener { loadHome() }
        findViewById<Button>(R.id.btnReload).setOnClickListener { if (::geckoSession.isInitialized) geckoSession.reload() }
        findViewById<Button>(R.id.btnRecents).setOnClickListener { showRecents() }
        findViewById<Button>(R.id.btnLock).setOnClickListener { toggleLock() }
        findViewById<Button>(R.id.btnQuit).setOnClickListener { quitCurrentApp() }
        findViewById<Button>(R.id.btnConsole).setOnClickListener { toggleConsoleOverlay() }

        consoleOverlay.setOnClickListener { toggleConsoleOverlay() }

        geckoSession = GeckoSession().apply {
            historyDelegate = object : GeckoSession.HistoryDelegate {
                override fun onHistoryStateChange(
                    session: GeckoSession,
                    historyList: GeckoSession.HistoryDelegate.HistoryList
                ) {
                    canNavigateBack = historyList.currentIndex > 0
                }
            }
            promptDelegate = object : GeckoSession.PromptDelegate {
                override fun onAlertPrompt(
                    session: GeckoSession,
                    prompt: GeckoSession.PromptDelegate.AlertPrompt
                ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
                    val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
                    runOnUiThread {
                        AlertDialog.Builder(this@MainActivity)
                            .setMessage(prompt.message ?: "")
                            .setPositiveButton(android.R.string.ok) { _, _ ->
                                result.complete(prompt.dismiss())
                            }
                            .setOnCancelListener {
                                result.complete(prompt.dismiss())
                            }
                            .show()
                    }
                    return result
                }

                override fun onButtonPrompt(
                    session: GeckoSession,
                    prompt: GeckoSession.PromptDelegate.ButtonPrompt
                ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
                    val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
                    runOnUiThread {
                        AlertDialog.Builder(this@MainActivity)
                            .setMessage(prompt.message ?: "")
                            .setPositiveButton(android.R.string.ok) { _, _ ->
                                result.complete(
                                    prompt.confirm(
                                        GeckoSession.PromptDelegate.ButtonPrompt.Type.POSITIVE
                                    )
                                )
                            }
                            .setNegativeButton(android.R.string.cancel) { _, _ ->
                                result.complete(
                                    prompt.confirm(
                                        GeckoSession.PromptDelegate.ButtonPrompt.Type.NEGATIVE
                                    )
                                )
                            }
                            .setOnCancelListener {
                                result.complete(prompt.dismiss())
                            }
                            .show()
                    }
                    return result
                }

                override fun onTextPrompt(
                    session: GeckoSession,
                    prompt: GeckoSession.PromptDelegate.TextPrompt
                ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
                    val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
                    runOnUiThread {
                        val input = EditText(this@MainActivity).apply {
                            setText(prompt.defaultValue ?: "")
                            setSelection(text?.length ?: 0)
                        }
                        AlertDialog.Builder(this@MainActivity)
                            .setMessage(prompt.message ?: "")
                            .setView(input)
                            .setPositiveButton(android.R.string.ok) { _, _ ->
                                val value = input.text?.toString() ?: ""
                                result.complete(prompt.confirm(value))
                            }
                            .setNegativeButton(android.R.string.cancel) { _, _ ->
                                result.complete(prompt.dismiss())
                            }
                            .setOnCancelListener {
                                result.complete(prompt.dismiss())
                            }
                            .show()
                    }
                    return result
                }

                override fun onColorPrompt(
                    session: GeckoSession,
                    prompt: GeckoSession.PromptDelegate.ColorPrompt
                ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
                    val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
                    runOnUiThread {
                        var red = 0
                        var green = 0
                        var blue = 0
                        var alpha = 255 // Default to opaque

                        // Try to parse initial color from prompt.defaultValue
                        prompt.defaultValue?.let {
                            try {
                                val color = Color.parseColor(it)
                                red = Color.red(color)
                                green = Color.green(color)
                                blue = Color.blue(color)
                                alpha = Color.alpha(color)
                            } catch (e: IllegalArgumentException) {
                                // Default to black if parsing fails
                                red = 0
                                green = 0
                                blue = 0
                                alpha = 255
                            }
                        }

                        val colorPreview = android.view.View(this@MainActivity).apply {
                            layoutParams = LinearLayout.LayoutParams(
                                LinearLayout.LayoutParams.MATCH_PARENT,
                                dpToPx(50) // 50dp height
                            ).apply {
                                bottomMargin = dpToPx(16)
                            }
                            setBackgroundColor(Color.argb(alpha, red, green, blue))
                        }

                        val layout = LinearLayout(this@MainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(dpToPx(24), dpToPx(16), dpToPx(24), dpToPx(16))
                            addView(colorPreview)
                        }

                        // Helper to add a color control (TextView + SeekBar)
                        val addColorControl = { labelText: String, initialValue: Int, onProgressChanged: (Int) -> Unit ->
                            val label = TextView(this@MainActivity).apply {
                                text = labelText
                                layoutParams = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.WRAP_CONTENT,
                                    LinearLayout.LayoutParams.WRAP_CONTENT
                                ).apply {
                                    topMargin = dpToPx(8)
                                    bottomMargin = dpToPx(4)
                                }
                                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                                setTextColor(Color.WHITE) // Assuming dark theme
                            }
                            val seekBar = SeekBar(this@MainActivity).apply {
                                max = 255
                                progress = initialValue
                                layoutParams = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.MATCH_PARENT,
                                    LinearLayout.LayoutParams.WRAP_CONTENT
                                )
                                setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                                    override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                                        onProgressChanged(progress)
                                        colorPreview.setBackgroundColor(Color.argb(alpha, red, green, blue))
                                    }
                                    override fun onStartTrackingTouch(seekBar: SeekBar?) {}
                                    override fun onStopTrackingTouch(seekBar: SeekBar?) {}
                                })
                            }
                            layout.addView(label)
                            layout.addView(seekBar)
                            seekBar
                        }

                        val redSeekBar = addColorControl("Red", red) { p -> red = p }
                        val greenSeekBar = addColorControl("Green", green) { p -> green = p }
                        val blueSeekBar = addColorControl("Blue", blue) { p -> blue = p }
                        val alphaSeekBar = addColorControl("Alpha", alpha) { p -> alpha = p }

                        AlertDialog.Builder(this@MainActivity)
                            .setTitle("Select Color")
                            .setView(layout)
                            .setPositiveButton(android.R.string.ok) { _, _ ->
                                // Format color as #AARRGGBB hex string for web, or rgba() if alpha < 255
                                val hexColor = String.format("#%02X%02X%02X%02X", alpha, red, green, blue)
                                val webColorString = if (alpha < 255) {
                                    "rgba($red, $green, $blue, ${String.format("%.2f", alpha / 255f)})"
                                } else {
                                    String.format("#%02X%02X%02X", red, green, blue)
                                }
                                result.complete(prompt.confirm(webColorString))
                            }
                            .setNegativeButton(android.R.string.cancel) { _, _ ->
                                result.complete(prompt.dismiss())
                            }
                            .setOnCancelListener {
                                result.complete(prompt.dismiss())
                            }
                            .show()
                    }
                    return result
                }
            }
        }

        runtime = GeckoRuntimeProvider.get(applicationContext)
        geckoSession.open(runtime)

        geckoView.setSession(geckoSession)

        installConsoleExtension()
        wakeFrameworkAndLoad()
    }

    private fun loadHome() {
        if (!::geckoSession.isInitialized) return
        geckoSession.loadUri(frameworkBaseUrl.trimEnd('/') + "/")
    }

    private fun loadApp(appId: String) {
        if (!::geckoSession.isInitialized) return
        currentAppId = appId
        isLocked = false
        findViewById<Button>(R.id.btnLock).text = "Lock"
        geckoSession.loadUri(frameworkBaseUrl.trimEnd('/') + "/app/" + appId + "?gv_native=1")
    }

    private fun showRecents() {
        Thread {
            try {
                val url = frameworkBaseUrl.trimEnd('/') + "/api/apps/running"
                val req = Request.Builder().url(url).get().build()
                httpClient.newCall(req).execute().use { resp ->
                    val body = resp.body?.string().orEmpty()
                    if (!resp.isSuccessful || body.isBlank()) return@use
                    val json = JSONObject(body)
                    val data = json.optJSONArray("data") ?: return@use
                    val ids = mutableListOf<String>()
                    for (i in 0 until data.length()) {
                        val obj = data.optJSONObject(i) ?: continue
                        val id = obj.optString("app_id")
                        if (id.isNotBlank()) ids.add(id)
                    }
                    runOnUiThread {
                        if (ids.isEmpty()) {
                            AlertDialog.Builder(this)
                                .setMessage("No running apps")
                                .setPositiveButton(android.R.string.ok, null)
                                .show()
                            return@runOnUiThread
                        }
                        AlertDialog.Builder(this)
                            .setTitle("Recents")
                            .setItems(ids.toTypedArray()) { _, which ->
                                val target = ids[which]
                                loadApp(target)
                            }
                            .setNegativeButton(android.R.string.cancel, null)
                            .show()
                    }
                }
            } catch (_: Exception) {
            }
        }.start()
    }

    private fun toggleLock() {
        Thread {
            try {
                val endpoint = if (isLocked) "unlock" else "lock"
                val url = frameworkBaseUrl.trimEnd('/') + "/api/apps/" + currentAppId + "/" + endpoint
                val req = Request.Builder()
                    .url(url)
                    .post("".toRequestBody("application/json".toMediaType()))
                    .build()
                httpClient.newCall(req).execute().use { resp ->
                    val body = resp.body?.string().orEmpty()
                    if (!resp.isSuccessful || body.isBlank()) return@use
                    val json = JSONObject(body)
                    if (json.optBoolean("ok")) {
                        isLocked = !isLocked
                        runOnUiThread {
                            findViewById<Button>(R.id.btnLock).text = if (isLocked) "Unlock" else "Lock"
                        }
                    }
                }
            } catch (_: Exception) {
            }
        }.start()
    }

    private fun quitCurrentApp() {
        Thread {
            try {
                val url = frameworkBaseUrl.trimEnd('/') + "/api/apps/" + currentAppId + "/quit"
                val req = Request.Builder()
                    .url(url)
                    .post("".toRequestBody("application/json".toMediaType()))
                    .build()
                httpClient.newCall(req).execute().close()
            } catch (_: Exception) {
            }
            runOnUiThread { loadHome() }
        }.start()
    }

    private fun toggleConsoleOverlay() {
        consoleOverlay.visibility = if (consoleOverlay.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        if (consoleOverlay.visibility == View.VISIBLE) {
            consoleScroll.post { consoleScroll.fullScroll(View.FOCUS_DOWN) }
        }
    }

    private fun appendConsoleLine(level: String, text: String, url: String?) {
        val line = buildString {
            append('[').append(level).append("] ").append(text)
            if (!url.isNullOrBlank()) {
                append("\n").append(url)
            }
        }
        if (consoleLines.size >= 2000) {
            consoleLines.removeFirst()
        }
        consoleLines.addLast(line)
        runOnUiThread {
            consoleText.text = consoleLines.joinToString("\n\n")
            if (consoleOverlay.visibility == View.VISIBLE) {
                consoleScroll.post { consoleScroll.fullScroll(View.FOCUS_DOWN) }
            }
        }
    }

    private fun installConsoleExtension() {
        val extLocation = "resource://android/assets/console_pipe/"
        runtime.webExtensionController
            .ensureBuiltIn(extLocation, "console_pipe@example.com")
            .accept(
                { extension ->
                    val ext = extension ?: return@accept
                    val delegate = object : WebExtension.MessageDelegate {
                        override fun onMessage(
                            nativeApp: String,
                            message: Any,
                            sender: WebExtension.MessageSender
                        ): GeckoResult<Any>? {
                            try {
                                val obj = when (message) {
                                    is JSONObject -> message
                                    is String -> JSONObject(message)
                                    else -> null
                                } ?: return null

                                if (obj.optString("type") == "console") {
                                    appendConsoleLine(
                                        obj.optString("level", "log"),
                                        obj.optString("text", ""),
                                        obj.optString("url", null)
                                    )
                                }
                            } catch (_: Exception) {
                            }
                            return null
                        }
                    }
                    geckoSession.webExtensionController
                        .setMessageDelegate(ext, delegate, "browser")
                },
                { e -> appendConsoleLine("error", "Extension install failed: ${e?.message ?: "unknown"}", null) }
            )
    }

    private fun wakeFrameworkAndLoad() {
        Thread {
            val base = IPC_SLEEP_BASE_URL.trimEnd('/')
            try {
                // best-effort wake
                val wakeReq = Request.Builder()
                    .url("$base/actions/wake")
                    .post("".toRequestBody("application/json".toMediaType()))
                    .build()
                httpClient.newCall(wakeReq).execute().close()
            } catch (_: Exception) {
            }

            var frameworkUrl = DEFAULT_FRAMEWORK_URL
            try {
                val cfgReq = Request.Builder().url("$base/config").get().build()
                httpClient.newCall(cfgReq).execute().use { resp ->
                    val body = resp.body?.string()
                    if (resp.isSuccessful && !body.isNullOrBlank()) {
                        val json = JSONObject(body)
                        val data = json.optJSONObject("data")
                        val candidate = data?.optString("framework_url")
                        if (!candidate.isNullOrBlank()) {
                            frameworkUrl = candidate
                        }
                    }
                }
            } catch (_: Exception) {
            }

            frameworkBaseUrl = frameworkUrl
            runOnUiThread {
                loadApp(DEFAULT_APP_ID)
            }
        }.start()
    }

    override fun onBackPressed() {
        if (::geckoSession.isInitialized && canNavigateBack) {
            geckoSession.goBack()
            return
        }
        super.onBackPressed()
    }

    override fun onDestroy() {
        if (::geckoSession.isInitialized) {
            geckoSession.close()
        }
        super.onDestroy()
    }

    companion object {
        private const val DEFAULT_FRAMEWORK_URL = "http://127.0.0.1:8089"
        private const val IPC_SLEEP_BASE_URL = "http://127.0.0.1:9100"
        private const val DEFAULT_APP_ID = "file_editor_cm6"
    }
}
