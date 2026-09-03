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
const WHEEL_DRAG_SCALE = 0.4;
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_PX = 24;
const EDGE_SCROLL_PX = 32;
const EDGE_SCROLL_INTERVAL_MS = 80;
const SELECTION_DRAG_OFFSET_ROWS = 3;
const HANDLE_HEIGHT_PX = 58;
const HANDLE_LAYER_CLASS = 'te2-xterm-touch-selection-layer';
const HANDLE_CLASS = 'te2-xterm-touch-selection-handle';
const MENU_CLASS = 'te2-xterm-touch-selection-menu';
const STYLE_ID = 'te2-xterm-touch-selection-style';

let gestureState = null;
let handleDrag = null;
const attachments = new WeakMap();
const attachmentsByRoot = new WeakMap();

function isMobileUserAgent() {
  if (navigator.userAgentData?.mobile === true) return true;
  return /\b(?:Android|Mobile|iPhone|iPad|iPod)\b/i.test(navigator.userAgent || '');
}

function helpersEnabled() {
  return isMobileUserAgent()
    && window.__fileEditorCm6TerminalHelpersActive !== false;
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

function resetGestureState() {
  const attachment = gestureState?.terminalRoot
    ? attachmentsByRoot.get(gestureState.terminalRoot)
    : null;
  clearLongPress();
  gestureState = null;
  if (attachment) scheduleRender(attachment);
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
  const attachment = attachmentsByRoot.get(gestureState.terminalRoot);
  if (attachment) {
    hideMenu(attachment);
    const cell = clientPointToBufferCell(attachment, point.clientX, point.clientY);
    if (cell && cell.col < attachment.terminal.cols) {
      gestureState.selectionAnchor = cell;
      if (typeof attachment.terminal.selectWordAt === 'function') {
        attachment.terminal.selectWordAt(cell.col, cell.row);
      } else {
        attachment.terminal.select(cell.col, cell.row, 1);
      }
    }
  }
}

function getTrackedTouch(event) {
  if (!gestureState) return null;
  return findTouchById(event.touches, gestureState.touchId)
    || findTouchById(event.changedTouches, gestureState.touchId);
}

function maybeSelectWord(point, root) {
  const attachment = attachmentsByRoot.get(root);
  if (!attachment) return false;
  const now = Date.now();
  const isDoubleTap = now - attachment.lastTapTime < DOUBLE_TAP_MS
    && Math.hypot(point.clientX - attachment.lastTapX, point.clientY - attachment.lastTapY)
      < DOUBLE_TAP_PX;
  if (isDoubleTap) {
    const cell = clientPointToBufferCell(attachment, point.clientX, point.clientY);
    if (cell && cell.col < attachment.terminal.cols) {
      if (typeof attachment.terminal.selectWordAt === 'function') {
        attachment.terminal.selectWordAt(cell.col, cell.row);
      } else {
        attachment.terminal.select(cell.col, cell.row, 1);
      }
    }
    attachment.lastTapTime = 0;
    return true;
  }
  attachment.lastTapTime = now;
  attachment.lastTapX = point.clientX;
  attachment.lastTapY = point.clientY;
  return false;
}

function handleTouchStart(event) {
  if (!helpersEnabled() || isHandleTarget(event.target)) return true;
  if (!event.touches || event.touches.length !== 1) {
    resetGestureState();
    return true;
  }
  const point = event.touches[0];
  const terminalRoot = getTerminalRoot(point.target);
  const mouseTarget = getMouseTarget(point.target);
  const wheelTarget = getWheelTarget(point.target);
  if (!terminalRoot || (!mouseTarget && !wheelTarget)) {
    resetGestureState();
    return true;
  }

  gestureState = {
    touchId: point.identifier,
    mode: 'pending',
    lastY: point.clientY,
    point,
    terminalRoot,
    mouseTarget,
    wheelTarget,
    selectionAnchor: null,
    longPressTimer: setTimeout(() => startSelection(point), LONG_PRESS_MS),
  };
  const attachment = attachmentsByRoot.get(terminalRoot);
  if (attachment) hideMenu(attachment);
  return false;
}

function handleTouchMove(event, isScrollGesture) {
  if (!helpersEnabled() || !gestureState) return true;
  const point = getTrackedTouch(event);
  if (!point || !event.touches || event.touches.length < 1) return true;
  gestureState.point = point;

  if (gestureState.mode === 'pending') {
    if (!isScrollGesture) {
      gestureState.lastY = point.clientY;
      return true;
    }
    clearLongPress();
    gestureState.mode = 'scroll';
  }
  if (gestureState.mode === 'select') {
    if (!isScrollGesture) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    const attachment = attachmentsByRoot.get(gestureState.terminalRoot);
    const moving = attachment
      ? clientPointToBufferCell(attachment, point.clientX, point.clientY)
      : null;
    if (attachment && moving && gestureState.selectionAnchor) {
      selectThroughCell(attachment.terminal, gestureState.selectionAnchor, moving);
    }
    event.preventDefault();
    event.stopPropagation();
    return false;
  }
  if (gestureState.mode === 'scroll') {
    const deltaY = (gestureState.lastY - point.clientY) * WHEEL_DRAG_SCALE;
    gestureState.lastY = point.clientY;
    dispatchWheel(deltaY, point, gestureState.wheelTarget);
    event.preventDefault();
    event.stopPropagation();
    return false;
  }
  return true;
}

function handleTouchEnd(event, isScrollGesture) {
  if (!gestureState) return true;
  const point = getTrackedTouch(event);
  if (!point) return true;
  if (gestureState.mode === 'pending' && isScrollGesture) {
    clearLongPress();
    gestureState.mode = 'scroll';
  }
  if (gestureState.mode === 'select') {
    event.preventDefault();
    event.stopPropagation();
    resetGestureState();
    return false;
  } else if (gestureState.mode === 'scroll') {
    event.preventDefault();
    event.stopPropagation();
    resetGestureState();
    return false;
  } else {
    const selectedWord = maybeSelectWord(point, gestureState.terminalRoot);
    if (!selectedWord) {
      dispatchMouse('mousedown', point, gestureState.mouseTarget);
      dispatchMouse('mouseup', point, gestureState.mouseTarget);
      dispatchMouse('click', point, gestureState.mouseTarget);
    }
    event.preventDefault();
    event.stopPropagation();
  }
  resetGestureState();
  return false;
}

function handleTouchCancel(event) {
  if (!gestureState) return true;
  const owned = gestureState.mode === 'select' || gestureState.mode === 'scroll';
  resetGestureState();
  return !owned;
}

function handleCustomTouchEvent(event, isScrollGesture) {
  if (event.type === 'touchstart') {
    return handleTouchStart(event);
  } else if (event.type === 'touchmove') {
    return handleTouchMove(event, isScrollGesture);
  } else if (event.type === 'touchend') {
    return handleTouchEnd(event, isScrollGesture);
  } else if (event.type === 'touchcancel') {
    return handleTouchCancel(event);
  }
  return true;
}

function handleContextMenu(event) {
  if (!helpersEnabled() || isHandleTarget(event.target)) return;
  const isTouchContextMenu = event.pointerType === 'touch' || Boolean(gestureState);
  if (!isTouchContextMenu) return;
  const createdGesture = !gestureState;
  if (!gestureState) {
    const terminalRoot = getTerminalRoot(event.target);
    const mouseTarget = getMouseTarget(event.target);
    const wheelTarget = getWheelTarget(event.target);
    if (!terminalRoot || (!mouseTarget && !wheelTarget)) return;
    gestureState = {
      touchId: null,
      mode: 'pending',
      lastY: event.clientY,
      point: event,
      terminalRoot,
      mouseTarget,
      wheelTarget,
      selectionAnchor: null,
      longPressTimer: null,
    };
  }
  startSelection(event);
  if (createdGesture) resetGestureState();
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
      height: ${HANDLE_HEIGHT_PX}px;
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
      transform: translateX(-50%) rotate(135deg);
    }
    .${HANDLE_CLASS}.dragging::after {
      background: #8fbcff;
      box-shadow: 0 2px 12px rgba(45, 116, 255, 0.68);
    }
    .${MENU_CLASS} {
      position: fixed;
      display: flex;
      align-items: stretch;
      gap: 2px;
      min-height: 38px;
      padding: 3px;
      border: 1px solid rgba(130, 163, 214, 0.42);
      border-radius: 9px;
      background: rgba(12, 20, 35, 0.94);
      box-shadow: 0 7px 24px rgba(0, 0, 0, 0.48);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      pointer-events: auto;
      touch-action: manipulation;
      transform: translate(-50%, calc(-100% - 8px));
    }
    .${MENU_CLASS}[hidden] { display: none !important; }
    .${MENU_CLASS} button {
      min-width: 52px;
      min-height: 38px;
      padding: 0 10px;
      border: 0;
      border-radius: 6px;
      color: #e7efff;
      background: transparent;
      font: 600 12px/1 ui-sans-serif, sans-serif;
      letter-spacing: 0.01em;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .${MENU_CLASS} button:active {
      background: rgba(91, 145, 235, 0.3);
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

function makeMenu() {
  const menu = document.createElement('div');
  menu.className = MENU_CLASS;
  menu.setAttribute('role', 'toolbar');
  menu.setAttribute('aria-label', 'Terminal selection actions');
  menu.hidden = true;
  for (const [action, label] of [
    ['copy', 'Copy'],
    ['paste', 'Paste'],
    ['selectAll', 'Select all'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = label;
    button.tabIndex = -1;
    menu.appendChild(button);
  }
  return menu;
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

function hideMenu(attachment) {
  attachment.menu.hidden = true;
  attachment.menu.setAttribute('aria-hidden', 'true');
}

function syncHandleLabels(attachment) {
  attachment.startHandle.setAttribute('aria-label', 'Adjust selection start');
  attachment.endHandle.setAttribute('aria-label', 'Adjust selection end');
}

function positionMenu(selection, attachment, geometry) {
  if (
    handleDrag?.attachment === attachment
    || gestureState?.terminalRoot === attachment.root
  ) {
    hideMenu(attachment);
    return;
  }
  const { terminal } = attachment;
  const viewportY = Number(terminal.buffer?.active?.viewportY) || 0;
  const viewportEnd = viewportY + terminal.rows - 1;
  const effectiveEndRow = selection.end.col === 0 && selection.end.row > selection.start.row
    ? selection.end.row - 1
    : selection.end.row;
  const firstVisibleRow = Math.max(selection.start.row, viewportY);
  const lastVisibleRow = Math.min(effectiveEndRow, viewportEnd);
  if (firstVisibleRow > lastVisibleRow) {
    hideMenu(attachment);
    return;
  }
  const firstColumn = firstVisibleRow === selection.start.row ? selection.start.col : 0;
  const lastColumn = firstVisibleRow === effectiveEndRow
    ? selection.end.col || terminal.cols
    : terminal.cols;
  const anchorColumn = (firstColumn + Math.max(firstColumn + 1, lastColumn)) / 2;
  const rawX = geometry.left + anchorColumn * geometry.cellWidth;
  const rawY = geometry.top + (firstVisibleRow - viewportY) * geometry.cellHeight;
  const viewportLeft = window.visualViewport?.offsetLeft ?? 0;
  const viewportTop = window.visualViewport?.offsetTop ?? 0;
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
  const menuHalfWidth = Math.max(88, attachment.menu.offsetWidth / 2);
  const x = Math.min(
    Math.max(rawX, viewportLeft + menuHalfWidth + 6),
    viewportLeft + viewportWidth - menuHalfWidth - 6,
  );
  attachment.menu.style.left = `${x}px`;
  attachment.menu.style.top = `${Math.max(rawY, viewportTop + 48)}px`;
  attachment.menu.hidden = false;
  attachment.menu.setAttribute('aria-hidden', 'false');
}

function hideHandles(attachment) {
  for (const handle of [attachment.startHandle, attachment.endHandle]) {
    handle.hidden = true;
    handle.setAttribute('aria-hidden', 'true');
  }
  hideMenu(attachment);
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
  positionMenu(selection, attachment, geometry);
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

function selectThroughCell(terminal, anchor, moving) {
  const cols = Math.max(1, Number(terminal.cols) || 1);
  const clampCell = (cell) => ({
    col: Math.min(Math.max(cell.col, 0), cols - 1),
    row: Math.max(cell.row, 0),
  });
  const first = clampCell(anchor);
  const second = clampCell(moving);
  const start = compareCells(first, second) <= 0 ? first : second;
  const end = start === first ? second : first;
  const length = (end.row * cols + end.col) - (start.row * cols + start.col) + 1;
  terminal.select(start.col, start.row, length);
}

function stopEdgeScroll() {
  if (!handleDrag?.scrollTimer) return;
  clearInterval(handleDrag.scrollTimer);
  handleDrag.scrollTimer = null;
}

function updateHandleDrag() {
  if (!handleDrag) return;
  const geometry = getScreenGeometry(handleDrag.attachment);
  if (!geometry) return;
  const moving = clientPointToBufferCell(
    handleDrag.attachment,
    handleDrag.clientX,
    handleDrag.clientY
      + handleDrag.touchOffsetY
      - geometry.cellHeight * SELECTION_DRAG_OFFSET_ROWS,
  );
  if (!moving || compareCells(moving, handleDrag.fixed) === 0) return;
  const nextRole = compareCells(moving, handleDrag.fixed) < 0 ? 'start' : 'end';
  if (nextRole !== handleDrag.role) {
    const attachment = handleDrag.attachment;
    const previousStart = attachment.startHandle;
    attachment.startHandle = attachment.endHandle;
    attachment.endHandle = previousStart;
    syncHandleLabels(attachment);
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
  const handleRect = handle.getBoundingClientRect();
  const handleCenterY = handleRect.height > 0
    ? handleRect.top + handleRect.height / 2
    : event.clientY + HANDLE_HEIGHT_PX / 2;
  handleDrag = {
    attachment,
    handle,
    pointerId: event.pointerId,
    role,
    fixed: role === 'start' ? selection.end : selection.start,
    clientX: event.clientX,
    clientY: event.clientY,
    touchOffsetY: handleCenterY - event.clientY,
    scrollDirection: 0,
    scrollTimer: null,
  };
  handle.classList.add('dragging');
  hideMenu(attachment);
  try {
    handle.setPointerCapture(event.pointerId);
  } catch (_) {}
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

function attach(terminal) {
  if (!terminal || typeof terminal !== 'object') {
    throw new TypeError('A terminal instance is required');
  }
  const existing = attachments.get(terminal);
  if (existing) return existing.publicDisposable;
  const root = terminal.element;
  const screen = root?.querySelector?.('.xterm-screen');
  if (!root || !screen || !isMobileUserAgent()) return { dispose() {} };
  if (
    typeof terminal.select !== 'function'
    || typeof terminal.getSelectionPosition !== 'function'
    || typeof terminal.hasSelection !== 'function'
    || typeof terminal.getSelection !== 'function'
    || typeof terminal.paste !== 'function'
    || typeof terminal.selectAll !== 'function'
    || typeof terminal.attachCustomTouchEventHandler !== 'function'
  ) {
    console.warn('[terminal] touch selection disabled: xterm touch hook is unavailable');
    return { dispose() {} };
  }

  ensureHandleStyles();
  const layer = document.createElement('div');
  layer.className = HANDLE_LAYER_CLASS;
  const startHandle = makeHandle('Adjust selection start');
  const endHandle = makeHandle('Adjust selection end');
  const menu = makeMenu();
  layer.append(startHandle, endHandle, menu);
  document.body.appendChild(layer);

  const attachment = {
    terminal,
    root,
    screen,
    layer,
    startHandle,
    endHandle,
    menu,
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
  menu.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  menu.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('button[data-action]')
      : null;
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const action = button.dataset.action;
    void (async () => {
      try {
        if (action === 'copy') {
          const text = terminal.getSelection();
          if (text) await navigator.clipboard.writeText(text);
        } else if (action === 'paste') {
          const text = await navigator.clipboard.readText();
          if (text) terminal.paste(text);
          terminal.clearSelection?.();
        } else if (action === 'selectAll') {
          terminal.selectAll();
        }
      } catch (error) {
        console.warn(`[terminal] selection ${action || 'action'} failed`, error);
      } finally {
        scheduleRender(attachment);
      }
    })();
  });
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
  addDisposable(attachment, terminal.attachCustomTouchEventHandler(handleCustomTouchEvent));
  root.addEventListener('contextmenu', handleContextMenu, eventOptions);
  attachment.disposables.push(() => {
    root.removeEventListener('contextmenu', handleContextMenu, eventOptions);
  });
  scheduleRender(attachment);
  return attachment.publicDisposable;
}

const eventOptions = { capture: true, passive: false };

window.te2TerminalTouchSelection = Object.freeze({ attach });
})();
