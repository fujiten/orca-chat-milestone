export const SERVER_NAME='orca_chat_milestone';
export const REPORT_TOOL=`mcp__${SERVER_NAME}__update_panel`;
const statuses=new Set(['pending','in_progress','completed']);
const text=(value,max)=>typeof value==='string' && value.trim().length>0 && value.length<=max;
export function validateReport(value) {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!['goal','tasks','nextActions'].includes(k)))return false;
  if(!text(value.goal,500) || !Array.isArray(value.tasks) || value.tasks.length>30)return false;
  if(value.tasks.some(t=>!t || Object.keys(t).some(k=>!['id','subject','status'].includes(k)) || !text(t.id,100) || !text(t.subject,500) || !statuses.has(t.status)))return false;
  if(new Set(value.tasks.map(t=>t.id)).size!==value.tasks.length || value.tasks.filter(t=>t.status==='in_progress').length>1)return false;
  const actions=value.nextActions ?? [];
  return Array.isArray(actions) && actions.length<=3 && actions.every(a=>a && Object.keys(a).every(k=>['label','prompt','reason'].includes(k)) && text(a.label,60) && text(a.prompt,1000) && !/^\s*[-/]/.test(a.prompt) && (a.reason===undefined || typeof a.reason==='string' && a.reason.length<=500));
}
export const REPORT_SCHEMA={type:'object',additionalProperties:false,required:['goal','tasks'],properties:{
  goal:{type:'string',minLength:1,maxLength:500},
  tasks:{type:'array',maxItems:30,items:{type:'object',additionalProperties:false,required:['id','subject','status'],properties:{id:{type:'string',minLength:1,maxLength:100},subject:{type:'string',minLength:1,maxLength:500},status:{type:'string',enum:[...statuses]}}}},
  nextActions:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:['label','prompt'],properties:{label:{type:'string',minLength:1,maxLength:60},prompt:{type:'string',minLength:1,maxLength:1000},reason:{type:'string',maxLength:500}}}}
}};
