# Aria Downloader frontend

`src/main.ts` owns browser composition/rendering and `src/contracts.ts` owns its
typed host/API/state shapes plus runtime checks of unknown data. App-shell API
responses are already unwrapped; downloads, status and shell projections are
validated before use. Picker/restored-state/legacy browse responses have their
own validators. No cross-app source or new runtime frontend dependency is used.

Build from this directory:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

The build emits one minified ES module directly to existing `main.js`, which is
already mapped by manifest and native asset inventory. Edit `src/`, not generated
`main.js`. `app.js` remains the existing compatibility re-export; it is not a new
adapter. `template.html` retains authored inline CSS and existing controls. No new
stylesheet, dist import or asset URL is introduced. App-local node_modules is
excluded from Python package discovery and package data.

This slice preserves HTTP control and five-second browser polling, visibility
refresh, host-saved sort/directory preferences, picker and legacy browse branches,
download dialogs/selections, shell actions and polling stop on host exit. It does
not implement the planned JSON-RPC socket/pipe intent modernization, fix recurring
502s, replace shell ownership or add automatic mutation replay. Errors remain
visible; mutation requests are not silently retried through another route.

The frontend regressions execute compiled source with isolated DOM/host/API/timer
fixtures, not a live aria2 server or framework. They cover validated DTO edges,
startup projection, shell/control routes, picker/add options, saved state, polling
cleanup/visibility behavior, no add replay, visible 502 errors and asset mapping.
They are not native client publication or live UI acceptance.

Native clients require explicit OTA or matching packaged assets to activate this
bundle; a server frontend build or browser refresh is not publication. No Code
TE2 mypyc, Cargo or APK build is needed for this source slice itself.
