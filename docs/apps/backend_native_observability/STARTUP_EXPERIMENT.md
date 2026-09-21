# Python Startup Comparison

## Protocol

Four requested configurations, keeping the same checkout, project/file, frontend,
extensions, WBA runtime and `--runtime-debug` setting. The user performs restarts;
the agent inspects and records, without restarting the shared framework.
Record whether worker/code-server/WBA processes are fresh, and verify the actual
Python runtime after backend imports, not merely the requested environment flags.
Do not change implementation between captures. One run per configuration is
exploratory evidence, not a controlled benchmark or statistical performance claim.
OS/Node compile caches, thermal state and CPU load are not reset or controlled.

| Run | Requested interpreter/configuration | Observed state | Result |
| --- | --- | --- | --- |
| A | Standard Python, defaults | CPython 3.14.6, GIL on, JIT unavailable/off | Captured below |
| B | Standard Python, JIT on | Pending; A's binary cannot provide JIT | Pending |
| C | Free-threaded Python, GIL off | Pending verification | Pending |
| D | Free-threaded Python, GIL off and JIT on | CPython 3.14.6 free-threading, GIL off, JIT unavailable/off | Captured; reduced sidebar workload |
| E | GIL on, similar settings after user warm-up | Standard Termux CPython 3.14.6, GIL on, JIT unavailable/off | Captured below; not the free-threaded binary with GIL enabled |
| F | Free-threaded Python, GIL on | Same free-threaded build as D, actual GIL on, JIT unavailable/off | Captured; matched interpreter comparison with D |

For JIT/GIL, collect `sys.executable`, `sys.version`, `sys._xoptions`,
`sysconfig.get_config_var("Py_GIL_DISABLED")`, `sys._is_gil_enabled()`, and
`sys._jit.is_available()/is_enabled()` where available, plus `PYTHON_GIL` and
`PYTHON_JIT`. An unavailable API is unknown, not proof of enablement. A requested
JIT-on run on a binary reporting JIT unavailable must not be labeled a JIT result.

## Historical Baselines

These are separate earlier captures from TRACKER.md, not matched controls for the
new four-run series. Nested durations must not be added to parent durations.

| Capture | Measurement | Seconds |
| --- | --- | ---: |
| 2026-09-16, warm worker/page refresh | Complete backend intelligence preparation | 16.008 |
| Same capture | code-server ensure | 5.358 |
| Same capture, sequentially afterward | WBA ensure | 10.646 |
| 2026-09-16, cold Python worker, PID 7312 | Backend import duration | 1.633 |
| Same capture | Serving-hook completion from worker main entry | 2.144 |
| Later live import baseline, PID 23846 | FastAPI import duration | 1.129 |
| Same capture | Backend import duration | 2.139 |
| Same capture | Listener ready from module entry | 4.376 |
| Same capture | Serving-hook completion from module entry | 4.538 |

The PID 7312 clock excluded interpreter/common imports before worker main. It is
not directly interchangeable with the later module-entry clock.

User-recalled earlier visible behavior: approximately **20 seconds until WBA and
grammars loaded**, followed by **another 5-10 seconds** before semantic tokens and
diagnostics appeared (approximately 25-30 seconds total). These are user-observed
estimates with no matching timestamped browser trace, not backend span measurements.

## Run A: Standard Python Defaults

Captured after the user's 2026-09-20 restart. Source baseline is HEAD `5f5b7c15`
plus the uncommitted compact-state and overlapped-bootstrap slices. No code was
changed for this measurement. Only this document, tracker and selected timing
artifacts were added during capture.

- Worker: `frs_1789954303632_17151_1_1`, PID `17267`.
- Worker instance: `aa10e10c934f69fd1442d86fa88c5124`.
- Fresh code-server: `fs_1789954308_3c639414`, PID `17336`.
- Fresh WBA: `fs_1789954309_93a408e6`, PID `17360`.
- Project: `/data/data/com.termux/files/home/mrselect6`.
- Frontend present: Cefrium main-page console worker. Initial file/first paint and
  first provider-result timestamps were not captured.
- Worker executable: `/data/data/com.termux/files/usr/bin/python3`.
- Version: `3.14.6 (main, Jul 5 2026, 10:35:55)`, Clang 21.0.0.
- `Py_GIL_DISABLED=0`, actual GIL enabled; `sys._xoptions={}`.
- `PYTHON_GIL` and `PYTHON_JIT` unset; JIT available=false, enabled=false.
- `TE2_RUNTIME_DEBUG=1`; explicit WBA runtime override unset.
- Actual WBA executable: `/data/data/com.termux/files/home/.bun/bin/bun`.
- Final inspected adapter state: ready for the project, no adapter error.

