import { questionsOf } from './model.mjs';
export function esc(v) {return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
const button=(label,token)=>`<button data-action="${esc(token)}">${esc(label)}</button>`;
export function render(view, route) {
  if (view.error) return `<p class="notice">${esc(view.error)}</p>`;
  if (!view.workspace) return '<p>ワークスペースを選んでください。</p>';
  let html=`<header><h1>${esc(view.workspace.displayName ?? view.workspace.name)}</h1><span>${view.questions?.length?'回答待ち':view.approvals?.length?'承認待ち':view.working?'作業中':'待機中'}</span></header>`;
  if (!view.sessions?.length) return html+'<p>このワークスペースにチャットがありません。Claudeをチャット形式で開いてください。</p>';
  if (view.sessions.length>1) html+=`<label>会話<select id="session">${view.sessions.map(s=>`<option value="${esc(s.id)}" ${s.id===view.session.id?'selected':''}>${esc(s.title)}</option>`).join('')}</select></label>`;
  html+=`<p class="subtle">${esc(view.session.title)}</p>`;
  if (view.progress) {
    const done=view.progress.tasks.filter(t=>t.status==='completed').length,total=view.progress.tasks.length;
    html+=`<section>${view.previousProgress?'<p class="notice">前の依頼の記録です。今回の進捗はまだ届いていません。</p>':''}<h2>${esc(view.progress.goal)}</h2><div class="count">${done} / ${total}</div><progress max="${total}" value="${done}"></progress><ol>${view.progress.tasks.map(t=>`<li class="${esc(t.status)}"><span>${t.status==='completed'?'✓':t.status==='in_progress'?'●':'○'}</span>${esc(t.subject)}</li>`).join('')}</ol></section>`;
  } else if(view.reportRecorded) html+='<section><p>この依頼には進捗項目がありません。</p></section>';
  else html+=`<section><h2>進捗の記録待ち</h2><p>この会話で進捗表示を有効にすると、現在の作業状況を整理します。</p>${!view.working?button('この会話で進捗表示を有効にする',route('enable',{})):'<p class="subtle">実行中の作業が終わるまで待っています。</p>'}</section>`;
  for (const item of view.questions ?? []) {
    html+=`<section><h2>質問</h2><form data-question="${esc(route('answer',{itemId:item.itemId,revision:item.revision}))}">`;
    for (const [qi,q] of questionsOf(item).entries()) {
      html+=`<fieldset data-question-id="${esc(q.id)}" data-multi="${q.multiSelect?'true':'false'}"><legend>${esc(q.question)}</legend>`;
      for (const o of q.options ?? []) html+=`<label class="choice"><input type="${q.multiSelect?'checkbox':'radio'}" name="q${qi}" value="${esc(o.id)}"><span>${esc(o.label)}${o.description?`<small>${esc(o.description)}</small>`:''}</span></label>`;
      if (q.freeTextQuestionId) html+='<label>自由入力<textarea data-other rows="2"></textarea></label>';
      html+='</fieldset>';
    }
    html+='<button type="submit">回答を送る</button></form></section>';
  }
  if (view.approvals?.length) html+=`<section><h2>操作の承認待ち</h2><p>内容と権限はチャット画面で確認してください。</p>${button('チャットで確認する',route('reveal',{}))}</section>`;
  if (view.offers?.length) html+='<h2 class="next-heading">次の操作</h2>'+view.offers.map((o,index)=>`<section>${button(o.label,route('next',{index,prompt:o.prompt}))}<p>${esc(o.reason)}</p><details><summary>送信する依頼</summary><p>${esc(o.prompt)}</p></details></section>`).join('');
  if (view.historyTruncated) html+='<p class="subtle">長い会話のため直近2000件を表示に使用しています。</p>';
  return html;
}
