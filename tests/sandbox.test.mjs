import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Config } from '../dist/config.js';
import { initialize } from '../dist/profile.js';
import { agentRequest } from '../dist/agent.js';
import { checkSandbox, probeSandbox, sandboxTool } from '../dist/sandbox.js';
import { sandboxTools, sandboxExtension } from '../dist/sandbox-tools.js';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wiki-sandbox-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const cfg = new Config({profile: join(root, 'profile with spaces')});
  await initialize(cfg);
  const request = agentRequest(cfg);
  await checkSandbox(request);
  return {cfg, request};
}
test('native sandbox enforces real filesystem, symlink, environment and network boundaries', async t => {
  const {cfg, request} = await fixture(t);
  const checks = await probeSandbox(request);
  assert.equal(Object.keys(checks).length, 12);
  assert.ok(Object.values(checks).every(Boolean));
  writeFileSync(join(cfg.state, 'secrets.json'), '{"SECRET_TOKEN":"synthetic-private"}');
  for (const name of ['read', 'write', 'edit', 'bash']) {
    const params = {
      read: {path: join(cfg.state, 'secrets.json')},
      write: {path: join(cfg.state, 'secrets.json'), content: 'changed'},
      edit: {path: join(cfg.state, 'secrets.json'), oldText: 'synthetic-private', newText: 'changed'},
      bash: {command: 'cat "$HOME/.ai-topics/secrets.json"'},
    }[name];
    await sandboxTool(request, name, params).then(result => {
      assert.equal(result.isError, true, `${name} must report a denied operation`);
    }, error => assert.ok(error instanceof Error));
  }
  assert.match(readFileSync(join(cfg.state, 'secrets.json'), 'utf8'), /synthetic-private/);
  const triage = {...request, job: 'blog-triage'};
  await assert.rejects(sandboxTool(triage, 'write', {path: join(cfg.wiki, 'new.md'), content: 'denied'}));
  const result = await sandboxTool(request, 'bash', {command: 'node -e "console.log(JSON.stringify(process.env))"'});
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private|API_KEY|SECRET_TOKEN/);
});
test('research network works; Python helpers work; raw broker only creates new files', async t => {
  const {cfg, request} = await fixture(t);
  const server = createServer((_req, res) => res.end('<html><body>Public fixture evidence</body></html>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const research = {...request, job: 'active-crawl'};
  const result = await sandboxTool(research, 'bash', {command: `wiki-script fetch_article.py http://127.0.0.1:${server.address().port}/`});
  assert.match(JSON.stringify(result), /Public fixture evidence/);
  const save = sandboxTools(research).find(t => t.name === 'save_raw');
  await save.execute('test', {filename: 'fixture.md', content: 'Original evidence'});
  await assert.rejects(save.execute('test', {filename: 'fixture.md', content: 'replacement'}), /EEXIST/);
  await assert.rejects(save.execute('test', {filename: '../secrets.md', content: 'bad'}), /Invalid/);
  await assert.rejects(sandboxTool(research, 'write', {path: join(cfg.wiki, 'raw/articles/fixture.md'), content: 'bad'}));
  assert.equal(readFileSync(join(cfg.wiki, 'raw/articles/fixture.md'), 'utf8'), 'Original evidence');
  assert.ok(!sandboxTools({...research, pi: {network_jobs: []}}).some(t => t.name === 'web_search'));
});
test('interactive shell uses the same boundary and propagates nonzero exits', async t => {
  const {request} = await fixture(t);
  let handler;
  sandboxExtension(request)({on: (name, callback) => { assert.equal(name, 'user_bash'); handler = callback; }});
  const {operations} = handler();
  let output = '';
  const result = await operations.exec('cat "$HOME/.pi/agent/auth.json"; exit 7', request.repo, {onData: data => { output += data; }});
  assert.equal(result.exitCode, 7);
  assert.match(output, /No such file|Permission denied/);
});
test('unsafe mount paths and aborted tools fail without executing on the host', async t => {
  const {cfg, request} = await fixture(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(sandboxTool(request, 'write', {path: join(cfg.wiki, 'aborted.md'), content: 'bad'}, controller.signal));
  rmSync(join(cfg.state, 'work'), {recursive: true});
  symlinkSync(cfg.profile, join(cfg.state, 'work'));
  await assert.rejects(checkSandbox(request), /symlink/);
});
test('timeout terminates sandbox descendants and leaves the next tool usable', async t => {
  const {cfg, request} = await fixture(t);
  await assert.rejects(sandboxTool(request, 'bash', {
    command: 'echo started > "$WIKI_WORK_DIR/started"; (sleep 3; echo orphan > "$WIKI_WORK_DIR/orphan") & wait',
  }, undefined, 1.5), /timed out/);
  assert.ok(existsSync(join(cfg.state, 'work/started')));
  await delay(2300);
  assert.equal(existsSync(join(cfg.state, 'work/orphan')), false);
  const result = await sandboxTool(request, 'write', {path: join(cfg.wiki, 'after.md'), content: 'ready'});
  assert.ok(result.content.length);
});
