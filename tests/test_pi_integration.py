"""Real pinned Pi against a local OpenAI-compatible SSE fixture; no paid API."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'src'))
from ai_topics_pi.config import Config, json_write
from ai_topics_pi.pi import run_agent
from ai_topics_pi.profile import initialize


@unittest.skipUnless((ROOT/'node_modules/.bin/pi').exists(), 'npm ci required for real Pi integration')
class PiIntegration(unittest.TestCase):
    def test_compatible_auth_and_native_edit_tool(self):
        with tempfile.TemporaryDirectory() as temp:
            cfg = Config(profile=Path(temp)/'profile')
            initialize(cfg)
            page = cfg.wiki/'sample.md'
            page.write_text('Original evidence\n')
            requests = []
            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *args):
                    pass
                def do_POST(self):
                    body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                    requests.append((self.path, self.headers.get('Authorization'), body))
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/event-stream')
                    self.end_headers()
                    if len(requests) == 1:
                        delta = {'role': 'assistant', 'tool_calls': [{'index': 0, 'id': 'call_edit',
                            'type': 'function', 'function': {'name': 'edit', 'arguments': json.dumps({
                                'path': str(page), 'oldText': 'Original evidence', 'newText': 'Updated evidence'})}}]}
                        reason = 'tool_calls'
                    else:
                        delta = {'role': 'assistant', 'content': 'Updated the fixture page.'}
                        reason = 'stop'
                    for data in (
                        {'id': 'fixture', 'object': 'chat.completion.chunk', 'model': 'fixture',
                         'choices': [{'index': 0, 'delta': delta, 'finish_reason': None}]},
                        {'id': 'fixture', 'object': 'chat.completion.chunk', 'model': 'fixture',
                         'choices': [{'index': 0, 'delta': {}, 'finish_reason': reason}],
                         'usage': {'prompt_tokens': 100, 'completion_tokens': 10, 'total_tokens': 110}}):
                        self.wfile.write(('data: '+json.dumps(data)+'\n\n').encode())
                    self.wfile.write(b'data: [DONE]\n\n')
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                json_write(cfg.profile/'.pi/agent/models.json', {'providers': {'fixture': {
                    'baseUrl': f'http://127.0.0.1:{server.server_port}/v1',
                    'api': 'openai-completions', 'apiKey': '$FIXTURE_API_KEY',
                    'compat': {'supportsDeveloperRole': False, 'supportsReasoningEffort': False},
                    'models': [{'id': 'fixture', 'contextWindow': 32768, 'maxTokens': 1024}]}}})
                cfg.local['pi'] = {'provider': 'fixture', 'model': 'fixture', 'thinking': 'off'}
                cfg.local['environment'] = {'FIXTURE_API_KEY': 'fixture-test-key'}
                result = run_agent(cfg, 'Edit sample.md to say Updated evidence.', 30)
                self.assertEqual(result['text'], 'Updated the fixture page.')
                self.assertEqual(page.read_text(), 'Updated evidence\n')
                self.assertEqual(len(requests), 2)
                self.assertEqual(requests[0][0], '/v1/chat/completions')
                self.assertEqual(requests[0][1], 'Bearer fixture-test-key')
                self.assertTrue(any(m['role'] == 'tool' for m in requests[1][2]['messages']))
                self.assertEqual(len(result['usage']), 2)
                self.assertTrue(list((cfg.state/'sessions').glob('*.jsonl')))
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
