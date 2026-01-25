// Minimal runtime shim for Monaco language workers.
//
// The upstream Monaco worker sources import from "monaco-editor-core", but in TE2 we
// serve the pinned VS Code ESM build directly (no node-style resolution inside workers).
//
// This shim provides only the runtime exports that are actually used by the worker code.
// Everything else is intentionally omitted to keep the worker bundles small.

import { URI } from 'vscode-uri';

// Monaco uses `Uri` (capital U, lower i) in many places; VS Code uses `URI`.
export const Uri = URI;

// These imports are used for typing in the original TypeScript sources.
// When bundling, they should tree-shake away if unused, but they must exist.
export const worker = {};

