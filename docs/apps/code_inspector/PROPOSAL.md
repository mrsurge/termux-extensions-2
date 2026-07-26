# Code Inspector Proposal

## Purpose

Code Inspector is one bottom-drawer surface for semantic relationships around
an explicitly selected editor symbol.

The initial feature set is:

- Call Hierarchy
- Find All References
- Find All Implementations

The editor chooses the target. Code Inspector presents and retains the result.
Ordinary cursor movement must not replace the current Inspector root.

## User Experience

The Monaco context menu gains a dedicated code-navigation island:

```text
Call Hierarchy       phone icon
Find All References  pages icon
Find Implementations target icon
```

The navigation island is available from touch and desktop context menus. The
existing selection-adjustment island remains touch-only.

All three actions:

1. Capture the exact editor document, position, language, and visible symbol.
2. Open the bottom drawer on the `Code Inspector` tab immediately.
3. Show a loading state tied to that target and operation.
4. Replace the current Inspector projection when the latest request completes.
5. Keep the result visible while the user opens locations in the editor.

The drawer renders:

- target symbol and source location
- active operation
- explicit loading, empty, unsupported, and error states
- references and implementations grouped by file
- call hierarchy with one active incoming or outgoing direction

Selecting a result opens the target file and range without closing or replacing
the Inspector. Result navigation uses a centered line reveal with editor focus
disabled, so it does not move the Monaco cursor or summon the mobile keyboard.
Displayed paths remain one text value and truncate from the root side, keeping
the deepest path segments visible without split-span overlap.

## Ownership

### Editor frontend

The editor frontend owns:

- capturing the context-menu target
- issuing direct WBA language-intelligence requests
- rejecting stale results by request and model generation
- publishing normalized Inspector projections through `/rpc/editor`
- receiving backend-mediated hierarchy direction, expansion, and release
  commands

The editor frontend must not notify the host frontend directly.

### WBA

WBA owns:

- provider registration and selector matching
- extension activation before language-feature requests
- references and implementation provider calls
- call-hierarchy preparation, expansion, and release
- provider handles and live call-hierarchy session validity
- normalization of extension-host DTOs into JSON-safe response data

These features reuse the existing language-feature RPC identifier. They do not
introduce new top-level NIDs.

The exact extension-host methods are:

```text
References
  $registerReferenceSupport
  $provideReferences

Implementations
  $registerImplementationSupport
  $provideImplementation

Call hierarchy
  $registerCallHierarchyProvider
  $prepareCallHierarchy
  $provideCallHierarchyIncomingCalls
  $provideCallHierarchyOutgoingCalls
  $releaseCallHierarchy
```

References and implementations query all ordered matching providers, merge
their results, and sort and deduplicate locations. Call hierarchy selects the
first ordered matching provider and retains its session until replacement,
adapter reset, project switch, or explicit release.

There is no text-search or grep fallback when a semantic provider is absent.

### Python app worker

The Python app worker owns the current normalized Code Inspector projection in
memory.

It:

- accepts reliable editor publications over `/rpc/editor`
- applies latest-request and revision guards
- retains one current top-level inspection
- updates that inspection as hierarchy direction changes and nodes are expanded
- publishes a backend Code Inspector fact
- projects that fact to the host through `/ui_ipc`
- includes the current snapshot in the host boot snapshot
- clears invalid hierarchy state after project or adapter session replacement

The projection is not written to disk. It survives browser reload while the
worker remains alive and disappears when the worker exits.

### Host frontend

The host frontend owns:

- the `Code Inspector` drawer tab
- rendering the current projection
- requesting backend-mediated hierarchy direction changes
- requesting backend-mediated hierarchy expansion
- opening result locations through existing host file-open behavior
- preserving Inspector state while the active editor file changes

## Transport

The transport sequence is:

```text
Monaco context action
  -> direct editor/WBA request
  -> reliable editor.codeInspector.publish request
  -> Python in-memory state update
  -> CodeInspectorChanged backend fact
  -> ui.codeInspector.changed notification
  -> Code Inspector drawer render
```

Lazy hierarchy expansion is:

```text
Code Inspector row expansion
  -> ui.host.codeInspector.expand request
  -> backend editor.codeInspector.expand notification
  -> direct editor/WBA incoming or outgoing request
  -> reliable editor.codeInspector.publish request
  -> updated backend fact and host projection
```

Hierarchy direction changes use the same command path. A prepared hierarchy
starts in the incoming direction, immediately resolves and expands its first
root, and retains all other roots for explicit expansion. The header direction
action resets direction-specific children and resolves the first root in the
new direction. Descendant calls remain lazy.

Top-level replacement or drawer disposal may request hierarchy release through
the same backend-mediated command path.

No new socket, HTTP endpoint, or frontend-to-frontend transport is introduced.

## Projection Contract

The retained projection has this conceptual shape:

```text
revision
requestId
status
mode
target
summary
tree
error
```

`status` is one of:

```text
loading
ready
empty
unsupported
error
```

`mode` is one of:

```text
references
implementations
callHierarchy
```

The target contains:

```text
path
uri
languageId
line
column
endLine
endColumn
symbol
modelVersion
```

Location nodes contain normalized paths, URIs, ranges, and optional origin
ranges.

Call-hierarchy nodes additionally contain:

```text
providerHandle
sessionId
itemId
direction
kind
name
detail
childrenState
children
```

Opaque provider and session identifiers are retained only to address WBA
expansion and release operations. They are not interpreted by Python or the
host.

## Race And Lifecycle Rules

- Every top-level action receives a unique request ID.
- Starting a new top-level action immediately supersedes the old request.
- Only the latest request may replace the retained projection.
- Model version prevents stale editor publication; worker-event project
  generation guards prevent stale cross-project projection.
- Hierarchy expansion updates must match the current request and session.
- Repeated expansion of one loaded node is deduplicated.
- Concurrent expansion of one node shares one in-flight operation.
- Project switch and adapter session reset invalidate active hierarchy sessions.
- Replacing a hierarchy releases the previous session best-effort.
- Browser reload rehydrates only the normalized Python snapshot.
- WBA restart invalidates opaque session identifiers and produces an explicit
  unavailable state rather than silently restarting or falling back.

## Rendering Model

References and implementations use:

```text
file
  line:column preview
  line:column preview
```

Call hierarchy uses:

```text
target symbol  [switch direction]
  first prepared root
    caller
      caller
```

Incoming calls are the default. Only the active direction is displayed; the
header telephone action switches between incoming and outgoing calls. The first
prepared root is always displayed and resolved immediately. Other roots and
descendant calls resolve only when expanded. Loading and failed nodes remain
visible and retryable.

## Accessibility

- Every icon-only action has a textual `title` and `aria-label`.
- The drawer tree uses buttons and tree semantics rather than native OS
  dropdowns or dialogs.
- Expansion state is exposed with `aria-expanded`.
- Loading and error transitions use a polite live region.
- Keyboard activation and navigation remain available on desktop.

## Validation

Implementation validation must include:

- provider registration tests for exact Code OSS method names
- document-selector ordering tests
- references and implementation multi-provider merge/deduplication tests
- call-hierarchy prepare, incoming, outgoing, and release tests
- stale request, model generation, and project generation tests
- Python snapshot replacement and boot rehydration tests
- backend fact and UI IPC projection tests
- drawer loading, empty, error, grouping, expansion, and navigation tests
- touch and desktop context-menu behavior
- Code TE2 TypeScript validation and host bundle build
- Monaco touch-selection package build and publication into Code TE2

Live testing must verify at least one LSP-backed extension and one built-in
language provider.
