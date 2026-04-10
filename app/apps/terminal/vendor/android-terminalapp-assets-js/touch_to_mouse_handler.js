/*
 * Copyright (C) 2024 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

(function() {
// TODO(b/375326606): consider contribution on
// upstream(https://github.com/xtermjs/xterm.js/issues/3727)
const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 8;
const WHEEL_DRAG_SCALE = 0.4;
let state = null;

function helpersEnabled() {
  return window.__fileEditorCm6TerminalHelpersActive !== false;
}

function getPoint(event) {
  if (event.changedTouches && event.changedTouches.length) {
    return event.changedTouches[0];
  }
  if (event.touches && event.touches.length) {
    return event.touches[0];
  }
  return event;
}

function getElementTarget(rawTarget) {
  if (rawTarget instanceof Element) return rawTarget;
  if (rawTarget && rawTarget.parentElement instanceof Element) {
    return rawTarget.parentElement;
  }
  return null;
}

function getTerminalRoot(rawTarget) {
  const element = getElementTarget(rawTarget);
  return element ? element.closest('.xterm') : null;
}

function getMouseTarget(rawTarget) {
  const root = getTerminalRoot(rawTarget);
  return root?.querySelector('.xterm-screen') || root || getElementTarget(rawTarget);
}

function getWheelTarget(rawTarget) {
  const root = getTerminalRoot(rawTarget);
  return root?.querySelector('.xterm-viewport') || root || getElementTarget(rawTarget);
}

function clearLongPress() {
  if (!state?.longPressTimer) return;
  clearTimeout(state.longPressTimer);
  state.longPressTimer = null;
}

function resetState() {
  clearLongPress();
  state = null;
}

function buildPointerLike(point, fallbackTarget) {
  return {
    screenX: point?.screenX ?? 0,
    screenY: point?.screenY ?? 0,
    clientX: point?.clientX ?? 0,
    clientY: point?.clientY ?? 0,
    target: fallbackTarget,
  };
}

function dispatchMouse(type, point, target) {
  if (!target) return;
  const pointer = buildPointerLike(point, target);
  const simulatedEvent = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    detail: 1,
    screenX: pointer.screenX,
    screenY: pointer.screenY,
    clientX: pointer.clientX,
    clientY: pointer.clientY,
    button: 0,
  });
  target.dispatchEvent(simulatedEvent);
}

function dispatchWheel(deltaY, point, target) {
  if (!target || !deltaY) return;
  const pointer = buildPointerLike(point, target);
  const simulatedEvent = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    view: window,
    deltaMode: 0,
    deltaX: 0,
    deltaY,
    screenX: pointer.screenX,
    screenY: pointer.screenY,
    clientX: pointer.clientX,
    clientY: pointer.clientY,
  });
  target.dispatchEvent(simulatedEvent);
}

function startSelection(point) {
  if (!state || state.mode === 'select') return;
  clearLongPress();
  state.mode = 'select';
  dispatchMouse('mousedown', point, state.mouseTarget);
}

function handleTouchStart(event) {
  if (!helpersEnabled()) return;
  if (!event.touches || event.touches.length !== 1) {
    resetState();
    return;
  }
  const point = event.touches[0];
  const mouseTarget = getMouseTarget(point.target);
  const wheelTarget = getWheelTarget(point.target);
  if (!mouseTarget && !wheelTarget) {
    resetState();
    return;
  }

  state = {
    mode: 'pending',
    startX: point.clientX,
    startY: point.clientY,
    lastY: point.clientY,
    point,
    mouseTarget,
    wheelTarget,
    longPressTimer: setTimeout(() => startSelection(point), LONG_PRESS_MS),
  };
}

function handleTouchMove(event) {
  if (!helpersEnabled() || !state) return;
  if (!event.touches || event.touches.length !== 1) {
    resetState();
    return;
  }

  const point = event.touches[0];
  state.point = point;

  const dx = point.clientX - state.startX;
  const dy = point.clientY - state.startY;
  const moved = Math.hypot(dx, dy) > MOVE_CANCEL_PX;

  if (state.mode === 'pending') {
    if (!moved) {
      state.lastY = point.clientY;
      return;
    }
    clearLongPress();
    state.mode = 'scroll';
  }

  if (state.mode === 'select') {
    dispatchMouse('mousemove', point, state.mouseTarget);
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (state.mode === 'scroll') {
    const deltaY = (state.lastY - point.clientY) * WHEEL_DRAG_SCALE;
    state.lastY = point.clientY;
    dispatchWheel(deltaY, point, state.wheelTarget);
    event.preventDefault();
    event.stopPropagation();
  }
}

function handleTouchEnd(event) {
  if (!state) return;
  const point = getPoint(event);

  if (state.mode === 'select') {
    dispatchMouse('mouseup', point, state.mouseTarget);
    event.preventDefault();
    event.stopPropagation();
  } else if (state.mode === 'scroll') {
    event.preventDefault();
    event.stopPropagation();
  }

  resetState();
}

function handleContextMenu(event) {
  if (!helpersEnabled()) return;
  const isTouchContextMenu = event.pointerType === 'touch' || !!state;
  if (!isTouchContextMenu) return;
  if (!state) {
    const mouseTarget = getMouseTarget(event.target);
    const wheelTarget = getWheelTarget(event.target);
    if (!mouseTarget && !wheelTarget) return;
    state = {
      mode: 'pending',
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      point: event,
      mouseTarget,
      wheelTarget,
      longPressTimer: null,
    };
  }
  startSelection(event);
  event.preventDefault();
  event.stopPropagation();
}

const eventOptions = {
  capture: true,
  passive: false,
};
document.addEventListener('touchstart', handleTouchStart, eventOptions);
document.addEventListener('touchmove', handleTouchMove, eventOptions);
document.addEventListener('touchend', handleTouchEnd, eventOptions);
document.addEventListener('touchcancel', handleTouchEnd, eventOptions);
document.addEventListener('contextmenu', handleContextMenu, eventOptions);
})();
