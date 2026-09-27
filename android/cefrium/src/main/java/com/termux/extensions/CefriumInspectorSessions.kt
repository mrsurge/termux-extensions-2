package com.termux.extensions

import org.json.JSONObject

/** Routes the inspector's flattened CDP subtree independently of native monitors. */
internal class CefriumInspectorSessions {
    private var root: String? = null
    private val parents = mutableMapOf<String, String>()

    private fun selectRoot(next: String?) {
        if (next == root) return
        root = next
        parents.clear()
    }

    private fun owns(session: String): Boolean = session == root || parents.containsKey(session)

    fun incoming(message: JSONObject, rootSession: String?): JSONObject? {
        selectRoot(rootSession)
        if (root == null) return null
        val session = message.optString("sessionId")
        if (!owns(session)) return null
        val params = message.optJSONObject("params")
        when (message.optString("method")) {
            "Target.attachedToTarget" -> {
                val child = params?.optString("sessionId").orEmpty()
                if (child.isNotBlank()) parents[child] = session
            }
            "Target.detachedFromTarget" -> {
                val removed = mutableSetOf(params?.optString("sessionId").orEmpty())
                do {
                    val descendants = parents.filterValues { it in removed }.keys - removed
                    removed.addAll(descendants)
                } while (descendants.isNotEmpty())
                removed.forEach(parents::remove)
            }
        }
        // DevTools sees the selected page as its root, but child session IDs
        // must survive for its worker router and runIfWaitingForDebugger reply.
        return JSONObject(message.toString()).apply {
            if (session == root) remove("sessionId")
        }
    }

    fun outgoing(message: JSONObject, rootSession: String?): JSONObject? {
        selectRoot(rootSession)
        val active = root ?: return null
        val session = message.optString("sessionId").ifBlank { active }
        if (!owns(session)) return null
        return JSONObject(message.toString()).put("sessionId", session)
    }
}
