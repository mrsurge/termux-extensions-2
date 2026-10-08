package com.termux.extensions

import android.content.pm.PackageManager
import android.os.Process
import dev.mrsurge.electromux.node.EmbeddedConsumerSpec
import dev.mrsurge.electromux.node.EmbeddedNodeService

/** TE2 policy declaration; the reusable engine/transport has no TE2 dependency. */
class TermuxNodeService : EmbeddedNodeService() {
    override val termuxLane = true
    override val consumer = EmbeddedConsumerSpec("embedded_node/te2.mjs", setOf(
        "set_selected_framework", "get_local_framework_config", "save_local_framework_config",
        "get_local_framework_state", "refresh_local_framework", "start_local_framework",
        "stop_local_framework", "use_local_framework", "install_local_framework",
        "cancel_local_framework_install", "shutdown"), setOf("local-framework-state"))

    @Suppress("DEPRECATION")
    override fun validateEnvironment() {
        val termux = packageManager.getApplicationInfo("com.termux", 0)
        check(termux.enabled && termux.uid == Process.myUid() &&
            packageManager.checkSignatures(packageName, "com.termux") == PackageManager.SIGNATURE_MATCH) {
            "Termux shared-UID/signature verification failed"
        }
    }
}
