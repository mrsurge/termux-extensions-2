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
const CTRL_STATE_EVENT = 'android-terminalapp-ctrl-state';
const CTRL_DESIRED_KEY = '__androidTerminalCtrlDesired';

function emitCtrlState(active) {
  try {
    window.dispatchEvent(new CustomEvent(CTRL_STATE_EVENT, {
      detail: { active: !!active },
    }));
  } catch (_) {}
}

function setCtrl(active, options) {
  const persistDesired = options?.persistDesired !== false;
  if (persistDesired) {
    window[CTRL_DESIRED_KEY] = !!active;
  }
  window.ctrl = !!active;
  emitCtrlState(window.ctrl);
}

function isCtrlDesired() {
  return !!window[CTRL_DESIRED_KEY];
}

function ensureCtrlLatched() {
  if (!isCtrlDesired()) {
    return false;
  }
  if (!window.ctrl) {
    setCtrl(true, { persistDesired: false });
  }
  return true;
}

window.__androidTerminalSetCtrl = setCtrl;
window.__androidTerminalEnsureCtrlLatched = ensureCtrlLatched;
if (window[CTRL_DESIRED_KEY] == null) {
  window[CTRL_DESIRED_KEY] = !!window.ctrl;
}

const previousCleanup = window.__androidTerminalCtrlCleanup;
if (typeof previousCleanup === 'function') {
  try {
    previousCleanup();
  } catch (_) {}
  window.__androidTerminalCtrlCleanup = null;
}

const term = window.term;
if (!term || typeof term.attachCustomKeyEventHandler !== 'function') {
  return;
}

const textarea = term.textarea instanceof HTMLTextAreaElement ? term.textarea : null;
const cleanups = [];

function clearTextInput(target) {
  const input = target && typeof target.value === 'string' ? target : textarea;
  if (!input) return;
  try {
    input.value = '';
  } catch (_) {}
  try {
    if (typeof input.setSelectionRange === 'function') {
      input.setSelectionRange(0, 0);
    }
  } catch (_) {}
}

function suppressComposition(event) {
  if (!ensureCtrlLatched()) return;
  if (event.cancelable) {
    try {
      event.preventDefault();
    } catch (_) {}
  }
  try {
    event.stopImmediatePropagation();
  } catch (_) {}
  try {
    event.stopPropagation();
  } catch (_) {}
  clearTextInput(event.target);
}

if (textarea) {
  const events = [
    'focus',
    'beforeinput',
    'input',
    'compositionstart',
    'compositionupdate',
    'compositionend',
  ];
  for (const type of events) {
    const handler = type === 'focus'
      ? () => {
          clearTextInput(textarea);
          ensureCtrlLatched();
        }
      : suppressComposition;
    textarea.addEventListener(type, handler, true);
    cleanups.push(() => textarea.removeEventListener(type, handler, true));
  }
}

window.__androidTerminalCtrlCleanup = function() {
  while (cleanups.length) {
    const cleanup = cleanups.pop();
    try {
      cleanup();
    } catch (_) {}
  }
};

// keyCode 229 means composing text, so get the last character in
// e.target.value.
// keycode 64(@)-95(_) is mapped to a ctrl code
// keycode 97(A)-122(Z) is converted to a small letter, and mapped to ctrl code
term.attachCustomKeyEventHandler((e) => {
  if (!ensureCtrlLatched()) {
    return true;
  }

  let keyCode = Number(e.keyCode) || 0;
  let fromImeComposition = false;
  if (keyCode === 229) {
    fromImeComposition = true;
    const target = e.target && typeof e.target.value === 'string' ? e.target : textarea;
    const value = typeof target?.value === 'string' ? target.value : '';
    const selectionStart = typeof target?.selectionStart === 'number'
      ? target.selectionStart
      : value.length;
    const index = Math.max(0, Math.min(value.length - 1, Math.max(0, selectionStart - 1)));
    if (!value || index >= value.length) {
      clearTextInput(target);
      return false;
    }
    keyCode = value.charCodeAt(index);
  }

  let input = null;
  if (64 <= keyCode && keyCode <= 95) {
    input = String.fromCharCode(keyCode - 64);
  } else if (97 <= keyCode && keyCode <= 122) {
    input = String.fromCharCode(keyCode - 96);
  } else {
    return true;
  }

  if (e.type === 'keyup') {
    term.input(input);
    clearTextInput(e.target);
    if (fromImeComposition) {
      ensureCtrlLatched();
    } else {
      setCtrl(false);
    }
  }
  return false;
});
})();
