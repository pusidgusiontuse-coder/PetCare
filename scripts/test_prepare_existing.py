import sqlite3
from pathlib import Path
import tempfile
import unittest

from prepare_existing import prepare


class PrepareTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        (self.root / 'app').mkdir()
        (self.root / 'app/.env').write_text('existing-secret')
        (self.root / 'data').mkdir()
        with sqlite3.connect(self.root / 'data/petcare.db') as db:
            db.execute('CREATE TABLE sample (value TEXT)')
            db.execute("INSERT INTO sample VALUES ('keep me')")

    def test_links_use_original_data_and_backup_is_consistent(self):
        prepare(self.root)
        prepare(self.root)  # Repeated preparation preserves link targets.
        self.assertEqual((self.root / 'shared/data').resolve(), self.root / 'data')
        self.assertEqual((self.root / 'shared/.env').read_text(), 'existing-secret')
        backups = list((self.root / 'backups').glob('*.db'))
        self.assertEqual(len(backups), 2)
        for backup in backups:
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
            with sqlite3.connect(backup) as db:
                self.assertEqual(db.execute('SELECT value FROM sample').fetchone(), ('keep me',))

    def test_conflict_does_not_overwrite_existing_shared_storage(self):
        (self.root / 'shared').mkdir()
        (self.root / 'shared/.env').write_text('different-secret')
        with self.assertRaisesRegex(RuntimeError, 'Refusing to replace'):
            prepare(self.root)
        self.assertFalse((self.root / 'shared/data').exists())
        self.assertEqual((self.root / 'shared/.env').read_text(), 'different-secret')
