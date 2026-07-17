/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { commonPrefixLength, commonSuffixLength } from '../../../../../base/common/strings.js';
export const _debugComposition = false;
const ANDROID_IME_LINE_PREFIX = '\u21dd';
const ANDROID_IME_LINE_SUFFIX = '\n\n';
export class TextAreaState {
    static { this.EMPTY = new TextAreaState('', 0, 0, null, undefined); }
    constructor(value, 
    /** the offset where selection starts inside `value` */
    selectionStart, 
    /** the offset where selection ends inside `value` */
    selectionEnd, 
    /** the editor range in the view coordinate system that matches the selection inside `value` */
    selection, 
    /** the visible line count (wrapped, not necessarily matching \n characters) for the text in `value` before `selectionStart` */
    newlineCountBeforeSelection, 
    /** the model line represented by `value` while Android owns the textarea */
    androidModelLineNumber = undefined) {
        this.value = value;
        this.selectionStart = selectionStart;
        this.selectionEnd = selectionEnd;
        this.selection = selection;
        this.newlineCountBeforeSelection = newlineCountBeforeSelection;
        this.androidModelLineNumber = androidModelLineNumber;
    }
    toString() {
        return `[ <${this.value}>, selectionStart: ${this.selectionStart}, selectionEnd: ${this.selectionEnd}]`;
    }
    static createAndroidImeLine(lineContent, selectionStartOffset, selectionEndOffset, selection, modelLineNumber) {
        const lineLength = lineContent.length;
        const startOffset = Math.min(Math.max(selectionStartOffset, 0), lineLength);
        const endOffset = Math.min(Math.max(selectionEndOffset, startOffset), lineLength);
        return new TextAreaState(`${ANDROID_IME_LINE_PREFIX}${lineContent}${ANDROID_IME_LINE_SUFFIX}`, ANDROID_IME_LINE_PREFIX.length + startOffset, ANDROID_IME_LINE_PREFIX.length + endOffset, selection, 0, modelLineNumber);
    }
    static readFromTextArea(textArea, previousState) {
        const value = textArea.getValue();
        const selectionStart = textArea.getSelectionStart();
        const selectionEnd = textArea.getSelectionEnd();
        let newlineCountBeforeSelection = undefined;
        if (previousState) {
            const valueBeforeSelectionStart = value.substring(0, selectionStart);
            const previousValueBeforeSelectionStart = previousState.value.substring(0, previousState.selectionStart);
            if (valueBeforeSelectionStart === previousValueBeforeSelectionStart) {
                newlineCountBeforeSelection = previousState.newlineCountBeforeSelection;
            }
        }
        return new TextAreaState(value, selectionStart, selectionEnd, null, newlineCountBeforeSelection, previousState?.androidModelLineNumber);
    }
    collapseSelection() {
        if (this.selectionStart === this.value.length) {
            return this;
        }
        return new TextAreaState(this.value, this.value.length, this.value.length, null, undefined, this.androidModelLineNumber);
    }
    isWrittenToTextArea(textArea, select) {
        const valuesEqual = this.value === textArea.getValue();
        if (!select) {
            return valuesEqual;
        }
        const selectionsEqual = this.selectionStart === textArea.getSelectionStart() && this.selectionEnd === textArea.getSelectionEnd();
        return selectionsEqual && valuesEqual;
    }
    writeToTextArea(reason, textArea, select) {
        if (_debugComposition) {
            console.log(`writeToTextArea ${reason}: ${this.toString()}`);
        }
        textArea.setValue(reason, this.value);
        if (select) {
            textArea.setSelectionRange(reason, this.selectionStart, this.selectionEnd);
        }
    }
    deduceEditorPosition(offset) {
        if (offset <= this.selectionStart) {
            const str = this.value.substring(offset, this.selectionStart);
            return this._finishDeduceEditorPosition(this.selection?.getStartPosition() ?? null, str, -1);
        }
        if (offset >= this.selectionEnd) {
            const str = this.value.substring(this.selectionEnd, offset);
            return this._finishDeduceEditorPosition(this.selection?.getEndPosition() ?? null, str, 1);
        }
        const str1 = this.value.substring(this.selectionStart, offset);
        if (str1.indexOf(String.fromCharCode(8230)) === -1) {
            return this._finishDeduceEditorPosition(this.selection?.getStartPosition() ?? null, str1, 1);
        }
        const str2 = this.value.substring(offset, this.selectionEnd);
        return this._finishDeduceEditorPosition(this.selection?.getEndPosition() ?? null, str2, -1);
    }
    _finishDeduceEditorPosition(anchor, deltaText, signum) {
        let lineFeedCnt = 0;
        let lastLineFeedIndex = -1;
        while ((lastLineFeedIndex = deltaText.indexOf('\n', lastLineFeedIndex + 1)) !== -1) {
            lineFeedCnt++;
        }
        return [anchor, signum * deltaText.length, lineFeedCnt];
    }
    static deduceInput(previousState, currentState, couldBeEmojiInput) {
        if (!previousState) {
            // This is the EMPTY state
            return {
                text: '',
                replacePrevCharCnt: 0,
                replaceNextCharCnt: 0,
                positionDelta: 0
            };
        }
        if (_debugComposition) {
            console.log('------------------------deduceInput');
            console.log(`PREVIOUS STATE: ${previousState.toString()}`);
            console.log(`CURRENT STATE: ${currentState.toString()}`);
        }
        const prefixLength = Math.min(commonPrefixLength(previousState.value, currentState.value), previousState.selectionStart, currentState.selectionStart);
        const suffixLength = Math.min(commonSuffixLength(previousState.value, currentState.value), previousState.value.length - previousState.selectionEnd, currentState.value.length - currentState.selectionEnd);
        const previousValue = previousState.value.substring(prefixLength, previousState.value.length - suffixLength);
        const currentValue = currentState.value.substring(prefixLength, currentState.value.length - suffixLength);
        const previousSelectionStart = previousState.selectionStart - prefixLength;
        const previousSelectionEnd = previousState.selectionEnd - prefixLength;
        const currentSelectionStart = currentState.selectionStart - prefixLength;
        const currentSelectionEnd = currentState.selectionEnd - prefixLength;
        if (_debugComposition) {
            console.log(`AFTER DIFFING PREVIOUS STATE: <${previousValue}>, selectionStart: ${previousSelectionStart}, selectionEnd: ${previousSelectionEnd}`);
            console.log(`AFTER DIFFING CURRENT STATE: <${currentValue}>, selectionStart: ${currentSelectionStart}, selectionEnd: ${currentSelectionEnd}`);
        }
        if (currentSelectionStart === currentSelectionEnd) {
            // no current selection
            const replacePreviousCharacters = (previousState.selectionStart - prefixLength);
            if (_debugComposition) {
                console.log(`REMOVE PREVIOUS: ${replacePreviousCharacters} chars`);
            }
            return {
                text: currentValue,
                replacePrevCharCnt: replacePreviousCharacters,
                replaceNextCharCnt: 0,
                positionDelta: 0
            };
        }
        // there is a current selection => composition case
        const replacePreviousCharacters = previousSelectionEnd - previousSelectionStart;
        return {
            text: currentValue,
            replacePrevCharCnt: replacePreviousCharacters,
            replaceNextCharCnt: 0,
            positionDelta: 0
        };
    }
    static deduceAndroidImeLineEdit(previousState, currentState) {
        const modelLineNumber = previousState.androidModelLineNumber;
        if (modelLineNumber === undefined
            || currentState.androidModelLineNumber !== modelLineNumber) {
            return null;
        }
        const previousProjection = TextAreaState._readAndroidImeLineProjection(previousState);
        const currentProjection = TextAreaState._readAndroidImeLineProjection(currentState);
        if (!previousProjection || !currentProjection || previousProjection.value === currentProjection.value) {
            return null;
        }
        const prefixLength = commonPrefixLength(previousProjection.value, currentProjection.value);
        const suffixLength = Math.min(commonSuffixLength(previousProjection.value, currentProjection.value), previousProjection.value.length - prefixLength, currentProjection.value.length - prefixLength);
        return {
            modelLineNumber,
            rangeStartOffset: prefixLength,
            rangeEndOffset: previousProjection.value.length - suffixLength,
            text: currentProjection.value.substring(prefixLength, currentProjection.value.length - suffixLength),
            selectionStartOffset: currentProjection.selectionStartOffset,
            selectionEndOffset: currentProjection.selectionEndOffset,
        };
    }
    static _readAndroidImeLineProjection(state) {
        if (!state.value.startsWith(ANDROID_IME_LINE_PREFIX) || !state.value.endsWith(ANDROID_IME_LINE_SUFFIX)) {
            return null;
        }
        const lineStart = ANDROID_IME_LINE_PREFIX.length;
        const lineEnd = state.value.length - ANDROID_IME_LINE_SUFFIX.length;
        const value = state.value.substring(lineStart, lineEnd);
        const clampSelectionOffset = (offset) => Math.min(Math.max(offset - lineStart, 0), value.length);
        const selectionStartOffset = clampSelectionOffset(state.selectionStart);
        const selectionEndOffset = Math.max(selectionStartOffset, clampSelectionOffset(state.selectionEnd));
        return { value, selectionStartOffset, selectionEndOffset };
    }
    static fromScreenReaderContentState(screenReaderContentState) {
        return new TextAreaState(screenReaderContentState.value, screenReaderContentState.selectionStart, screenReaderContentState.selectionEnd, screenReaderContentState.selection, screenReaderContentState.newlineCountBeforeSelection);
    }
}
//# sourceMappingURL=textAreaEditContextState.js.map