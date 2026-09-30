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
import { agentRequest, runAgent, listModels } from '../dist/agent.js';
import { makeModelRuntime } from '../dist/agent-session.js';
import { SettingsManager } from '@earendil-works/pi-coding-agent';

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

const tokenResponse = (access='fixture-oauth-access') => ({
  access_token:access,refresh_token:'fixture-refresh-rotated',expires_in:3600,
  scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',id_token:'fixture-id-token',
});
const oauthCredential = expires => ({type:'oauth',access:'fixture-oauth-access',refresh:'fixture-refresh',
  expires,clientId:'fixture-issued-client',scopes:['chatgpt.tokens.use.direct']});

test('built-in OpenAI login registers ChatGPT plan access and persists it in this profile',async t=>{
  const {cfg}=await fixture(t,()=>assert.fail('login must not call inference'));
  const runtime=await makeModelRuntime(agentRequest(cfg));
  const settings=SettingsManager.create(cfg.repo,join(cfg.profile,'.pi/agent'));
  const deviceId=settings.getOrCreateDeviceId();
  assert.equal(settings.getOrCreateDeviceId(),deviceId);
  let authorization,exchanged;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(String(url),'https://auth.openai.com/api/accounts/oauth/token');
    exchanged=new URLSearchParams(options.body);
    return Response.json(tokenResponse());
  });
  await runtime.login('openai','oauth',{
    signal:new AbortController().signal,
    notify:event=>{if(event.type==='auth_url')authorization=new URL(event.url);},
    prompt:async()=>{
      assert.ok(authorization);
      assert.equal(authorization.searchParams.get('client_id'),'dynamic_agent_client');
      assert.equal(authorization.searchParams.get('ext_agent_host_id'),`urn:uuid:${deviceId}`);
      assert.ok(authorization.searchParams.get('scope').split(' ').includes('chatgpt.tokens.use.direct'));
      const callback=new URL(authorization.searchParams.get('redirect_uri'));
      callback.search=new URLSearchParams({code:'fixture-code',client_id:'fixture-issued-client',state:authorization.searchParams.get('state')}).toString();
      return callback.href;
    },
  },{getDeviceId:()=>deviceId});
  assert.equal(exchanged.get('grant_type'),'authorization_code');
  assert.equal(exchanged.get('client_id'),'fixture-issued-client');
  assert.ok(exchanged.get('code_verifier'));
  const saved=JSON.parse(readFileSync(join(cfg.profile,'.pi/agent/auth.json'),'utf8'));
  assert.equal(saved.openai.clientId,'fixture-issued-client');
  assert.equal(saved.openai.type,'oauth');assert.equal(runtime.isUsingSubscription('openai'),true);
  assert.equal((await runtime.getAuth('openai')).auth.apiKey,'fixture-oauth-access');
  const restarted=await makeModelRuntime(agentRequest(cfg));
  assert.equal(restarted.isUsingSubscription('openai'),true);
});

test('OpenAI subscription refresh persists rotated tokens; failed refresh does not use an API key',async t=>{
  const {cfg}=await fixture(t,()=>assert.fail('refresh must not call inference'));
  const path=join(cfg.profile,'.pi/agent/auth.json');
  writeJson(path,{openai:oauthCredential(0)});
  let fail=false,refreshes=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(String(url),'https://auth.openai.com/api/accounts/oauth/token');
    const body=new URLSearchParams(options.body);
    assert.equal(body.get('grant_type'),'refresh_token');
    assert.equal(body.get('client_id'),'fixture-issued-client');refreshes++;
    return fail ? Response.json({error:'invalid_grant'},{status:400}) : Response.json(tokenResponse('fixture-new-access'));
  });
  const runtime=await makeModelRuntime(agentRequest(cfg));
  const auth=await runtime.getAuth('openai',{env:{OPENAI_API_KEY:'fixture-api-key'}});
  assert.equal(auth.auth.apiKey,'fixture-new-access');assert.ok(refreshes>=1);
  assert.equal(JSON.parse(readFileSync(path,'utf8')).openai.refresh,'fixture-refresh-rotated');
  writeJson(path,{openai:oauthCredential(0)});fail=true;
  await assert.rejects(runtime.getAuth('openai',{env:{OPENAI_API_KEY:'fixture-api-key'}}),/OAuth refresh failed/);
});

test('SDK worker sends subscription credentials to Responses instead of the ambient API key',async t=>{
  const {cfg,requests}=await fixture(t,(_req,res)=>{
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const item={id:'msg_fixture',type:'message',role:'assistant',content:[{type:'output_text',text:'Subscription OK',annotations:[]}]};
    for(const event of [
      {type:'response.created',response:{id:'resp_fixture',status:'in_progress'}},
      {type:'response.output_item.added',output_index:0,item:{...item,content:[]}},
      {type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},
      {type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:'Subscription OK'},
      {type:'response.output_item.done',output_index:0,item},
      {type:'response.completed',response:{id:'resp_fixture',status:'completed',output:[item],usage:{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:0}}}},
    ])res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  const modelPath=join(cfg.profile,'.pi/agent/models.json');
  const baseUrl=JSON.parse(readFileSync(modelPath,'utf8')).providers.fixture.baseUrl;
  writeJson(modelPath,{providers:{openai:{baseUrl}}});
  writeJson(join(cfg.profile,'.pi/agent/auth.json'),{openai:oauthCredential(Date.now()+3600_000)});
  cfg.local.pi={provider:'openai',model:'gpt-6.1-sol',thinking:'off'};
  cfg.local.environment={OPENAI_API_KEY:'fixture-api-key'};
  assert.equal((await runAgent(cfg,'Reply Subscription OK',30)).text,'Subscription OK');
  assert.equal(requests.length,1);assert.equal(requests[0].path,'/v1/responses');
  assert.equal(requests[0].auth,'Bearer fixture-oauth-access');
  assert.equal(requests[0].body.model,'gpt-6.1-sol');
});
