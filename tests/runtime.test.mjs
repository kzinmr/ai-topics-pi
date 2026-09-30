import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { Config } from '../dist/config.js';
import { initialize } from '../dist/profile.js';
import { run, tick } from '../dist/runner.js';
import { completeBacklog, validateTriage, wakeAgent } from '../dist/results.js';
import { Store, lockProfile } from '../dist/state.js';
import { execute } from '../dist/process.js';
import { readJson, writeJson, inside } from '../dist/files.js';
import { enqueue, deliver } from '../dist/delivery.js';
import { cronMatches } from '../dist/schedule.js';
import { importState } from '../dist/migrate.js';
import { publish } from '../dist/publish.js';

let root, cfg;
beforeEach(async () => { root = mkdtempSync(join(tmpdir(), 'wiki-ts-')); cfg = new Config({profile: join(root, 'profile')}); await initialize(cfg); });
afterEach(() => rmSync(root, {recursive: true, force: true}));
const agent = async () => ({text: 'Completed', usage: []});

test('profile init is isolated and rejects overwrite', async () => {
  assert.equal(realpathSync(cfg.wiki), join(cfg.repo, 'wiki'));
  assert.equal(existsSync(join(cfg.profile, '.hermes')), false);
  await assert.rejects(initialize(cfg), /empty destination/);
});
test('CLI uses the selected profile, keeps dry-run read-only and reports failure', () => {
  const cli=(...args)=>spawnSync(process.execPath,['dist/cli.js','--profile',cfg.profile,...args],{cwd:cfg.source,encoding:'utf8'});
  const dry=cli('run','blog-triage','--dry-run');
  assert.equal(dry.status,0,dry.stderr);
  const request=JSON.parse(dry.stdout);
  assert.equal(request.sdk.profile,cfg.profile);assert.equal(request.sdk.mode,'prompt');
  assert.equal(existsSync(join(cfg.state,'runs.db')),false);
  const failure=cli('run','blog-triage');
  assert.equal(failure.status,1);assert.equal(JSON.parse(failure.stdout).status,'error');
  const status=cli('status');assert.equal(status.status,0,status.stderr);
  assert.equal(JSON.parse(status.stdout)['blog-triage'].status,'error');
  const service=cli('systemd-service');assert.equal(service.status,0,service.stderr);
  assert.ok(service.stdout.includes(`AI_TOPICS_PROFILE=${cfg.profile}`));
  assert.ok(service.stdout.includes(`${cfg.source}/bin/wiki`));assert.ok(!service.stdout.includes('@SOURCE@'));
});
test('profile mutex excludes other connections and releases on close', () => {
  const release = lockProfile(cfg.state);
  assert.throws(() => lockProfile(cfg.state), /busy/);
  release(); lockProfile(cfg.state)();
});
test('profile mutex releases after process crash', async () => {
  const module = new URL('../dist/state.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {lockProfile} from ${JSON.stringify(module)}; lockProfile(${JSON.stringify(cfg.state)}); console.log('locked'); setInterval(()=>{},1000)`]);
  await new Promise((resolve,reject) => { child.stdout.once('data', resolve); child.once('error',reject); });
  assert.throws(() => lockProfile(cfg.state), /busy/);
  child.kill('SIGKILL'); await new Promise(resolve => child.once('close', resolve));
  lockProfile(cfg.state)();
});
test('timeout kills subprocess descendants even when they ignore SIGTERM', async () => {
  const marker = join(root, 'orphan');
  const childCode = `process.on('SIGTERM',()=>{}); setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'bad'),800)`;
  const parentCode = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'}); setInterval(()=>{},1000)`;
  await assert.rejects(execute([process.execPath,'-e',parentCode], {cwd: root,env: process.env,timeout: .2}), /timeout/);
  await delay(1000); assert.equal(existsSync(marker),false);
});
test('failed dependency never exposes a downstream result', async () => {
  const result = await run(cfg,'blog-triage',agent);
  assert.equal(result.status,'error'); assert.match(result.error,/dependency/);
  assert.equal(existsSync(join(cfg.state,'runs',result.run,'response.md')),false);
});
test('collector ok:false stops Pi despite exit code zero', async () => {
  cfg.job('blog-triage').depends_on=[];
  const result=await run(cfg,'blog-triage',async()=>assert.fail('must not invoke agent'));
  assert.equal(result.status,'error'); assert.match(result.error,/pre-run/);
});
test('triage validates lineage and attaches source identities', () => {
  const source={run_id:'one',candidates:[{item_id:'a',url:'https://example.com'}]};
  const result={checkpoint_run_id:'one',decisions:[{item_id:'a',recommended_action:'take',reason_ja:'verified',url:'invented'}]};
  validateTriage('blog-triage',result,source);
  assert.equal(result.decisions[0].url,'https://example.com');
  for (const bad of [{...result,checkpoint_run_id:'old'},{...result,decisions:[]},{...result,decisions:[...result.decisions,...result.decisions]}]) assert.throws(()=>validateTriage('blog-triage',bad,source));
});
test('dreaming rejects invented article URLs', () => {
  assert.throws(()=>validateTriage('dreaming-group',{checkpoint_run_id:'one',groups:[{theme:'x',articles:[{url:'https://invented'}]}]},{_checkpoint:{run_id:'one'},articles:[]}),/unknown article/);
});
test('partial backlog receipts acknowledge nothing', () => {
  const source={collect_run_id:'one',articles:[{filename:'one.md',url:'https://one'}]};
  assert.throws(()=>completeBacklog(cfg,{collect_run_id:'one',completed:[]},source));
  assert.equal(existsSync(join(cfg.state,'processed_raw_articles.json')),false);
  completeBacklog(cfg,{collect_run_id:'one',completed:[{filename:'one.md',status:'done',reason_ja:'verified'}]},source);
  assert.equal(readJson(join(cfg.state,'processed_raw_articles.json'))['one.md'].status,'done');
});
test('successful triage reaches ingestion, newer collection invalidates it', async () => {
  Object.assign(cfg.job('blog-ingest'),{script:null,no_agent:false});
  assert.equal((await run(cfg,'blog-ingest',agent)).status,'ok');
  writeJson(join(cfg.state,'data/blog_ingest/latest.json'),{run_id:'one',saved_articles:[{url:'https://example.com',raw_path:join(cfg.wiki,'raw/articles/one.md')}]});
  const result=await run(cfg,'blog-triage',async()=>({text:JSON.stringify({checkpoint_run_id:'one',decisions:[{item_id:'blog-1',recommended_action:'take',reason_ja:'evidence'}]}),usage:[]}));
  assert.equal(result.status,'ok',JSON.stringify(result));
  const ingest=async(_cfg,prompt)=>{assert.match(prompt,/https:\/\/example.com/);return agent();};
  assert.equal((await run(cfg,'blog-wiki-ingest',ingest)).status,'ok');
  await delay(5);
  await run(cfg,'blog-ingest',agent);
  const stale=await run(cfg,'blog-wiki-ingest',agent);
  assert.equal(stale.status,'error');assert.match(stale.error,/predates/);
});
test('schedule is durable, catches up and respects paused jobs', async () => {
  for(const job of cfg.jobs) job.enabled=job.name==='trending-topics';
  cfg.job('trending-topics').schedule='* * * * *';
  const at=new Date('2026-09-30T12:00:00Z');
  assert.equal((await tick(cfg,at,agent)).length,1);
  assert.deepEqual(await tick(cfg,at,agent),[]);
  assert.equal((await tick(cfg,new Date(at.getTime()+120000),agent)).length,2);
  cfg.local.max_catchup_minutes=1;
  await assert.rejects(tick(cfg,new Date(at.getTime()+86400000),agent),/gap/);
});
test('existing SQLite schema and ISO offsets remain usable', () => {
  const store=new Store(cfg.state);
  store.start('old','trending-topics','2026-09-30T12:00:00.123456+00:00');
  store.finish('old','2026-09-30T12:00:01+00:00','ok',{text:'history'});
  store.db.prepare('INSERT INTO claims VALUES(?,?)').run('trending-topics','2026-09-30T12:00:00+00:00');
  assert.equal(store.claim('trending-topics','2026-09-30T12:00:00.000Z'),false);
  assert.equal(store.latest('trending-topics').id,'old'); store.close();
});
test('interrupted run blocks both scheduled and manual runs', async () => {
  const store=new Store(cfg.state);store.start('crash','trending-topics',new Date().toISOString());store.close();
  await assert.rejects(tick(cfg),/interrupted/);
  await assert.rejects(run(cfg,'trending-topics',agent),/interrupted/);
});
test('outbox retries delivery without repeating work and suppresses silence', async () => {
  const job=cfg.job('trending-topics');
  assert.equal(enqueue(cfg,'silence',job,'[SILENT]'),undefined);
  const path=enqueue(cfg,'one',job,'hello');
  cfg.local.delivery={operations:{kind:'command',command:[process.execPath,'-e','process.exit(1)']}};
  assert.equal((await deliver(cfg,path)).status,'failed');
  cfg.local.delivery.operations.command=[process.execPath,'-e',`let x='';process.stdin.on('data',d=>x+=d).on('end',()=>{if(JSON.parse(x).text!=='hello')process.exit(1)})`];
  assert.equal((await deliver(cfg,path)).status,'delivered');
  assert.equal((await deliver(cfg,path)).attempts,2);
});
test('publication failure does not invalidate completed inference', async () => {
  cfg.local.publish=true;
  const result=await run(cfg,'trending-topics',agent);
  assert.equal(result.status,'ok'); assert.equal(result.publication.status,'failed');
});
test('publish stages only wiki and runs repository hooks', async () => {
  const git=(...args)=>{const p=spawnSync('git',args,{cwd:cfg.repo,encoding:'utf8'});assert.equal(p.status,0,p.stderr);return p.stdout;};
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.com');
  writeFileSync(join(cfg.repo,'unrelated.txt'),'local');writeFileSync(join(cfg.wiki,'one.md'),'evidence');
  const hook=join(cfg.repo,'.git/hooks/pre-commit');writeFileSync(hook,'#!/bin/sh\nexit 1\n');chmodSync(hook,0o755);
  await assert.rejects(publish(cfg));assert.equal(git('diff','--cached','--name-only').trim(),'wiki/one.md');
  await assert.rejects(publish(cfg),/already staged/);
});
test('state import copies SQLite snapshot and rebases only allowed JSON', async () => {
  const old=join(root,'old');
  writeJson(join(old,'.hermes/processed_emails.json'),['one']);
  writeJson(join(old,'.hermes/cron/data/blog_ingest/latest.json'),{raw_path:'/opt/data/wiki/raw/a.md'});
  writeJson(join(old,'.hermes/auth.json'),{secret:'excluded'});
  writeJson(join(old,'.hermes/cron/jobs.json'),{jobs:[]});
  mkdirSync(join(old,'.blogwatcher'));
  const db=new DatabaseSync(join(old,'.blogwatcher/blogwatcher.db'));db.exec('CREATE TABLE sample(id INTEGER); INSERT INTO sample VALUES(1)');db.close();
  const report=await importState(cfg,old);assert.equal(report.json_files,2);assert.equal(report.rss_database,true);
  assert.equal(readJson(join(cfg.state,'data/blog_ingest/latest.json')).raw_path,join(cfg.wiki,'raw/a.md'));
  assert.equal(existsSync(join(cfg.state,'auth.json')),false);
  await assert.rejects(importState(cfg,old),/already/);
});
test('cron uses UTC and Vixie day semantics; malformed expressions fail', () => {
  const sunday=new Date('2026-10-04T00:00:00Z');
  assert.equal(cronMatches('0 0 1 * 0',sunday),true);assert.equal(cronMatches('0 0 * * 7',sunday),true);
  assert.equal(cronMatches('0 0 */2 * *',sunday),false);
  assert.throws(()=>cronMatches('NaN * * * *',sunday));assert.throws(()=>cronMatches('*/0 * * * *',sunday));
});
test('source paths cannot escape checkout and multiline wake gate is honored', () => {
  assert.throws(()=>inside(cfg.scripts,'../../outside'));
  assert.equal(wakeAgent('{\n"wakeAgent": false\n}'),false);
});
