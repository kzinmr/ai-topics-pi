"""Collect recent successful run reports by name, never scheduler-specific IDs."""
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from pipeline_watchdog import inspect

state = Path(os.environ['AI_TOPICS_STATE'])
reports = {}
with sqlite3.connect(f'file:{state / "runs.db"}?mode=ro', uri=True) as db:
    for job in ('wiki-health-fix', 'wiki-graph-analysis'):
        row = db.execute('SELECT id,finished FROM runs WHERE job=? AND status=? ORDER BY started DESC LIMIT 1',
                         (job, 'ok')).fetchone()
        if row and (datetime.now(timezone.utc)-datetime.fromisoformat(row[1])).total_seconds() < 8*86400:
            reports[job] = (state/'runs'/row[0]/'response.md').read_text()[:12000]
print(json.dumps({'pipeline': inspect(), 'reports': reports}, ensure_ascii=False))
