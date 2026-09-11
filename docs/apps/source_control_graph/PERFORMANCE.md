# History Read Performance

## Reproduction

The ignored `history_read_interference_benchmark` Rust test is read-only. It
requires an explicit repository and a file present in HEAD:

```sh
TE2_HISTORY_BENCH_ROOT="$PWD" TE2_HISTORY_BENCH_PATH=README.md cargo test --manifest-path framework/rust/Cargo.toml -p te2-server history_read_interference_benchmark -- --ignored --nocapture
```

It uses the real scheduler, watched History session, first 100-commit page and
40-file statistics pages. Baseline reads are 40 sequential `git_head_blob`
requests before, during and after background work. Background work is bounded
to 100 file pages and stops after the current page once baseline sampling ends.
The output includes its elapsed duration and page count; it is not an unbounded
soak or a production trace. A ref change invalidates the measurement explicitly.

This measures native scheduling and Git work, not Python/socket/browser/Monaco
open latency. OS caches are not cleared; the first baseline request in a new
test process can include startup/cache costs. The JSON scope label refers to
cache warming by the before phase, not a guarantee that every read is cached.

## Termux Evidence

Measured at HEAD `9d5b75fe806a85759f5c5be65a6dd7c4dfcf1996`, against this
checkout's README.md, with 1,291 commits reachable across refs (1,077 from HEAD).
Build profile: unoptimized Rust tests with debug info; two Tokio worker threads.
No shared framework restart or client reload occurred.

All values below are milliseconds. Each baseline column is median / p95 / max.

| Run | History open | First 100 | Before | Concurrent | After | Background pages / time |
| --- | ---: | ---: | --- | --- | --- | --- |
| 1 | 53.60 | 95.03 | 2.94 / 7.03 / 109.45 | 3.66 / 8.60 / 16.32 | 3.01 / 5.80 / 10.28 | 1 / 250.90 |
| 2 | 51.50 | 80.50 | 2.19 / 8.62 / 100.83 | 7.05 / 20.61 / 31.07 | 10.21 / 20.09 / 23.51 | 4 / 377.67 |
| 3 | 54.46 | 34.09 | 3.53 / 22.72 / 105.05 | 9.78 / 22.48 / 48.68 | 8.45 / 15.46 / 23.66 | 9 / 497.80 |

Concurrent sampling windows in runs 2 and 3 were 328.55 and 482.33 ms; background
work remained active through those windows. Run 1 predates that output field.
The before-phase maximum is retained, not discarded as an outlier.

These samples show no seconds-long native baseline stall. They do show timing
variability, including slower after-phase controls; they cannot attribute all
differences to History, establish a device-wide latency guarantee, or validate
the future UI. Full primary-open latency and mounted graph acceptance remain.

The ordinary capacity regression separately fills all four History slots and
requires a scheduler baseline read to succeed before a three-second test guard.
That is a deadlock/admission-isolation assertion, not a performance target.
