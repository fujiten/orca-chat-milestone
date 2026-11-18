import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {SERVER_NAME} from '../src/report.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const server=join(root,'scripts/report-server.mjs');
const run=args=>spawnSync('claude',args,{encoding:'utf8',timeout:30_000});
const current=run(['mcp','get',SERVER_NAME]);
if(current.error)throw current.error;
const remove=process.argv.includes('--remove');
if(current.status===0){
  if(!current.stdout.includes(server))throw new Error('同名のMCP設定が既にあります。上書きしていません。');
  if(!remove){console.log('専用のローカル連携は設定済みです。');process.exit(0);}
  const result=run(['mcp','remove','--scope','user',SERVER_NAME]);
  if(result.status!==0)throw new Error('ローカル連携を削除できませんでした。claude mcp get orca_chat_milestone で確認してください。');
  console.log('専用のローカル連携を削除しました。');
}else if(!remove){
  // Use Claude's own config writer. No existing server or permission setting is replaced.
  const result=run(['mcp','add','--scope','user','--transport','stdio',SERVER_NAME,'--',process.execPath,server]);
  if(result.status!==0)throw new Error('ローカル連携を登録できませんでした。Claudeの設定を確認してください。');
  console.log('専用のローカル連携を登録しました。新しいOrcaのClaudeチャットから利用できます。');
}else console.log('専用のローカル連携は未登録です。');
