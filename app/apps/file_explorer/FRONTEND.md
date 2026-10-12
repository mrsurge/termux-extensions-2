# File Explorer frontend

## Source and build

`src/main.ts` is the strictly typed composition root. It retains directory/tab
coordination and delegates presentation and workflows to app-owned controllers.
Unknown host/runtime values are checked at the boundary, not cast into trusted
DTOs. The public `main.js` remains only the stable manifest mount adapter.

All extracted controllers are checked under the app's strict TypeScript
configuration:

- `src/viewport.ts`: directory presentation, breadcrumbs, sorting, selection,
  bounded regex filtering and listing-focus restoration. Exposes typed entry,
  state, DOM and callback contracts; does not own navigation or durable tabs.
- `src/keyboard.ts`: listing-only keyboard actions. Input/composition/modifier
  handling stays outside filtering; Space selects, Enter opens, Backspace goes
  to parent, and Delete delegates to the existing confirmation workflow.
- `src/menubar.ts`: command menu bindings and item context menus, including
  focus restoration, keyboard navigation and listener disposal. Existing command
  buttons remain the capability source.
- `terminal_drawer.ts`: existing independent terminal controller/transport.
- `src/api.ts`: validates host-unwrapped app HTTP DTOs and exposes named file
  operations. Nullable listing metadata becomes absent; legacy array listings
  remain supported. Global jobs/bookmarks and intents retain their own boundary.
- `src/tab_protocol.ts` and `src/tab_client.ts`: validate backend tab/terminal
  DTOs over existing MessagePack Socket.IO, with serialized mutation and
  disconnect/selection fences. Uncertain mutations are never replayed; resync
  attaches read-only and cannot regress a newer peer revision.
- `src/tabs_ui.ts`: splash and tab-menu presentation with stale-result/disposal
  guards. Directory, preference, terminal and sidebar coordination stay in root
  callbacks; showing a splash never creates a tab.
- `src/action_types.ts` and `src/file_actions.ts`: captured selection/origin,
  dialog/picker contracts and file creation, rename, deletion, copy/move and
  download workflows. Jobs are injected; attempting a job submission never
  falls back to a second direct mutation if its result is uncertain.
- `src/open_actions.ts`: file/project/terminal intents, symlink and size checks,
  archive launch/extraction, with captured targets and async context guards.
- `src/properties.ts`: permissions/ownership/rename dialog with request identity,
  cancelled delayed focus and captured Apply context. Closing/superseding a
  dialog prevents subsequent steps, but does not cancel or undo an issued mutation.
- `src/bookmarks.ts`: global bookmark API validation, metadata-preserving edits,
  safe text rendering and disposable modal/menu bindings.
- `src/jobs.ts`: per-mount job observation/notifications, optional stream/poller
  capabilities and bounded cleanup. Suspension/disposal fences stale callbacks;
  disposal does not cancel or delete running jobs.
- `src/frontend_contracts.ts`: validates host, API, dialogs, picker, preferences
  and Socket.IO capabilities. `src/static_modules.d.ts` describes the existing
  shared asset APIs; `src/presentation_helpers.ts` holds pure display helpers.

Ctrl+backtick reveals/focuses the current tab's terminal via its existing drawer
action, creating it if absent. It does not toggle the drawer closed. The typed
keyboard binding captures before terminal input, ignores held-key repeats and
composition, and leaves modal dialogs and inactive/splash tabs alone.

Edit `src/styles.css` and `src/template.html`, not generated `template.html`.
The build minifies CSS into the template's one stylesheet placeholder. This
keeps the existing inline style delivery without another request or layout gate.

From this directory:

```bash
npm run typecheck
npm run build
npm run test:frontend
```

From the repository root, `node app/apps/file_explorer/build.mjs` also works.

The framework manifest still resolves `main.js`, now a small mount adapter to
`/static/js/file_explorer_main.js`. The latter is one minified ESM app bundle with
no code splitting, including the typed controllers and terminal/codec. Shared
console/icon/intent resources and lazy terminal vendor assets retain their
existing URLs; the bounded regex worker remains isolated and terminable.
Standalone terminal/codec/context/tab helper outputs retain compatibility URLs and
are generated from their owning sources, not separate implementations.

