package com.termux.extensions

internal object CefriumPagePolicy {
    private const val MONACO_ANDROID_IME_SELECTOR =
        "textarea.inputarea.android-ime-input"
    private const val IME_DISMISSED_EVENT = "te2:android-ime-dismissed"

    fun installScript(): String =
        """
        (() => {
          const selector = ${jsString(MONACO_ANDROID_IME_SELECTOR)};
          const marker = Symbol.for('te2.cefrium.monaco-focus-policy');
          const stateMarker = Symbol.for('te2.cefrium.monaco-focus-policy.state');

          const installWindow = targetWindow => {
            try {
              const prototype = targetWindow.HTMLTextAreaElement?.prototype;
              if (!prototype || prototype[marker]) return Boolean(prototype);
              const nativeFocus = prototype.focus;
              Object.defineProperty(prototype, 'focus', {
                configurable: true,
                writable: true,
                value: function(options) {
                  if (this.matches?.(selector)) {
                    const focusOptions =
                      options && typeof options === 'object'
                        ? Object.assign({}, options, { preventScroll: true })
                        : { preventScroll: true };
                    return nativeFocus.call(this, focusOptions);
                  }
                  return nativeFocus.call(this, options);
                },
              });
              Object.defineProperty(prototype, marker, {
                configurable: true,
                value: true,
              });
              return true;
            } catch (_) {
              return false;
            }
          };

          const existingState = globalThis[stateMarker];
          if (existingState) {
            existingState.scan(document);
            return true;
          }

          const watchedFrames = new WeakSet();
          const watchFrame = frame => {
            if (!(frame instanceof HTMLIFrameElement) || watchedFrames.has(frame)) return;
            watchedFrames.add(frame);
            const installFrame = () => installWindow(frame.contentWindow);
            frame.addEventListener('load', installFrame);
            installFrame();
          };
          const scan = root => {
            if (root instanceof HTMLIFrameElement) watchFrame(root);
            root.querySelectorAll?.('iframe').forEach(watchFrame);
          };
          const observer = new MutationObserver(records => {
            for (const record of records) {
              for (const node of record.addedNodes) {
                if (node instanceof Element) scan(node);
              }
            }
          });
          const state = { scan, observer };
          Object.defineProperty(globalThis, stateMarker, {
            configurable: true,
            value: state,
          });
          installWindow(globalThis);
          scan(document);
          observer.observe(document.documentElement, { childList: true, subtree: true });
          return true;
        })();
        """.trimIndent()

    fun imeDismissalScript(): String =
        """
        (() => {
          let targetWindow = globalThis;
          for (;;) {
            const active = targetWindow.document?.activeElement;
            if (!(active instanceof targetWindow.HTMLIFrameElement)) break;
            try {
              const childWindow = active.contentWindow;
              if (!childWindow || childWindow.location.origin !== targetWindow.location.origin) break;
              targetWindow = childWindow;
            } catch (_) {
              break;
            }
          }
          targetWindow.dispatchEvent(new CustomEvent(${jsString(IME_DISMISSED_EVENT)}, {
            detail: { source: 'android-window-insets' },
          }));
          return true;
        })();
        """.trimIndent()

    private fun jsString(value: String): String =
        "\"" +
            value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"") +
            "\""
}
