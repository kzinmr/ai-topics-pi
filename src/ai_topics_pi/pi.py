"""One fresh Pi CLI process per task. Pi owns tools, model APIs and sessions."""
import json
from .process import execute


def command(cfg, job=None):
    settings = {**cfg.local.get('pi', {}), **(job or {}).get('pi', {})}
    argv = [str(cfg.source/'node_modules/.bin/pi'), '--offline',
            '--no-context-files', '--no-extensions', '--no-prompt-templates',
            '--append-system-prompt', str(cfg.source/'config/AGENTS.md'),
            '--skill', str(cfg.source/'skills'),
            '--session-dir', str(cfg.state/'sessions')]
    for key in ('provider', 'model', 'thinking'):
        if settings.get(key):
            argv += ['--'+key, settings[key]]
    for extension in settings.get('extensions', []):
        argv += ['--extension', str(cfg.source/extension)]
    return argv


def parse_events(output):
    """Require a completed assistant turn; exit 0 alone is not success."""
    final = None
    completed = False
    usage = []
    for line in output.splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get('type') == 'message_end':
            message = event.get('message', {})
            if message.get('role') == 'assistant':
                reason = message.get('stopReason')
                if reason in ('error', 'aborted', 'length'):
                    raise RuntimeError('Pi turn failed: '+str(message.get('errorMessage') or reason))
                if message.get('usage'):
                    usage.append(message['usage'])
                final = message
        if event.get('type') == 'agent_end':
            completed = True
    if not completed or not final or final.get('stopReason') != 'stop':
        raise RuntimeError('Pi did not finish a successful assistant turn')
    text = '\n'.join(c['text'] for c in final.get('content', []) if c.get('type') == 'text')
    if not text.strip():
        raise RuntimeError('Pi returned no final text')
    return {'text': text, 'usage': usage}


def run_agent(cfg, prompt, timeout, job=None):
    output = execute(command(cfg, job) + ['--mode', 'json', '--print'],
                     cwd=cfg.repo, env=cfg.env(), timeout=timeout, input=prompt)
    return parse_events(output)