The generated app bundle is in `app/static/js`, which is included in wheels and
native asset publication. A build alone does not activate installed native
clients: publish the matching OTA before live testing. No Python/mypyc rebuild or
framework restart is needed for these frontend changes.

## Navigation/filter contract

Clear transient filter input/error after a successful resolved directory change
and whenever a different backend tab is selected (even at the same path). Keep
the filter on same-directory refreshes, option changes and failed navigation.
Obsolete listing/filter completions cannot reset current state. Filter state is
presentation-only, not persisted into durable tab records.

## Mount and listing lifecycle

Remounting the same root disposes its previous controllers, socket and listeners.
Final page exit does the same; bfcache suspension disconnects observation and
resumes through existing read-only resync. This does not close backend tabs or
terminate their terminal shells. Late startup/listing callbacks cannot mutate a
disposed mount.

While a directory listing is pending, filtering and view/sort rerenders cannot
resurrect the previous directory. The filter input is temporarily disabled until
the current request completes; failed listings clear old entries without changing
the retained filter text or durable tab authority.

## Action/dialog identity

File actions capture targets before awaiting consent or a picker. Presentation
guards combine the current tab/directory with an epoch changed by tab switches,
successful directory changes and returning to the splash. Returning to the same
location does not revive old dialog work; same-directory refreshes do not
invalidate a successful Properties Apply. These guards are not durable authority.
Cleanup cannot reload a different foreground context. Properties mutations remain
one-shot and ordered rename → chmod → chown, using the renamed path for later
steps. A superseded context stops remaining steps; failures are not retried.

## Directory usage

View → Directory usage explicitly starts a scan for the attached backend tab.
Purple usage pills replace list size cells and appear centered below icon tiles.
Progress events carry child totals; completed children lose the pending ellipsis.
The header shows the running total and Cancel action. Directory usage is a
localStorage-persisted View toggle. Navigation cancels the previous scan, clears
its projection and automatically starts a scan after the new listing loads.
Manual Cancel stops only the current scan; disabling the View toggle turns off
the mode. Sort by Size uses progressive measured totals, placing unknown sizes
last. View/sort/filter rerenders retain projections and focus. Partial or
interrupted results remain labelled in the header.
`src/usage.ts` owns only presentation; `usage_service.py` forwards requests over
the framework pipe to `service.fs` (NID 2100), using
`fs.directoryUsage.start/cancel`. Rust `framework_services/fs_usage.rs` owns the
bounded scan lane, recursive accounting, progress and terminal result events.
Requests are fenced by pipe owner and scan ID; the backend adds tab identity and
forwards binary `directory_usage` updates only to the requesting `/tabs` SID.

Closing, navigating, detaching or disconnecting cancels observation and requests
cooperative scan cancellation. Reconnection never replays scans. An early result
can precede the start ACK; late results cannot mutate a newer scan. Ordinary
directory listing does not invoke scans or compete for their separate permits.

Immediate-child rows summarize recursive contents, including hidden files.
Unix accounting uses allocated bytes, deduplicates hard links and does not follow
nested symlinks. Root directory allocation contributes to the total. Other
platforms explicitly report apparent size. Time/entry/row/payload limits and
unreadable entries produce labelled partial results, never false complete totals.

This feature requires a rebuilt/restarted framework, refreshed File Explorer
Python worker and published frontend assets. It does not require a Code TE2
mypyc build. A frontend reload or OTA alone cannot add the framework pipe method.

## Native entry resources

The minified app graph is `/static/js/file_explorer_main.js`; its public mount
adapter and generated template are `/apps/file_explorer/main.js` and
`/apps/file_explorer/template.html`, with `/apps/by-id/file_explorer/` aliases.
All are included in the common OTA/APK inventory. Electron, Gecko and
Cefrium/TE2 Termux declare exact entry-resource mappings; shared `/static/js/`
resources retain their existing prefix mapping. Dynamic app/API paths are not
intercepted. Bundle inventory does not configure native routing automatically.

Validate with Code TE2's `npm run test:native-assets`, Electron's asset tests and
Cefrium's `CefriumAssetRoutesTest`. New routing needs rebuilt native clients;
OTA only installs resource bytes. Regenerate the Android seed with
`bash scripts/bundle_gecko_assets.sh` before APK assembly. Built-in entry resources
are required before activating a downloaded bundle; missing mapped files fail
locally rather than fetching a different server copy.
