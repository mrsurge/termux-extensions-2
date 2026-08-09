# TE2 VS Code Build Source

Extracted VS Code base widgets bundled for TE2 browser consumption.

## What this is

This directory contains build infrastructure to bundle standalone VS Code UI widgets
from the code-server worktree (`../mrselect6-2/code-server/lib/vscode/src/vs/base/`)
into single-file ESM bundles that TE2 serves to the browser.

## Current bundles

| Bundle | Entry | Source |
|--------|-------|--------|
| `out/breadcrumbsWidget.js` | `breadcrumbs_entry.ts` | `vs/base/browser/ui/breadcrumbs/breadcrumbsWidget.ts` |

## How to build

```bash
cd app/apps/code_te2/monaco_editor/vscode_build_src/
node build.mjs
```

## Prerequisites

- code-server worktree at `../../../../../../mrselect6-2/code-server/`
- esbuild (resolved from npm cache)

## Architecture

- **Entry files** (`*_entry.ts`): thin re-exports of what TE2 needs
- **build.mjs**: esbuild config that resolves `vs/...` imports from the worktree
- **out/**: bundled ESM artifacts served to the browser
- Source files are NOT copied — esbuild reads them directly from the worktree

All source code is MIT licensed (Microsoft Corporation).
