/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { BrowserFeatures } from '../../../base/browser/canIUse.js';
import * as dom from '../../../base/browser/dom.js';
import { EventType, Gesture } from '../../../base/browser/touch.js';
import { mainWindow } from '../../../base/browser/window.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import * as platform from '../../../base/common/platform.js';
import { MouseHandler } from './mouseHandler.js';
import { EditorMouseEvent, EditorPointerEventFactory } from '../editorDom.js';
import { TextAreaSyntethicEvents } from './editContext/textArea/textAreaEditContextInput.js';
function dispatchTextAreaTap(viewHelper) {
    const event = document.createEvent('CustomEvent');
    event.initEvent(TextAreaSyntethicEvents.Tap, false, true);
    viewHelper.dispatchTextAreaEvent(event);
}
// A touch hold selects through the same word-selection command as double click.
// It never focuses the textarea; ordinary taps keep the existing IME activation.
class EditorTouchMouseHandler extends MouseHandler {
    constructor(context, viewController, viewHelper) {
        super(context, viewController, viewHelper);
        this.lastTouchAt = -Infinity;
        this.touchActive = false;
        const recordTouch = (e) => {
            this.lastTouchAt = Date.now();
            this.touchActive = e.touches.length > 0;
        };
        for (const type of ['touchstart', 'touchend', 'touchcancel']) {
            this._register(dom.addDisposableListener(viewHelper.viewDomNode, type, recordTouch, { capture: true, passive: true }));
        }
        this._register(dom.addDisposableListener(dom.getWindow(viewHelper.viewDomNode), 'blur', () => { this.touchActive = false; }));
        this._register(dom.addDisposableListener(viewHelper.linesContentDomNode, EventType.Hold, (e) => {
            this.lastTouchAt = Date.now();
            this._dispatchGesture(e, false);
            // Expose the completed selection through the public context-menu event.
            // The touch-menu contribution can present it without relocating the caret.
            super._onContextMenu(new EditorMouseEvent(e, false, viewHelper.viewDomNode), false);
        }));
    }
    isTouchMouseEvent(e) {
        const event = e.browserEvent;
        return event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents === true
            || (!event.pointerType && (this.touchActive || Date.now() - this.lastTouchAt < 1000));
    }
    _onMouseMove(e) {
        if (this.isTouchMouseEvent(e)) {
            return;
        }
        super._onMouseMove(e);
    }
    _onContextMenu(e, testEventTarget) {
        if (this.isTouchMouseEvent(e) && this.viewHelper.linesContentDomNode.contains(e.browserEvent.target)) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        super._onContextMenu(e, testEventTarget);
    }
    _dispatchGesture(event, inSelectionMode) {
        const target = this._createMouseTarget(new EditorMouseEvent(event, false, this.viewHelper.viewDomNode), false);
        if (target.position) {
            this.viewController.dispatchMouse({
                position: target.position,
                mouseColumn: target.position.column,
                startedOnLineNumbers: false,
                revealType: 1 /* NavigationCommandRevealType.Minimal */,
                mouseDownCount: event.tapCount,
                inSelectionMode,
                altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
                leftButton: false, middleButton: false,
                onInjectedText: target.type === 6 /* MouseTargetType.CONTENT_TEXT */ && target.detail.injectedText !== null
            });
        }
    }
}
/**
 * Currently only tested on iOS 13/ iPadOS.
 */
