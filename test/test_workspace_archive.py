import importlib.util, json, sqlite3, tempfile, unittest, zipfile, os, sys, subprocess
from pathlib import Path
spec = importlib.util.spec_from_file_location('workspace_archive', Path(__file__).resolve().parents[1] / 'scripts/workspace_archive.py')
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)

class WorkspaceArchiveTests(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        with sqlite3.connect(self.source / 'serafina.sqlite') as db:
            db.execute('CREATE TABLE sample(value TEXT)')
            db.execute("INSERT INTO sample VALUES ('preserved')")
        (self.source / 'uploads').mkdir()
        (self.source / 'uploads' / 'source.pdf').write_bytes(b'%PDF-1.7 example')
        (self.source / 'hosting').mkdir()
        (self.source / 'hosting' / 'connection.json').write_text('{"secret":"private"}')

    def tearDown(self):
        self.temp.cleanup()

    def test_restore_preserves_data_and_credentials_but_not_runtime_lock_or_models(self):
        (self.source / 'runtime.lock').write_text('old pid')
        (self.source / 'models').mkdir()
        (self.source / 'models' / 'weights').write_text('large')
        bundle = self.root / 'bundle.zip'
        archive.export_workspace(self.source, bundle)
        target = self.root / 'target'
        archive.import_workspace(bundle, target)
        self.assertEqual((target / 'hosting' / 'connection.json').read_text(), '{"secret":"private"}')
        self.assertFalse((target / 'runtime.lock').exists())
        self.assertFalse((target / 'models').exists())
        with sqlite3.connect(target / 'serafina.sqlite') as db:
            self.assertEqual(db.execute('SELECT value FROM sample').fetchone()[0], 'preserved')
        with self.assertRaisesRegex(ValueError, 'already exists'):
            archive.import_workspace(bundle, target)

    def test_traversal_and_changed_bytes_never_publish_a_destination(self):
        bundle = self.root / 'bundle.zip'
        archive.export_workspace(self.source, bundle)
        with zipfile.ZipFile(bundle) as original:
            entries = {n: original.read(n) for n in original.namelist()}
        entries['data/uploads/source.pdf'] = b'changed'
        bad = self.root / 'changed.zip'
        with zipfile.ZipFile(bad, 'w') as z:
            for name, value in entries.items():
                z.writestr(name, value)
        target = self.root / 'target'
        with self.assertRaisesRegex(ValueError, 'checksum'):
            archive.import_workspace(bad, target)
        self.assertFalse(target.exists())
        traversal = self.root / 'traversal.zip'
        with zipfile.ZipFile(traversal, 'w') as z:
            z.writestr('manifest.json', json.dumps({'version': 1, 'files': [{'path': '../../escape', 'size': 1, 'sha256': 'x'}]}))
            z.writestr('data/../../escape', 'x')
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            archive.import_workspace(traversal, target)
        self.assertFalse(target.exists())
        self.assertFalse((self.root / 'escape').exists())

    def test_source_symlink_is_rejected_instead_of_copying_unrelated_files(self):
        (self.source / 'outside').symlink_to(self.root)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            archive.export_workspace(self.source, self.root / 'bundle.zip')
    def test_encrypted_cli_rejects_wrong_key_tampering_and_existing_outputs(self):
        repo = Path(__file__).resolve().parents[1]
        env = {**os.environ, 'SERAFINA_DATA_DIR': str(self.source), 'SERAFINA_PYTHON': sys.executable}
        def cli(*args):
            return subprocess.run(['node', 'scripts/workspace.js', *map(str,args)], cwd=repo, env=env, capture_output=True, text=True, timeout=30)
        transfer = self.root / 'transfer.saf'
        self.assertEqual(cli('export', transfer).returncode, 0)
        target = self.root / 'restored'
        result = cli('import', transfer, target)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((target/'uploads/source.pdf').read_bytes(), (self.source/'uploads/source.pdf').read_bytes())
        key_file = Path(str(transfer)+'.key')
        key = key_file.read_bytes()
        original = transfer.read_bytes()
        duplicate = cli('export', transfer)
        self.assertNotEqual(duplicate.returncode, 0)
        self.assertEqual(transfer.read_bytes(), original)
        self.assertEqual(key_file.read_bytes(), key)
        key_file.write_bytes(bytes(32))
        rejected = self.root / 'rejected'
        self.assertNotEqual(cli('import', transfer, rejected).returncode, 0)
        self.assertFalse(rejected.exists())
        key_file.write_bytes(key)
        damaged = bytearray(original)
        damaged[len(damaged)//2] ^= 1
        transfer.write_bytes(damaged)
        self.assertNotEqual(cli('import', transfer, rejected).returncode, 0)
        self.assertFalse(rejected.exists())

if __name__ == '__main__':
    unittest.main()
