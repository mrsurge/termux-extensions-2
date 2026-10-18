# Shared terminal projection

`screen_projection.py` contains the existing Pyte screen/checkpoint/delta algorithm,
not shell launch, input, sockets, project state or tab ownership. The parser in
`pyte_parser.py` stays demand-loaded on first projection use.

Checkpoints restore a curated terminal mode set as well as screen cells: mouse
protocol/encoding, bracketed paste, application cursor keys, alternate-buffer
selection and origin/scroll region. Disable stale mouse modes before enabling
selected modes: xterm shares protocol state and an unrelated later reset can
disable the restored protocol. This is parsed-state reconstruction, not arbitrary
escape-sequence replay. Alternate-screen checkpoints omit normal scrollback.

`terminal_cursor.ts` repairs xterm DOM block cursor precedence after rendering:
remove inline cell foreground/background from cursor spans so xterm's generated
theme/OSC cursor rules remain visible on RGB application backgrounds. It owns no
input, resizing, shell state or inactive cursor styling.

`terminal_shift.ts` handles printable mobile IME Shift text without altering
escape/control sequences. `terminal_shift_button.ts` owns pointer/long-press
timing only: each app retains its own modifier/session state. Single-tap arms
Shift, double-tap or 500ms hold locks it; tapping a locked key releases it.
Lifecycle transitions cancel pending holds. Code TE2 drawer Sel is a sticky
Shift modifier forwarded to the terminal app (including navigation keys), not
a local-buffer selection interception; the application owns selection behavior.

Mobile drag scrolling uses the byte-identical app-owned
`vendor/android-terminalapp-assets-js/touch_to_mouse_handler.js` copies in
Code TE2 and Terminal. File Explorer loads the Code TE2 static helper as a UI
dependency, not its backend/shell machinery. Touch distance gain is 1.0 (formerly
0.4): 2.5 times the prior pixel wheel input for the same drag. Xterm retains
wheel-to-line conversion and TUI mouse reporting; native wheel input, selection
edge-scroll's one-row step and terminal scroll options are unchanged. This gain
does not itself imply a fixed one-line-per-touch-event guarantee.

Flick release is separately velocity-gated: at least 24 CSS pixels within the
recent 80 ms sampling window, speed at least 0.35 px/ms, and release no more than
80 ms after the last movement. Slow/short scrubs and drag→pause→lift do not coast;
direction reversal resets history. Accepted release speed controls a continuous
page-scaled travel curve: `min(4.5, 0.75 * speed²)` pages, where speed is CSS
px/ms and a page is the measured visible terminal height. Reference regular
speed 1 px/ms coasts about 0.75 page; strong 2.5 px/ms reaches about 4.5 pages,
subject to content bounds and application-owned wheel interpretation.
Analytically integrated exponential decay (280 ms time constant) is frame-rate
independent; stop when remaining travel/pending output are subpixel or after
2.2 s. Sampling,
release and animation integration all use `performance.now()`. The rAF callback
timestamp is frame-start time and may precede the release handler; mixing it
with release-time samples can wrongly cancel an otherwise valid flick.
Each wheel pulse
is at most one measured row; xterm still owns scrollback/TUI interpretation.

New touch, selection/handle interaction, resize, blur/pagehide/visibility change,
detached/zero-sized surface, disposal, helper deactivation and changed buffer/mouse
or application-cursor mode stop inertia. Normal scrollback stops at known bounds;
no bounce is synthesized. Reduced motion disables fling. A frame delay above
64 ms cancels instead of producing a catch-up burst. At most 16 one-row wheel
pulses are emitted per frame; residual distance is retained within the bounded
throw, not discarded or treated as a failed strong fling. Public attachment
`cancelGesture()` also fences owner socket/session/checkpoint handoffs: the drawer,
standalone and File Explorer call it without changing backend/session authority.
No general-purpose physics dependency is introduced. New bytes require native client asset
publication/reload; worker/mypyc changes are unnecessary.

Each `TerminalScreenProjectionRegistry` requires a `log_opener` that returns a
context-managed `LogReader`. That application-owned boundary supplies file identity,
captured size and bounded byte reads. Readers are closed before return; failures
propagate, with no filesystem/native fallback selected by the shared core. Registry
state, capacity and locks are instance-local; identical shell IDs in different
registries do not share state or readers.

Code TE2's `terminal_screen_projection.py` is the thin native-log adapter and owns
its existing singleton. Its native bridge configuration remains in Code TE2's
`terminal_log_io.py`. File Explorer's ordinary Python worker owns a separate
Node PTY worker/pipe adapter and supplies its app-owned `terminal_projection.py`
log opener to an independent registry, bounded at an acknowledged byte offset.
It does not borrow Code TE2's embedded native manager or another app's shellspec.
See `app/apps/file_explorer/TERMINAL.md` for its control/output/lifetime contract.

The interpreted test reader remains in Code TE2's adapter, not this shared core.
For an isolated compiled proof (no activation or process restart):

```bash
python -B scripts/probe_terminal_projection_mypyc.py \
  --output "${TMPDIR:-.codex-scratch}/shared-terminal-projection-proof"
```

Choose a fresh output directory. The proof compiles the core/parser/native-log
adapter together and exercises shared-reader isolation plus the retained checkpoint
regressions. It is not a full worker-domain build or a release artifact.
