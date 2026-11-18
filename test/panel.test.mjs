import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// The panel bridge takes JsonValue, not arbitrary structured-clone objects.
// Exercise the actual click handler: worker-only tests skip this boundary.
function assertJson(value) {
  if(value===null || ['string','boolean'].includes(typeof value))return;
  if(typeof value==='number' && Number.isFinite(value))return;
  if(typeof value!=='object')throw new Error('Invalid input');
  for(const item of Object.values(value))assertJson(item);
}
async function panel() {
  const handlers=new Map(),calls=[];
  const view={innerHTML:'',addEventListener:(name,fn)=>handlers.set(name,fn),querySelectorAll:()=>[]};
  const message={textContent:''};
  const document={activeElement:null,querySelector:selector=>selector==='#view'?view:message};
  const window={orca:{plugin:{on:()=>{},request:async(name,input)=>{
    assertJson(input);
    calls.push({name,input});
    return name==='view.get'?{html:'test'}:{sent:true};
  }}}};
  vm.runInNewContext(readFileSync(new URL('../panel/main.mjs',import.meta.url),'utf8'),{document,window,setInterval:()=>0});
  await new Promise(setImmediate);
  return {handlers,calls,message};
}
test('next-action button crosses the panel JSON bridge without an undefined answers field',async()=>{
  const p=await panel();
  p.handlers.get('click')({target:{closest:()=>({dataset:{action:'next-token'}})}});
  await new Promise(setImmediate);
  assert.equal(p.message.textContent,'送信しました。');
  const actions=p.calls.filter(c=>c.name==='action');
  assert.equal(actions.length,1);
  assert.equal(actions[0].input.token,'next-token');
  assert.deepEqual(Object.keys(actions[0].input),['token']);
});
test('question submit still carries its selected answers through the panel bridge',async()=>{
  const p=await panel();
  const field={dataset:{questionId:'q1'},querySelectorAll:()=>[{value:'choice-1'}],querySelector:()=>null};
  const form={dataset:{question:'question-token'},querySelectorAll:()=>[field]};
  p.handlers.get('submit')({target:{closest:()=>form},preventDefault:()=>{}});
  await new Promise(setImmediate);
  assert.equal(p.message.textContent,'送信しました。');
  const action=p.calls.find(c=>c.name==='action');
  assert.deepEqual(JSON.parse(JSON.stringify(action.input)),{token:'question-token',answers:[{questionId:'q1',optionIds:['choice-1']}]});
});
