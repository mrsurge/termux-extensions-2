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
const setCtrl = typeof window.__androidTerminalSetCtrl === 'function'
  ? window.__androidTerminalSetCtrl
  : function(active) {
      window[CTRL_DESIRED_KEY] = !!active;
      window.ctrl = !!active;
      try {
        window.dispatchEvent(new CustomEvent(CTRL_STATE_EVENT, {
          detail: { active: !!active },
        }));
      } catch (_) {}
    };
setCtrl(true);
})();
