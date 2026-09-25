#!/usr/bin/env python3
"""Check essential files in a staged static release before activation."""
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name not in ('src', 'href') or not value:
                continue
            parsed = urlsplit(value)
            if parsed.scheme or parsed.netloc or not parsed.path.startswith('/'):
                continue
            path = unquote(parsed.path)
            if path.startswith(('/_astro/', '/assets/', '/favicon/')):
                self.paths.add(path)

def verify(root):
    root = root.resolve()
    for path in ('index.html', '404.html', 'pagefind/pagefind.js'):
        if not (root / path).is_file() or (root / path).stat().st_size == 0:
            raise SystemExit('Static release is missing required file: ' + path)
    astro = root / '_astro'
    if not astro.is_dir() or not any(item.is_file() for item in astro.rglob('*')):
        raise SystemExit('Static release has no _astro assets.')
    parser = References()
    parser.feed((root / 'index.html').read_text(encoding='utf-8'))
    for reference in parser.paths:
        target = (root / reference.lstrip('/')).resolve()
        if not target.is_relative_to(root) or not target.is_file() or target.stat().st_size == 0:
            raise SystemExit('Static release is missing a local homepage asset.')
    print('Static release essentials and homepage references verified.')

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: verify-static-release.py <release-directory>')
    verify(Path(sys.argv[1]))
