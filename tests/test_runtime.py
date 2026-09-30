import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'src'))
from ai_topics_pi.config import Config, json_write
from ai_topics_pi.profile import initialize
from ai_topics_pi.runner import run, tick, validate_triage, dependencies_ready, complete_backlog
from ai_topics_pi.state import Store, profile_lock
from ai_topics_pi.pi import parse_events
from ai_topics_pi.delivery import enqueue, deliver
from ai_topics_pi.schedule import cron_matches
from ai_topics_pi.migrate import import_state


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cfg = Config(profile=Path(self.temp.name)/'profile')
        initialize(self.cfg)

    def tearDown(self):
        self.temp.cleanup()

    def agent(self, cfg, prompt, timeout, job):
        return {'text': 'Completed', 'usage': []}

    def test_init_isolated_and_refuses_overwrite(self):
        self.assertEqual(self.cfg.wiki.resolve(), self.cfg.repo/'wiki')
        self.assertFalse((self.cfg.profile/'.hermes').exists())
        with self.assertRaises(ValueError):
            initialize(self.cfg)

    def test_profile_lock(self):
        with profile_lock(self.cfg.state):
            with self.assertRaises(RuntimeError):
                with profile_lock(self.cfg.state):
                    pass

    def test_process_timeout_kills_descendants(self):
        import subprocess
        import time
        from ai_topics_pi.process import execute
        marker = Path(self.temp.name)/'orphan-wrote'
        child = 'import signal,time,pathlib; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(1); pathlib.Path('+repr(str(marker))+').touch()'
        parent = 'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",'+repr(child)+']); time.sleep(10)'
        with self.assertRaises(subprocess.TimeoutExpired):
            execute([sys.executable, '-c', parent], cwd=self.temp.name, env=os.environ.copy(), timeout=.2)
        time.sleep(1.1)
        self.assertFalse(marker.exists())

    def test_failure_does_not_publish_downstream_output(self):
        result = run(self.cfg, 'blog-triage', self.agent)
        self.assertEqual(result['status'], 'error')
        self.assertIn('dependency', result['error'])
        self.assertFalse((self.cfg.state/'runs'/result['run']/'response.md').exists())

    def test_script_ok_false_stops_agent(self):
        # Collection is not invoked: checkpoint reader fails with exit 0.
        self.cfg.job('blog-triage')['depends_on'] = []
        def forbidden(*args):
            self.fail('agent invoked after checkpoint failure')
        result = run(self.cfg, 'blog-triage', forbidden)
        self.assertEqual(result['status'], 'error')
        self.assertIn('pre-run', result['error'])

    def test_json_lineage_and_identity(self):
        source = {'run_id': 'one', 'candidates': [{'item_id': 'a', 'url': 'https://example.com'}]}
        result = {'checkpoint_run_id': 'one', 'decisions': [
            {'item_id': 'a', 'recommended_action': 'take', 'reason_ja': 'new evidence', 'url': 'invented'}]}
        validate_triage('blog-triage', result, source)
        self.assertEqual(result['decisions'][0]['url'], 'https://example.com')
        for bad in ({**result, 'checkpoint_run_id': 'old'}, {**result, 'decisions': []},
                    {**result, 'decisions': result['decisions'] * 2}):
            with self.assertRaises(ValueError):
                validate_triage('blog-triage', bad, source)

    def test_backlog_partial_receipt_does_not_acknowledge_batch(self):
        source = {'collect_run_id': 'one', 'articles': [{'filename': 'one.md', 'url': 'https://one'}]}
        with self.assertRaises(ValueError):
            complete_backlog(self.cfg, {'collect_run_id': 'one', 'completed': []}, source)
        self.assertFalse((self.cfg.state/'processed_raw_articles.json').exists())
        complete_backlog(self.cfg, {'collect_run_id': 'one', 'completed': [
            {'filename': 'one.md', 'status': 'done', 'reason_ja': 'verified'}]}, source)
        data = json.loads((self.cfg.state/'processed_raw_articles.json').read_text())
        self.assertEqual(data['one.md']['status'], 'done')

    def test_publish_scopes_files_and_runs_hooks(self):
        import subprocess
        from ai_topics_pi.publish import publish
        cfg = self.cfg
        def git(*args):
            return subprocess.check_output(['git', *args], cwd=cfg.repo, stderr=subprocess.DEVNULL).decode()
        git('init', '-q')
        git('config', 'user.name', 'Fixture')
        git('config', 'user.email', 'fixture@example.com')
        (cfg.repo/'unrelated.txt').write_text('keep local')
        (cfg.wiki/'sample.md').write_text('evidence')
        hook = cfg.repo/'.git/hooks/pre-commit'
        hook.write_text('#!/bin/sh\nexit 1\n')
        hook.chmod(0o755)
        with self.assertRaises(RuntimeError):
            publish(cfg)
        self.assertEqual(git('diff', '--cached', '--name-only').strip(), 'wiki/sample.md')
        with self.assertRaisesRegex(RuntimeError, 'already staged'):
            publish(cfg)

    def test_chain_reads_successful_json(self):
        cfg = self.cfg
        cfg.job('blog-ingest')['script'] = None
        cfg.job('blog-ingest')['no_agent'] = False
        self.assertEqual(run(cfg, 'blog-ingest', self.agent)['status'], 'ok')
        json_write(cfg.state/'data/blog_ingest/latest.json', {'run_id': 'one', 'saved_articles': [
            {'url': 'https://example.com', 'raw_path': str(cfg.wiki/'raw/articles/one.md')}]})
        def triage(*args):
            return {'text': json.dumps({'checkpoint_run_id': 'one', 'decisions': [
                {'item_id': 'blog-1', 'recommended_action': 'take', 'reason_ja': 'technical evidence'}]})}
        result = run(cfg, 'blog-triage', triage)
        self.assertEqual(result['status'], 'ok', result)
        def ingest(cfg, prompt, timeout, job):
            self.assertIn('https://example.com', prompt)
            self.assertIn('checkpoint_run_id', prompt)
            return {'text': 'integrated'}
        self.assertEqual(run(cfg, 'blog-wiki-ingest', ingest)['status'], 'ok')
        # A newer collector invalidates the old triage even when it succeeded.
        run(cfg, 'blog-ingest', self.agent)
        result = run(cfg, 'blog-wiki-ingest', self.agent)
        self.assertEqual(result['status'], 'error')
        self.assertIn('predates', result['error'])

    def test_tick_is_durable_and_paused_jobs_stay_paused(self):
        cfg = self.cfg
        for job in cfg.jobs:
            job['enabled'] = job['name'] == 'trending-topics'
        cfg.job('trending-topics')['schedule'] = '* * * * *'
        at = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)
        self.assertEqual(len(tick(cfg, at, self.agent)), 1)
        self.assertEqual(tick(cfg, at, self.agent), [])
        self.assertEqual(len(tick(cfg, at+timedelta(minutes=2), self.agent)), 2)
        cfg.local['max_catchup_minutes'] = 1
        with self.assertRaises(RuntimeError):
            tick(cfg, at+timedelta(days=1), self.agent)

    def test_interrupted_run_requires_recovery(self):
        store = Store(self.cfg.state)
        store.start('crash', 'trending-topics', datetime.now(timezone.utc).isoformat())
        store.close()
        with self.assertRaisesRegex(RuntimeError, 'interrupted'):
            tick(self.cfg, adapter=self.agent)

    def test_pi_errors_and_incomplete_stream_fail(self):
        for reason in ('error', 'aborted', 'length', 'toolUse'):
            events = [{'type': 'message_end', 'message': {'role': 'assistant', 'stopReason': reason}},
                      {'type': 'agent_end'}]
            with self.assertRaises(RuntimeError):
                parse_events('\n'.join(map(json.dumps, events)))
        with self.assertRaises(RuntimeError):
            parse_events('{}')

    def test_outbox_retry_does_not_repeat_work(self):
        cfg = self.cfg
        job = cfg.job('trending-topics')
        self.assertIsNone(enqueue(cfg, 'silent', job, '[SILENT]'))
        path = enqueue(cfg, 'run', job, 'hello')
        cfg.local['delivery'] = {'operations': {'kind': 'command', 'command': [sys.executable, '-c', 'raise SystemExit(1)']}}
        self.assertEqual(deliver(cfg, path)['status'], 'failed')
        cfg.local['delivery']['operations']['command'] = [sys.executable, '-c', 'import sys,json; assert json.load(sys.stdin)["text"] == "hello"']
        self.assertEqual(deliver(cfg, path)['status'], 'delivered')
        self.assertEqual(deliver(cfg, path)['attempts'], 2)

    def test_state_import_rebases_and_excludes_credentials(self):
        import sqlite3
        old = Path(self.temp.name)/'old'
        json_write(old/'.hermes/processed_emails.json', ['message-one'])
        json_write(old/'.hermes/cron/data/blog_ingest/latest.json', {'raw_path': '/opt/data/wiki/raw/a.md'})
        json_write(old/'.hermes/auth.json', {'secret': 'not-imported'})
        json_write(old/'.hermes/cron/jobs.json', {'jobs': []})
        (old/'.blogwatcher').mkdir()
        with sqlite3.connect(old/'.blogwatcher/blogwatcher.db') as db:
            db.execute('CREATE TABLE sample (id INTEGER)')
            db.execute('INSERT INTO sample VALUES (1)')
        result = import_state(self.cfg, old)
        self.assertEqual(result['json_files'], 2)
        self.assertFalse((self.cfg.state/'auth.json').exists())
        data = json.loads((self.cfg.state/'data/blog_ingest/latest.json').read_text())
        self.assertEqual(data['raw_path'], str(self.cfg.wiki/'raw/a.md'))
        with self.assertRaises(ValueError):
            import_state(self.cfg, old)

    def test_cron_utc_day_semantics(self):
        sunday = datetime(2026, 10, 4, tzinfo=timezone.utc)
        self.assertTrue(cron_matches('0 0 1 * 0', sunday))
        self.assertTrue(cron_matches('0 0 * * 7', sunday))
        self.assertFalse(cron_matches('0 0 */2 * *', sunday))


if __name__ == '__main__':
    unittest.main()
