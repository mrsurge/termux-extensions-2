# Selected Commit Inline Diff Plan

Branch: `feature/selected-commit-inline-diff`

## Goal

Restore inline commit comparisons against the commit selected in the Explorer,
while fixing related mobile touch, commit selection, and draft navigation bugs.
The branch started from upstream main at `a95cb8e6` (TE2 0.2.346).

## Scope And Sequence

1. **Mobile touch handles during inline diff transitions.** Fix handle geometry
   when switching between plain and inline diff editors, including switching
   back without a page refresh.
2. **Explorer Git commit selector.** External commits must update a HEAD-following
   selector through Git facts, without first opening By changes. Show HEAD and
   the latest commit as one choice; preserve explicitly selected older baselines.
3. **Unified comparison workflow (combines the two remaining items).** Share the
   Explorer comparison selector with the editor and a new status-bar drop-up,
   and correct Drafts navigation as part of the same phase. Investigate existing
   authority and event paths before approving the concrete implementation.

## Unified Comparison Workflow

- Keep one backend-owned, project-scoped comparison selection, shared by the
  Explorer selectors, By changes, and inline commit comparisons. The status-bar
  drop-up mirrors and changes that same selector state, not a separate copy.
- Put the status control at the far left, before extension contributions.
  Show the active filename without its path and the comparison state:
  `file @ HEAD · hash`, `file @ hash`, `file @ disk`, or the filename in plain
  mode. Breadcrumbs already provide the path.
- Highlight historical/non-HEAD selection yellow in both the status control
  and Explorer selectors. Preserve HEAD-following versus pinned-ref semantics.
  Disk mode labels the actual disk comparison rather than suggesting Git data
  is being displayed; the menu can still expose the retained shared Git ref.
- The drop-up combines the existing commit choices with mutually exclusive
  plain, selected-commit, and draft-versus-disk modes. Use existing custom menu
  components, not native browser dropdowns or dialogs.
- Draft-versus-disk turns autosave off. Clicking a Drafts result applies draft
  mode and disk comparison before opening/jumping to that file. Commit and
  draft inline comparison must not both be enabled by this workflow.
- Disk comparison loads no Git baseline/content. Commit comparison loads the
  selected commit as the original and keeps the current editable file as the
  modified model; this is not checkout or historical-file replacement.
- Keep By changes current from Git facts and comparison-selection events, just
  as Drafts stays current. Reopening an overlay must not be required to repair
  its state. No polling or frontend-to-frontend authority shortcuts.
- Fence baseline results against project, file, mode, and selected-ref changes.
  HEAD movement invalidates HEAD comparisons but does not unpin older refs.
  Keep baseline work off the critical file-open completion path.
- Investigate missing historical paths, unborn repositories, cold restoration,
  reconnect, and multiple client surfaces before finalizing error behavior.

The combined control is especially important on mobile: Explorer is hidden when
closed and occupies the screen when open, so comparison state and selection
must also be available while editing.

## Constraints

- Preserve the existing Gboard input, touch dragging, and editor focus behavior.
- Reuse existing state projection, Git baseline services, and surface RPC lanes.
- Keep frontend file opening responsive; baseline loading must not introduce
  unnecessary blocking into the editor open path.
- Publish the touch extension from its editable fork. Do not hand-edit its UMD.
- Treat the parent repository and touch-extension fork as separate commit scopes.
- Android builds, APK seed updates, and release version changes are separate
  publication steps, not implicit requirements for each frontend fix.
- Later items remain pending investigation and detailed user requirements.
- The Explorer selector chooses the comparison baseline for By changes and,
  in the upcoming editor work, inline commit diffs. It is not a checkout command.
  Detached-HEAD workflows and checkout/history navigation are outside this branch.

## Validation

- Touch changes: build/typecheck the touch-extension fork, verify the published
  UMD matches its build output, and obtain live mobile acceptance across diff
  toggles. Inspect wrapped lines, scrolling, and changing gutter geometry when
  relevant to subsequent changes.
- Host/editor changes: run Code TE2 typecheck and frontend build, with focused
  behavioral checks for the affected baseline or navigation contract.
- Selected-commit comparisons: verify the displayed baseline matches the chosen
  commit and current file, including rapid file/commit changes and missing paths.
  Final behavior for exceptional cases is to be determined during investigation.

## Follow-Up: DevTools Through TE2 MCP

Expose native-client DevTools through TE2 MCP for direct, target-specific
debugging rather than relying on volatile console telemetry. Investigate the
existing Cefrium CDP, GeckoView inspector, and Electron integration before
choosing the API and transport. Include target discovery, page/frame/worker
evaluation, runtime exceptions, worker startup/debugger state, and bounded
network/event capture, with explicit capability reporting per renderer.

The transport must preserve target/session identity and protocol routing,
including nested workers, reconnects, cancellation, and clean detach. Inspection
must not silently pause workers or require the native overlay to be open.
Provide explicit debugging actions, not an artificially read-only interface.
Agree on the concrete implementation and security scope after investigation.
This is a backlog item, not authorization to change Android or MCP now; finish
the cold-start inline-diff regression first.

## Source References

- Touch fork: `worktrees/monaco-touch-selection/src/index.ts`.
- Touch deployment: `app/apps/code_te2/static/vendor/monaco-touch-selection/`.
- Editor transitions: `app/apps/code_te2/monaco_editor/editor_editor_lifecycle.ts`.
- Touch initialization: `app/apps/code_te2/monaco_editor/editor_touch_menu_utils.ts`.
- Technical reference: `docs/apps/code_te2/CODE_TE2.md`, section 32.

See `TRACKER.md` for completed work, evidence, and pending decisions.
