"""Exercise activation and rollback with a fake hosting account on Linux."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('deploy.sh').resolve()


@unittest.skipUnless(sys.platform == 'linux', 'REG.RU deployment uses Linux utilities')
class DeployTests(unittest.TestCase):
    def run_deploy(self, healthy):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            root, public = base / 'private', base / 'public'
            public.mkdir()
            (public / 'passenger_wsgi.py').write_text('previous dispatcher')
            (root / 'shared/data').mkdir(parents=True)
            (root / 'shared/.env').write_text('SECRET_KEY=test\n')
            revision = 'a' * 40
            release = revision + '-1-1'
            incoming = root / 'incoming' / release
            incoming.mkdir(parents=True)
            source = base / 'source'
            (source / 'app').mkdir(parents=True)
            # Replace only environment installation, keep real shell activation.
            (source / 'setup_hosting.py').write_text(
                'import pathlib,sys\n'
                'p=pathlib.Path(sys.argv[-1]); p.mkdir()\n'
                '(p/"passenger_wsgi.py").write_text("new dispatcher")\n'
            )
            with tarfile.open(incoming / 'petcare.tar.gz', 'w:gz') as tar:
                tar.add(source / 'app', arcname='app')
                tar.add(source / 'setup_hosting.py', arcname='setup_hosting.py')
            digest = hashlib.sha256((incoming / 'petcare.tar.gz').read_bytes()).hexdigest()
            (incoming / 'petcare.tar.gz.sha256').write_text(digest + '  petcare.tar.gz\n')
            bin_dir = base / 'bin'
            bin_dir.mkdir()
            for name, body in {'curl': f'echo \'{{"release":"{revision if healthy else "old"}"}}\'\n',
                               'sleep': 'exit 0\n'}.items():
                path = bin_dir / name
                path.write_text('#!/bin/sh\n' + body)
                path.chmod(0o700)
            result = subprocess.run(['bash', str(SCRIPT), str(root), str(public),
                                     'https://example.com', sys.executable, release],
                                    env={**os.environ, 'PATH': str(bin_dir) + ':' + os.environ['PATH']},
                                    capture_output=True, text=True)
            if healthy:
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((public / 'passenger_wsgi.py').read_text(), 'new dispatcher')
                self.assertEqual((root / 'current').resolve(), root / 'releases' / release)
            else:
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual((public / 'passenger_wsgi.py').read_text(), 'previous dispatcher')
                self.assertFalse((root / 'current').exists())
            self.assertTrue((public / 'tmp/restart.txt').exists())
            self.assertEqual((root / 'shared/.env').read_text(), 'SECRET_KEY=test\n')

    def test_successful_activation(self):
        self.run_deploy(True)

    def test_wrong_release_rolls_back(self):
        self.run_deploy(False)
