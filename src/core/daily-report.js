import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { ControlPlaneError } from './errors.js';
const failure=()=>new ControlPlaneError('workflow_report_unavailable','Daily report could not be safely persisted or read');
const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>Number.isFinite(Date.parse(d+'T00:00:00.000Z'))&&new Date(d+'T00:00:00.000Z').toISOString().slice(0,10)===d);
const id=z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const rowSchema=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),task_id:z.string().uuid(),logical_task_id:id,repository:z.string().max(201).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/),pull_request_number:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),head_sha:z.string().regex(/^[a-f0-9]{40}$/),task_status:z.enum(['completed','partial']),accepted_at:z.string().datetime()}).strict();
const reportSchema=z.object({schema_version:z.literal(1),date:dateSchema,time_zone:z.string().min(1).max(64).refine(zone=>{try{new Intl.DateTimeFormat('en',{timeZone:zone});return true;}catch{return false;}}),entries:z.array(rowSchema).max(2048).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length)}).strict();
export const reportEntryHash=row=>crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
export function reportDate(nowMs,timeZone){
 if(!Number.isSafeInteger(nowMs)||nowMs<0)throw failure();
 let parts;try{parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(nowMs)).map(p=>[p.type,p.value]));}catch{throw failure();}
 const date=`${parts.year}-${parts.month}-${parts.day}`;if(!dateSchema.safeParse(date).success)throw failure();return date;
}
function render(report){
 return `# ACP daily report — ${report.date}\n\nTime zone: ${report.time_zone}\n\nHistorical user acceptance snapshots; not new merge authority.\n\n| Task | PR | HEAD | Outcome | Accepted (UTC) |\n| --- | --- | --- | --- | --- |\n`+report.entries.map(r=>`| ${r.task_id} | ${r.repository}#${r.pull_request_number} | ${r.head_sha} | ${r.task_status} | ${r.accepted_at} |`).join('\n')+`\n\n<!-- ACP_DAILY_REPORT\n${JSON.stringify(report)}\nACP_DAILY_REPORT -->\n`;
}
function location(stateDir,date){
 if(!dateSchema.safeParse(date).success)throw failure();
 const directory=path.join(stateDir,'reports');
 if(fs.existsSync(directory)&&(!fs.lstatSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink()))throw failure();
 return {directory,file:path.join(directory,`${date}.md`)};
}
export function readDailyReport(stateDir,date){
 try{
  const {file}=location(stateDir,date);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw failure();
  const text=fs.readFileSync(file,'utf8'),prefix='<!-- ACP_DAILY_REPORT\n',suffix='\nACP_DAILY_REPORT -->\n',start=text.indexOf(prefix);
  if(start<0||!text.endsWith(suffix))throw failure();
  const parsed=reportSchema.safeParse(JSON.parse(text.slice(start+prefix.length,-suffix.length)));if(!parsed.success||parsed.data.date!==date||render(parsed.data)!==text)throw failure();
  return parsed.data;
 }catch{throw failure();}
}
export function writeDailyReport(stateDir,date,timeZone,row){
 let temporary;
 try{
  const parsed=rowSchema.safeParse(row);if(!parsed.success)throw failure();row=parsed.data;
  const {directory,file}=location(stateDir,date);fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const report=fs.existsSync(file)?readDailyReport(stateDir,date):{schema_version:1,date,time_zone:timeZone,entries:[]};
  if(report.time_zone!==timeZone)throw failure();
  const existing=report.entries.find(r=>r.id===row.id);
  if(existing){if(reportEntryHash(existing)!==reportEntryHash(row))throw failure();return reportEntryHash(existing);}
  report.entries.push(row);report.entries.sort((a,b)=>a.accepted_at.localeCompare(b.accepted_at)||a.id.localeCompare(b.id));
  if(!reportSchema.safeParse(report).success)throw failure();const text=render(report);if(Buffer.byteLength(text,'utf8')>1024*1024)throw failure();
  temporary=path.join(directory,`.${date}.${crypto.randomUUID()}.tmp`);const fd=fs.openSync(temporary,'wx',0o600);
  try{fs.writeFileSync(fd,text,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);temporary=null;
  if(process.platform!=='win32'){const dir=fs.openSync(directory,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
  const verified=readDailyReport(stateDir,date).entries.find(r=>r.id===row.id);if(!verified||reportEntryHash(verified)!==reportEntryHash(row))throw failure();
  return reportEntryHash(verified);
 }catch{throw failure();}
 finally{if(temporary){try{fs.unlinkSync(temporary);}catch{}}}
}