| Milestone | Seconds from worker module entry | Span duration, if measured |
| --- | ---: | ---: |
| Early intelligence preparation scheduled | 0.417 | |
| Backend import starts | 0.432 | |
| Backend import completes | 3.231 | 2.799 s |
| Backend assembly completes | 3.232 | |
| Application attachment released | 3.416 | |
| HTTP listener ready | 3.549 | |
| Serving hook completes | 3.747 | 0.096 s |
| First code-server spawn/adoption callback | 4.838 | |
| WBA process prepared (stdio responsive) | 6.523 | |
| First code-server startup complete | 8.133 | |
| WBA connection completes | 13.301 | 5.167 s |
| First intelligence orchestration completes | 13.324 | 12.904 s |
| Second orchestration caller completes | 14.497 | 9.715 s |

Worker-clock milestones use its `sinceEntryMs`; cross-component milestones use
`unixMs` minus the inferred module-entry epoch `1789954303727.509 ms`, rounded to
milliseconds. Each StartupTrace instance has its own `sinceEntryMs` origin: never
compare those directly across appIds/spans. Timestamp-derived offsets have ordinary
wall-clock/rounding limitations; span durations use their recorded elapsed values.

Two orchestration callers appear, with one observed code-server shell and one WBA
shell. The first starts at `1789954304148 ms`, the second at `1789954308510 ms`.
This is not evidence of two process spawns. The first WBA dependency wait lasts
1.611 s. Preparation begins before backend import, but actual code-server spawn
and WBA process readiness occur after assembly in this run. Do not describe this
capture as native process initialization overlapping backend import.

WBA connected is not equivalent to TextMate loaded, first semantic tokens, first
diagnostics, or browser paint. Those visible milestones are **not measured** here;
the old 20 + 5-10 second observation cannot be subtracted from this WBA timestamp
to produce a claimed end-to-end improvement.

Evidence: `startup_captures/standard-default-worker.jsonl` and
`startup_captures/standard-default-wba.jsonl`, extracted only from structured
`[startup_timing]` records. Full runtime logs remain under
`~/.cache/te2/framework_shells/runtimes/b4f2d44683b344a8/d6075279a24122e4/logs/`.
Worker reflection supplied interpreter state and exact shell metadata. Standalone
`fws` used a different store and reported no shell; do not interpret that as the
worker being absent.

## Run D: Free-Threaded, JIT Requested But Unavailable

Captured next, before a separate run C. Same editable checkout and project as A.
**Workload differs:** the user closed all sidebar items before this run. Cache
warmth, thermal conditions and background CPU load remain uncontrolled. Compiler
and build provenance also differ. Do not attribute the measured differences to
GIL removal alone. No runtime source edits or agent-initiated restarts occurred.

- Worker: `frs_1789955123835_24011_7_7`, PID `25957`.
- Instance: `4d61d7139ae36cc9a17d666cec26be3c`.
- Fresh code-server: `fs_1789955127_b97391bb`, PID `25998`.
- Fresh WBA: `fs_1789955130_528c734b`, PID `26061`.
- Interpreter: `/data/data/com.termux/files/home/mrselect6/.314t/bin/python3`.
- Version: `3.14.6 free-threading build (heads/main-dirty:64e1b782,
  Jun 12 2026, 21:45:34) [Clang 21.1.8 ]`.
- Actual `Py_GIL_DISABLED=1`, `sys._is_gil_enabled()=false` after backend imports.
- `PYTHON_GIL=0`, `PYTHON_JIT=1`, `sys._xoptions={}`.
- Actual JIT available=false and enabled=false. This is **GIL off, JIT off**,
  not evidence for JIT performance and not a fulfilled JIT-enabled configuration.
- `TE2_RUNTIME_DEBUG=1`, WBA runtime override unset; actual WBA uses the same
  `/data/data/com.termux/files/home/.bun/bin/bun` executable as A.
- Adapter ready, no error, project `/data/data/com.termux/files/home/mrselect6`.

Module-entry epoch inferred as `1789955124127.633 ms`. Preparation scheduled at
1.145 s; import began at 1.156 s and assembly completed at 2.487 s. Code-server's
first spawn callback was at 3.645 s. WBA was prepared at 7.092 s, after code-server
readiness at 6.398 s, so its dependency wait was only 0.091 ms. The code-server to
WBA-prepared interval was longer than A, despite several earlier milestones.
There are again two orchestration callers but one observed process for each shell;
first orchestration completes at 11.602 s and the second at 12.574 s.

### Observed Comparison

Milestones are seconds from worker module entry unless labeled as durations.
For each worker's listener, use recorded `sinceEntryMs`; cross-component offsets
use the inferred epoch, as for A. Differences below are D minus A, rounded.

