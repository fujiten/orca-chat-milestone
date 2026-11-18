import {REPORT_SCHEMA,validateReport} from '../src/report.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// Stdio only. No network listener, file access, shell or persistence.
// Orca records the validated tool call in the chat journal; the panel reads it.
const active=!!(process.env.ORCA_STRUCTURED_SESSION && process.env.ORCA_AGENT_SESSION_ID);
const protocols=new Set(['2024-11-05','2025-03-26','2025-06-18','2025-11-25']);
export function handle(message, enabled=active) {
  if(!message || typeof message!=='object' || Array.isArray(message) || message.jsonrpc!=='2.0')return {jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}};
  if(!Object.hasOwn(message,'id'))return null;
  const reply=result=>({jsonrpc:'2.0',id:message.id,result});
  if(message.method==='initialize')return reply({protocolVersion:protocols.has(message.params?.protocolVersion)?message.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'orca-chat-milestone',version:'0.2.0'},instructions:'Orcaの進捗・次の操作はupdate_panelへ記録し、会話本文にはJSONを出さないでください。'});
  if(message.method==='ping')return reply({});
  if(message.method==='tools/list')return reply({tools:enabled?[{name:'update_panel',title:'進捗パネルを更新',description:'Orcaのサイドパネルに作業の進捗と次の操作を記録します。会話本文へJSONを表示せず、このツールを作業開始前・段階の切替・完了時に使ってください。ファイル変更・外部通信・作業の実行は行いません。',inputSchema:REPORT_SCHEMA,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}]:[]});
  if(message.method==='tools/call') {
    if(!enabled || message.params?.name!=='update_panel')return {jsonrpc:'2.0',id:message.id,error:{code:-32602,message:'Tool unavailable outside an Orca native chat'}};
    if(!validateReport(message.params.arguments))return reply({isError:true,content:[{type:'text',text:'進捗の形式が不正です。goal、tasks、nextActionsを確認してください。'}]});
    return reply({content:[{type:'text',text:'パネルに記録しました。本文にはJSONを出さず、通常の説明を続けてください。'}]});
  }
  return {jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  let pending='';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data',chunk=>{
    pending+=chunk;
    if(pending.length>1024*1024){process.stderr.write('MCP request exceeds limit\n');process.exitCode=1;process.stdin.destroy();return;}
    for(let index;(index=pending.indexOf('\n'))>=0;) {
      const line=pending.slice(0,index);pending=pending.slice(index+1);
      if(!line.trim())continue;
      let result;
      try{result=handle(JSON.parse(line));}catch{result={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}};}
      if(result)process.stdout.write(JSON.stringify(result)+'\n');
    }
  });
}
