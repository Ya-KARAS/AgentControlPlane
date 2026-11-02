import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ControlPlaneError } from './errors.js';
const fail=()=>new ControlPlaneError('workspace_inventory_unavailable','Bounded workspace inventory unavailable');
const inside=(root,p)=>{const r=path.relative(root,p);return !path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep);};
const canonical=p=>fs.realpathSync.native(p);
const safePath=p=>typeof p==='string'&&p.length<=512&&/^[A-Za-z0-9._/-]+$/.test(p)&&!p.startsWith('/')&&!p.split('/').some(v=>!v||v==='.'||v==='..');
const sensitive=p=>/(?:^|\/)(?:\.env(?:\.[^/]*)?|\.ssh|\.aws|\.codex|credentials(?:\.json)?|secrets(?:\.json)?|state\.json)(?:\/|$)|(?:^|\/)config\/local\.json$|\.(?:pem|p12|pfx|key)$/i.test(p);
const stamp=s=>[String(s.dev),String(s.ino),String(s.size),String(s.mtimeNs),String(s.ctimeNs),String(s.mode),String(s.nlink)];
// Explicit local host operation only. No auto scan, remote Git or source export.
export function createWorkspaceInventory({enabled=false,workspaceRoots=[],maxFiles=256,maxFileBytes=8*1024*1024,maxTotalBytes=32*1024*1024,maxMetadataEntries=10000,maxMetadataBytes=64*1024*1024,maxOutputBytes=262144,deadlineMs=5000}={}){
 if(enabled!==true)return Object.freeze({enabled:false,capture:()=>{throw fail();}});
 const bounds=[[maxFiles,1,256],[maxFileBytes,1,8*1024*1024],[maxTotalBytes,1,32*1024*1024],[maxMetadataEntries,1,10000],[maxMetadataBytes,1,64*1024*1024],[maxOutputBytes,128,1048576],[deadlineMs,50,10000]];
 if(!workspaceRoots.length||bounds.some(([n,min,max])=>!Number.isInteger(n)||n<min||n>max))throw fail();
 let roots;try{roots=workspaceRoots.map(root=>({input:path.resolve(root),path:canonical(root),stamp:stamp(fs.statSync(root,{bigint:true})).slice(0,2)}));}catch{throw fail();}
 return Object.freeze({enabled:true,capture(input){try{
  if(!input||Object.keys(input).some(k=>!['workspace','expectedHead','expectedBranch'].includes(k))||!path.isAbsolute(input.workspace))throw fail();
  const start=performance.now(),check=()=>{if(performance.now()-start>deadlineMs)throw fail();};
  for(const r of roots)if(canonical(r.input)!==r.path||JSON.stringify(stamp(fs.statSync(r.input,{bigint:true})).slice(0,2))!==JSON.stringify(r.stamp))throw fail();
  const root=canonical(input.workspace);if(!roots.some(r=>inside(r.path,root)))throw fail();const rootStamp=stamp(fs.statSync(root,{bigint:true})).slice(0,2),gitDir=path.join(root,'.git');
  const assertRoot=()=>{check();if(canonical(input.workspace)!==root||JSON.stringify(stamp(fs.statSync(root,{bigint:true})).slice(0,2))!==JSON.stringify(rootStamp))throw fail();};
  function guarded(relative,missing=false){if(!safePath(relative)||sensitive(relative))throw fail();let p=root;const parts=relative.split('/');for(let i=0;i<parts.length;i++){p=path.join(p,parts[i]);let s;try{s=fs.lstatSync(p,{bigint:true});}catch(e){if(missing&&e.code==='ENOENT')return null;throw fail();}if(s.isSymbolicLink()||s.nlink>1n&&!s.isDirectory()||!inside(root,canonical(p))||i<parts.length-1&&!s.isDirectory())throw fail();}return fs.lstatSync(p,{bigint:true});}
  function metadata(){if(!fs.lstatSync(gitDir).isDirectory()||fs.lstatSync(gitDir).isSymbolicLink())throw fail();const rows=[];let count=0,bytes=0;
   const visit=(dir,depth)=>{check();if(depth>32)throw fail();const names=[],handle=fs.opendirSync(dir);try{let entry;while((entry=handle.readSync())!==null){check();if(++count>maxMetadataEntries)throw fail();names.push(entry.name);}}finally{handle.closeSync();}for(const name of names.sort()){check();if(name.endsWith('.promisor'))throw fail();const p=path.join(dir,name),s=fs.lstatSync(p,{bigint:true});if(s.isSymbolicLink()||!inside(gitDir,canonical(p)))throw fail();if(s.isDirectory())visit(p,depth+1);else{if(!s.isFile()||s.nlink>1n||(bytes+=Number(s.size))>maxMetadataBytes)throw fail();}rows.push([path.relative(gitDir,p),stamp(s)]);}};visit(gitDir,0);
   for(const p of ['commondir','config.worktree','objects/info/alternates'])if(fs.existsSync(path.join(gitDir,p)))throw fail();
   const cfg=path.join(gitDir,'config');if(fs.statSync(cfg).size>65536)throw fail();const config=fs.readFileSync(cfg,'utf8').replace(/\\\r?\n/g,'');if(/^\s*\[\s*(?:include|includeIf|filter)(?:\s|\]|\"|\.)/mi.test(config))throw fail();if(/^\s*[^\s=]*(?:partialclone|promisor|sparsecheckout)[^\s=]*\s*=/mi.test(config))throw fail();return rows;
  }
  const env={};for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TMP','TEMP','TMPDIR'])if(process.env[key])env[key]=process.env[key];Object.assign(env,{GIT_NO_LAZY_FETCH:'1',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:os.devNull,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_ATTR_NOSYSTEM:'1',LC_ALL:'C'});
  function git(...args){assertRoot();const value=execFileSync('git',['--no-optional-locks','--git-dir='+gitDir,'--work-tree='+root,'-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','core.hooksPath='+path.join(gitDir,'acp-no-hooks'),'-c','core.attributesFile='+os.devNull,'-c','core.excludesFile='+os.devNull,'-c','diff.external=','-c','status.renames=false',...args],{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:Math.max(1,Math.floor(deadlineMs-(performance.now()-start))),maxBuffer:maxOutputBytes,windowsHide:true});check();return value;}
  function observe(){const meta=metadata(),head=git('rev-parse','--verify','HEAD').trim(),branch=git('symbolic-ref','--short','HEAD').trim();if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)||!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(branch)||branch.includes('..'))throw fail();
   const flags=git('ls-files','-v','-z').split('\0').filter(Boolean);if(flags.some(row=>!row.startsWith('H ')))throw fail();
   const tracked=git('ls-files','--stage','-z').split('\0').filter(Boolean);if(tracked.length>4096)throw fail();let total=0;const trackedStats=[];
   for(const row of tracked){check();const m=row.match(/^(100644|100755) [a-f0-9]{40,64} 0\t(.+)$/);if(!m)throw fail();const s=guarded(m[2],true);if(s&&(!s.isFile()||s.size>BigInt(maxFileBytes)||(total+=Number(s.size))>maxTotalBytes))throw fail();trackedStats.push([m[2],s?stamp(s):null]);}
   const status=git('status','--porcelain=v1','-z','--untracked-files=all','--ignore-submodules=none'),entries=status.split('\0').filter(Boolean);if(entries.length>maxFiles)throw fail();const paths=new Set();const files=entries.map(row=>{if(row.length<4||row[2]!==' '||/[^ MAD?]/.test(row.slice(0,2)))throw fail();const name=row.slice(3);if(paths.has(name)||!safePath(name)||sensitive(name))throw fail();paths.add(name);return {path:name,deleted:row.slice(0,2).includes('D')};}).sort((a,b)=>a.path.localeCompare(b.path));
   return {head,branch,files,signature:JSON.stringify([meta,flags,tracked,trackedStats,status])};
  }
  function hashes(items){let total=0;return items.map(item=>{assertRoot();const before=guarded(item.path,item.deleted);if(item.deleted){if(before)throw fail();return {path:item.path,sha256:null,deleted:true};}if(!before?.isFile()||before.size>BigInt(maxFileBytes)||(total+=Number(before.size))>maxTotalBytes)throw fail();
   const p=path.join(root,...item.path.split('/')),fd=fs.openSync(p,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));try{const opened=fs.fstatSync(fd,{bigint:true});if(JSON.stringify(stamp(opened))!==JSON.stringify(stamp(before)))throw fail();
    if(process.platform==='linux'&&fs.existsSync('/proc/self/fd')){if(!inside(root,canonical('/proc/self/fd/'+fd)))throw fail();}else if(!inside(root,canonical(p))||JSON.stringify(stamp(fs.statSync(p,{bigint:true})))!==JSON.stringify(stamp(opened)))throw fail();
    const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let read=0,n;while((n=fs.readSync(fd,buffer,0,Math.min(buffer.length,maxFileBytes-read+1),null))>0){check();read+=n;if(read>maxFileBytes)throw fail();hash.update(buffer.subarray(0,n));}const after=fs.fstatSync(fd,{bigint:true});if(read!==Number(before.size)||JSON.stringify(stamp(after))!==JSON.stringify(stamp(before))||JSON.stringify(stamp(guarded(item.path)))!==JSON.stringify(stamp(before)))throw fail();return {path:item.path,sha256:hash.digest('hex')};
   }finally{fs.closeSync(fd);}
  });}
  const first=observe();if(input.expectedHead!==undefined&&input.expectedHead!==first.head||input.expectedBranch!==undefined&&input.expectedBranch!==first.branch)throw fail();const one=hashes(first.files),second=observe(),two=hashes(second.files);assertRoot();
  if(first.signature!==second.signature||JSON.stringify(one)!==JSON.stringify(two)||observe().signature!==second.signature)throw fail();const result={branch:first.branch,head:first.head,files:one};if(Buffer.byteLength(JSON.stringify(result))>8192)throw fail();const at=Date.now();return Object.freeze({...result,observed_at:new Date(at).toISOString(),valid_until:new Date(at+1000).toISOString()});
 }catch{throw fail();}}});
}
