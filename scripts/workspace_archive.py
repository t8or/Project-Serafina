"""Portable workspace archive with a per-file inventory and transactional restore."""
import argparse, hashlib, json, os, shutil, sqlite3, stat, tempfile, zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import quote
MAX_BYTES = 20 * 1024 ** 3

def check_database(root):
    db = root / 'serafina.sqlite'
    if not db.is_file():
        raise ValueError('Workspace database is missing')
    with sqlite3.connect('file:' + quote(str(db)) + '?mode=ro', uri=True) as connection:
        if connection.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('Database integrity check failed')
        if connection.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('Database reference check failed')

def digest(path):
    sha = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(block)
    return sha.hexdigest()

def export_workspace(root, archive):
    check_database(root)
    inventory = []
    total = 0
    for current, dirs, files in os.walk(root, followlinks=False):
        relative = Path(current).relative_to(root)
        dirs[:] = [d for d in dirs if not (relative == Path('.') and d == 'models')]
        for name in dirs + files:
            if (Path(current) / name).is_symlink():
                raise ValueError('Symlinks are not supported in a portable workspace')
        for name in files:
            p = Path(current) / name
            rel = p.relative_to(root).as_posix()
            if not stat.S_ISREG(p.stat().st_mode):
                raise ValueError('Only regular workspace files can be exported')
            if rel == 'runtime.lock':
                continue
            total += p.stat().st_size
            if total > MAX_BYTES:
                raise ValueError('Workspace exceeds the 20 GB transfer limit')
            inventory.append({'path': rel, 'size': p.stat().st_size, 'sha256': digest(p)})
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, allowZip64=True) as bundle:
        bundle.writestr('manifest.json', json.dumps({'version': 1, 'files': inventory}))
        for item in inventory:
            bundle.write(root / item['path'], 'data/' + item['path'])
    return {'files': len(inventory), 'bytes': total}

def import_workspace(archive, destination):
    if destination.exists():
        raise ValueError('Restore destination already exists; restore into a new directory')
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.serafina-restore-', dir=destination.parent))
    try:
        with zipfile.ZipFile(archive) as bundle:
            names = bundle.namelist()
            if len(names) != len(set(names)) or len(names) > 100000:
                raise ValueError('Duplicate or excessive archive entries')
            if bundle.getinfo('manifest.json').file_size > 8 * 1024 * 1024:
                raise ValueError('Archive manifest exceeds 8 MB')
            manifest = json.loads(bundle.read('manifest.json'))
            if manifest.get('version') != 1:
                raise ValueError('Unsupported archive version')
            records = manifest['files']
            paths = [r['path'] for r in records]
            if len(paths) != len(set(paths)):
                raise ValueError('Duplicate inventory entries')
            if set(names) != {'manifest.json', *('data/' + p for p in paths)}:
                raise ValueError('Archive inventory does not match files')
            if sum((i.file_size for i in bundle.infolist())) > MAX_BYTES:
                raise ValueError('Archive exceeds the restore size limit')
            for item in records:
                rel = PurePosixPath(item['path'])
                if rel.is_absolute() or '..' in rel.parts or '\\' in str(rel) or (':' in str(rel)) or (not rel.parts) or (str(rel) != item['path']):
                    raise ValueError('Unsafe archive path')
                info = bundle.getinfo('data/' + item['path'])
                if stat.S_ISLNK(info.external_attr >> 16) or info.is_dir():
                    raise ValueError('Unsupported archive entry')
                output = staging / rel
                output.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(info) as source, output.open('xb') as target:
                    shutil.copyfileobj(source, target, 1024 * 1024)
                os.chmod(output, 0o600)
                if output.stat().st_size != item['size'] or digest(output) != item['sha256']:
                    raise ValueError('Archive checksum mismatch')
        check_database(staging)
        if destination.exists():
            raise ValueError('Restore destination appeared during validation')
        staging.rename(destination)
        return {'files': len(records), 'destination': str(destination)}
    finally:
        if staging.exists():
            shutil.rmtree(staging)
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['export', 'import'])
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    print(json.dumps(export_workspace(args.source.resolve(), args.destination.resolve()) if args.command == 'export' else import_workspace(args.source.resolve(), args.destination.resolve())))
