// Authored contract for scripts/build_monaco_bootstrap_bundle.mjs.
// Keep this separate from the generated JavaScript; no runtime code is added.
export interface MonacoBootstrapOptions {
  languageWorkersEnabled?: boolean;
  basicLanguagesOnly?: boolean;
}

// Consumers narrow the namespace to their public API or internal runtime view.
export function loadMonaco(options?: MonacoBootstrapOptions): Promise<unknown>;
