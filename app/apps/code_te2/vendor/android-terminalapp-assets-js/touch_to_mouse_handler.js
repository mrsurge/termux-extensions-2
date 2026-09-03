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
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_PX = 24;
const EDGE_SCROLL_PX = 32;
const EDGE_SCROLL_INTERVAL_MS = 80;
const HANDLE_LAYER_CLASS = 'te2-xterm-touch-selection-layer';
const HANDLE_CLASS = 'te2-xterm-touch-selection-handle';
const STYLE_ID = 'te2-xterm-touch-selection-style';

let gestureState = null;
let handleDrag = null;
const attachments = new WeakMap();
const attachmentsByRoot = new WeakMap();

function helpersEnabled() {
  return window.__fileEditorCm6TerminalHelpersActive !== false;
}

function getPoint(event) {
  if (event.changedTouches && event.changedTouches.length) return event.changedTouches[0];
  if (event.touches && event.touches.length) return event.touches[0];
  return event;
}

function getElementTarget(rawTarget) {
  if (rawTarget instanceof Element) return rawTarget;
  if (rawTarget && rawTarget.parentElement instanceof Element) return rawTarget.parentElement;
  return null;
}

function isHandleTarget(rawTarget) {
  return Boolean(getElementTarget(rawTarget)?.closest(`.${HANDLE_CLASS}`));
}

function getTerminalRoot(rawTarget) {
  const element = getElementTarget(rawTarget);
  return element ? element.closest('.xterm') : null;
}

function findTouchById(touchList, touchId) {
  if (!touchList || touchId == null) return null;
  for (let index = 0; index < touchList.length; index += 1) {
    const touch = touchList[index];
    if (touch?.identifier === touchId) return touch;
  }
  return null;
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
  if (!gestureState?.longPressTimer) return;
  clearTimeout(gestureState.longPressTimer);
  gestureState.longPressTimer = null;
}

function unlockGestureRoot() {
  const root = gestureState?.terminalRoot;
  const lockedStyle = gestureState?.lockedRootStyle;
  if (!root || !lockedStyle) return;
  root.style.touchAction = lockedStyle.touchAction;
  root.style.webkitUserSelect = lockedStyle.webkitUserSelect;
  root.style.userSelect = lockedStyle.userSelect;
  root.style.webkitTouchCallout = lockedStyle.webkitTouchCallout;
}

function resetGestureState() {
  clearLongPress();
  unlockGestureRoot();
  gestureState = null;
}

function lockGestureRoot(root) {
  if (!root) return null;
  const lockedStyle = {
    touchAction: root.style.touchAction,
    webkitUserSelect: root.style.webkitUserSelect,
    userSelect: root.style.userSelect,
    webkitTouchCallout: root.style.webkitTouchCallout,
  };
  root.style.touchAction = 'none';
  root.style.webkitUserSelect = 'none';
  root.style.userSelect = 'none';
  root.style.webkitTouchCallout = 'none';
  return lockedStyle;
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
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    detail: 1,
    screenX: pointer.screenX,
    screenY: pointer.screenY,
    clientX: pointer.clientX,
    clientY: pointer.clientY,
    button: 0,
  }));
}

function dispatchWheel(deltaY, point, target) {
  if (!target || !deltaY) return;
  const pointer = buildPointerLike(point, target);
  target.dispatchEvent(new WheelEvent('wheel', {
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
  }));
}

function startSelection(point) {
  if (!gestureState || gestureState.mode === 'select') return;
  clearLongPress();
  gestureState.mode = 'select';
  dispatchMouse('mousedown', point, gestureState.mouseTarget);
}

function getTrackedTouch(event) {
  if (!gestureState) return null;
  return findTouchById(event.touches, gestureState.touchId)
    || findTouchById(event.changedTouches, gestureState.touchId);
}

function maybeSelectWord(point, root) {
  const attachment = attachmentsByRoot.get(root);
  if (!attachment) return;
  const now = Date.now();
  const isDoubleTap = now - attachment.lastTapTime < DOUBLE_TAP_MS
    && Math.hypot(point.clientX - attachment.lastTapX, point.clientY - attachment.lastTapY)
      < DOUBLE_TAP_PX;
  if (isDoubleTap) {
    dispatchMouse('dblclick', point, getMouseTarget(root));
    attachment.lastTapTime = 0;
    return;
  }
  attachment.lastTapTime = now;
  attachment.lastTapX = point.clientX;
  attachment.lastTapY = point.clientY;
}

