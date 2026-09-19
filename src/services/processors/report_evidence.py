"""Lossless Report evidence and resumable batch storage behind one small interface."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime, timezone
import pypdfium2 as pdfium


def atomic_json(path, data):
    path = Path(path)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, default=str, allow_nan=False), encoding='utf-8')
    os.replace(temporary, path)


class ReportEvidence:
    def __init__(self, source, output_dir, settings):
        self.source = Path(source)
        self.source_hash = hashlib.sha256(self.source.read_bytes()).hexdigest()
        code = Path(__file__).read_bytes()
        self.fingerprint = hashlib.sha256(code + json.dumps(settings, sort_keys=True).encode()).hexdigest()
        self.cache = Path(output_dir) / '.checkpoints' / self.source_hash / self.fingerprint
        self.cache.mkdir(parents=True, exist_ok=True)
        self.settings = settings

    def inventory(self):
        pages = []
        with closing(pdfium.PdfDocument(self.source)) as pdf:
            if not len(pdf):
                raise ValueError('PDF contains no pages')
            for index in range(len(pdf)):
                with closing(pdf[index]) as page:
                    with closing(page.get_textpage()) as text:
                        native = text.get_text_bounded()
                    width, height = page.get_size()
                    pages.append({'page_number': index + 1, 'native_text': native,
                                  'width': width, 'height': height,
                                  'native_status': 'text' if native.strip() else 'no_native_text',
                                  'layout_status': 'pending'})
        return {'schema_version': 1, 'source_sha256': self.source_hash,
                'source_file': self.source.name, 'source_bytes': self.source.stat().st_size,
                'pipeline_fingerprint': self.fingerprint, 'settings': self.settings,
                'created_at': datetime.now(timezone.utc).isoformat(), 'pages': pages,
                'tables': [], 'warnings': [], 'coverage': {'status': 'processing', 'total_pages': len(pages)}}

    def load_batch(self, start, end):
        path = self.cache / f'{start}-{end}.json'
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text())
            digest = data.pop('_sha256', None)
            valid_hash = digest == hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()
            if valid_hash and data['start'] == start and data['end'] == end and data['status'] == 'success' and isinstance(data['pages'], dict) and isinstance(data['tables'], list) and isinstance(data['document'], dict):
                return data
        except (ValueError, KeyError):
            pass
        return None

    def save_batch(self, data):
        digest = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()
        atomic_json(self.cache / f"{data['start']}-{data['end']}.json", {**data, '_sha256': digest})
