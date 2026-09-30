"""Explicit publication boundary; stage only wiki changes and run repository hooks."""
from .process import execute


def publish(cfg):
    def git(*args):
        return execute(['git', *args], cwd=cfg.repo, env=cfg.env(), timeout=120).strip()
    # Prevent an unrelated staged change from hitchhiking on this publication.
    if git('diff', '--cached', '--name-only'):
        raise RuntimeError('index is already staged; review and publish manually')
    if git('status', '--porcelain', '--', 'wiki'):
        git('add', '--', 'wiki')
        git('commit', '-m', 'wiki: update collected knowledge')
    # Also retries a previous commit whose push failed, without repeating collection.
    git('push')
    return {'commit': git('rev-parse', 'HEAD'), 'pushed': True}
