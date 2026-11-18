import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {project,nextActions} from '../src/model.mjs';
import {render} from '../src/render.mjs';
import {NativeClient,envelope,nativeSessions} from '../src/native.mjs';
import {createWorker,validAnswers} from '../main.mjs';

const message=(sequence,text,role='assistant')=>({itemId:`m${sequence}`,sequence,body:{kind:'message',role,blocks:[{type:'text',text}]},turnScope:{turnItemId:'turn1'}});
const call=(sequence,name,input,output={})=>({itemId:`t${sequence}`,sequence,body:{kind:'tool-call',name,input,output,state:'completed'}});
const page=items=>({items,fence:2,working:false,latestTurn:{itemId:'turn1'},liveCursor:{epoch:'e1',sequence:20},actionablePromptIds:[]});

test('progress follows completed tool calls and preserves completed lists',()=>{
 const p=project(page([
  call(1,'TaskCreate',{subject:'調査',metadata:{goal:'確認'}},{task:{id:'1'}}),
  call(2,'TaskCreate',{subject:'報告',metadata:{goal:'確認'}},'Task #2 created successfully: 報告'),
  call(3,'TaskUpdate',{taskId:'1',status:'completed'}),
  call(4,'TaskUpdate',{taskId:'2',status:'in_progress'}),
 ]));
 assert.equal(p.progress.goal,'確認');assert.deepEqual(p.progress.tasks.map(t=>t.status),['completed','in_progress']);
});
test('snapshots must come from assistant, use valid states, and newer updates win',()=>{
 const snapshot='```milestone\n{"goal":"現在","tasks":[{"subject":"確認","status":"in_progress"}]}\n```';
 assert.equal(project(page([message(1,snapshot,'user')])).progress,null);
 assert.equal(project(page([message(1,snapshot,'reasoning')])).progress,null);
 assert.equal(project(page([message(1,snapshot.replace('in_progress','fake'))])).progress,null);
 assert.equal(project(page([message(1,snapshot)])).progress.goal,'現在');
});
test('next actions only from current assistant turn and never while busy',()=>{
 const next='```next\n[{"label":"要約","prompt":"1文で要約して"}]\n```';
 assert.equal(project(page([message(1,next,'user')])).offers.length,0);
 assert.equal(project({...page([message(1,next)]),working:true}).offers.length,0);
 assert.equal(project({...page([message(1,next)]),latestTurn:{itemId:'turn2'}}).offers.length,0);
 assert.equal(project(page([message(1,next)])).offers.length,1);
 assert.equal(nextActions(next+'\n別の文章').length,0);
 assert.equal(nextActions(next.replace('1文で要約して','/exit')).length,0);
});
test('malicious log content is escaped and never becomes markup or script',()=>{
 const html=render({workspace:{displayName:'<img src=x onerror=alert(1)>'},sessions:[{id:'s'}],session:{id:'s',title:'<script>x</script>'},progress:{goal:'<svg onload=x>',tasks:[{subject:'" onclick="x',status:'pending'}]}},()=> 'route');
 assert(!html.includes('<img'));assert(!html.includes('<script>'));assert(html.includes('&lt;svg'));
});
test('question answers reject forged options, duplicates and excess selections',()=>{
 const item={body:{question:'どちら',options:[{id:'a'},{id:'b'}]}};
 assert(validAnswers(item,[{questionId:'q1',optionIds:['a']}]));
 assert(!validAnswers(item,[{questionId:'q1',optionIds:['forged']}]));
 assert(!validAnswers(item,[{questionId:'q1',optionIds:['a','b']}]));
 assert(!validAnswers(item,[{questionId:'q1',optionIds:['a'],other:'secret'}]));
});
test('native pending resolution is actionable; resolved prompts are not',()=>{
 const q={itemId:'q',revision:1,body:{kind:'question',resolution:{state:'pending'},question:'選択',options:[]}};
 assert.equal(project({...page([q]),actionablePromptIds:['q']}).questions.length,1);
 q.body.resolution.state='answered';
 assert.equal(project({...page([q]),actionablePromptIds:['q']}).questions.length,0);
});
test('native sends preserve fence and refuse active turns without sending',async()=>{
 let n=0;
 const client=new NativeClient({client:{call:async(method,params)=>{n++;assert.equal(params.envelope.expectedRuntimeFence,2);return {ok:true,result:{ok:true}};}}});
 await assert.rejects(()=>client.send('s',{...page([]),working:true},'hello','op'));
 assert.equal(n,0);await client.send('s',page([]),'hello','op');assert.equal(n,1);
});
test('fingerprint matches installed Orca protocol', {skip:!existsSync('/Applications/Orca.app/Contents/Resources/app.asar.unpacked/out')},()=>{
 const require=createRequire(import.meta.url);
 const {structuredAgentSessionPayloadFingerprint:f}=require('/Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/shared/agent-session/lifecycle/operations/structured-agent-session-mutation.js');
 const fields={body:{kind:'message',role:'user',blocks:[{type:'text',text:'日本語'}]}};
 assert.equal(envelope('agentSession.send','s',2,fields,'op').payloadFingerprint,f({method:'agentSession.send',sessionId:'s',fields}));
});
function fixture(){
 const store=new Map();let sends=0;
 const w={worktreeId:'w1',displayName:'test',isActive:true,agents:[{structuredHostOwned:true,paneKey:'structured-agent-session-claude_1234:leaf',state:'done'}]};
 const p=page([]);
 const worker=createWorker({host:{call:async()=>({workspaceId:'w1'})},storage:{get:async k=>store.get(k),set:async(k,v)=>store.set(k,v)}},{workspaces:async()=>[w],history:async()=>p,send:async()=>{sends++;},reveal:async()=>{}});
 return {worker,w,p,sends:()=>sends};
}
test('workspace switch and stale cards cannot dispatch into another conversation',async()=>{
 const f=fixture(),v=await f.worker.view();
 const token=/data-action="([a-f0-9]+)"/.exec(v.html)[1];
 f.w.worktreeId='other';await assert.rejects(()=>f.worker.action({token}));assert.equal(f.sends(),0);
});
test('each button is dispatched at most once, including repeated clicks',async()=>{
 const f=fixture(),v=await f.worker.view();const token=/data-action="([a-f0-9]+)"/.exec(v.html)[1];
 await f.worker.action({token});await assert.rejects(()=>f.worker.action({token}));assert.equal(f.sends(),1);
});
test('native discovery does not mistake terminal sessions for chats',()=>{
 assert.equal(nativeSessions({agents:[{paneKey:'structured-agent-session-claude_1234:leaf'}]}).length,0);
});
