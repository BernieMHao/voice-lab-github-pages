"""One-time packaging from the original checkout; Pages builds need no Python/models."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'public/models'
PUBLIC = ROOT / 'public'
HF = 'https://huggingface.co'
SOURCES = json.loads((SOURCE / 'extra-sources.json').read_text())
SOURCES.update({
    'pocket': ['kyutai/pocket-tts-without-voice-cloning', 'a7056f505a4a8ca72d8b5fb1440071d6f1a35739'],
    'qwen': ['onnx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice', '18b0bf898d211718bc33082fadc36a448e0cbc0c'],
    'matcha': ['csukuangfj/matcha-icefall-zh-baker', '4ddc32d1724e5ea167116096b860de07b8dcb781'],
    'omnivoice': ['KitsuMate/omnivoice-onnx', 'a8719e37c2ec34a090d04e36033084f2d1cd6837'],
})
LANGS = {'100m':'english_2026-01','18m':'english_18m_2026-10','7m':'english_7m_2026-10','2m':'english_2m_2026-10'}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def hf(key, filename):
    repo, revision = SOURCES[key]
    return f'{HF}/{repo}/resolve/{revision}/{filename}'


def asset(key, filename, remote=None, local_pack=False, source=None):
    path = source or SOURCE / key / filename
    virtual = f'models/{key}/{filename}'
    item = dict(path=virtual, bytes=path.stat().st_size, sha256=digest(path))
    if local_pack:
        parts = []
        with path.open('rb') as file:
            while True:
                data = file.read(48 * 1024 * 1024)
                if not data:
                    break
                name = f'packs/{key}/{filename}.part-{len(parts):02d}'
                target = PUBLIC / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                parts.append(dict(url=name, bytes=len(data)))
        item['parts'] = parts
    elif remote:
        item['url'] = remote
    else:
        item['url'] = 'support/' + virtual
    return item


catalog = {}
for identity, lang in LANGS.items():
    key = 'pocket/' + identity
    files = ['model.safetensors', 'tokenizer.json'] + [f'embeddings/{voice}.safetensors' for voice in ['alba','marius','jean','anna','cosette','fantine','vera','javert']]
    catalog[identity] = [asset(key, name, hf('pocket', f'languages/{lang}/{name}')) for name in files]

for key in ['kokoro','kitten-nano','kitten-micro','kitten-mini','piper','supertonic','phonon','matcha','zipvoice','qwen']:
    files = []
    if key == 'qwen':
        names = ['config.json','tokenizer.json','tokenizer_config.json'] + [x+'.onnx' for x in ['text_embed','codec_embed','talker_cache','code_predictor','residual_embed','tok_decoder']]
    elif key == 'phonon':
        names = ['model.q8.gguf','config.json','tokenizer.json','default-voice.safetensors']
    else:
        names = sorted(str(p.relative_to(SOURCE / key)) for p in (SOURCE / key).rglob('*') if p.is_file() and p.suffix not in ['.md','.py','.npz','.yaml'] and p.name not in ['README','LICENSE','MODEL_CARD'])
    for name in names:
        remote = None
        packed = False
        tensor = Path(name).suffix in ['.onnx','.gguf','.safetensors']
        if tensor:
            if key == 'zipvoice' or (key == 'matcha' and name.startswith('vocos')):
                packed = True
            elif key == 'piper':
                remote = hf(key, 'en/en_US/lessac/medium/' + name)
            elif key == 'qwen':
                remote = hf(key, 'cpu_int4/' + name)
            else:
                remote = hf(key, name)
        files.append(asset(key, name, remote, packed))
    catalog[key] = files

# Public CPU-ready OmniVoice conversion: INT4 LM, FP32 codec, no publisher account required.
omni_files = {
    'omnivoice_lm.onnx':'onnx/omnivoice_int4.onnx',
    'omnivoice_int4.onnx.data':'onnx/omnivoice_int4.onnx.data',
    'audio_decoder.onnx':'onnx/higgs_decoder.onnx',
    'tokenizer.json':'tokenizer.json', 'tokenizer_config.json':'tokenizer_config.json'
}
tree = {}
for name in ['kitsu-root-tree.json','kitsu-onnx-tree.json']:
    tree.update({item['path']: item for item in json.loads((ROOT / 'metadata' / name).read_text()) if item['type'] == 'file'})
manifest = json.loads((ROOT / 'metadata/kitsu-manifest.json').read_text())
files = []
for local, original in omni_files.items():
    entry = tree[original]
    checksum = entry.get('lfs', {}).get('oid') or manifest['sha256'][original]
    files.append(dict(path='models/omnivoice/'+local, bytes=entry['size'], sha256=checksum, url=hf('omnivoice', original)))
directory = PUBLIC / 'support/models/omnivoice'
directory.mkdir(parents=True, exist_ok=True)
(directory / 'manifest.json').write_text(json.dumps({'omnivoice_lm':['omnivoice_int4.onnx.data'], 'audio_decoder':[]}))
files.append(asset('omnivoice','manifest.json',source=directory / 'manifest.json'))
catalog['omnivoice'] = files

data = {'format':1, 'defaultModel':'2m', 'models':{key:{'files':files, 'bytes':sum(f['bytes'] for f in files)} for key,files in catalog.items()}, 'sources':SOURCES}
(PUBLIC / 'catalog.json').write_text(json.dumps(data, ensure_ascii=False, indent=2))
print('Packaged', len(catalog), 'models; default bytes:', data['models']['2m']['bytes'])
