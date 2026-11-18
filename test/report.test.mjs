import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {handle} from '../scripts/report-server.mjs';
import {REPORT_TOOL,validateReport} from '../src/report.mjs';
import {project} from '../src/model.mjs';
import {INSTRUCTIONS} from '../src/instructions.mjs';

const report={goal:'確認',tasks:[{id:'1',subject:'調べる',status:'completed'}],nextActions:[{label:'要約',prompt:'要点を1文で説明して',reason:'調査が終わったため'}]};
const call=(sequence,input=report)=>({itemId:'report',sequence,turnScope:{turnItemId:'turn1'},body:{kind:'tool-call',name:REPORT_TOOL,input,state:'completed'}});
const page=items=>({items,latestTurn:{itemId:'turn1'},working:false,actionablePromptIds:[]});

test('local report supplies progress and next actions without assistant JSON',()=>{
 const m=project(page([call(1)]));
 assert.equal(m.progress.goal,'確認');assert.equal(m.offers[0].label,'要約');assert(m.reportRecorded);
});
test('reports from older turns cannot send stale next actions',()=>{
 const m=project({...page([call(1)]),latestTurn:{itemId:'turn2'}});
 assert.equal(m.offers.length,0);assert.equal(m.progress.goal,'確認');assert(m.previousProgress);
});
test('invalid or failed tool reports do not update the panel',()=>{
 const bad=call(1,{...report,tasks:[{id:'1',subject:'invalid',status:'invented'}]});
 assert.equal(project(page([bad])).progress,null);
 const failed=call(1);failed.body.isError=true;assert.equal(project(page([failed])).progress,null);
 const wrong=call(1);wrong.body.name='mcp__other__update_panel';assert.equal(project(page([wrong])).progress,null);
});
test('reports validate unique tasks, one current task, and bounded safe offers',()=>{
 assert(validateReport(report));
 assert(!validateReport({...report,tasks:[report.tasks[0],report.tasks[0]]}));
 assert(!validateReport({...report,tasks:[{id:'1',subject:'a',status:'in_progress'},{id:'2',subject:'b',status:'in_progress'}]}));
 assert(!validateReport({...report,nextActions:[{label:'exit',prompt:'/exit'}]}));
 assert(!validateReport({...report,execute:'shell'}));
});
test('stdio report server initializes, validates calls and keeps report content out of responses',()=>{
 const input=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'update_panel',arguments:report}}].map(x=>JSON.stringify(x)).join('\n')+'\n';
 const env={...process.env,ORCA_STRUCTURED_SESSION:'1',ORCA_AGENT_SESSION_ID:'test'};
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/report-server.mjs',import.meta.url))],{env,input,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 const responses=r.stdout.trim().split('\n').map(JSON.parse);
 assert.equal(responses.length,3);assert.equal(responses[1].result.tools[0].name,'update_panel');
 assert(!r.stdout.includes('要点を1文'));assert.equal(responses[2].result.isError,undefined);
});
test('report tool is unavailable outside native Orca chats and has no execution interface',()=>{
 assert.equal(handle({jsonrpc:'2.0',id:1,method:'tools/list'},false).result.tools.length,0);
 assert.equal(handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'update_panel',arguments:report}},false).error.code,-32602);
 assert.equal(handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'shell',arguments:{command:'anything'}}},true).error.code,-32602);
});
test('new instructions explicitly retire inline JSON and require the dedicated tool',()=>{
 assert(INSTRUCTIONS.includes(REPORT_TOOL));
 assert(INSTRUCTIONS.includes('本文に表示しない'));
 assert(!INSTRUCTIONS.includes('```'));
});
