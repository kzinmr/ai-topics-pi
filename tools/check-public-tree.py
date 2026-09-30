"""Check tracked and candidate public source files, excluding ignored artifacts."""
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
files = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-co', '--exclude-standard', '-z']).decode().split('\0')
errors = []
for relative in set(files):
    if not relative:
        continue
    path = root/relative
    if not path.is_file():
        continue
    text = path.read_text(errors='replace')
    if any(part in ('profiles', '.local', 'node_modules', '.venv') for part in path.relative_to(root).parts):
        errors.append(relative+': generated/private file')
    if re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----', text):
        errors.append(relative+': private key')
    if re.search(r'(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{20,})', text):
        errors.append(relative+': token-like literal')
    if relative != 'src/migrate.ts' and relative.startswith(('src/', 'scripts/', 'prompts/', 'skills/', 'bin/')) and re.search(r'HERMES_|\.hermes|/opt/data|/srv/hermes', text):
        errors.append(relative+': legacy runtime dependency')
if errors:
    raise SystemExit('\n'.join(errors))
print('Public tree checks passed')
