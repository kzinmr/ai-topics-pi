"""Initialize an independent profile; content and credentials are separate."""
import json
import shutil
import subprocess
from .config import json_write


def initialize(cfg, content_source=None):
    if cfg.profile.exists() and any(cfg.profile.iterdir()):
        raise ValueError('init requires an empty destination profile')
    cfg.profile.mkdir(parents=True, exist_ok=True)
    cfg.state.mkdir(mode=0o700)
    (cfg.profile/'.pi/agent').mkdir(parents=True, mode=0o700)
    (cfg.profile/'bin').mkdir()
    if content_source:
        subprocess.run(['git', 'clone', '--no-hardlinks', str(content_source), str(cfg.repo)], check=True)
        subprocess.run(['git', '-C', str(cfg.repo), 'remote', 'set-url', 'origin',
                        'https://github.com/kzinmr/ai-topics.git'], check=True)
    else:
        (cfg.repo/'wiki').mkdir(parents=True)
    cfg.wiki.symlink_to('ai-topics/wiki', target_is_directory=True)
    # Domain scripts still run as ordinary programs; no installation/sync layer.
    (cfg.state/'scripts').symlink_to(cfg.scripts, target_is_directory=True)
    for name in ('data', 'runs', 'outbox', 'sessions'):
        (cfg.state/name).mkdir(mode=0o700)
    # Replace legacy agent instructions only in the destination clone. Preserve
    # the original privately; no tracked content is committed automatically.
    instructions = cfg.repo/'AGENTS.md'
    if instructions.exists():
        shutil.copy2(instructions, cfg.state/'original-AGENTS.md')
    instructions.write_text((cfg.source/'config/AGENTS.md').read_text())
    json_write(cfg.local_path, json.loads((cfg.source/'config/local.example.json').read_text()))
    json_write(cfg.profile/'.pi/agent/models.json', json.loads((cfg.source/'config/models.example.json').read_text()))
    if (cfg.repo/'.git').exists():
        subprocess.run(['git', '-C', str(cfg.repo), 'config', 'core.hooksPath', '.githooks'], check=True)
    json_write(cfg.state/'profile.json', {'version': 1, 'runtime': 'pi'})
    return {'profile': str(cfg.profile), 'content': str(cfg.repo)}
