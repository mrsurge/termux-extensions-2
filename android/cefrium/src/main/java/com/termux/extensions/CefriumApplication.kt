package com.termux.extensions

import android.app.Application
import android.content.Context
import org.chromium.base.CommandLine

class CefriumApplication : Application() {
    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(base)

        // Cefrium 0.9.0 initializes in a ContentProvider, before Application.onCreate.
        // Its AAR ships Java-backed services, not NativeOnlySandboxedProcessService;
        // select those services before Chromium caches its renderer feature choice.
        // Preserve all other switches and do not initialize the browser ourselves.
        if (!CommandLine.isInitialized()) {
            CommandLine.init(null)
        }
        CommandLine.getInstance().appendSwitchWithValue("javaless-renderers", "disabled")
    }
}
