# File Editor frontend

`src/main.ts` owns CM6/menu/document orchestration. `src/contracts.ts` owns typed
host interfaces and validation of unknown API, picker and restored-state values.
The `.d.ts` adapters describe the existing browser CM6/preferences/navigation URLs;
CodeMirror npm packages provide development types only, not another runtime editor.

```bash
cd app/apps/file_editor
npm ci
npm run typecheck
npm run build
npm test
```

`build.mjs` produces one minified ESM **directly at `main.js`**, retaining the
manifest/OTA URL without an adapter import or new asset request. Do not edit that
generated file. The template/CSS remain authored inline in `template.html`.
The existing CM6 vendor and shared preference/save-guard helpers stay external at
their existing `/static/` URLs; frontend tests bundle those helpers with an isolated
CM6/DOM fixture, without changing or starting a live framework or real worker.

Preserve all five localStorage preferences, sidebar query identity/publication,
host draft restoration and Discard/Save/Cancel navigation semantics. Unknown input
is validated at the transport edge; settings/drafts are not backend authority.
CodeMirror stays the standalone/outside-project editor, not a Code TE2 frontend.

Native clients require separate OTA or package publication and reload for live
acceptance; a local build does not update installed assets. The existing asset
manifest already maps `app/apps/file_editor/main.js` to `apps/file_editor/main.js`.
No Android source/assembly, OTA publication, backend restart or mypyc build is part
of this frontend build. App-local `node_modules` is excluded from wheel discovery
and runtime package data.
