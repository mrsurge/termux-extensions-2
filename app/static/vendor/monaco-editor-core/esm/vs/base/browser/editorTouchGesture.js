/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/** Editor-only gesture ownership. Small IME/browser jitter is not a scroll, and
 * returning to the starting point cannot turn an established scroll into a tap. */
export class EditorTouchGesture {
    constructor() {
        this.phase = 'cancel';
        this.x = 0;
        this.y = 0;
    }
    static { this.holdDelay = 700; }
    start(x, y) {
        this.x = x;
        this.y = y;
        this.phase = 'pending';
    }
    move(x, y) {
        if (this.phase === 'pending' && Math.hypot(x - this.x, y - this.y) > 10) {
            this.phase = 'scroll';
            this.lastTap = undefined;
        }
        return this.phase === 'scroll';
    }
    hold() {
        if (this.phase !== 'pending') {
            return false;
        }
        this.phase = 'hold';
        this.lastTap = undefined;
        return true;
    }
    end(time) {
        const phase = this.phase;
        this.phase = 'cancel';
        if (phase !== 'pending') {
            return { kind: phase };
        }
        const previous = this.lastTap;
        const doubleTap = previous && time - previous.time <= 400
            && Math.hypot(previous.x - this.x, previous.y - this.y) <= 24;
        this.lastTap = doubleTap ? undefined : { x: this.x, y: this.y, time };
        return { kind: 'tap', count: doubleTap ? 2 : 1 };
    }
    cancel() {
        this.phase = 'cancel';
        this.lastTap = undefined;
    }
}