| Measurement | A: standard/default | D: free-threaded, JIT unavailable | Difference |
| --- | ---: | ---: | ---: |
| Backend import duration | 2.799 | 1.328 | -1.471 |
| HTTP listener ready | 3.549 | 2.858 | -0.690 |
| First code-server startup complete | 8.133 | 6.398 | -1.735 |
| WBA process prepared | 6.523 | 7.092 | +0.569 |
| WBA connect duration | 5.167 | 4.502 | -0.665 |
| WBA connect complete | 13.301 | 11.595 | -1.706 |
| First document open begins in WBA | 13.891 | 11.780 | -2.111 |
| First semantic-token provider event | 19.183 | 17.796 | -1.387 |
| Python language activation completes | 19.223 | 17.824 | -1.399 |
| First diagnostics/changeMany event | 23.846 | 22.696 | -1.150 |

The provider/diagnostics milestones above were recovered by closer inspection of
the WBA traces for **both** runs, including A's already-preserved artifact. Source
`workbench-client.ts::_handleWorkbenchEvent` marks the first `provider/*` and
`diagnostics/changeMany` event; `provider-registry.ts` emits the semantic-token
provider registration. This is **provider availability, not computed semantic
tokens or browser rendering**. The first diagnostics event is not necessarily
nonempty and does not prove the selected file's diagnostics appeared. Python
activation completion is the resolved onLanguage activation call. Grammar-loaded
and visible-first-result times are still not measured.

Not all intervals improved: language activation took about 5.30 s in A versus
6.03 s in D; WBA connect to first diagnostics event was about 10.54 s versus
11.10 s. The picture is earlier overall arrival at several milestones, not a
uniform acceleration of the entire intelligence pipeline.

Evidence: `startup_captures/free-threaded-jit-requested-worker.jsonl` and
`startup_captures/free-threaded-jit-requested-wba.jsonl`. Full logs use the same
configured runtime log directory documented for A, with the shell IDs above.

## Run E: Standard Python, GIL On After Warm-Up

The user reports similar settings to the preceding run, after a warm-up. This is
an additional comparison, not a controlled cache reset. Reflection confirms the
standard Termux interpreter, **not** the free-threaded interpreter with its GIL
re-enabled. Build/compiler differences therefore remain confounded with GIL mode.
The sidebar workload was not independently captured. No runtime source edits or
agent-initiated restarts were made for this capture.

- Worker: `frs_1789958210682_16484_3_3`, PID `17861`.
- Instance: `7620cc9dd0d6fd79c0b0b93396b73aa5`.
- Fresh code-server: `fs_1789958216_e34485b7`, PID `17906`.
- Fresh WBA: `fs_1789958217_eec00bc4`, PID `17924`.
- Interpreter: `/data/data/com.termux/files/usr/bin/python3`, version
  `3.14.6 (main, Jul 5 2026, 10:35:55)`, Clang 21.0.0, as in A.
- `Py_GIL_DISABLED=0`, actual GIL enabled after backend imports;
  `PYTHON_GIL` unset. The enabled GIL is verified, not inferred from a flag.
- `PYTHON_JIT=1`, `sys._xoptions={"jit": true}`, but actual JIT available=false
  and enabled=false. Like D, this does not constitute a JIT-enabled measurement.
- `TE2_RUNTIME_DEBUG=1`; actual WBA executable remains
  `/data/data/com.termux/files/home/.bun/bin/bun`.
- Adapter ready with no error, project `/data/data/com.termux/files/home/mrselect6`.

Inferred module-entry epoch: `1789958210848.689 ms`. Early preparation was
scheduled at 0.400 s; backend import began at 0.413 s and ended at 2.876 s.
The first code-server spawn callback occurred at 5.981 s. Both intelligence
shells were created after this worker, so this was not warm-shell adoption even
though the user warmed the workload/caches beforehand. Two orchestration callers
completed at 11.730 and 12.657 s with one observed shell of each kind.

| Measurement | D: free-threaded, GIL off | E: standard, GIL on, warmed | E minus D |
| --- | ---: | ---: | ---: |
| Backend import duration | 1.328 | 2.463 | +1.135 |
| HTTP listener ready | 2.858 | 3.071 | +0.213 |
| First code-server startup complete | 6.398 | 7.692 | +1.294 |
| WBA process prepared | 7.092 | 7.312 | +0.220 |
| WBA connect duration | 4.502 | 4.013 | -0.489 |
| WBA connect complete | 11.595 | 11.706 | +0.111 |
| First document open begins in WBA | 11.780 | 12.054 | +0.274 |
| First semantic-token provider event | 17.796 | 16.371 | -1.425 |
| Python language activation completes | 17.824 | 16.385 | -1.439 |
| First diagnostics/changeMany event | 22.696 | 18.870 | -3.826 |

