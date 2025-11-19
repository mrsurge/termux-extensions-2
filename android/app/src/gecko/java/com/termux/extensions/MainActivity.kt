package com.termux.extensions

import android.graphics.Color
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView

class MainActivity : AppCompatActivity() {

    private lateinit var geckoView: GeckoView
    private lateinit var geckoSession: GeckoSession
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

        val runtime = GeckoRuntimeProvider.get(applicationContext)
        geckoSession.open(runtime)

        geckoView.setSession(geckoSession)
        geckoSession.loadUri(FRAMEWORK_URL)
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
        private const val FRAMEWORK_URL = "http://127.0.0.1:8088"
    }
}
