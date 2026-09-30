import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from .config import Config, inside
from .state import Store, profile_lock


def main():
    parser = argparse.ArgumentParser(description='Pi-only Lucy Wiki operations')
    parser.add_argument('--profile', help='independent profile root (or AI_TOPICS_PROFILE)')
    sub = parser.add_subparsers(dest='command', required=True)
    init = sub.add_parser('init')
    init.add_argument('--content-source', help='Git URL or local clone to clone into the new profile')
    migrate = sub.add_parser('import-state')
    migrate.add_argument('source', help='old Lucy profile, read only')
    for command in ('validate', 'doctor', 'jobs', 'tick', 'status', 'publish'):
        sub.add_parser(command)
    run = sub.add_parser('run')
    run.add_argument('name')
    run.add_argument('--dry-run', action='store_true')
    script = sub.add_parser('script')
    script.add_argument('name')
    script.add_argument('args', nargs=argparse.REMAINDER)
    pi = sub.add_parser('pi')
    pi.add_argument('args', nargs=argparse.REMAINDER)
    outbox = sub.add_parser('outbox')
    outbox.add_argument('--deliver', action='store_true')
    recover = sub.add_parser('recover')
    recover.add_argument('run_id', help='interrupted run to mark failed after inspecting artifacts')
    sub.add_parser('reset-cursor', help='explicitly skip missed schedule slots through now')
    args = parser.parse_args()
    try:
        cfg = Config(profile=args.profile)
        result = dispatch(cfg, args)
        if result is not None:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        results = result if isinstance(result, list) else [result]
        if any(isinstance(x, dict) and x.get('status') in ('error', 'failed') for x in results):
            raise SystemExit(1)
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as exc:
        from .runner import _redact
        message = _redact(cfg, str(exc)) if 'cfg' in locals() else str(exc)
        print(message, file=sys.stderr)
        raise SystemExit(1)


def dispatch(cfg, args):
    from . import runner
    if args.command == 'validate':
        return {'valid': True, 'jobs': len(cfg.jobs), 'enabled': sum(j['enabled'] for j in cfg.jobs)}
    if args.command == 'jobs':
        return cfg.jobs
    if args.command == 'init':
        from .profile import initialize
        return initialize(cfg, args.content_source)
    if args.command == 'import-state':
        from .migrate import import_state
        return import_state(cfg, args.source)
    if args.command == 'run':
        job = cfg.job(args.name)
        if args.dry_run:
            from .pi import command
            return {'job': job, 'cwd': str(cfg.repo), 'pi': command(cfg, job),
                    'prompt': runner.prompt_for(cfg, job, '(not collected in dry-run)')}
        return runner.run(cfg, args.name)
    if args.command == 'tick':
        return runner.tick(cfg)
    runner._require_profile(cfg)
    if args.command == 'doctor':
        pi = cfg.source/'node_modules/.bin/pi'
        checks = {'pi': pi.is_file(), 'git': bool(shutil.which('git')),
                  'schema': (cfg.wiki/'SCHEMA.md').is_file(),
                  'index': (cfg.wiki/'index.md').is_file(),
                  'models': (cfg.profile/'.pi/agent/models.json').is_file()}
        return {'status': 'ok' if all(checks.values()) else 'error', 'checks': checks,
                'note': 'Offline checks only; use wiki pi -- --list-models and a model smoke test.'}
    if args.command == 'script':
        # Also used inside an already locked Pi process; no nested writer lock.
        script = inside(cfg.scripts, args.name)
        if not script.is_file() or script.suffix != '.py':
            raise ValueError('script must name a maintained .py file')
        returncode = subprocess.call([sys.executable, str(script), *args.args], cwd=cfg.repo, env=cfg.env())
        raise SystemExit(returncode)
    if args.command == 'pi':
        from .pi import command
        argv = args.args[1:] if args.args[:1] == ['--'] else args.args
        with profile_lock(cfg.state):
            raise SystemExit(subprocess.call(command(cfg) + argv, cwd=cfg.repo, env=cfg.env()))
    if args.command == 'publish':
        from .publish import publish
        with profile_lock(cfg.state):
            return publish(cfg)
    if args.command == 'outbox':
        from .delivery import deliver
        with profile_lock(cfg.state):
            paths = sorted((cfg.state/'outbox').glob('*.json'))
            return [deliver(cfg, p) if args.deliver else json.loads(p.read_text()) for p in paths]
    with profile_lock(cfg.state):
        store = Store(cfg.state)
        try:
            if args.command == 'status':
                return {j['name']: store.latest(j['name']) for j in cfg.jobs}
            if args.command == 'recover':
                row = store.db.execute('SELECT status FROM runs WHERE id=?', (args.run_id,)).fetchone()
                if not row or row[0] != 'running':
                    raise ValueError('run is not interrupted/running')
                store.finish(args.run_id, datetime.now(timezone.utc).isoformat(), 'error',
                             {'error': 'operator acknowledged interrupted run; no automatic replay'})
                store.view(cfg)
                return {'recovered': args.run_id}
            if args.command == 'reset-cursor':
                slot = datetime.now(timezone.utc).replace(second=0, microsecond=0).isoformat()
                store.set_meta('cursor', slot)
                return {'cursor': slot}
        finally:
            store.close()
