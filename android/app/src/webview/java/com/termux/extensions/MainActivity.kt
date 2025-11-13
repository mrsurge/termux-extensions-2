package com.termux.extensions

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)

        // Configure WebView settings for PWA-like experience
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            
            // Enable modern web features
            allowFileAccess = true
            allowContentAccess = true
            setGeolocationEnabled(true)
            
            // Performance optimizations
            setRenderPriority(WebSettings.RenderPriority.HIGH)
            
            // Display settings
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            
            // Set initial zoom to 80%
            textZoom = 80
        }

        // Add JavaScript interface for native bridge
        webView.addJavascriptInterface(NativeBridge(this), "Android")

        // Set WebViewClient to handle navigation
        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(
                view: WebView?,
                errorCode: Int,
                description: String?,
                failingUrl: String?
            ) {
                Toast.makeText(
                    this@MainActivity,
                    getString(R.string.error_framework_not_running),
                    Toast.LENGTH_LONG
                ).show()
            }

            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return false
            }
        }

        // Set WebChromeClient for console logging and other features
        webView.webChromeClient = WebChromeClient()

        // Load the framework URL
        webView.loadUrl("http://127.0.0.1:8088")
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
