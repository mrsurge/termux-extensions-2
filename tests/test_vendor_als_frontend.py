from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from scripts import vendor_als_frontend as vendor


class AlsFrontendVendorTest(unittest.TestCase):
    source: Path
    destination: Path

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="te2-als-vendor-")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.source, self.destination = root / "source", root / "snapshot"
        self.source.mkdir()
        (self.source / "pyproject.toml").write_text('[project]\nversion = "0.2.139"\n')
        (self.source / "LICENSE").write_text("Fixture license\n")
        for name in vendor.REQUIRED:
            path = self.source / vendor.STATIC_PATH / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("Fixture resource\n")
        for relative in vendor.ADDITIONAL_RESOURCES.values():
            path = self.source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('export function renderRequestCard() { return true; }\n')
        self.git("init", "--quiet")
        self.git("add", ".")
        self.git("-c", "user.name=TE2 Fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "--quiet", "-m", "fixture")

    def git(self, *arguments: str) -> None:
        subprocess.run(["git", "-C", str(self.source), *arguments], check=True,
                       capture_output=True, text=True)

    def test_snapshot_pins_external_request_card_and_validates_hash(self) -> None:
        result = vendor.snapshot(self.source, self.destination)
        self.assertEqual(result["additional_source_files"], vendor.ADDITIONAL_RESOURCES)
        self.assertEqual(vendor.check(self.destination), result)
        for local, relative in vendor.ADDITIONAL_RESOURCES.items():
            self.assertEqual((self.destination / "static" / local).read_bytes(),
                             (self.source / relative).read_bytes())
            self.assertEqual(len(vendor.inventory(self.destination / "static")), len(vendor.REQUIRED) + 1)

    def test_dirty_request_card_is_rejected_before_replacing_snapshot(self) -> None:
        vendor.snapshot(self.source, self.destination)
        before = (self.destination / "manifest.json").read_bytes()
        relative = next(iter(vendor.ADDITIONAL_RESOURCES.values()))
        (self.source / relative).write_text("Changed but not checkpointed\n")
        with self.assertRaisesRegex(ValueError, "tracked changes"):
            vendor.snapshot(self.source, self.destination)
        self.assertEqual((self.destination / "manifest.json").read_bytes(), before)

    def test_untracked_request_card_is_not_given_commit_provenance(self) -> None:
        relative = next(iter(vendor.ADDITIONAL_RESOURCES.values()))
        self.git("rm", "--cached", relative)
        self.git("-c", "user.name=TE2 Fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "--quiet", "-m", "untrack card")
        with self.assertRaisesRegex(ValueError, "Uncommitted/untracked"):
            vendor.snapshot(self.source, self.destination)

    def test_old_complete_snapshot_can_be_upgraded_but_is_not_new_gate_valid(self) -> None:
        vendor.snapshot(self.source, self.destination)
        for local in vendor.ADDITIONAL_RESOURCES:
            (self.destination / "static" / local).unlink()
        files = vendor.inventory(self.destination / "static")
        manifest = self.destination / "manifest.json"
        # Reconstruct a valid previous static-only snapshot using only public metadata.
        previous: dict[str, object] = {
            "schema": 1, "files": files,
            "tree_sha256": hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(),
            "license_sha256": hashlib.sha256((self.destination / "LICENSE").read_bytes()).hexdigest(),
        }
        manifest.write_text(json.dumps(previous))
        vendor.check(self.destination, require_approval=False)
        with self.assertRaisesRegex(ValueError, "approval request-card resource missing"):
            vendor.check(self.destination)
        vendor.snapshot(self.source, self.destination)
        vendor.check(self.destination)

    def test_proxy_rewrite_preserves_quote_and_does_not_double_prefix_api(self) -> None:
        source = b'''fetch('/api/test'); const ws="/ws/events"; const asset=`/static/x.js`; fetch('/api/app/other');'''
        expected = b'''fetch('/api/app/als-rs/proxy/api/test'); const ws="/api/app/als-rs/proxy/ws/events"; const asset=`/api/app/als-rs/proxy/static/x.js`; fetch('/api/app/other');'''
        self.assertEqual(vendor.proxy_text(source, ".js"), expected)
        self.assertEqual(vendor.proxy_text(b"url('/static/a.woff2')", ".css"),
                         b"url('/api/app/als-rs/proxy/static/a.woff2')")
        self.assertEqual(vendor.proxy_text(b"\x00\xff", ".wasm"), b"\x00\xff")
