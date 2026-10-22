# Isolated PyO3 graph/buffer qualification — 2026-10-21

## Follow-on approved inbound implementation — 2026-10-22

The original qualification below is historical. User approves the framework-pipe
inbound implementation, explicitly noting this carries generated search/Git data.
The source now uses `inbound::read_and_deliver` from the existing pipe reader.
It captures exactly one original frame through a buffered reader while running
the unchanged native decoder. Native values are discarded before attaching Python;
only one bounded bytes object crosses PyO3. No native graph-to-Python traversal is
performed on this path. This still constructs the native validation graph, retains
one raw frame and copies into PyBytes: no zero-copy/allocation/RSS claim.

`native_worker.control_bytes` calls cached typed msgspec decoding and the same
`InboundEnvelopeRouter`. Schema rejections alone run raw decode + old convert to
preserve precise protocol.invalidFrame text (including null vs None wording);
no handler executes twice. Native malformed/key/depth/node/size/marker failures
still stop the stream before Python, and schema-invalid frames still reply then
continue. Correlation, debug/production admission, ordering, response/notification
owners and outbound writes are unchanged. No WBA, frontend socket, queue, GIL,
wire-format or concurrent-dispatch change is included.

New workers require matching Python domain code and explicitly reject a missing/
non-callable control_bytes at import, before startup/reader activation. Old native
workers can still call retained control(object); there is no automatic fallback
from new bytes ingress to an old domain. External framework servers see the same
wire contract. A full matching mypyc snapshot and Rust worker must be prepared
before compiled live adoption; the isolated two-module fixture is not activation.

### Dispatch and typing evidence

- 19 focused Python tests/two subtests pass, including a real mypyc build of
  only native_worker and pipe_codec (not a full domain build).
- Inbound dispatch probe uses the actual production Rust reader/delivery helper,
  actual control_bytes, and the actual router. Interpreted and newly compiled
  modes pass 181 value/error-message parity cases and the same 20 dispatch events.
  Mixed response/progress/notification/request, invalid-schema recovery,
  debug/production admission, corruption and no delivery after handler failure
  are covered. This deliberately avoids starting the domain or a live server.
- Native decoder tests cover exact noncanonical bytes, concatenated frames,
  one-byte reads, guard rejection parity and node-budget rejection.
- Full native worker release-profile tests: 41 pass, including old-domain
  entrypoint rejection. Cargo check --release for code-te2-worker passes.
- Strict/extra/all-Any check passes 247 Code TE2 files; the two changed Python
  production files also pass those flags explicitly. Probe/test helpers pass
  ordinary strict mypy. Native check and tests use the retained Cargo cache.

Native dispatch smoke (standalone command, after building the examples as below):

```bash
"$HOME/.cache/te2/code_te2/build/cargo-target/release/examples/inbound_dispatch_probe"
```

For compiled smoke/measurements, provide an explicit **matching newly built**
overlay through BOUNDARY_PROBE_MYPYC_DIR. Do not assume an older active snapshot
contains the new entrypoint. pytest creates a disposable two-module overlay at
its per-test tmp_path; it does not publish or select it for any live worker.

### Capture-inclusive measurements

The benchmark now includes original-byte capture, an 8 KiB buffered reader on
both incoming paths and the actual production typed decoder. Earlier numbers
below excluded acquisition and must not be quoted as this implementation's gain.
New synthetic search/Git fixtures represent nested generated results, not a
recorded user search. Local CPython 3.14.4/msgspec 0.21.1/release, 11 samples,
scale 3, rotating order; median batch means in microseconds. A standalone final
compiled run used the fresh two-module overlay from
`.codex-scratch/inbound-final-pytest-20261022/test_native_domain_control_buf1`,
not the mutable live selector. No concurrent probe/build was run for this sample;
ordinary system load was uncontrolled. Handler/network/queue time is excluded.

| Fixture (wire bytes) | Incoming graph | Incoming bytes |
|---|---:|---:|
| Control (296) | 17.52 | 10.06 |
| Nested 256 (21,023) | 942.67 | 721.68 |
| Unicode + binary (291,094) | 134.50 | 161.67 |
| Wide 1024 (26,328) | 1,138.65 | 1,157.92 |
| Search 512 (94,067) | 2,102.74 | 1,604.17 |
| Git 512 (29,807) | 1,249.08 | 951.03 |
| Error (276) | 17.80 | 8.90 |

Search/Git conversion is approximately 24% lower in that run; binary is ~20%
slower, wide is roughly unchanged/slightly slower. This trade-off remains visible
before live adoption, not a claim all incoming data is faster. Initial 21-sample
capture runs overlapped briefly and are not the final table above. Outbound buffer
acceptance mismatch remains in the probe, but outbound production stays unchanged.
Seven supported fixture comparisons and ten native malformed inputs pass.

Production source is wired, **not activated**. No shared runtime restart, full
mypyc build, selected-artifact mutation, version bump, commit or publication.

## Original conversion-only qualification

Outcome: do not replace both production directions with serialized buffers.
Incoming object-heavy/control fixtures improve in this probe, but binary-heavy
messages regress; outgoing benefits largely disappear with compiled projection.
Plain msgspec encoding also accepts sets that the existing bridge rejects.
An inbound-only bounded proposal is the next candidate, not an approved cutover.

## Reproduction and scope

Source: `framework/native_editor_worker/examples/boundary_probe.rs` and its
Python helper. Existing Cargo dependencies and production `decode.rs`,
`protocol.rs`, `values.rs` are reused without production edits. Run from repo root:

