"""Read the runner's durable view, excluding paused jobs from freshness alerts."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

def inspect():
    path = Path(os.environ['AI_TOPICS_JOBS_FILE'])
    jobs = json.loads(path.read_text())['jobs'] if path.exists() else []
    alerts = []
    now = datetime.now(timezone.utc)
    for job in jobs:
        if not job['enabled'] or job['name'] == 'pipeline-watchdog':
            continue
        if job['last_status'] == 'running':
            continue
        stamp = job['last_run_at']
        if not stamp:
            alerts.append({'job': job['name'], 'reason': 'not yet run'})
            continue
        fields = job['schedule']['expr'].split()
        grace = 192 if fields[4] != '*' else 74 if fields[2] != '*' else 30
        if job['last_status'] != 'ok' or (now-datetime.fromisoformat(stamp)).total_seconds() > grace*3600:
            alerts.append({'job': job['name'], 'status': job['last_status'], 'last_run_at': stamp})
    return {'alerts': alerts, 'checked': len(jobs)}

if __name__ == '__main__':
    print(json.dumps(inspect()))
