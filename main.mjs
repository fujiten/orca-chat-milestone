import { createHash } from 'node:crypto';
import { NativeClient, nativeSessions, operationId } from './src/native.mjs';
import { project, questionsOf } from './src/model.mjs';
import { render } from './src/render.mjs';
import { ENABLE_PROMPT } from './src/instructions.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createWorker(orca, client = new NativeClient()) {
  let routes=new Map(),busy=false;
  async function read(sessionId) {
    const [context,workspaces]=await Promise.all([orca.host.call('workspace.readContext'),client.workspaces()]);
    const workspace=workspaces.find(w=>w.isActive || w.worktreeId===context?.workspaceId);
    if (!workspace) return {workspace:null};
    const sessions=nativeSessions(workspace);
    const session=sessions.find(s=>s.id===sessionId) ?? sessions.at(-1);
    if (!session) return {workspace,sessions};
    const page=await client.history(session.id);
    return {workspace,sessions,session,page,...project(page),historyTruncated:page.historyTruncated};
  }
  async function view({sessionId}={}) {
    try {
      const v=await read(sessionId);
      const nextRoutes=new Map();
      const html=render(v,(kind,fields)=>{
        const route={kind,...fields,sessionId:v.session.id,workspaceId:v.workspace.worktreeId,cursor:v.page.liveCursor};
        const token=digest(route);
        nextRoutes.set(token,route);
        return token;
      });
      routes=nextRoutes;
      return {html};
    } catch(error) {return {html:render({error:error.message})};}
  }
  async function action({token,answers}={}) {
    if (busy) throw new Error('操作の送信中です。');
    const r=routes.get(token);
    if (!r) throw new Error('表示が更新されました。最新のカードから操作してください。');
    busy=true;
    try {
      const v=await read(r.sessionId);
      if (v.workspace?.worktreeId!==r.workspaceId || v.session?.id!==r.sessionId) throw new Error('作業場所が変わりました。操作を中止しました。');
      if (r.kind==='reveal') return client.reveal(r.sessionId);
      if (digest(v.page.liveCursor)!==digest(r.cursor)) throw new Error('会話が更新されました。最新のカードから操作してください。');
      const key=`op-${token}`;
      const previous=await orca.storage.get(key);
      if (previous) throw new Error('この操作は送信済み、または送信結果の確認待ちです。チャットを確認してください。');
      const op=operationId();
      let send;
      if (r.kind==='next') {
        const offer=v.offers[r.index];
        if (!offer || offer.prompt!==r.prompt) throw new Error('次の操作が変わりました。');
        send=()=>client.send(r.sessionId,v.page,offer.prompt,op);
      } else if (r.kind==='enable') {
        if (v.progress) throw new Error('すでに進捗が記録されています。');
        send=()=>client.send(r.sessionId,v.page,ENABLE_PROMPT,op);
      } else if (r.kind==='answer') {
        const item=v.questions.find(i=>i.itemId===r.itemId && i.revision===r.revision);
        if (!item || !validAnswers(item,answers)) throw new Error('質問か回答の内容を確認できません。最新の質問に回答してください。');
        send=()=>client.answer(r.sessionId,v.page,item,answers,op);
      } else throw new Error('不明な操作です。');
      // Record before dispatch: an ambiguous disconnect must never automatically resend.
      // Store only an operation id, never conversation text or answers.
      await orca.storage.set(key,{id:op,state:'attempted',at:Date.now()});
      const result=await send();
      await orca.storage.set(key,{id:op,state:'sent',at:Date.now()});
      return {sent:true};
    } finally {busy=false;}
  }
  return {view,action};
}
export function validAnswers(item, answers) {
  const qs=questionsOf(item);
  if (!Array.isArray(answers) || answers.length!==qs.length || new Set(answers.map(a=>a.questionId)).size!==qs.length) return false;
  return qs.every(q=>{
    const a=answers.find(a=>a.questionId===q.id);
    if(!a || !Array.isArray(a.optionIds) || a.optionIds.some(id=>!q.options.some(o=>o.id===id)) || new Set(a.optionIds).size!==a.optionIds.length) return false;
    if(a.other!==undefined && (typeof a.other!=='string' || a.other.length>16000 || !q.freeTextQuestionId)) return false;
    const count=a.optionIds.length+(a.other?.trim()?1:0);
    return count>0 && (q.multiSelect || count===1);
  });
}
export default function activate(orca) {
  const worker=createWorker(orca);
  orca.panels.handle('view.get',args=>worker.view(args));
  orca.panels.handle('action',args=>worker.action(args));
  orca.events.on('workspace.changed',()=>orca.panels.post('workspace.changed',{}));
}
