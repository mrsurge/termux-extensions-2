package com.termux.extensions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DevToolsProtocolBrokerTest {
    @Test
    fun routesMessagesInBothDirections() {
        val targetMessages = mutableListOf<String>()
        val clientMessages = mutableListOf<String>()
        val broker = DevToolsProtocolBroker()

        broker.attachTarget { targetMessages.add(it) }
        broker.attachClient { clientMessages.add(it) }
        broker.routeFromClient("""{"id":1,"method":"Runtime.enable"}""")
        broker.routeFromTarget("""{"id":1,"result":{}}""")

        assertEquals(1, targetMessages.size)
        assertEquals(1, clientMessages.size)
        assertTrue(broker.hasTarget())
        assertTrue(broker.hasClient())
    }

    @Test
    fun queuesTargetEventsUntilClientAttaches() {
        val clientMessages = mutableListOf<String>()
        val broker = DevToolsProtocolBroker()

        broker.attachTarget { true }
        broker.routeFromTarget("""{"method":"Runtime.consoleAPICalled"}""")
        broker.attachClient { clientMessages.add(it) }

        assertEquals(
            listOf("""{"method":"Runtime.consoleAPICalled"}"""),
            clientMessages,
        )
    }

    @Test
    fun newTargetGenerationDropsCommandsForTheOldDocument() {
        val targetMessages = mutableListOf<String>()
        val broker = DevToolsProtocolBroker()

        broker.attachClient { true }
        broker.routeFromClient("""{"id":1,"method":"DOM.getDocument"}""")
        val firstGeneration = broker.attachTarget { targetMessages.add(it) }
        val secondGeneration = broker.attachTarget { targetMessages.add(it) }

        assertTrue(secondGeneration > firstGeneration)
        assertTrue(targetMessages.isEmpty())
    }

    @Test
    fun queueOverflowIsExplicitAndBounded() {
        val overflows = mutableListOf<DevToolsProtocolBroker.Direction>()
        val broker = DevToolsProtocolBroker(
            maxQueuedMessages = 1,
            maxQueuedChars = 64,
            onQueueOverflow = overflows::add,
        )

        broker.routeFromTarget("first")
        broker.routeFromTarget("second")
        broker.attachClient { false }

        assertEquals(
            listOf(DevToolsProtocolBroker.Direction.TARGET_TO_CLIENT),
            overflows,
        )
        assertFalse(broker.hasTarget())
        assertTrue(broker.hasClient())
    }
}