function handleTouchStart(event) {
  if (!helpersEnabled() || isHandleTarget(event.target)) return;
  if (!event.touches || event.touches.length !== 1) {
    resetGestureState();
    return;
  }
  const point = event.touches[0];
  const terminalRoot = getTerminalRoot(point.target);
  const mouseTarget = getMouseTarget(point.target);
  const wheelTarget = getWheelTarget(point.target);
  if (!terminalRoot || (!mouseTarget && !wheelTarget)) {
    resetGestureState();
    return;
  }

  gestureState = {
    touchId: point.identifier,
    mode: 'pending',
    startX: point.clientX,
    startY: point.clientY,
    lastY: point.clientY,
    point,
    terminalRoot,
    mouseTarget,
    wheelTarget,
    lockedRootStyle: lockGestureRoot(terminalRoot),
    longPressTimer: setTimeout(() => startSelection(point), LONG_PRESS_MS),
  };
}

function handleTouchMove(event) {
  if (!helpersEnabled() || !gestureState) return;
  const point = getTrackedTouch(event);
  if (!point || !event.touches || event.touches.length < 1) return;
  gestureState.point = point;
  const moved = Math.hypot(
    point.clientX - gestureState.startX,
    point.clientY - gestureState.startY,
  ) > MOVE_CANCEL_PX;

  if (gestureState.mode === 'pending') {
    if (!moved) {
      gestureState.lastY = point.clientY;
      return;
    }
    clearLongPress();
    gestureState.mode = 'scroll';
  }
  if (gestureState.mode === 'select') {
    dispatchMouse('mousemove', point, gestureState.mouseTarget);
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (gestureState.mode === 'scroll') {
    const deltaY = (gestureState.lastY - point.clientY) * WHEEL_DRAG_SCALE;
    gestureState.lastY = point.clientY;
    dispatchWheel(deltaY, point, gestureState.wheelTarget);
    event.preventDefault();
    event.stopPropagation();
  }
}

function handleTouchEnd(event) {
  if (!gestureState) return;
  const point = getTrackedTouch(event);
  if (!point) return;
  if (gestureState.mode === 'select') {
    dispatchMouse('mouseup', point, gestureState.mouseTarget);
    event.preventDefault();
    event.stopPropagation();
  } else if (gestureState.mode === 'scroll') {
    event.preventDefault();
    event.stopPropagation();
  } else {
    maybeSelectWord(point, gestureState.terminalRoot);
  }
  resetGestureState();
}

function handleContextMenu(event) {
  if (!helpersEnabled() || isHandleTarget(event.target)) return;
  const isTouchContextMenu = event.pointerType === 'touch' || Boolean(gestureState);
  if (!isTouchContextMenu) return;
  if (!gestureState) {
    const terminalRoot = getTerminalRoot(event.target);
    const mouseTarget = getMouseTarget(event.target);
    const wheelTarget = getWheelTarget(event.target);
    if (!terminalRoot || (!mouseTarget && !wheelTarget)) return;
    gestureState = {
      touchId: null,
      mode: 'pending',
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      point: event,
      terminalRoot,
      mouseTarget,
      wheelTarget,
      lockedRootStyle: lockGestureRoot(terminalRoot),
      longPressTimer: null,
    };
  }
  startSelection(event);
  event.preventDefault();
  event.stopPropagation();
}

function ensureHandleStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${HANDLE_LAYER_CLASS} {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      overflow: visible;
      pointer-events: none;
      z-index: 2147483000;
    }
    .${HANDLE_CLASS} {
      position: fixed;
      width: 40px;
      height: 44px;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      pointer-events: auto;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      transform: translate3d(-100px, -100px, 0);
    }
    .${HANDLE_CLASS}[hidden] { display: none !important; }
    .${HANDLE_CLASS}::before {
      content: '';
      position: absolute;
      left: 50%;
      top: 5px;
      width: 3px;
      height: 10px;
      border-radius: 2px;
      background: #74a9ff;
      transform: translateX(-50%);
      box-shadow: 0 0 0 1px rgba(4, 10, 24, 0.72);
    }
    .${HANDLE_CLASS}::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 13px;
      width: 16px;
      height: 16px;
      border: 1px solid rgba(4, 10, 24, 0.82);
      border-radius: 50% 50% 50% 0;
      background: rgba(71, 137, 255, 0.94);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.42);
      transform: translateX(-50%) rotate(-45deg);
    }
    .${HANDLE_CLASS}.dragging::after {
      background: #8fbcff;
      box-shadow: 0 2px 12px rgba(45, 116, 255, 0.68);
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function makeHandle(label) {
  const handle = document.createElement('div');
  handle.className = HANDLE_CLASS;
  handle.setAttribute('role', 'button');
  handle.setAttribute('aria-label', label);
  handle.setAttribute('aria-hidden', 'true');
  handle.tabIndex = -1;
  handle.hidden = true;
  return handle;
}

function getScreenGeometry(attachment) {
  const { terminal, root, screen } = attachment;
  if (!root.isConnected || !screen.isConnected || terminal.cols < 1 || terminal.rows < 1) {
    return null;
  }
  const screenRect = screen.getBoundingClientRect();
  const canvas = screen.querySelector('canvas');
  const surfaceRect = canvas?.getBoundingClientRect() || screenRect;
  if (surfaceRect.width <= 0 || surfaceRect.height <= 0) return null;
  return {
    left: surfaceRect.left,
    top: surfaceRect.top,
    right: surfaceRect.right,
    bottom: surfaceRect.bottom,
    cellWidth: surfaceRect.width / terminal.cols,
    cellHeight: surfaceRect.height / terminal.rows,
  };
}

function readSelection(terminal) {
  if (!terminal.hasSelection?.()) return null;
  const range = terminal.getSelectionPosition?.();
  if (!range?.start || !range?.end) return null;
  const start = { col: Number(range.start.x), row: Number(range.start.y) };
  const end = { col: Number(range.end.x), row: Number(range.end.y) };
  if (![start.col, start.row, end.col, end.row].every(Number.isFinite)) return null;
  return { start, end };
}

function compareCells(first, second) {
  if (first.row !== second.row) return first.row - second.row;
  return first.col - second.col;
}

function setHandlePosition(handle, cell, attachment, geometry) {
  const viewportY = Number(attachment.terminal.buffer?.active?.viewportY) || 0;
  const viewportRow = cell.row - viewportY;
  if (viewportRow < 0 || viewportRow >= attachment.terminal.rows) {
    handle.hidden = true;
    handle.setAttribute('aria-hidden', 'true');
    return;
  }
  const x = geometry.left + cell.col * geometry.cellWidth;
  const y = geometry.top + (viewportRow + 1) * geometry.cellHeight;
  handle.style.transform = `translate3d(${x - 20}px, ${y - 5}px, 0)`;
  handle.hidden = false;
  handle.setAttribute('aria-hidden', 'false');
}

function hideHandles(attachment) {
  for (const handle of [attachment.startHandle, attachment.endHandle]) {
    handle.hidden = true;
    handle.setAttribute('aria-hidden', 'true');
  }
}

function renderHandles(attachment) {
  attachment.renderRaf = null;
  if (attachment.disposed || !helpersEnabled()) {
    hideHandles(attachment);
    return;
  }
  const selection = readSelection(attachment.terminal);
  const geometry = getScreenGeometry(attachment);
  if (!selection || !geometry) {
    hideHandles(attachment);
    return;
  }
  setHandlePosition(attachment.startHandle, selection.start, attachment, geometry);
  setHandlePosition(attachment.endHandle, selection.end, attachment, geometry);
}

function scheduleRender(attachment) {
  if (attachment.disposed || attachment.renderRaf != null) return;
  attachment.renderRaf = requestAnimationFrame(() => renderHandles(attachment));
}

function normalizeWideCell(terminal, cell) {
  const cols = Math.max(1, Number(terminal.cols) || 1);
  const normalized = {
    col: Math.min(Math.max(Math.trunc(cell.col), 0), cols),
    row: Math.max(Math.trunc(cell.row), 0),
  };
  if (normalized.col >= cols) return normalized;
  const line = terminal.buffer?.active?.getLine?.(normalized.row);
  const width = line?.getCell?.(normalized.col)?.getWidth?.();
  if (width === 0) normalized.col = Math.min(cols, normalized.col + 1);
  return normalized;
}

function clientPointToBufferCell(attachment, clientX, clientY) {
  const geometry = getScreenGeometry(attachment);
  if (!geometry) return null;
  const { terminal } = attachment;
  const rawColumn = Math.ceil(
    (clientX - geometry.left + geometry.cellWidth / 2) / geometry.cellWidth,
  ) - 1;
  const rawViewportRow = Math.ceil((clientY - geometry.top) / geometry.cellHeight) - 1;
  const viewportRow = Math.min(Math.max(rawViewportRow, 0), terminal.rows - 1);
  const viewportY = Number(terminal.buffer?.active?.viewportY) || 0;
  return normalizeWideCell(terminal, {
    col: Math.min(Math.max(rawColumn, 0), terminal.cols),
    row: viewportY + viewportRow,
  });
}

function selectBetween(terminal, first, second) {
  const cols = Math.max(1, Number(terminal.cols) || 1);
  const start = compareCells(first, second) <= 0 ? first : second;
  const end = start === first ? second : first;
  const length = (end.row * cols + end.col) - (start.row * cols + start.col);
  if (length <= 0) return false;
  terminal.select(start.col, start.row, length);
  return true;
}

function stopEdgeScroll() {
  if (!handleDrag?.scrollTimer) return;
  clearInterval(handleDrag.scrollTimer);
  handleDrag.scrollTimer = null;
}

function updateHandleDrag() {
  if (!handleDrag) return;
  const moving = clientPointToBufferCell(
    handleDrag.attachment,
    handleDrag.clientX,
    handleDrag.clientY,
  );
  if (!moving || compareCells(moving, handleDrag.fixed) === 0) return;
  const nextRole = compareCells(moving, handleDrag.fixed) < 0 ? 'start' : 'end';
  if (nextRole !== handleDrag.role) {
    const attachment = handleDrag.attachment;
    const previousStart = attachment.startHandle;
    attachment.startHandle = attachment.endHandle;
    attachment.endHandle = previousStart;
    handleDrag.role = nextRole;
  }
  if (selectBetween(handleDrag.attachment.terminal, moving, handleDrag.fixed)) {
    scheduleRender(handleDrag.attachment);
  }
}

function updateEdgeScroll() {
  if (!handleDrag) return;
  const geometry = getScreenGeometry(handleDrag.attachment);
  if (!geometry) {
    handleDrag.scrollDirection = 0;
    stopEdgeScroll();
    return;
  }
  const nextDirection = handleDrag.clientY < geometry.top + EDGE_SCROLL_PX
    ? -1
    : handleDrag.clientY > geometry.bottom - EDGE_SCROLL_PX
      ? 1
      : 0;
  if (nextDirection === handleDrag.scrollDirection) return;
  handleDrag.scrollDirection = nextDirection;
  stopEdgeScroll();
  if (!nextDirection) return;
  handleDrag.scrollTimer = setInterval(() => {
    if (!handleDrag) return;
    handleDrag.attachment.terminal.scrollLines(handleDrag.scrollDirection);
    updateHandleDrag();
  }, EDGE_SCROLL_INTERVAL_MS);
}

function finishHandleDrag(event) {
  if (!handleDrag || (event && event.pointerId !== handleDrag.pointerId)) return;
  const completed = handleDrag;
  stopEdgeScroll();
  completed.handle.classList.remove('dragging');
  handleDrag = null;
  scheduleRender(completed.attachment);
}

function beginHandleDrag(event, attachment) {
  if (attachment.disposed || event.button > 0) return;
  const selection = readSelection(attachment.terminal);
  if (!selection) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget;
  const role = handle === attachment.startHandle ? 'start' : 'end';
  handleDrag = {
    attachment,
    handle,
    pointerId: event.pointerId,
    role,
    fixed: role === 'start' ? selection.end : selection.start,
    clientX: event.clientX,
    clientY: event.clientY,
    scrollDirection: 0,
    scrollTimer: null,
  };
  handle.classList.add('dragging');
  try {
    handle.setPointerCapture(event.pointerId);
  } catch (_) {}
  updateHandleDrag();
  updateEdgeScroll();
}

function moveHandleDrag(event) {
  if (!handleDrag || event.pointerId !== handleDrag.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  handleDrag.clientX = event.clientX;
  handleDrag.clientY = event.clientY;
  updateHandleDrag();
  updateEdgeScroll();
}

function addDisposable(attachment, disposable) {
  if (disposable && typeof disposable.dispose === 'function') {
    attachment.disposables.push(() => disposable.dispose());
  }
}

function isTouchFirst() {
  return Boolean(window.matchMedia?.('(pointer: coarse)').matches)
    || Number(navigator.maxTouchPoints || 0) > 0;
}

function attach(terminal) {
  if (!terminal || typeof terminal !== 'object') {
    throw new TypeError('A terminal instance is required');
  }
  const existing = attachments.get(terminal);
  if (existing) return existing.publicDisposable;
  const root = terminal.element;
  const screen = root?.querySelector?.('.xterm-screen');
  if (!root || !screen || !isTouchFirst()) return { dispose() {} };
  if (
    typeof terminal.select !== 'function'
    || typeof terminal.getSelectionPosition !== 'function'
    || typeof terminal.hasSelection !== 'function'
  ) {
    throw new TypeError('The terminal selection API is unavailable');
  }

  ensureHandleStyles();
  const layer = document.createElement('div');
  layer.className = HANDLE_LAYER_CLASS;
  const startHandle = makeHandle('Adjust selection start');
  const endHandle = makeHandle('Adjust selection end');
  layer.append(startHandle, endHandle);
  document.body.appendChild(layer);

  const attachment = {
    terminal,
    root,
    screen,
    layer,
    startHandle,
    endHandle,
    renderRaf: null,
    resizeObserver: null,
    disposed: false,
    disposables: [],
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
    publicDisposable: null,
  };

  const onPointerDown = (event) => beginHandleDrag(event, attachment);
  for (const handle of [startHandle, endHandle]) {
    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', moveHandleDrag);
    handle.addEventListener('pointerup', finishHandleDrag);
    handle.addEventListener('pointercancel', finishHandleDrag);
    handle.addEventListener('lostpointercapture', finishHandleDrag);
  }
  addDisposable(attachment, terminal.onSelectionChange?.(() => scheduleRender(attachment)));
  addDisposable(attachment, terminal.onScroll?.(() => scheduleRender(attachment)));
  addDisposable(attachment, terminal.onResize?.(() => scheduleRender(attachment)));
  const schedule = () => scheduleRender(attachment);
  window.addEventListener('resize', schedule, { passive: true });
  attachment.disposables.push(() => window.removeEventListener('resize', schedule));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedule, { passive: true });
    window.visualViewport.addEventListener('scroll', schedule, { passive: true });
    attachment.disposables.push(() => {
      window.visualViewport.removeEventListener('resize', schedule);
      window.visualViewport.removeEventListener('scroll', schedule);
    });
  }
  if (typeof ResizeObserver === 'function') {
    attachment.resizeObserver = new ResizeObserver(schedule);
    attachment.resizeObserver.observe(screen);
  }

  const dispose = () => {
    if (attachment.disposed) return;
    attachment.disposed = true;
    if (handleDrag?.attachment === attachment) finishHandleDrag();
    if (attachment.renderRaf != null) cancelAnimationFrame(attachment.renderRaf);
    attachment.renderRaf = null;
    attachment.resizeObserver?.disconnect();
    attachment.resizeObserver = null;
    for (const cleanup of attachment.disposables.splice(0)) {
      try {
        cleanup();
      } catch (_) {}
    }
    layer.remove();
    attachments.delete(terminal);
    attachmentsByRoot.delete(root);
  };
  attachment.publicDisposable = { dispose };
  attachments.set(terminal, attachment);
  attachmentsByRoot.set(root, attachment);
  scheduleRender(attachment);
  return attachment.publicDisposable;
}

const eventOptions = { capture: true, passive: false };
document.addEventListener('touchstart', handleTouchStart, eventOptions);
document.addEventListener('touchmove', handleTouchMove, eventOptions);
document.addEventListener('touchend', handleTouchEnd, eventOptions);
document.addEventListener('touchcancel', handleTouchEnd, eventOptions);
document.addEventListener('contextmenu', handleContextMenu, eventOptions);

window.te2TerminalTouchSelection = Object.freeze({ attach });
})();
