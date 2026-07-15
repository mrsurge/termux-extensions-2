package com.termux.extensions.nativeeditor.structure

import android.os.Bundle
import io.github.rosemoe.sora.lang.Language
import io.github.rosemoe.sora.lang.analysis.AnalyzeManager
import io.github.rosemoe.sora.lang.analysis.StyleReceiver
import io.github.rosemoe.sora.lang.analysis.StyleUpdateRange
import io.github.rosemoe.sora.lang.brackets.BracketsProvider
import io.github.rosemoe.sora.lang.diagnostic.DiagnosticsContainer
import io.github.rosemoe.sora.lang.styling.CodeBlock
import io.github.rosemoe.sora.lang.styling.Styles
import io.github.rosemoe.sora.text.CharPosition
import io.github.rosemoe.sora.text.ContentReference

internal class NativeStructureLanguage(
    private val base: Language,
) : Language by base {
    private val structureAnalyzer = NativeStructureAnalyzeManager(base.analyzeManager)

    override fun getAnalyzeManager(): AnalyzeManager = structureAnalyzer

    fun updateStructureBlocks(blocks: List<NativeEditorStructureBlock>) {
        structureAnalyzer.updateStructureBlocks(blocks)
    }

    override fun destroy() {
        base.destroy()
    }
}

private class NativeStructureAnalyzeManager(
    private val delegate: AnalyzeManager,
) : AnalyzeManager {
    @Volatile
    private var structureBlocks: List<NativeEditorStructureBlock> = emptyList()
    @Volatile
    private var receiver: StyleReceiver? = null
    @Volatile
    private var sourceStyles: Styles? = null

    override fun setReceiver(receiver: StyleReceiver?) {
        this.receiver = receiver
        delegate.setReceiver(
            if (receiver == null) {
                null
            } else {
                object : StyleReceiver {
                    override fun setStyles(manager: AnalyzeManager, styles: Styles?) {
                        sourceStyles = styles
                        receiver.setStyles(
                            this@NativeStructureAnalyzeManager,
                            styles?.let(::mergeStyles),
                        )
                    }

                    override fun setStyles(manager: AnalyzeManager, styles: Styles?, action: Runnable?) {
                        sourceStyles = styles
                        receiver.setStyles(
                            this@NativeStructureAnalyzeManager,
                            styles?.let(::mergeStyles),
                            action,
                        )
                    }

                    override fun updateStyles(
                        manager: AnalyzeManager,
                        styles: Styles,
                        range: StyleUpdateRange,
                    ) {
                        sourceStyles = styles
                        receiver.updateStyles(this@NativeStructureAnalyzeManager, mergeStyles(styles), range)
                    }

                    override fun setDiagnostics(
                        manager: AnalyzeManager,
                        diagnostics: DiagnosticsContainer?,
                    ) {
                        receiver.setDiagnostics(this@NativeStructureAnalyzeManager, diagnostics)
                    }

                    override fun updateBracketProvider(
                        manager: AnalyzeManager,
                        provider: BracketsProvider?,
                    ) {
                        receiver.updateBracketProvider(this@NativeStructureAnalyzeManager, provider)
                    }
                }
            },
        )
    }

    override fun reset(content: ContentReference, extraArguments: Bundle) {
        delegate.reset(content, extraArguments)
    }

    override fun insert(start: CharPosition, end: CharPosition, insertedContent: CharSequence) {
        delegate.insert(start, end, insertedContent)
    }

    override fun delete(start: CharPosition, end: CharPosition, deletedContent: CharSequence) {
        delegate.delete(start, end, deletedContent)
    }

    override fun rerun() {
        delegate.rerun()
    }

    override fun destroy() {
        receiver = null
        sourceStyles = null
        delegate.destroy()
    }

    fun updateStructureBlocks(blocks: List<NativeEditorStructureBlock>) {
        if (structureBlocks == blocks) return
        structureBlocks = blocks
        val styles = sourceStyles ?: return
        receiver?.setStyles(this, mergeStyles(styles))
    }

    private fun mergeStyles(source: Styles): Styles {
        val merged = Styles(source.spans, true)
        merged.lineStyles = source.lineStyles
        merged.styleTypeCount = source.styleTypeCount
        merged.suppressSwitch = source.suppressSwitch
        merged.isIndentCountMode = source.isIndentCountMode
        val blocks = buildList {
            source.blocks.orEmpty().forEach { add(it.copyBlock()) }
            structureBlocks.forEach { block ->
                add(
                    CodeBlock().apply {
                        startLine = block.startLine
                        startColumn = block.startColumn
                        endLine = block.endLine
                        endColumn = block.endColumn
                        toBottomOfEndLine = true
                    },
                )
            }
        }.distinctBy { listOf(it.startLine, it.startColumn, it.endLine, it.endColumn) }
        blocks.forEach(merged::addCodeBlock)
        merged.finishBuilding()
        return merged
    }
}

private fun CodeBlock.copyBlock(): CodeBlock = CodeBlock().also { copy ->
    copy.startLine = startLine
    copy.startColumn = startColumn
    copy.endLine = endLine
    copy.endColumn = endColumn
    copy.toBottomOfEndLine = toBottomOfEndLine
}
