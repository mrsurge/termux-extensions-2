package com.termux.extensions

import android.net.LocalSocket
import android.net.LocalSocketAddress
import java.io.Closeable
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** Relays loopback TCP connections to Chromium's app-private abstract DevTools socket. */
internal class CefriumDevToolsSocketBridge(
    private val abstractSocketName: String,
) : Closeable {
    private val running = AtomicBoolean(false)
    private val threadNumber = AtomicInteger(0)
    private val executor: ExecutorService = Executors.newCachedThreadPool(
        ThreadFactory { task ->
            Thread(task, "cefrium-devtools-${threadNumber.incrementAndGet()}").apply {
                isDaemon = true
            }
        },
    )
    private var serverSocket: ServerSocket? = null

    val port: Int
        get() = checkNotNull(serverSocket) { "Cefrium DevTools bridge is not started" }.localPort

    fun start() {
        if (!running.compareAndSet(false, true)) return
        val server = ServerSocket()
        server.reuseAddress = true
        server.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 8)
        serverSocket = server
        executor.execute { acceptConnections(server) }
    }

    private fun acceptConnections(server: ServerSocket) {
        while (running.get()) {
            val socket = try {
                server.accept()
            } catch (_: Exception) {
                if (!running.get()) return
                continue
            }
            executor.execute { relay(socket) }
        }
    }

    private fun relay(tcpSocket: Socket) {
        val localSocket = LocalSocket()
        val closed = AtomicBoolean(false)

        fun closeBoth() {
            if (!closed.compareAndSet(false, true)) return
            runCatching { tcpSocket.close() }
            runCatching { localSocket.close() }
        }

        try {
            tcpSocket.tcpNoDelay = true
            localSocket.connect(
                LocalSocketAddress(
                    abstractSocketName,
                    LocalSocketAddress.Namespace.ABSTRACT,
                ),
            )
            executor.execute {
                try {
                    tcpSocket.getInputStream().copyTo(localSocket.outputStream)
                    localSocket.outputStream.flush()
                } catch (_: Exception) {
                } finally {
                    closeBoth()
                }
            }
            try {
                localSocket.inputStream.copyTo(tcpSocket.getOutputStream())
                tcpSocket.getOutputStream().flush()
            } catch (_: Exception) {
            } finally {
                closeBoth()
            }
        } catch (_: Exception) {
            closeBoth()
        }
    }

    override fun close() {
        if (!running.compareAndSet(true, false)) return
        runCatching { serverSocket?.close() }
        serverSocket = null
        executor.shutdownNow()
    }
}
