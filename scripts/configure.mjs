import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const settingsPath=join(process.env.CLAUDE_CONFIG_DIR || join(homedir(),'.claude'),'settings.json');
const hookPath=join(root,'scripts/session-start.mjs');
const quote=s=>`'${s.replaceAll("'", "'\\''")}'`;
const command=`${quote(process.execPath)} ${quote(hookPath)}`;
const remove=process.argv.includes('--remove');
let original='{}\n';
try {original=await readFile(settingsPath,'utf8');} catch(e) {if(e.code!=='ENOENT')throw e;}
const settings=JSON.parse(original);
if (settings.hooks!==undefined && (!settings.hooks || typeof settings.hooks!=='object' || Array.isArray(settings.hooks))) throw new Error('既存のhooks設定を確認してください。変更していません。');
const hooks=settings.hooks ?? {};
const groups=hooks.SessionStart ?? [];
if (!Array.isArray(groups)) throw new Error('既存のSessionStart設定を確認してください。変更していません。');
if(groups.some(g=>!Array.isArray(g.hooks)))throw new Error('既存のSessionStart設定を確認してください。変更していません。');
const next=groups.map(g=>({...g,hooks:g.hooks.filter(h=>h.command!==command && !h.command?.endsWith(` ${quote(hookPath)}`))})).filter(g=>g.hooks.length);
if(!remove)next.push({matcher:'startup|resume|compact',hooks:[{type:'command',command,timeout:5}]});
if(JSON.stringify(next)===JSON.stringify(groups)){console.log('設定済みです。');process.exit(0);}
const backupDir=join(dirname(settingsPath),'chat-milestone-backups');
await mkdir(backupDir,{recursive:true,mode:0o700});
await writeFile(join(backupDir,`${Date.now()}.json`),original,{mode:0o600,flag:'wx'});
settings.hooks={...hooks,SessionStart:next};
const tmp=`${settingsPath}.chat-milestone-${process.pid}.tmp`;
await writeFile(tmp,JSON.stringify(settings,null,2)+'\n',{mode:0o600,flag:'wx'});
// Do not overwrite a concurrent settings change.
let current='{}\n';try{current=await readFile(settingsPath,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
if(current!==original)throw new Error('設定が同時に更新されました。変更していません。');
await rename(tmp,settingsPath);
console.log(remove?'このプラグインの開始時指示を削除しました。':'Orcaの新しいClaudeチャットで進捗表示を自動で有効にしました。');
