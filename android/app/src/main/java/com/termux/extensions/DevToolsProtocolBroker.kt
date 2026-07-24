package com.termux.extensions

/**
 * Routes raw CDP messages between one inspected-page target and one native
 * developer-tools client without involving the framework network stack.
 */
internal class DevToolsProtocolBroker(
    private val maxQueuedMessages: Int = DEFAULT_MAX_QUEUED_MESSAGES,
    private val maxQueuedChars: Int = DEFAULT_MAX_QUEUED_CHARS,
    private val onQueueOverflow: (Direction) -> Unit = {},
) {
    fun interface Endpoint {
        fun send(payload: String): Boolean
    }

    enum class Direction {
        TARGET_TO_CLIENT,
        CLIENT_TO_TARGET,
    }

    private data class PendingMessage(
        val payload: String,
        val chars: Int = payload.length,
    )

    private val targetToClient = ArrayDeque<PendingMessage>()
    private val clientToTarget = ArrayDeque<PendingMessage>()
    private var targetToClientChars = 0
    private var clientToTargetChars = 0
    private var target: Endpoint? = null
    private var client: Endpoint? = null
    private var generation = 0L

    @Synchronized
    fun attachTarget(endpoint: Endpoint): Long {
        target = endpoint
        generation += 1
        clearQueue(Direction.TARGET_TO_CLIENT)
        clearQueue(Direction.CLIENT_TO_TARGET)
        return generation
    }

    @Synchronized
    fun detachTarget(endpoint: Endpoint? = null) {
        if (endpoint == null || target === endpoint) target = null
        clearQueue(Direction.CLIENT_TO_TARGET)
    }

    @Synchronized
    fun attachClient(endpoint: Endpoint) {
        client = endpoint
        flush(Direction.TARGET_TO_CLIENT, endpoint)
    }

    @Synchronized
    fun detachClient(endpoint: Endpoint? = null) {
        if (endpoint == null || client === endpoint) client = null
        clearQueue(Direction.TARGET_TO_CLIENT)
    }

    @Synchronized
    fun routeFromTarget(payload: String) {
        route(Direction.TARGET_TO_CLIENT, payload, client)
    }

    @Synchronized
    fun routeFromClient(payload: String) {
        route(Direction.CLIENT_TO_TARGET, payload, target)
    }

    @Synchronized
    fun currentGeneration(): Long = generation

    @Synchronized
    fun hasTarget(): Boolean = target != null

    @Synchronized
    fun hasClient(): Boolean = client != null

    @Synchronized
    fun clear() {
        target = null
        client = null
        clearQueue(Direction.TARGET_TO_CLIENT)
        clearQueue(Direction.CLIENT_TO_TARGET)
    }

    private fun route(direction: Direction, payload: String, endpoint: Endpoint?) {
        if (endpoint?.send(payload) == true) return
        enqueue(direction, payload)
    }

    private fun enqueue(direction: Direction, payload: String) {
        val queue = queue(direction)
        val pending = PendingMessage(payload)
        queue.addLast(pending)
        updateQueuedChars(direction, pending.chars)

        if (queue.size <= maxQueuedMessages && queuedChars(direction) <= maxQueuedChars) {
            return
        }

        clearQueue(direction)
        onQueueOverflow(direction)
    }

    private fun flush(direction: Direction, endpoint: Endpoint) {
        val queue = queue(direction)
        while (queue.isNotEmpty()) {
            val pending = queue.removeFirst()
            updateQueuedChars(direction, -pending.chars)
            if (!endpoint.send(pending.payload)) {
                queue.addFirst(pending)
                updateQueuedChars(direction, pending.chars)
                return
            }
        }
    }

    private fun queue(direction: Direction): ArrayDeque<PendingMessage> =
        when (direction) {
            Direction.TARGET_TO_CLIENT -> targetToClient
            Direction.CLIENT_TO_TARGET -> clientToTarget
        }

    private fun queuedChars(direction: Direction): Int =
        when (direction) {
            Direction.TARGET_TO_CLIENT -> targetToClientChars
            Direction.CLIENT_TO_TARGET -> clientToTargetChars
        }

    private fun updateQueuedChars(direction: Direction, delta: Int) {
        when (direction) {
            Direction.TARGET_TO_CLIENT -> targetToClientChars += delta
            Direction.CLIENT_TO_TARGET -> clientToTargetChars += delta
        }
    }

    private fun clearQueue(direction: Direction) {
        queue(direction).clear()
        when (direction) {
            Direction.TARGET_TO_CLIENT -> targetToClientChars = 0
            Direction.CLIENT_TO_TARGET -> clientToTargetChars = 0
        }
    }

    companion object {
        private const val DEFAULT_MAX_QUEUED_MESSAGES = 512
        private const val DEFAULT_MAX_QUEUED_CHARS = 4 * 1024 * 1024
    }
}
