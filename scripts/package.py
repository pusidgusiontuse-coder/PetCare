"""Build a release from an explicit allowlist; never include local secrets or data."""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def build():
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    archive = output / 'petcare.tar.gz'
    # Only tracked application sources plus verified OCR downloads.
    tracked = subprocess.check_output(['git', 'ls-files', '-z', 'app', 'setup_hosting.py', 'backup.py'], cwd=ROOT).decode().split('\0')
    files = [ROOT / name for name in tracked if name and not Path(name).name.startswith('test_')]
    for asset in json.loads((ROOT / 'tools/ocr-assets.json').read_text()):
        path = ROOT / 'app/static/ocr/vendor' / asset['file']
        if hashlib.sha256(path.read_bytes()).hexdigest() != asset['sha256']:
            raise RuntimeError(f'OCR checksum mismatch: {path.name}')
        files.append(path)
    with tarfile.open(archive, 'w:gz') as tar:
        for path in files:
            relative = path.relative_to(ROOT)
            if path.is_symlink() or not path.is_file():
                raise RuntimeError(f'Unexpected release input: {relative}')
            if '.env' in path.name or path.suffix in {'.db', '.pem', '.sqlite'}:
                continue
            tar.add(path, arcname=str(relative), recursive=False)
        import io
        data = (revision + '\n').encode()
        info = tarfile.TarInfo('RELEASE')
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (output / 'petcare.tar.gz.sha256').write_text(digest + '  petcare.tar.gz\n')
    print(f'Built {revision}: {digest}')


if __name__ == '__main__':
    build()
