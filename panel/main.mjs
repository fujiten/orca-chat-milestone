const view=document.querySelector('#view'), message=document.querySelector('#message');
let busy=false,html='',sessionId=null;
async function refresh(){
  if(busy || document.activeElement?.closest('form')) return;
  try{
    const r=await window.orca.plugin.request('view.get',{sessionId});
    if(r.html!==html){view.innerHTML=r.html;html=r.html;}
  }catch{message.textContent='チャットの読み取りに失敗しました。再接続を待っています。';}
}
async function act(token,answers){
  if(busy) return;
  busy=true;message.textContent='送信しています…';
  view.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await window.orca.plugin.request('action',{token,answers});message.textContent='送信しました。';}
  catch(e){message.textContent=e.message ?? '送信できませんでした。チャット画面を確認してください。';}
  finally{busy=false;html='';await refresh();}
}
view.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b) void act(b.dataset.action);});
view.addEventListener('change',e=>{
  if(e.target.id==='session'){sessionId=e.target.value;html='';void refresh();}
  const f=e.target.closest('fieldset');
  if(f?.dataset.multi==='false' && e.target.matches('input:checked')){const other=f.querySelector('[data-other]');if(other)other.value='';}
});
view.addEventListener('input',e=>{
  const f=e.target.closest('fieldset');
  if(f?.dataset.multi==='false' && e.target.matches('[data-other]') && e.target.value.trim()) f.querySelectorAll('input:checked').forEach(i=>i.checked=false);
});
view.addEventListener('submit',e=>{
  const form=e.target.closest('[data-question]');if(!form)return;e.preventDefault();
  const answers=[...form.querySelectorAll('fieldset')].map(f=>({questionId:f.dataset.questionId,optionIds:[...f.querySelectorAll('input:checked')].map(i=>i.value),...(f.querySelector('[data-other]')?.value.trim()?{other:f.querySelector('[data-other]').value}:{})}));
  if(answers.some(a=>!a.optionIds.length&&!a.other?.trim())){message.textContent='すべての質問に回答してください。';return;}
  void act(form.dataset.question,answers);
});
window.orca.plugin.on('workspace.changed',()=>{sessionId=null;html='';void refresh();});
void refresh();setInterval(()=>void refresh(),2000);
