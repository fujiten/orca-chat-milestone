const STATES = new Set(['pending','in_progress','completed']);
export const textOf = body => (body?.blocks ?? []).filter(b=>b.type==='text').map(b=>b.text ?? '').join('\n');
function outputText(output) {
  if (typeof output==='string') return output;
  if (Array.isArray(output)) return output.map(outputText).join('\n');
  if (output && typeof output==='object') return output.text ?? JSON.stringify(output);
  return '';
}
export function fenced(text, language) {
  const blocks=[];
  const re=new RegExp('(?:^|\\n)```'+language+'[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n```(?=\\s|$)','g');
  for (const m of text.matchAll(re)) try { blocks.push(JSON.parse(m[1])); } catch {}
  return blocks;
}
export function validProgress(value) {
  if (!value || typeof value.goal!=='string' || !Array.isArray(value.tasks) || !value.tasks.length || value.tasks.length>30) return null;
  if (!value.tasks.every(t=>t && typeof t.subject==='string' && t.subject.length<=500 && STATES.has(t.status))) return null;
  return {goal:value.goal.slice(0,500),tasks:value.tasks.map((t,i)=>({id:String(t.id ?? i),subject:t.subject,status:t.status}))};
}
export function nextActions(text) {
  // Only a complete block at the end of the assistant's final message is actionable.
  const match=/(?:^|\n)```next[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(text);
  if (!match) return [];
  try {
    const a=JSON.parse(match[1]);
    return Array.isArray(a) ? a.filter(x=>x && typeof x.label==='string' && x.label.length<=60 && typeof x.prompt==='string' && x.prompt.trim() && x.prompt.length<=1000 && !/^\s*[-/]/.test(x.prompt)).slice(0,3).map(x=>({label:x.label,prompt:x.prompt,reason:typeof x.reason==='string'?x.reason.slice(0,500):''})) : [];
  } catch { return []; }
}
export function project(page) {
  const tasks=new Map();
  let progress=null, taskSequence=-1, snapshotSequence=-1, reportItem=null;
  for (const item of page.items ?? []) {
    const b=item.body;
    if (b?.kind==='message' && b.role==='assistant') {
      for (const block of fenced(textOf(b),'milestone')) {
        const v=validProgress(block);
        if (v) {progress=v;snapshotSequence=item.sequence;}
      }
    }
    if (b?.kind!=='tool-call' || b.state!=='completed' || b.isError || b.output?.isError) continue;
    const input=b.input ?? {};
    if (b.name===REPORT_TOOL && validateReport(input)) {
      progress=input.tasks.length?{goal:input.goal,tasks:input.tasks}:null;
      snapshotSequence=item.sequence;
      reportItem=item;
    } else if (b.name==='TaskCreate') {
      let output=b.output;
      try {if(typeof output==='string') output=JSON.parse(output);} catch {}
      const id=output?.task?.id ?? /Task #([\w-]+)/.exec(outputText(b.output))?.[1];
      if (id && typeof input.subject==='string') {
        if (tasks.size && [...tasks.values()].every(t=>t.status==='completed')) tasks.clear();
        tasks.set(String(id),{...input,id:String(id),status:'pending'});taskSequence=item.sequence;
      }
    } else if (b.name==='TaskUpdate') {
      const id=String(input.taskId), old=tasks.get(id);
      if (input.status==='deleted') tasks.delete(id);
      else if (old) tasks.set(id,{...old,...input,metadata:{...old.metadata,...input.metadata}});
      taskSequence=item.sequence;
    } else if (b.name==='TodoWrite' && Array.isArray(input.todos)) {
      tasks.clear();
      for (const [i,t] of input.todos.entries()) if (typeof t.content==='string' && STATES.has(t.status)) tasks.set(String(i),{id:String(i),subject:t.content,status:t.status});
      taskSequence=item.sequence;
    } else if (b.name==='update_plan' && Array.isArray(input.plan)) {
      tasks.clear();
      for (const [i,t] of input.plan.entries()) if (typeof t.step==='string' && STATES.has(t.status)) tasks.set(String(i),{id:String(i),subject:t.step,status:t.status});
      taskSequence=item.sequence;
    }
  }
  if (taskSequence>snapshotSequence && tasks.size) {
    const all=[...tasks.values()];
    const goal=all.findLast(t=>typeof t.metadata?.goal==='string')?.metadata.goal;
    progress={goal:goal ?? '作業の進捗',tasks:all.filter(t=>!goal || !t.metadata?.goal || t.metadata.goal===goal)};
  }
  const currentTurnId=page.latestTurn?.itemId;
  const progressSource=(page.items ?? []).find(i=>i.sequence===Math.max(taskSequence,snapshotSequence));
  const previousProgress=!!progress && !!currentTurnId && progressSource?.turnScope?.turnItemId!==currentTurnId;
  const assistant=(page.items ?? []).filter(i=>i.body?.kind==='message' && i.body.role==='assistant' && (!currentTurnId || i.turnScope?.turnItemId===currentTurnId)).at(-1);
  const pending=(page.items ?? []).filter(i=>page.actionablePromptIds?.includes(i.itemId) && (!i.body?.resolution || i.body.resolution.state==='pending'));
  const prompts=pending.filter(i=>i.body?.kind==='question');
  const approvals=pending.filter(i=>i.body?.kind!=='question');
  const reportOffers=reportItem && (!currentTurnId || reportItem.turnScope?.turnItemId===currentTurnId)?reportItem.body.input.nextActions ?? []:null;
  const offers=!page.working && !page.actionablePromptIds?.length ? reportOffers ?? (assistant?nextActions(textOf(assistant.body)):[]):[];
  return {progress,questions:prompts,approvals,offers,working:page.working===true,reportRecorded:!!reportItem,previousProgress};
}
export function questionsOf(item) {
  const b=item.body;
  return b.questions ?? [{id:b.freeTextQuestionId ?? 'q1',question:b.question,options:b.options ?? [],multiSelect:false,...b.freeTextQuestionId?{freeTextQuestionId:b.freeTextQuestionId}:{},...b.freeTextInput?{freeTextInput:b.freeTextInput}:{}}];
}
import {REPORT_TOOL,validateReport} from './report.mjs';
