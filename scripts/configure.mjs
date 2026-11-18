import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const settingsPath=join(process.env.CLAUDE_CONFIG_DIR || join(homedir(),'.claude'),'settings.json');
const quote=s=>`'${s.replaceAll("'", "'\\''")}'`;
const remove=process.argv.includes('--remove');
let original='{}\n';
try {original=await readFile(settingsPath,'utf8');} catch(e) {if(e.code!=='ENOENT')throw e;}
const settings=JSON.parse(original);
if (settings.hooks!==undefined && (!settings.hooks || typeof settings.hooks!=='object' || Array.isArray(settings.hooks))) throw new Error('既存のhooks設定を確認してください。変更していません。');
const hooks=settings.hooks ?? {};
const updatedHooks={...hooks};
for(const [name,file,matcher] of [['SessionStart','session-start.mjs','startup|resume|compact'],['UserPromptSubmit','prompt-submit.mjs',null]]) {
  const hookPath=join(root,'scripts',file);
  const command=`${quote(process.execPath)} ${quote(hookPath)}`;
  const groups=hooks[name] ?? [];
  if(!Array.isArray(groups) || groups.some(g=>!Array.isArray(g.hooks)))throw new Error(`既存の${name}設定を確認してください。変更していません。`);
  const next=groups.map(g=>({...g,hooks:g.hooks.filter(h=>h.command!==command && !h.command?.endsWith(` ${quote(hookPath)}`))})).filter(g=>g.hooks.length);
  if(!remove)next.push({...matcher?{matcher}:{},hooks:[{type:'command',command,timeout:5}]});
  if(next.length)updatedHooks[name]=next;else delete updatedHooks[name];
}
if(JSON.stringify(updatedHooks)===JSON.stringify(hooks)){console.log('設定済みです。');process.exit(0);}
const backupDir=join(dirname(settingsPath),'chat-milestone-backups');
await mkdir(backupDir,{recursive:true,mode:0o700});
await writeFile(join(backupDir,`${Date.now()}.json`),original,{mode:0o600,flag:'wx'});
settings.hooks=updatedHooks;
const tmp=`${settingsPath}.chat-milestone-${process.pid}.tmp`;
await writeFile(tmp,JSON.stringify(settings,null,2)+'\n',{mode:0o600,flag:'wx'});
// Do not overwrite a concurrent settings change.
let current='{}\n';try{current=await readFile(settingsPath,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
if(current!==original)throw new Error('設定が同時に更新されました。変更していません。');
await rename(tmp,settingsPath);
console.log(remove?'このプラグインの開始時指示を削除しました。':'Orcaの新しいClaudeチャットで進捗表示を自動で有効にしました。');
