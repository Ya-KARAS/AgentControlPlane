import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createWorkspaceInventory } from '../src/core/workspace-inventory.js';
import { inventoryRepo as repo } from './fixtures/inventory-repo.js';
const bad=e=>e.code==='workspace_inventory_unavailable';
test('default-off inventory does not probe paths or Git',()=>{const c=createWorkspaceInventory();assert.equal(c.enabled,false);assert.throws(()=>c.capture({workspace:'/not/read'}),bad);});
test('read-only double observation captures clean HEAD and exact dirty/untracked/deleted hashes',t=>{
 const f=repo(t),c=f.collector();const first=c.capture({workspace:f.dir});assert.equal(first.branch,'main');assert.equal(first.head,f.git('rev-parse','HEAD'));assert.deepEqual(first.files,[]);
 fs.writeFileSync(path.join(f.dir,'a.txt'),'modified\n');fs.writeFileSync(path.join(f.dir,'new.txt'),'new\n');const bytes=fs.readFileSync(path.join(f.dir,'.git','index'));const changed=c.capture({workspace:f.dir,expectedHead:first.head});assert.deepEqual(changed.files,[{path:'a.txt',sha256:createHash('sha256').update('modified\n').digest('hex')},{path:'new.txt',sha256:createHash('sha256').update('new\n').digest('hex')}]);assert.deepEqual(fs.readFileSync(path.join(f.dir,'.git','index')),bytes);assert.equal(JSON.stringify(changed).includes('modified\n'),false);
 fs.unlinkSync(path.join(f.dir,'a.txt'));const deleted=c.capture({workspace:f.dir});assert.deepEqual(deleted.files[0],{path:'a.txt',sha256:null,deleted:true});
});
test('expected HEAD branch and unmerged/unsupported filename conditions fail closed',t=>{
 const f=repo(t),c=f.collector();assert.throws(()=>c.capture({workspace:f.dir,expectedHead:'b'.repeat(40)}),bad);assert.throws(()=>c.capture({workspace:f.dir,expectedBranch:'elsewhere'}),bad);fs.writeFileSync(path.join(f.dir,'space name.txt'),'synthetic');assert.throws(()=>c.capture({workspace:f.dir}),bad);
});
test('outside paths sensitive files metadata includes and filter hooks never become inventory',t=>{
 const f=repo(t),c=f.collector();assert.throws(()=>c.capture({workspace:f.root}),bad);fs.writeFileSync(path.join(f.dir,'.env'),'synthetic-secret-marker');assert.throws(()=>c.capture({workspace:f.dir}),bad);fs.unlinkSync(path.join(f.dir,'.env'));f.git('config','include.path',path.join(f.root,'not-read-config'));assert.throws(()=>c.capture({workspace:f.dir}),bad);f.git('config','--unset','include.path');f.git('config','filter.danger.clean','echo not-run');assert.throws(()=>c.capture({workspace:f.dir}),bad);
});
test('file count bytes metadata and output limits reject rather than truncate',t=>{
 const f=repo(t);fs.writeFileSync(path.join(f.dir,'a.txt'),'longer than one byte');assert.throws(()=>f.collector({maxFileBytes:1}).capture({workspace:f.dir}),bad);fs.writeFileSync(path.join(f.dir,'second.txt'),'x');assert.throws(()=>f.collector({maxFiles:1}).capture({workspace:f.dir}),bad);assert.throws(()=>f.collector({maxMetadataEntries:1}).capture({workspace:f.dir}),bad);
});
test('a changing file during descriptor read is rejected and no outside file is read through a link',t=>{
 const f=repo(t);fs.writeFileSync(path.join(f.dir,'a.txt'),'modified');const original=fs.readSync;let mutated=false;fs.readSync=function(fd,...args){const n=original.call(this,fd,...args);if(!mutated){mutated=true;fs.appendFileSync(path.join(f.dir,'a.txt'),'changed');}return n;};try{assert.throws(()=>f.collector().capture({workspace:f.dir}),bad);}finally{fs.readSync=original;}
 const outside=path.join(f.root,'outside.txt');fs.writeFileSync(outside,'private-outside-marker');fs.linkSync(outside,path.join(f.dir,'hard.txt'));assert.throws(()=>f.collector().capture({workspace:f.dir}),bad);
});
test('a new untracked file during the final hash pass cannot be silently omitted',t=>{
 const f=repo(t);fs.writeFileSync(path.join(f.dir,'a.txt'),'modified');const original=fs.readSync;let reads=0;fs.readSync=function(fd,...args){const n=original.call(this,fd,...args);if(++reads===3)fs.writeFileSync(path.join(f.dir,'late.txt'),'late');return n;};try{assert.throws(()=>f.collector().capture({workspace:f.dir}),bad);}finally{fs.readSync=original;}
});
test('directory links and external Git metadata are refused without traversing outside checkout',t=>{
 const f=repo(t),outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'private.txt'),'synthetic private');fs.symlinkSync(outside,path.join(f.dir,'escape'),process.platform==='win32'?'junction':'dir');assert.throws(()=>f.collector().capture({workspace:f.dir}),bad);fs.unlinkSync(path.join(f.dir,'escape'));const old=path.join(f.root,'git-meta');fs.renameSync(path.join(f.dir,'.git'),old);fs.symlinkSync(old,path.join(f.dir,'.git'),process.platform==='win32'?'junction':'dir');assert.throws(()=>f.collector().capture({workspace:f.dir}),bad);
});
test('staged additions and renames preserve new hashes and explicit missing old paths',t=>{
 const f=repo(t);f.git('mv','a.txt','b.txt');const data=f.collector().capture({workspace:f.dir});assert.deepEqual(data.files.map(r=>r.path),['a.txt','b.txt']);assert.equal(data.files[0].deleted,true);assert.equal(data.files[1].sha256,createHash('sha256').update('initial\n').digest('hex'));
});
test('HEAD changes during file reads invalidate capture and fsmonitor hooks stay disabled',t=>{
 const f=repo(t);fs.writeFileSync(path.join(f.dir,'a.txt'),'modified');const original=fs.readSync;let changed=false;fs.readSync=function(fd,...args){const n=original.call(this,fd,...args);if(!changed){changed=true;f.git('commit','--allow-empty','-m','changed-head');}return n;};try{assert.throws(()=>f.collector().capture({workspace:f.dir}),bad);}finally{fs.readSync=original;}
 const marker=path.join(f.dir,'hook-ran');f.git('config','core.fsmonitor','touch hook-ran');assert.doesNotThrow(()=>f.collector().capture({workspace:f.dir}));assert.equal(fs.existsSync(marker),false);
});
test('index flags cannot hide dirty edits from recovery inventory',t=>{
 for(const flag of ['--assume-unchanged','--skip-worktree']){const f=repo(t);f.git('update-index',flag,'a.txt');fs.writeFileSync(path.join(f.dir,'a.txt'),'hidden-edit');assert.throws(()=>f.collector().capture({workspace:f.dir}),bad);}
});
test('partial-clone config cannot execute a lazy-fetch helper even when HEAD is missing',t=>{
 const f=repo(t),marker=path.join(f.root,'helper-ran'),script=path.join(f.root,'helper.cjs');fs.writeFileSync(script,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran');process.exit(1);`);
 f.git('config','extensions.partialClone','origin');f.git('config','remote.origin.promisor','true');f.git('config','remote.origin.url',f.root);f.git('config','remote.origin.uploadpack',`node "${script.replaceAll('\\','/')}"`);
 const head=f.git('rev-parse','HEAD');fs.unlinkSync(path.join(f.dir,'.git','objects',head.slice(0,2),head.slice(2)));assert.throws(()=>f.collector().capture({workspace:f.dir}),bad);assert.equal(fs.existsSync(marker),false);
});
test('metadata directory limits reject without materializing unbounded readdir arrays',t=>{
 const f=repo(t),original=fs.readdirSync;let arrayUsed=false;fs.readdirSync=function(...args){arrayUsed=true;return original.apply(this,args);};try{assert.throws(()=>f.collector({maxMetadataEntries:1}).capture({workspace:f.dir}),bad);assert.equal(arrayUsed,false);}finally{fs.readdirSync=original;}
});
