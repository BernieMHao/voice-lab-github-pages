"""Build a standalone source ZIP, including GitHub Actions and excluding local data."""
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
target = root.parent / (root.name + '.zip')
excluded = {'node_modules', 'dist', '.research', 'test-results', '.git', '__pycache__'}
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        if any(part in excluded for part in relative.parts):
            continue
        if path.is_file() and path.name != '.DS_Store' and not path.name.endswith('.log'):
            if path.is_symlink():
                raise RuntimeError(f'Unexpected source symlink: {relative}')
            archive.write(path, Path(root.name) / relative)
print(f'{target} ({target.stat().st_size / 1024**2:.1f} MiB)')
