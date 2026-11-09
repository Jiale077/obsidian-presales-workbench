#!/usr/bin/env python3
"""Check shipped text for syntax errors, credentials and accidentally bundled runtime files."""
import ast
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TEXT = {'.py', '.js', '.cjs', '.md', '.json', '.css', '.svg', '.yml'}
SKIP = {'.git', '__pycache__', '.venv', 'node_modules'}
FORBIDDEN = {'.env', 'runtime-config.json', 'holiday-cache.json', 'state.json', 'session.json', 'request.json', 'feed.json', 'candidates.json'}


def main():
    errors, count = [], 0
    for file in ROOT.rglob('*'):
        relative = file.relative_to(ROOT)
        if any(p in SKIP for p in relative.parts) or not file.is_file():
            continue
        if file.name in FORBIDDEN or 'cookie' in file.name.lower() or any(p in {'.workbench', '.weekly', '.presales-workbench-backups'} for p in relative.parts):
            errors.append(f'{relative}: runtime or credential file must not be distributed')
        if file.suffix not in TEXT:
            continue
        count += 1
        text = file.read_text(encoding='utf-8')
        if re.search(r'\b(?:sk-[A-Za-z0-9_-]{24,}|LTAI[A-Za-z0-9]{16,}|AKIA[A-Za-z0-9]{16,})\b', text):
            errors.append(f'{relative}: possible API credential')
        if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', text):
            errors.append(f'{relative}: private key material')
        # Never distribute an author's real home directory in extracted code.
        if re.search(r'/' + r'Users/[A-Za-z0-9_.-]+/', text):
            errors.append(f'{relative}: personal absolute path')
        try:
            if file.suffix == '.py':
                ast.parse(text, filename=str(relative))
            elif file.suffix == '.json':
                json.loads(text)
            elif file.suffix in {'.js', '.cjs'}:
                result = subprocess.run(['node', '--check', str(file)], capture_output=True, text=True)
                if result.returncode:
                    errors.append(f'{relative}: {result.stderr.strip()}')
        except (SyntaxError, ValueError) as error:
            errors.append(f'{relative}: {error}')
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print(f'Checked {count} text files: syntax and release hygiene passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
