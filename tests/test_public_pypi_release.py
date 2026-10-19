import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('public_builder_pypi', ROOT/'release/build_public_release.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class PublicPyPIReleaseTests(unittest.TestCase):
    def run_builder(self, output, version='0.2.355', tag_commit='a'*40, dirty='', extra=()):
        argv=['builder','--pypi','--version',version,'--source-commit','a'*40,
            '--output',str(output),'--agent-log-server-version','0.2.139',
            '--framework-shells-version','0.2.65',*extra]
        with patch.object(sys,'argv',argv), patch.object(builder,'_git_output',side_effect=['a'*40,dirty,tag_commit]):
            return builder.main()

    def test_modern_manifest_contains_verified_installers_without_archive(self):
        with tempfile.TemporaryDirectory() as raw:
            out=Path(raw)/'release'
            self.assertEqual(self.run_builder(out),0)
            manifest=json.loads((out/'release-manifest.json').read_text())
            self.assertTrue(manifest['release']['publicationEligible'])
            self.assertEqual(manifest['targets']['termux-android-aarch64']['source'],'pypi')
            self.assertNotIn('archive',manifest['targets']['termux-android-aarch64'])
            self.assertEqual(manifest['components']['agentLogServerVersion'],'0.2.139')
            sums=(out/'SHA256SUMS').read_text()
            for name in ('install-te2','install_te2.py','release-manifest.json'):
                self.assertIn(hashlib.sha256((out/name).read_bytes()).hexdigest()+'  '+name+'\n',sums)

    def test_old_version_rejected(self):
        with tempfile.TemporaryDirectory() as raw, self.assertRaisesRegex(SystemExit,'requires version'):
            self.run_builder(Path(raw)/'release',version='0.2.353')

    def test_mismatched_tag_rejected(self):
        with tempfile.TemporaryDirectory() as raw, self.assertRaisesRegex(SystemExit,'version tag'):
            self.run_builder(Path(raw)/'release',tag_commit='b'*40)

    def test_dirty_validation_never_publishable(self):
        with tempfile.TemporaryDirectory() as raw:
            out=Path(raw)/'release'
            self.run_builder(out,dirty=' M README.md',extra=('--allow-dirty-source',))
            self.assertFalse(json.loads((out/'release-manifest.json').read_text())['release']['publicationEligible'])

if __name__=='__main__': unittest.main()
