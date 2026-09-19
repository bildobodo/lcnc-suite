"""Read-only browsing of the configured server tool-library directory."""
from pathlib import Path

EXTENSIONS = {'.json', '.zip', '.fctb', '.fctl'}


def resolve_entry(root, relative):
    root = Path(root).expanduser().resolve()
    path = (root / relative).resolve()
    if Path(relative).is_absolute() or not path.is_relative_to(root):
        raise ValueError('Path outside tool-library directory')
    return root, path


def list_entries(root, subdir=''):
    root, directory = resolve_entry(root, subdir)
    entries = []
    for path in sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        if path.name.startswith('.') or not path.resolve().is_relative_to(root):
            continue
        if path.is_dir():
            entries.append(dict(name=path.name, type='directory', path=path.relative_to(root).as_posix()))
        elif path.is_file() and path.suffix.lower() in EXTENSIONS:
            entries.append(dict(name=path.name, type='file', path=path.relative_to(root).as_posix(), size=path.stat().st_size))
    return dict(ok=True, directory=str(root), subdir='' if directory == root else directory.relative_to(root).as_posix(), entries=entries)
