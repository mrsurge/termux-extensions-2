package com.termux.extensions

/** UI-thread admission for callbacks that can outlive a surface or Activity. */
internal class CefriumViewportRestoreGate {
    var generation = 0
        private set
    var active = false
        private set
    private var closed = false

    fun activate(): Boolean {
        if (closed) return false
        active = true
        return true
    }

    fun invalidate() { generation += 1 }
    fun accepts(ticket: Int): Boolean = active && !closed && ticket == generation
    fun suspend() { active = false; invalidate() }
    fun close() { closed = true; suspend() }
}