export class PointerEventHandler extends EditorTouchMouseHandler {
    constructor(context, viewController, viewHelper) {
        super(context, viewController, viewHelper);
        this._register(Gesture.addTarget(this.viewHelper.linesContentDomNode, true));
        this._register(dom.addDisposableListener(this.viewHelper.linesContentDomNode, EventType.Tap, (e) => this.onTap(e)));
        this._register(dom.addDisposableListener(this.viewHelper.linesContentDomNode, EventType.Change, (e) => this.onChange(e)));
        this._register(dom.addDisposableListener(this.viewHelper.linesContentDomNode, EventType.Contextmenu, (e) => this._onContextMenu(new EditorMouseEvent(e, false, this.viewHelper.viewDomNode), false)));
        this._lastPointerType = 'mouse';
        this._register(dom.addDisposableListener(this.viewHelper.linesContentDomNode, 'pointerdown', (e) => {
            const pointerType = e.pointerType;
            if (pointerType === 'mouse') {
                this._lastPointerType = 'mouse';
                return;
            }
            else if (pointerType === 'touch') {
                this._lastPointerType = 'touch';
            }
            else {
                this._lastPointerType = 'pen';
            }
        }));
        // PonterEvents
        const pointerEvents = new EditorPointerEventFactory(this.viewHelper.viewDomNode);
        this._register(pointerEvents.onPointerMove(this.viewHelper.viewDomNode, (e) => this._onMouseMove(e)));
        this._register(pointerEvents.onPointerUp(this.viewHelper.viewDomNode, (e) => this._onMouseUp(e)));
        this._register(pointerEvents.onPointerLeave(this.viewHelper.viewDomNode, (e) => this._onMouseLeave(e)));
        this._register(pointerEvents.onPointerDown(this.viewHelper.viewDomNode, (e, pointerId) => this._onMouseDown(e, pointerId)));
    }
    onTap(event) {
        if (!event.initialTarget || !this.viewHelper.linesContentDomNode.contains(event.initialTarget)) {
            return;
        }
        event.preventDefault();
        this.viewHelper.focusTextArea();
        dispatchTextAreaTap(this.viewHelper);
        this._dispatchGesture(event, /*inSelectionMode*/ false);
    }
    onChange(event) {
        if (this._lastPointerType === 'touch') {
            this._context.viewModel.viewLayout.deltaScrollNow(-event.translationX, -event.translationY);
        }
        if (this._lastPointerType === 'pen') {
            this._dispatchGesture(event, /*inSelectionMode*/ true);
        }
    }
    _onMouseDown(e, pointerId) {
        if (e.browserEvent.pointerType === 'touch') {
            return;
        }
        super._onMouseDown(e, pointerId);
    }
}
class TouchHandler extends EditorTouchMouseHandler {
    constructor(context, viewController, viewHelper) {
        super(context, viewController, viewHelper);
        this._register(Gesture.addTarget(this.viewHelper.linesContentDomNode, true));
        this._register(dom.addDisposableListener(this.viewHelper.linesContentDomNode, EventType.Tap, (e) => this.onTap(e)));
        this._register(dom.addDisposableListener(this.viewHelper.linesContentDomNode, EventType.Change, (e) => this.onChange(e)));
        this._register(dom.addDisposableListener(this.viewHelper.linesContentDomNode, EventType.Contextmenu, (e) => this._onContextMenu(new EditorMouseEvent(e, false, this.viewHelper.viewDomNode), false)));
    }
    onTap(event) {
        event.preventDefault();
        this.viewHelper.focusTextArea();
        const target = this._createMouseTarget(new EditorMouseEvent(event, false, this.viewHelper.viewDomNode), false);
        if (target.position) {
            // Send the tap event also to the <textarea> (for input purposes)
            dispatchTextAreaTap(this.viewHelper);
            this._dispatchGesture(event, false);
        }
    }
    onChange(e) {
        this._context.viewModel.viewLayout.deltaScrollNow(-e.translationX, -e.translationY);
    }
}
export class PointerHandler extends Disposable {
    constructor(context, viewController, viewHelper) {
        super();
        const isPhone = platform.isIOS || (platform.isAndroid && platform.isMobile);
        if (isPhone && BrowserFeatures.pointerEvents) {
            this.handler = this._register(new PointerEventHandler(context, viewController, viewHelper));
        }
        else if (mainWindow.TouchEvent) {
            this.handler = this._register(new TouchHandler(context, viewController, viewHelper));
        }
        else {
            this.handler = this._register(new MouseHandler(context, viewController, viewHelper));
        }
    }
    getTargetAtClientPoint(clientX, clientY) {
        return this.handler.getTargetAtClientPoint(clientX, clientY);
    }
}
