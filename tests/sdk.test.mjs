/** Real pinned Pi SDK against loopback fixtures. No model/API credentials needed. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Config } from '../dist/config.js';
import { initialize } from '../dist/profile.js';
import { writeJson } from '../dist/files.js';
import { runAgent, listModels } from '../dist/agent.js';

async function fixture(t, handle) {
  const root=mkdtempSync(join(tmpdir(),'wiki-sdk-'));
  const cfg=new Config({profile:join(root,'profile')}); await initialize(cfg);
  const requests=[];
  const server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const body=JSON.parse(text);requests.push({path:req.url,auth:req.headers.authorization,body});
    handle(req,res,body,requests.length,cfg);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});});
  writeJson(join(cfg.profile,'.pi/agent/models.json'),{providers:{fixture:{
    baseUrl:`http://127.0.0.1:${server.address().port}/v1`,api:'openai-completions',apiKey:'$FIXTURE_API_KEY',
    compat:{supportsDeveloperRole:false,supportsReasoningEffort:false},
    models:[{id:'fixture',contextWindow:32768,maxTokens:1024}],
  }}});
  cfg.local.pi={provider:'fixture',model:'fixture',thinking:'off'};
  cfg.local.environment={FIXTURE_API_KEY:'fixture-test-key'};
  return {cfg,requests};
}
function stream(res,delta,reason='stop') {
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  for(const value of [
    {id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta,finish_reason:null}]},
    {id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{},finish_reason:reason}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}},
  ])res.write('data: '+JSON.stringify(value)+'\n\n');
  res.end('data: [DONE]\n\n');
}
test('SDK resolves models, authenticates, edits via native tools and saves session',async t=>{
  const {cfg,requests}=await fixture(t,(_req,res,_body,n,cfg)=>{
    if(n===1)stream(res,{role:'assistant',tool_calls:[{index:0,id:'call_edit',type:'function',function:{name:'edit',arguments:JSON.stringify({path:join(cfg.wiki,'sample.md'),oldText:'Original evidence',newText:'Updated evidence'})}}]},'tool_calls');
    else stream(res,{role:'assistant',content:'Updated the fixture page.'});
  });
  writeFileSync(join(cfg.wiki,'sample.md'),'Original evidence\n');
  const models=await listModels(cfg);assert.ok(models.some(m=>m.provider==='fixture'&&m.id==='fixture'));
  const result=await runAgent(cfg,'Update the sample page.',30);
  assert.equal(result.text,'Updated the fixture page.');
  assert.equal(readFileSync(join(cfg.wiki,'sample.md'),'utf8'),'Updated evidence\n');
  assert.equal(requests.length,2);assert.equal(requests[0].path,'/v1/chat/completions');assert.equal(requests[0].auth,'Bearer fixture-test-key');
  assert.ok(requests[1].body.messages.some(m=>m.role==='tool'));assert.equal(result.usage.length,2);
  assert.ok(result.sessionId);assert.ok(result.sessionFile);assert.ok(readdirSync(join(cfg.state,'sessions')).some(x=>x.endsWith('.jsonl')));
  const system=JSON.stringify(requests[0].body.messages);
  assert.match(system,/source-triage/);assert.match(system,/Wiki/);
});
test('SDK uses configured local dummy key without external credentials',async t=>{
  const {cfg,requests}=await fixture(t,(_req,res)=>stream(res,{role:'assistant',content:'OK'}));
  const models=JSON.parse(readFileSync(join(cfg.profile,'.pi/agent/models.json'),'utf8'));models.providers.fixture.apiKey='local-no-key';writeJson(join(cfg.profile,'.pi/agent/models.json'),models);
  assert.equal((await runAgent(cfg,'Reply OK',30)).text,'OK');assert.equal(requests[0].auth,'Bearer local-no-key');
});
test('SDK reports final API failure instead of success',async t=>{
  const {cfg}=await fixture(t,(_req,res)=>{res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'fixture unauthorized',type:'authentication_error'}}));});
  await assert.rejects(runAgent(cfg,'test',30),/did not complete|401|unauthorized/);
});
test('SDK recovers from a transient API error before reporting its final result',async t=>{
  const {cfg,requests}=await fixture(t,(_req,res,_body,n)=>{
    if(n===1){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'temporarily overloaded'}}));}
    else stream(res,{role:'assistant',content:'Recovered after retry'});
  });
  writeJson(join(cfg.profile,'.pi/agent/settings.json'),{retry:{enabled:true,maxRetries:1,baseDelayMs:10}});
  assert.equal((await runAgent(cfg,'test retry',30)).text,'Recovered after retry');
  assert.ok(requests.length>=2);
});
test('SDK bash tools receive the profile environment without changing the parent',async t=>{
  const operatorHome=process.env.HOME;
  const {cfg,requests}=await fixture(t,(_req,res,_body,n)=>{
    if(n===1)stream(res,{role:'assistant',tool_calls:[{index:0,id:'call_env',type:'function',function:{name:'bash',arguments:JSON.stringify({command:'printf "%s\\n" "$HOME" "$PWD" "$AI_TOPICS_PROFILE"'})}}]},'tool_calls');
    else stream(res,{role:'assistant',content:'Environment checked'});
  });
  assert.equal((await runAgent(cfg,'Inspect the profile environment',30)).text,'Environment checked');
  const tool=requests[1].body.messages.find(m=>m.role==='tool');
  assert.ok(tool);assert.ok(JSON.stringify(tool).includes(cfg.profile));assert.ok(JSON.stringify(tool).includes(cfg.repo));
  assert.equal(process.env.HOME,operatorHome);
});
test('SDK rejects truncated output',async t=>{
  const {cfg}=await fixture(t,(_req,res)=>stream(res,{role:'assistant',content:'partial'},'length'));
  writeJson(join(cfg.profile,'.pi/agent/settings.json'),{retry:{enabled:false},compaction:{enabled:false}});
  await assert.rejects(runAgent(cfg,'test',30),/length|did not complete/);
});
test('SDK timeout aborts a stalled request and permits the next session',async t=>{
  const {cfg}=await fixture(t,(_req,res,_body,n)=>{if(n>1)stream(res,{role:'assistant',content:'Recovered'});});
  await assert.rejects(runAgent(cfg,'wait',1),/timed out/);
  assert.equal((await runAgent(cfg,'next',30)).text,'Recovered');
});
test('SDK loads explicit extensions and passes their tool results back to the model',async t=>{
  const {cfg,requests}=await fixture(t,(_req,res,_body,n)=>{
    if(n===1)stream(res,{role:'assistant',tool_calls:[{index:0,id:'call_custom',type:'function',function:{name:'fixture_echo',arguments:'{}'}}]},'tool_calls');
    else stream(res,{role:'assistant',content:'Extension worked'});
  });
  const path=join(cfg.profile,'fixture-extension.mjs');
  writeFileSync(path,`export default function(pi){pi.registerTool({name:'fixture_echo',label:'Fixture',description:'Fixture echo',parameters:{type:'object',properties:{}},async execute(){return {content:[{type:'text',text:'fixture-result'}],details:{}}}})}`);
  cfg.local.pi.extensions=[path];
  assert.equal((await runAgent(cfg,'Use fixture_echo',30)).text,'Extension worked');
  assert.ok(requests[0].body.tools.some(t=>t.function.name==='fixture_echo'));
  assert.match(JSON.stringify(requests[1].body.messages),/fixture-result/);
});
