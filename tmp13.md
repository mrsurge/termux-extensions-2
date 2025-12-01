# Outstanding Issue: Draft Parent Directory Inheritance

**Date**: 2025-12-01 07:33 UTC

## Problem

The yellow draft accent (indicating unsaved changes) does not propagate to ancestor directories when the subdirectory containing the draft file is collapsed.

**Current behavior:**
- ✅ Files with drafts show yellow right-accent
- ✅ Direct parent shows accent when subdirectory is opened
- ❌ Ancestor directories do NOT show accent when subdirectory is collapsed

## Root Cause

The frontend's `applyAggregatedGitStatusFlags()` walks up from rendered DOM nodes. When a directory is collapsed, its children aren't in the DOM, so there's nothing to walk up from.

For git status, this is solved by `gitFlags` - the backend computes flags for ALL descendants and sends them with each directory entry. The frontend then propagates these flags up.

For drafts, we added `hasDraft: true` for directories (using prefix matching), but the propagation isn't reaching all ancestors.

## Likely Fix

Either:
1. Debug why the prefix-matching `hasDraft` isn't working for all ancestor levels
2. Add a `draftFlags` array similar to `gitFlags` that explicitly lists 'draft' when descendants have drafts

## Files Involved

- `app/apps/file_editor_cm6/explorer_helper.py` - `list_dir()` computes `hasDraft`
- `app/apps/file_editor_cm6/static/js/explorer.js` - `renderEntriesInto()` and `applyAggregatedGitStatusFlags()`
- `app/apps/file_editor_cm6/static/js/explorer.css` - `.fe-dir-has-draft::after`

— _Claude (Anthropic) & VectorArc, 2025-12-01 07:33 UTC_
