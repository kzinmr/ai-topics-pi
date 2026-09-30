"""One-way import of collector state, never credentials or scheduler state."""
import json
import sqlite3
from pathlib import Path
from .config import json_write
from .runner import _require_profile
from .state import profile_lock


def import_state(cfg, source):
    _require_profile(cfg)
    source = Path(source).expanduser().resolve()
    if source == cfg.profile or source in cfg.profile.parents:
        raise ValueError('source and destination profiles must be independent')
    old = source/'.hermes'
    if not old.is_dir():
        raise ValueError('source is not a Lucy profile')
    # Restrict import to known collector state. Auth, sessions, cron definitions,
    # cron outputs and environment files have intentionally separate lifecycles.
    paths = list(old.glob('processed_*.json'))
    data = old/'cron/data'
    folders = ('blog_ingest', 'newsletter', 'dreaming', 'sitemap_monitor',
               'raw_backlog', 'x_accounts_archive', 'x_bookmarks_archive')
    paths += [p for folder in folders for p in (data/folder).rglob('*.json') if p.is_file()]
    paths += list(data.glob('x_*.json'))
    planned = []
    def rebase(value):
        if isinstance(value, list):
            return [rebase(v) for v in value]
        if isinstance(value, dict):
            return {k: rebase(v) for k, v in value.items()}
        if isinstance(value, str):
            for prefix in (str(source), '/opt/data'):
                if value.startswith(prefix+'/'):
                    suffix = value[len(prefix)+1:]
                    if suffix.startswith('.hermes/cron/data/'):
                        return str(cfg.state/'data'/suffix[len('.hermes/cron/data/'):])
                    if suffix.startswith('.hermes/'):
                        return str(cfg.state/suffix[len('.hermes/'):])
                    return str(cfg.profile/suffix)
        return value
    for path in paths:
        if path.is_symlink() or not path.resolve().is_relative_to(old.resolve()):
            raise ValueError('state import refuses external symlinks')
        relative = Path('data')/path.relative_to(data) if path.is_relative_to(data) else path.relative_to(old)
        dest = cfg.state/relative
        planned.append((dest, rebase(json.loads(path.read_text()))))
    database = source/'.blogwatcher/blogwatcher.db'
    target_db = cfg.profile/'.blogwatcher/blogwatcher.db'
    with profile_lock(cfg.state):
        if (cfg.state/'import.json').exists() or any(dest.exists() for dest, _ in planned) or target_db.exists():
            raise ValueError('destination already has imported/collector state; use an unused profile')
        if database.exists():
            target_db.parent.mkdir(parents=True, exist_ok=True)
            with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as src, sqlite3.connect(target_db) as dst:
                src.backup(dst)
            target_db.chmod(0o600)
        for dest, value in planned:
            json_write(dest, value)
        report = {'json_files': len(planned), 'rss_database': database.exists(),
                  'note': 'Stop source collection for a consistent final cutover. Source untouched.'}
        json_write(cfg.state/'import.json', report)
        return report
