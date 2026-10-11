# File Explorer frontend

## Source and build

`src/main.js` currently composes the app and retains directory navigation, tab
orchestration, file workflows, properties, bookmarks and job observation. These
remaining JavaScript paths are the second refactor slice; they are **not yet
strictly typechecked**.

The first extracted controllers are checked under the app's strict TypeScript
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
console/icon/tab/intent resources and lazy terminal vendor assets retain their
existing URLs; the bounded regex worker remains isolated and terminable.
Standalone terminal/codec/context helper outputs retain compatibility URLs and
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

## Remaining extraction

Next: validated API/DTOs; tabs/splash; file actions/properties/bookmarks; job
observation; then strictly type the reduced composition entrypoint. Preserve the
backend-owned tab and intent boundaries and existing terminal ownership. Do not
rename remaining JS to TS with suppression directives or broad casts as a
substitute for validating external values.
