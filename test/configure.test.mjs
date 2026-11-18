import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('setup preserves existing settings, is idempotent, and removes only its own hook',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'chat-milestone-test-'));
 try {
  const original={permissions:{defaultMode:'default'},env:{UNCHANGED:'value'},hooks:{SessionStart:[{matcher:'startup',hooks:[{type:'command',command:'echo existing'}]}],Stop:[{hooks:[{type:'command',command:'echo keep'}]}]}};
  await writeFile(join(dir,'settings.json'),JSON.stringify(original));
  const run=(...args)=>{
   const r=spawnSync(process.execPath,[resolve('scripts/configure.mjs'),...args],{env:{...process.env,CLAUDE_CONFIG_DIR:dir},encoding:'utf8'});
   assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.startsWith('{')?r.stdout:'{}');
  };
  run();const first=await readFile(join(dir,'settings.json'),'utf8');
  const settings=JSON.parse(first);
  assert.deepEqual(settings.permissions,original.permissions);assert.deepEqual(settings.env,original.env);
  assert.equal(settings.hooks.SessionStart.length,2);assert.deepEqual(settings.hooks.Stop,original.hooks.Stop);
  assert.equal(settings.hooks.UserPromptSubmit.length,1);
  run();assert.equal(await readFile(join(dir,'settings.json'),'utf8'),first);
  run('--remove');assert.deepEqual(JSON.parse(await readFile(join(dir,'settings.json'),'utf8')),original);
  assert.equal((await readdir(join(dir,'chat-milestone-backups'))).length,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('display instructions for both hook events are confined to Orca native chats',()=>{
 const base={...process.env};delete base.ORCA_STRUCTURED_SESSION;delete base.ORCA_AGENT_SESSION_ID;
 for(const [file,event] of [['session-start.mjs','SessionStart'],['prompt-submit.mjs','UserPromptSubmit']]){
 const script=resolve('scripts',file);
 const outside=spawnSync(process.execPath,[script],{env:base,encoding:'utf8'});
 assert.equal(outside.status,0);assert.equal(outside.stdout,'');
 const inside=spawnSync(process.execPath,[script],{env:{...base,ORCA_STRUCTURED_SESSION:'1',ORCA_AGENT_SESSION_ID:'test'},encoding:'utf8'});
 assert.equal(inside.status,0);
 const result=JSON.parse(inside.stdout);
 assert.equal(result.hookSpecificOutput.hookEventName,event);
 assert(result.hookSpecificOutput.additionalContext.includes('milestone'));
 }
});
