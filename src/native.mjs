import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

// Orca has no public plugin API for native-chat messages yet. Keep this version-
// dependent adapter separate, and use Orca's own authenticated local client.
export function runtimeRoot(execPath = process.execPath) {
  const roots = ['/Applications/Orca.app/Contents/Resources/app.asar.unpacked/out'];
  const appEnd = execPath.indexOf('.app/Contents/');
  if (appEnd >= 0) roots.unshift(join(execPath.slice(0, appEnd + 4), 'Contents/Resources/app.asar.unpacked/out'));
  const root = roots.find(p => existsSync(join(p, 'cli/runtime/client.js')));
  if (!root) throw new Error('対応するOrcaのローカル接続機能が見つかりません。');
  return root;
}

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export function envelope(method, sessionId, fence, fields, operationId) {
  if (!Number.isSafeInteger(fence) || fence < 1) throw new Error('チャットの更新世代を確認できません。');
  return { sessionId, expectedRuntimeFence: fence,
    clientOperationId: operationId,
    payloadFingerprint: createHash('sha256').update(canonical({method, sessionId, fields})).digest('hex') };
}

export class NativeClient {
  constructor({ client, root } = {}) {
    if (!client) {
      root ??= runtimeRoot();
      const require = createRequire(join(root,'cli/runtime/client.js'));
      const { RuntimeClient } = require(join(root,'cli/runtime/client.js'));
      client = new RuntimeClient(undefined, 12_000, null, null);
    }
    this.client = client;
  }
  async call(method, params) {
    const r = await this.client.call(method, params);
    if (!r.ok || r.result?.ok === false) throw new Error(r.result?.refusal?.message ?? r.result?.error?.message ?? 'Orcaが操作を受け付けませんでした。');
    return r.result;
  }
  async workspaces() { return (await this.call('worktree.ps', {})).worktrees; }
  async history(sessionId) {
    let result = await this.call('agentSession.history', {sessionId, direction:'tail', limit:200});
    if (!Array.isArray(result.page?.items) || !Number.isInteger(result.page?.fence)) throw new Error('Orcaのチャット形式が変わりました。プラグインの更新が必要です。');
    const page = result.page;
    const byId = new Map(page.items.map(i=>[i.itemId,i]));
    let cursor = page.window?.nextCursor;
    let older = page.hasOlder;
    for (let n=0; older && cursor && n<9; n++) {
      const previous = await this.call('agentSession.history', {sessionId, direction:'before', cursor, limit:200});
      if (previous.page?.epoch !== page.epoch) throw new Error('会話が更新されました。再読み込みします。');
      for (const i of previous.page.items) if (!byId.has(i.itemId)) byId.set(i.itemId,i);
      older = previous.page.hasOlder;
      const next = previous.page.window?.nextCursor;
      if (canonical(next)===canonical(cursor)) break;
      cursor=next;
    }
    return {...page, items:[...byId.values()].sort((a,b)=>a.sequence-b.sequence), historyTruncated:older};
  }
  async send(sessionId, page, text, operationId) {
    if (page.working || page.actionablePromptIds?.length || page.queuedMessages?.length) throw new Error('作業中または回答待ちです。チャットを確認してください。');
    const fields={body:{kind:'message', role:'user', blocks:[{type:'text',text}]}};
    return this.call('agentSession.send', {...fields,envelope:envelope('agentSession.send',sessionId,page.fence,fields,operationId)});
  }
  async answer(sessionId, page, item, answers, operationId) {
    const fields={itemId:item.itemId, expectedRevision:item.revision, answers};
    return this.call('agentSession.respondToQuestion', {...fields,envelope:envelope('agentSession.respondTo:question',sessionId,page.fence,fields,operationId)});
  }
  async reveal(sessionId) { return this.call('agentSession.reveal',{sessionId}); }
}

export function operationId() { return `${Date.now()}-${randomUUID().replaceAll('-','')}`; }
export function nativeSessions(workspace) {
  return (workspace?.agents ?? []).filter(a=>a.structuredHostOwned).flatMap(a=>{
    const match=/^structured-agent-session-([a-zA-Z0-9_]+):/.exec(a.paneKey ?? '');
    return match ? [{id:match[1], title:a.conversationName ?? a.agentType ?? 'Chat', state:a.state}] : [];
  });
}
