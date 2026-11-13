"""Fetch pinned OCR assets; validate every download before installation. Python 3 + curl."""
from pathlib import Path
import hashlib,json,subprocess,tempfile
root=Path(__file__).resolve().parent.parent
out=root/'app/static/ocr/vendor';out.mkdir(parents=True,exist_ok=True)
for item in json.loads((Path(__file__).with_name('ocr-assets.json')).read_text()):
    target=out/item['file']
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()==item['sha256']:continue
    with tempfile.TemporaryDirectory() as temporary:
        download=Path(temporary)/'asset'
        subprocess.run(['curl','--fail','--location','--retry','2',item['url'],'--output',str(download)],check=True)
        content=download.read_bytes()
        if hashlib.sha256(content).hexdigest()!=item['sha256']:raise RuntimeError('Checksum mismatch: '+item['file'])
        target.write_bytes(content)
print('OCR assets ready')
