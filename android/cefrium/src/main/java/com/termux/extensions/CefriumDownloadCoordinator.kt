package com.termux.extensions

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.activity.result.ActivityResultLauncher
import com.cefrium.CefriumBrowser
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal class CefriumDownloadCoordinator(
    context: Context,
    private val destinationLauncher: ActivityResultLauncher<String>,
    private val browserProvider: () -> CefriumBrowser?,
    private val onMessage: (String) -> Unit,
    private val copyExecutor: ExecutorService = Executors.newSingleThreadExecutor(),
) : CefriumBrowser.CefriumDownloadHandler {
    private data class PendingDownload(
        val id: Int,
        val suggestedName: String,
        val callback: CefriumBrowser.BeforeDownloadCallback,
    )

    private data class AcceptedDownload(
        val destination: Uri,
        val stagingFile: File,
    )

    private val applicationContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())
    private val pickerQueue = CefriumDownloadPickerQueue<PendingDownload>()
    private val accepted = mutableMapOf<Int, AcceptedDownload>()
    private val destroyed = AtomicBoolean(false)
    private val stagingDirectory = File(applicationContext.cacheDir, STAGING_DIRECTORY)

    init {
        cleanCefriumDownloadStagingDirectory(stagingDirectory)
    }

    override fun onBeforeDownload(
        item: CefriumBrowser.DownloadItem,
        callback: CefriumBrowser.BeforeDownloadCallback,
    ) {
        if (destroyed.get()) {
            callback.cancel()
            return
        }
        val activated = pickerQueue.enqueue(
            PendingDownload(
                id = item.id,
                suggestedName = sanitizeCefriumDownloadName(item.suggestedName),
                callback = callback,
            ),
        )
        if (activated != null) launchPicker(activated)
    }

    fun onDestinationSelected(destination: Uri?) {
        val pending = pickerQueue.active ?: return
        if (destroyed.get() || destination == null) {
            pending.callback.cancel()
        } else {
            var stagingFile: File? = null
            try {
                if (!stagingDirectory.isDirectory && !stagingDirectory.mkdirs()) {
                    throw IllegalStateException("Could not create the download staging directory")
                }
                stagingFile = File.createTempFile(
                    "download-${pending.id}-",
                    ".part",
                    stagingDirectory,
                )
                accepted[pending.id] = AcceptedDownload(destination, stagingFile)
                pending.callback.allow(stagingFile.absolutePath)
            } catch (error: Exception) {
                accepted.remove(pending.id)
                stagingFile?.delete()
                pending.callback.cancel()
                deleteDestination(destination)
                publishMessage(
                    "Download could not start: ${error.message ?: error.javaClass.simpleName}",
                )
            }
        }
        pickerQueue.finishActive()?.let(::launchPicker)
    }

    override fun onDownloadUpdated(item: CefriumBrowser.DownloadItem) {
        val activeDownload = accepted[item.id] ?: return
        when (
            cefriumDownloadTerminalAction(
                complete = item.isComplete,
                canceled = item.isCanceled,
                interruptReason = item.interruptReason,
            )
        ) {
            CefriumDownloadTerminalAction.COPY_TO_DESTINATION -> {
                accepted.remove(item.id)
                copyExecutor.execute { publishCompletedDownload(activeDownload) }
            }
            CefriumDownloadTerminalAction.CLEAN_UP -> {
                accepted.remove(item.id)
                activeDownload.stagingFile.delete()
                deleteDestination(activeDownload.destination)
                publishMessage("Download canceled or interrupted")
            }
            CefriumDownloadTerminalAction.NONE -> Unit
        }
    }

    fun close() {
        if (!destroyed.compareAndSet(false, true)) return
        pickerQueue.drain().forEach { it.callback.cancel() }
        val browser = browserProvider()
        val activeDownloads = accepted.toMap()
        accepted.clear()
        activeDownloads.forEach { (id, download) ->
            browser?.cancelDownload(id)
            download.stagingFile.delete()
            deleteDestination(download.destination)
        }
        copyExecutor.shutdownNow()
    }

    private fun launchPicker(pending: PendingDownload) {
        if (destroyed.get()) {
            pending.callback.cancel()
            pickerQueue.finishActive()?.let(::launchPicker)
            return
        }
        try {
            destinationLauncher.launch(pending.suggestedName)
        } catch (error: Exception) {
            pending.callback.cancel()
            publishMessage(
                "Download destination could not open: " +
                    (error.message ?: error.javaClass.simpleName),
            )
            pickerQueue.finishActive()?.let(::launchPicker)
        }
    }

    private fun publishCompletedDownload(download: AcceptedDownload) {
        try {
            val output = applicationContext.contentResolver
                .openOutputStream(download.destination, "w")
                ?: throw IllegalStateException("The selected document is not writable")
            output.use { destination ->
                FileInputStream(download.stagingFile).use { source ->
                    source.copyTo(destination)
                }
            }
            publishMessage("Download saved")
        } catch (error: Exception) {
            deleteDestination(download.destination)
            publishMessage(
                "Download could not be saved: ${error.message ?: error.javaClass.simpleName}",
            )
        } finally {
            download.stagingFile.delete()
        }
    }

    private fun deleteDestination(destination: Uri) {
        runCatching { applicationContext.contentResolver.delete(destination, null, null) }
    }

    private fun publishMessage(message: String) {
        mainHandler.post {
            if (!destroyed.get()) onMessage(message)
        }
    }

    companion object {
        private const val STAGING_DIRECTORY = "cefrium-downloads"
    }
}
