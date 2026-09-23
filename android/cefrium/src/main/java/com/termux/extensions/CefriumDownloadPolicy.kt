package com.termux.extensions

import java.io.File

internal enum class CefriumDownloadTerminalAction {
    NONE,
    COPY_TO_DESTINATION,
    CLEAN_UP,
}

internal class CefriumDownloadPickerQueue<T> {
    private val waiting = ArrayDeque<T>()

    var active: T? = null
        private set

    fun enqueue(request: T): T? {
        waiting.addLast(request)
        return activateNext()
    }

    fun finishActive(): T? {
        active = null
        return activateNext()
    }

    fun drain(): List<T> {
        val drained = buildList {
            active?.let(::add)
            addAll(waiting)
        }
        active = null
        waiting.clear()
        return drained
    }

    private fun activateNext(): T? {
        if (active != null || waiting.isEmpty()) return null
        return waiting.removeFirst().also { active = it }
    }
}

internal fun sanitizeCefriumDownloadName(rawName: String?): String {
    val leaf = rawName
        .orEmpty()
        .substringAfterLast('/')
        .substringAfterLast('\\')
    val sanitized = buildString(leaf.length) {
        leaf.forEach { character ->
            append(
                if (
                    character.code < 32 ||
                    character in INVALID_FILENAME_CHARACTERS
                ) '_'
                else character,
            )
        }
    }.trim().trim('.')
    return sanitized.take(120).ifBlank { "download" }
}

internal fun cefriumDownloadTerminalAction(
    complete: Boolean,
    canceled: Boolean,
    interruptReason: Int,
): CefriumDownloadTerminalAction = when {
    complete -> CefriumDownloadTerminalAction.COPY_TO_DESTINATION
    canceled || interruptReason != 0 -> CefriumDownloadTerminalAction.CLEAN_UP
    else -> CefriumDownloadTerminalAction.NONE
}

internal fun cleanCefriumDownloadStagingDirectory(directory: File) {
    directory.listFiles()?.forEach { child ->
        if (child.isDirectory) child.deleteRecursively() else child.delete()
    }
}

private const val INVALID_FILENAME_CHARACTERS = "/\\:*?\"<>|"
