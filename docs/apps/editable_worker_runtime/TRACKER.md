# Editable worker runtime tracker

- [x] Read-only source investigation and implementation approval.
- [x] Preserve worker build variants and reuse equivalent interpreter aliases.
- [x] Fresh editable missing-mypyc interpreted-domain selection.
- [x] Preserve explicit/broken selections and strict release payload contract.
- [x] README source-build and mypyc workflow documentation.
- [x] Targeted bootstrap/build regression validation: 28 tests pass.
- [ ] User CLI ↔ TE2 Termux editable launch acceptance.
- [ ] Fresh editable interpreted-domain live acceptance.

## Evidence boundaries

The worker-only fingerprint/pruning interaction is source-confirmed. The exact
compiler/interpreter difference in the reported device launches is not confirmed.
The attached Motorola's read-only default cache lookup found no worker binaries;
no device state was changed and no process restarted. Local validation does not
constitute device acceptance. Existing unrelated repository changes are retained.

Validation: `python -B -m pytest -q
--basetemp=.codex-scratch/pytest-editable-worker
tests/test_native_worker_bootstrap.py tests/test_code_te2_local_mypyc_build.py
tests/test_framework_bootstrap_discovery.py` — 28 passed. The initial run exposed
two fixture assumptions about inherited worker environment variables; fixtures
now isolate the selectors from the actively running development environment.
No Rust or mypyc build, client publication, device mutation or runtime restart
was performed. Cache schema changes cause one new native worker publication on
next source startup; later equivalent launches reuse it. Existing fingerprints
are retained rather than automatically deleted.
