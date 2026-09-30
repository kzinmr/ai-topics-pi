"""Skills are loaded from Git directly; report local custom skills and code drift."""
import hashlib
import json
import os
import subprocess
from pathlib import Path

root = Path(os.environ['AI_TOPICS_SOURCE'])
skills = [{'name': p.parent.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
          for p in sorted((root/'skills').glob('*/SKILL.md'))]
custom = sorted(p.parent.name for p in (Path.home()/'.pi/agent/skills').glob('*/SKILL.md'))
changes = None
if (root/'.git').exists():
    result = subprocess.run(['git', '-C', str(root), 'status', '--porcelain', '--', 'skills', 'prompts', 'config'],
                            capture_output=True, text=True, check=True)
    changes = result.stdout.splitlines()
print(json.dumps({'skills': skills, 'custom_skills': custom, 'uncommitted': changes,
                  'note': 'null uncommitted means a release image without Git metadata'}))
