"""Release boundary checks, using a temporary repository-shaped fixture."""
import hashlib
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import package


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name, content in {
            'app/main.py': 'app', 'app/.env': 'SECRET_KEY=private',
            'app/petcare.db': 'private data', 'app/test_main.py': 'tests',
            'app/static/ocr/vendor/worker.js': 'verified worker',
        }.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        (self.root / 'tools').mkdir()
        (self.root / 'tools/ocr-assets.json').write_text(json.dumps([
            {'file': 'worker.js', 'sha256': hashlib.sha256(b'verified worker').hexdigest()}
        ]))
        patcher = patch.object(package, 'ROOT', self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = patch.object(package.subprocess, 'check_output', side_effect=[
            'a' * 40 + '\n', b'app/main.py\0app/.env\0app/petcare.db\0app/test_main.py\0'
        ])
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_release_contains_only_runtime_files_and_verified_assets(self):
        package.build()
        archive = self.root / 'dist/petcare.tar.gz'
        with tarfile.open(archive) as tar:
            self.assertEqual(set(tar.getnames()), {'app/main.py', 'app/static/ocr/vendor/worker.js', 'RELEASE'})
            self.assertEqual(tar.extractfile('RELEASE').read().strip(), b'a' * 40)
        self.assertEqual((self.root / 'dist/petcare.tar.gz.sha256').read_text().split()[0],
                         hashlib.sha256(archive.read_bytes()).hexdigest())

    def test_corrupt_asset_blocks_release(self):
        (self.root / 'app/static/ocr/vendor/worker.js').write_text('tampered')
        with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
            package.build()

    def test_symlink_cannot_exfiltrate_file(self):
        (self.root / 'app/main.py').unlink()
        (self.root / 'app/main.py').symlink_to(self.root / 'app/.env')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected release input'):
            package.build()
