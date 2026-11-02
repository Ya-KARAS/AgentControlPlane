import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { TaskStore } from '../src/core/store.js';
import { NodeRecoveryCoordinator } from '../src/core/node-recovery.js';
import { createWorkspaceRecoveryInspector } from '../src/core/workspace-recovery-inspector.js';
import { inventoryRepo } from './fixtures/inventory-repo.js';
const fresh=()=>({observed_at:new Date().toISOString(),valid_until:new Date(Date.now()+30000).toISOString()});
test('inventory plus separately measured facts feeds existing coordinator including deleted entries',t=>{
 const f=inventoryRepo(t),store=new TaskStore(path.join(f.root,'state')),task=store.createTask({workspace:f.dir,brief:{objective:'synthetic transfer'},policy:{name:'economy'},executor:'codex'});fs.unlinkSync(path.join(f.dir,'a.txt'));fs.writeFileSync(path.join(f.dir,'new.txt'),'synthetic');
 const make=nodeId=>({task_id:task.id,node_id:nodeId,generation:1,...fresh()});
 const source=createWorkspaceRecoveryInspector({enabled:true,inventory:f.collector(),nodeId:'desktop',measureSource:()=>({...make('desktop'),stopped:true,tests:[{command:'npm run verify',status:'not_run'}]})});
 const target=createWorkspaceRecoveryInspector({enabled:true,inventory:f.collector(),nodeId:'cloud',measureTarget:()=>({...make('cloud'),ready:true,idle:true,persistent:true})});
 const config={enabled:true,nodes:[{id:'desktop',kind:'local',authorized:true,executor_ids:['codex']},{id:'cloud',kind:'cloud',authorized:true,executor_ids:['codex']}]};const c=new NodeRecoveryCoordinator({store,config,sourceNodeId:'desktop',targetNodeId:'cloud',workspaceRoots:[f.root],inspectSource:task=>source.inspectSource(task),inspectTarget:task=>target.inspectTarget(task)});c.bind(task.id);const checkpoint=c.checkpoint(task.id,1);assert.equal(checkpoint.node_recovery.checkpoint.files[0].deleted,true);c.release(task.id,1);let admissions=0;c.resume(task.id,1,'synthetic-resume',{enqueueNodeRecovery(){admissions++;}});assert.equal(admissions,1);assert.equal(store.getTask(task.id).logical_task_id,task.logical_task_id);assert.equal(fs.existsSync(path.join(f.dir,'a.txt')),false);
});
test('inventory cannot invent source stop target readiness or task/generation binding',t=>{
 const f=inventoryRepo(t),task={id:'00000000-0000-4000-8000-000000000001',workspace:f.dir,node_recovery:{generation:1}};const make=extra=>createWorkspaceRecoveryInspector({enabled:true,inventory:f.collector(),nodeId:'desktop',...extra});assert.throws(()=>make().inspectSource(task));assert.throws(()=>make().inspectTarget(task));
 assert.throws(()=>make({measureSource:()=>({task_id:task.id,node_id:'other',generation:1,stopped:true,tests:[],...fresh()})}).inspectSource(task));assert.throws(()=>make({measureSource:()=>({task_id:task.id,node_id:'desktop',generation:0,stopped:true,tests:[],...fresh()})}).inspectSource(task));const off=createWorkspaceRecoveryInspector();assert.equal(off.enabled,false);assert.throws(()=>off.inspectSource(task));
});
test('old or future measured proof cannot be refreshed merely by a fresh Git inventory timestamp',t=>{
 const f=inventoryRepo(t),task={id:'00000000-0000-4000-8000-000000000001',workspace:f.dir,node_recovery:{generation:1}};
 for(const observed_at of [new Date(0).toISOString(),new Date(Date.now()+60000).toISOString()]){const inspector=createWorkspaceRecoveryInspector({enabled:true,inventory:f.collector(),nodeId:'desktop',measureSource:()=>({task_id:task.id,node_id:'desktop',generation:1,stopped:true,tests:[],observed_at,valid_until:new Date(Date.now()+90000).toISOString()})});assert.throws(()=>inspector.inspectSource(task));}
});
