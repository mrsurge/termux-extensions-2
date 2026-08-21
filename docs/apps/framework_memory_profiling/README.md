# TE2 Framework Memory Profiling

TE2 memory investigations must begin with process attribution. The framework
bootstrap owns a tree containing the Rust server, Python runtime bridge and app
workers, WBA, Code Server, the extension host, language servers, and other app
processes. A large Termux UID total is not evidence that the Rust heap is large.

## Controlled desktop launch

Install Heaptrack with the host package manager before a profiling run. TE2 does
not install it as an application dependency.

```bash
te2 --memory-profile "$HOME/.cache/te2-memory-profile"
```

This explicit mode:

- builds optimized Rust with symbols through Cargo profile `memory`;
- runs only `te2-server` under Heaptrack;
- starts Python allocation tracing at interpreter startup;
- gives the runtime bridge and generic app workers an explicit `SIGUSR2`
  snapshot hook;
- gives inherited Node processes V8 `SIGUSR2` heap snapshots and one shared
  diagnostic output directory.

It does not replace the production allocator with jemalloc. Electron is a
separate process tree and is not included unless it is profiled independently
through Chromium DevTools/CDP.

Do not start this mode beside a framework using the same ports and runtime
roots. In an agent-hosted session, do not stop the shared framework merely to
start profiling; use a separate session or obtain explicit restart approval.

## Process-tree samples

Record proportional set size, resident memory, anonymous memory, private pages,
and swap for the bootstrap and all current descendants:

```bash
python framework/tools/te2_memory_profile.py sample \
  --root-pid BOOTSTRAP_PID \
  --output "$HOME/.cache/te2-memory-profile/process-tree.jsonl" \
  --interval 1
```

The sampler reads `/proc/*/smaps_rollup`; it does not require `psutil`. Each
sample includes process start ticks so PID reuse can be distinguished. Keep
process roles separate when comparing totals: extension-host or language-server
growth must not be attributed to `te2-server`.

## Managed heap snapshots

Request snapshots only from exact Python or Node PIDs reported by the sampler:

```bash
python framework/tools/te2_memory_profile.py snapshot PID [PID ...]
```

The command verifies the target process inherited the corresponding opt-in
profiling environment before sending `SIGUSR2`; it refuses ordinary Python or
Node processes because an unhandled signal could terminate them.

Python writes both a loadable `.tracemalloc` snapshot and a JSON summary with
traced current/peak bytes, `/proc` memory, GC counts, the most common tracked
types, and the top allocation tracebacks. Node writes `.heapsnapshot` files that
can be loaded into Chromium DevTools. WBA also retains its existing explicit
`adapter.heapSnapshot` method; the signal path is useful because it applies to
Code Server, the extension host, and inherited language servers as well.

Heap snapshots are intentionally explicit: producing one temporarily increases
memory and can be unsafe on an already memory-starved Android host.

Compare two Python snapshots without importing the profiled process:

```bash
python framework/tools/te2_memory_profile.py compare-python \
  BEFORE.tracemalloc AFTER.tracemalloc --limit 50
```

## Workload shape

Capture process and managed-heap baselines, repeat the same workload several
times, then capture again:

1. framework idle;
2. Code TE2 open with WBA and Code Server ready;
3. project and representative documents opened;
4. repeated file/project switches, searches, extension views, and run profiles;
5. surfaces and app workers closed where the product contract permits;
6. a second and third identical workload cycle.

Judge the result by whether retained memory plateaus across identical cycles.
RSS is not expected to return to its initial value because Python, glibc, V8,
and Rust's platform allocator may retain arenas. Compare process PSS delta,
managed-heap delta, and unexplained native delta before choosing a fix or a
different allocator.

## Console transcript

The TE2 console transcript remains complete for the framework session. Drawer
replay and `tail` walk it newest-first in bounded chunks, while search walks the
complete history as a stream. `tail_lines: 0` requests worker inventory without
replaying log entries. Console telemetry uses volatile Socket.IO delivery so a
transport interruption cannot build a replay queue in the browser bridge.