Times are seconds from worker module entry except rows explicitly labeled
duration, using the same clock rules as A/D. WBA connection arrival is nearly
unchanged, despite slower backend import and later code-server readiness. Python
activation took about 4.31 s versus 6.03 s in D; WBA connection to the first
diagnostics event took 7.16 s versus 11.10 s. Those later spans include external
WBA/extension-host work and cannot be attributed to Python GIL behavior alone.
Relative to original standard run A, E reaches WBA connection 1.595 s earlier and
the first diagnostics event 4.976 s earlier, also illustrating run variability.

Provider registration and the first diagnostics event are still not proof of
computed tokens, nonempty diagnostics, grammar loading, or browser paint. These
single captures do not establish a preferred interpreter or a GIL speedup.

Evidence: `startup_captures/standard-gil-on-warmed-worker.jsonl` (32 records) and
`startup_captures/standard-gil-on-warmed-wba.jsonl` (48 records), extracted from
the configured shell stderr logs. Runtime reflection supplied interpreter state,
shell creation metadata and actual WBA command.

## Run F: Free-Threaded Build With GIL Enabled

The user performed another run specifically to compare GIL modes within the same
free-threaded interpreter. This is a new run, not a correction to E's verified
standard-interpreter provenance. Reflection confirms the same executable and build
identity as D. Cache warmth, workload and thermal/load conditions are still not
controlled, so this is a matched-build observation rather than a repeated benchmark.

- Worker: `frs_1789958611083_20248_2_2`, PID `20503`.
- Instance: `d9a37bab3b71e1f46bf6c1304ef343c4`.
- Fresh code-server: `fs_1789958616_ff688bc8`, PID `20540`.
- Fresh WBA: `fs_1789958618_69503dbb`, PID `20558`.
- Interpreter: `/data/data/com.termux/files/home/mrselect6/.314t/bin/python3`.
- Version: `3.14.6 free-threading build (heads/main-dirty:64e1b782,
  Jun 12 2026, 21:45:34) [Clang 21.1.8 ]`, matching D.
- `Py_GIL_DISABLED=1`, `PYTHON_GIL=1`, actual GIL enabled after backend imports.
- `PYTHON_JIT=1`, `sys._xoptions={"jit": true}`; actual JIT available=false,
  enabled=false. Both D and F therefore ran without JIT, despite requested flags.
- `TE2_RUNTIME_DEBUG=1`; WBA command uses `/data/data/com.termux/files/home/.bun/bin/bun`.
- Adapter ready without error for `/data/data/com.termux/files/home/mrselect6`.

Inferred module-entry epoch: `1789958611227.894 ms`. Preparation scheduled at
0.325 s, backend import started at 0.342 s and ended at 2.188 s. First code-server
spawn callback occurred at 5.846 s. Shell creation metadata confirms fresh
code-server/WBA processes, not adoption of previously running shells. Two
orchestration callers completed at 13.229 and 14.292 s.

| Measurement | D: free-threaded, GIL off | F: same build, GIL on | F minus D |
| --- | ---: | ---: | ---: |
| Backend import duration | 1.328 | 1.846 | +0.518 |
| HTTP listener ready | 2.858 | 2.413 | -0.446 |
| First code-server startup complete | 6.398 | 8.564 | +2.166 |
| WBA process prepared | 7.092 | 8.607 | +1.515 |
| WBA connect duration | 4.502 | 4.601 | +0.099 |
| WBA connect complete | 11.595 | 13.210 | +1.615 |
| First document open begins in WBA | 11.780 | 13.392 | +1.612 |
| First semantic-token provider event | 17.796 | 18.096 | +0.300 |
| Python language activation completes | 17.824 | 18.120 | +0.296 |
| First diagnostics/changeMany event | 22.696 | 21.976 | -0.720 |

Times use the same definitions as the previous tables; differences are calculated
before rounding. The listener arrived earlier with GIL enabled despite a longer
backend import, because the import itself started earlier. WBA connect duration
was similar; most of its later overall arrival preceded the connect span. Language
activation took about 4.70 s versus 6.03 s in D, and connect-to-first-diagnostics
took 8.77 s versus 11.10 s. These mixed results do not show a uniform GIL-on or
GIL-off advantage. External process/extension work and uncontrolled run conditions
remain relevant. Provider availability and first diagnostics event are not browser
paint, computed-token or nonempty-diagnostics measurements.

Evidence: `startup_captures/free-threaded-gil-on-worker.jsonl` (32 records) and
`startup_captures/free-threaded-gil-on-wba.jsonl` (50 records). Interpreter state,
shell metadata and actual WBA command were read through worker reflection. No
runtime implementation changes or agent-initiated restarts were made.