```bash
env CARGO_TARGET_DIR="$HOME/.cache/te2/code_te2/build/cargo-target" \
  PYO3_PYTHON="$PWD/.jitenv/bin/python" \
  cargo build --release --locked --offline \
  --manifest-path framework/native_editor_worker/Cargo.toml \
  --example boundary_probe -j 2
```

Each smoke/measurement is a standalone command:

```bash
"$HOME/.cache/te2/code_te2/build/cargo-target/release/examples/boundary_probe" 21 5
```

```bash
env BOUNDARY_PROBE_MYPYC_DIR="$PROBE_SNAPSHOT" \
  "$HOME/.cache/te2/code_te2/build/cargo-target/release/examples/boundary_probe" 21 5
```

PROBE_SNAPSHOT must name an explicit matching overlay. The optional overlay changes imports only inside this isolated process;
it does not build/activate a snapshot or change a live worker. Scope records print
the actual imported module, Python/msgspec versions and selected overlay. Read
that path: the mutable local selector can identify a different snapshot next run.
Python uses the existing inventory audit/isolation helper and disposable roots
under `$TMPDIR` or `.codex-scratch`; no sockets, handlers or live state are used.
Import-time Python messages go to stderr; stdout contains JSONL probe records.

Production graph baselines call the actual `_struct_values`, `decode_envelope`
and native converters. Helper imports are outside timed loops. Candidate inbound
retains the full native decoder, discards its value, copies bytes to Python and
uses typed msgspec decode/validation. Candidate outbound msgspec-encodes, then
native-decodes/validates and copies bytes into an owned Rust buffer. No zero-copy
or elimination of native parse/allocation is claimed. Both retain applicable
frame/depth/node/key/marker guards rather than treating msgspec as equivalent.

The interpreter is attached once. Timings include conversion, validation and
copies, but **exclude** interpreter attachment per call, production dispatch,
queue waits, IPC, network and application handlers. No allocation counts, RSS or
end-to-end latency measurements were made. This is an intentionally conservative
conversion microbenchmark, not a throughput or application responsiveness result.

## Measurements

Local Linux x86_64, release profile, CPython 3.14.4, msgspec 0.21.1; 21 samples,
three warmups per mode, rotating mode order. Control/error batches use 1000/500
iterations; nested/binary/wide use 50/50/25. Values below are median batch means
in microseconds per operation. JSONL also reports p95 **batch means**, not
per-message p95 latency. No fixed speedup promise follows from these samples.

Compiled run loaded native_worker from snapshot
`domain-e70cddcbb86dbae3b5dca1c96ce724df90aab44301191f5b8eed6d74552ba2c6`.
This verifies actual compiled projection execution, not freshness of every module
in that user-selected snapshot or activation in the live worker.

| Fixture (wire bytes) | In graph | In buffer | Out graph | Out buffer |
|---|---:|---:|---:|---:|
| Control (296) | 12.03 | 6.63 | 7.11 | 7.20 |
| Nested 256 (21,023) | 632.37 | 447.35 | 303.00 | 307.74 |
| Unicode + binary (291,094) | 95.36 | 100.39 | 44.44 | 72.13 |
| Wide 1024 (26,328) | 832.00 | 771.91 | 461.78 | 477.19 |
| Error (276) | 12.24 | 6.68 | 7.46 | 7.39 |

Interpreted projection from the current native_worker.py:

| Fixture | In graph | In buffer | Out graph | Out buffer |
|---|---:|---:|---:|---:|
| Control | 12.06 | 6.90 | 9.51 | 7.59 |
| Nested 256 | 639.15 | 454.30 | 307.76 | 310.59 |
| Unicode + binary | 98.50 | 102.67 | 37.52 | 74.39 |
| Wide 1024 | 834.94 | 784.14 | 466.48 | 480.65 |
| Error | 12.25 | 6.66 | 10.23 | 7.46 |

These corrected runs supersede the exploratory measurements whose Python helpers
repeated imports inside timed calls. Incoming control/nested conversion improves
approximately 45%/29% with the compiled projection; outgoing nested/wide regress
slightly and binary regresses substantially. Do not average unlike workloads into
one headline result or infer compilation-time effects.

## Parity and limits

Five valid fixtures pass inbound Struct equality and outbound decoded-value
equality in both runtime modes, including Unicode, binary, null/bool/integer and
nested error details. Ten malformed inputs reject on both paths: reserved marker,
truncated map, extension marker, non-string key, duplicate key, huge declared
binary length, excessive depth, wrong kind type, trailing frame and invalid UTF-8.

Acceptance probes deliberately report a blocker: Python sets reject under the
current recursive converter but encode as arrays under plain msgspec. Datetimes
reject on both paths, but at different validation stages with different errors.
Thus supported fixture parity is not complete behavioral/failure-order parity.
The known set mismatch is asserted/reported, not hidden by successful exit; exit
zero means the probe reproduced its expected results, not production eligibility.
No unbounded/custom-object acceptance is approved by these tests.

Next: propose an inbound-only buffer seam preserving exact decoder/schema/error
contracts and lifecycle/ordering, then test actual dispatch and workload effects
before deciding whether to adopt. Outbound stays unchanged unless a separately
measured typed seam wins without broadening accepted values. Afterwards, the
planned targeted mypyc-native-type pass examines obvious reusable-record/numeric/
lookup wins; it is not a blanket elimination of PyObjects.

No production buffer path was part of this initial qualification; the separately
approved follow-on source implementation/status is recorded at the top.
