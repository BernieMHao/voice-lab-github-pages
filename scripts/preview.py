"""Header-free static preview to emulate a GitHub Pages /repository/ deployment."""
import argparse
import hashlib
import json
import re
import time
from urllib.parse import urlsplit
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        prefix = self.server.prefix
        if not self.path.startswith(prefix):
            self.send_error(404)
            return
        self.path = '/' + self.path[len(prefix):]
        if self.server.fixtures:
            path = urlsplit(self.path).path
            if path == '/catalog.json':
                body = json.dumps(self.server.catalog).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if path in self.server.fixtures:
                source = self.server.fixtures[path]
                size = source.stat().st_size
                start, end = 0, size - 1
                requested = self.headers.get('Range')
                if requested:
                    match = re.fullmatch(r'bytes=(\d+)-(\d+)', requested)
                    if not match:
                        self.send_error(416)
                        return
                    start, end = map(int, match.groups())
                    if not 0 <= start <= end < size:
                        self.send_error(416)
                        return
                self.send_response(206 if requested else 200)
                self.send_header('Content-Type', 'application/octet-stream')
                self.send_header('Content-Length', str(end-start+1))
                if requested:
                    self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
                self.end_headers()
                with source.open('rb') as stream:
                    stream.seek(start)
                    remaining = end-start+1
                    while remaining:
                        block = stream.read(min(remaining, 1024*1024))
                        self.wfile.write(block)
                        remaining -= len(block)
                        if self.server.fixture_delay:
                            time.sleep(self.server.fixture_delay)
                return
        super().do_GET()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5195)
    parser.add_argument('--base', default='/voice-lab/')
    parser.add_argument('--fixtures', action='store_true', help='QA only: mirror verified local weights; never used for deployment')
    parser.add_argument('--fixture-delay', type=float, default=0, help='QA only: seconds per MiB, to exercise download cancellation')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1] / 'dist'
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(root)))
    server.prefix = args.base
    server.fixtures = {}
    server.fixture_delay = args.fixture_delay
    if args.fixtures:
        project = root.parent
        server.catalog = json.loads((root / 'catalog.json').read_text())
        names = {'omnivoice_lm.onnx':'omni-int4.onnx', 'audio_decoder.onnx':'higgs_decoder.onnx'}
        for model in server.catalog['models'].values():
            for entry in model['files']:
                if not entry.get('url', '').startswith('https:'):
                    continue
                source = project.parent / 'public' / entry['path']
                if '/omnivoice/' in entry['path']:
                    name = Path(entry['path']).name
                    source = project / '.research' / names.get(name, name)
                if not source.exists() or source.stat().st_size != entry['bytes']:
                    continue
                with source.open('rb') as stream:
                    hasher = hashlib.sha256()
                    for block in iter(lambda: stream.read(1024*1024), b''):
                        hasher.update(block)
                    digest = hasher.hexdigest()
                if digest != entry['sha256']:
                    raise RuntimeError(f'QA fixture checksum mismatch: {source}')
                path = '/__fixtures__/' + entry['path']
                server.fixtures[path] = source
                entry['url'] = '__fixtures__/' + entry['path']
        print(f'QA mirror: {len(server.fixtures)} SHA-256 verified files', flush=True)
    print(f'Pages preview: http://127.0.0.1:{args.port}{args.base}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
