package com.termux.extensions

internal object CefriumPagePolicy {
    private const val MONACO_ANDROID_IME_SELECTOR =
        "textarea.inputarea.android-ime-input"

    fun installScript(): String =
        """
        (() => {
          const selector = ${jsString(MONACO_ANDROID_IME_SELECTOR)};
          const prototype = globalThis.HTMLTextAreaElement?.prototype;
          if (!prototype) return false;

          const marker = Symbol.for('te2.cefrium.monaco-focus-policy');
          if (!prototype[marker]) {
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
          }

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
