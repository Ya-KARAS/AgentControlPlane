import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeExecutionNodes, executionNodeView } from '../src/core/execution-nodes.js';
import { loadConfig } from '../src/core/config.js';

const now=Date.parse('2026-11-02T08:00:00Z');
const local={id:'desktop',kind:'local',authorized:true,executor_ids:['codex']};
const cloud={id:'owned-cloud',kind:'cloud',authorized:true,executor_ids:['codex']};
const cfg=(nodes=[cloud,local])=>({enabled:true,nodes});
const observation=(node_id,patch={})=>({node_id,observed_at:'2026-11-02T07:59:50Z',valid_until:'2026-11-02T08:00:20Z',online:true,runtime_ready:true,workspace_ready:true,authentication_ready:true,persistent:true,...patch});
const view=(options={})=>executionNodeView({config:cfg(),observations:[observation('desktop'),observation('owned-cloud')],nowMs:now,executorId:'codex',...options});

test('node configuration defaults safe and rejects ambiguous or sensitive registration',()=>{
 assert.deepEqual(normalizeExecutionNodes(),{enabled:false,nodes:[]});
 assert.equal(normalizeExecutionNodes({enabled:true,nodes:[{id:'local',kind:'local',executor_ids:[]}]}).nodes[0].authorized,false);
 for(const bad of [null,{enabled:'true'},{nodes:[local,local]},{nodes:[{...local,id:'../secret'}]},{nodes:[{...local,token:'private-secret'}]},{nodes:[{...local,kind:'hosted-service'}]},{nodes:Array(65).fill(local)},{nodes:[{...local,executor_ids:Array(17).fill('codex')}]},{nodes:[{...local,executor_ids:['codex','codex']}]},{nodes:[{...local,executor_ids:['/private/command']}]},{observer:'caller'}]){
  assert.throws(()=>normalizeExecutionNodes(bad),e=>e.code==='invalid_config'&&!e.message.includes('private-secret'));
 }
});

test('real config loading preserves defaults and rejects invalid node options',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-nodes-config-'));const file=path.join(dir,'config.json');
 try{
  fs.writeFileSync(file,'{}');assert.deepEqual(loadConfig(file).executionNodes,{enabled:false,nodes:[]});
  fs.writeFileSync(file,JSON.stringify({executionNodes:cfg([local])}));assert.equal(loadConfig(file).executionNodes.nodes[0].id,'desktop');
  fs.writeFileSync(file,JSON.stringify({executionNodes:{nodes:[local,local]}}));assert.throws(()=>loadConfig(file),e=>e.code==='invalid_config');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('local-first advice never grants execution permission or mutates host input',()=>{
 const config=cfg();const observations=[observation('owned-cloud'),observation('desktop')];const before=JSON.stringify({config,observations});
 const result=view({config,observations});
 assert.equal(result.selected_node_id,'desktop');assert.equal(result.advisory_only,true);assert.equal(result.execution_authorized,false);
 assert.equal(JSON.stringify({config,observations}),before);
 assert.equal(view({requestedNodeId:'owned-cloud'}).selected_node_id,'owned-cloud');
});

test('disabled or unconfigured nodes cannot masquerade as the current cloud runtime',()=>{
 assert.equal(view({config:undefined}).reason,'disabled');
 assert.equal(view({config:{enabled:true,nodes:[]}}).reason,'no_eligible_node');
 assert.equal(view({observations:[]}).selected_node_id,null);
 assert.equal(view({observations:[]}).nodes[0].availability,'unknown');
});

for(const [label,patch,reason] of [
 ['offline',{online:false},'offline'],['runtime',{runtime_ready:false},'runtime_unverified'],['workspace',{workspace_ready:false},'workspace_unverified'],['authentication',{authentication_ready:false},'authentication_unverified'],['ephemeral',{persistent:false},'persistence_unverified'],['expired',{valid_until:'2026-11-02T08:00:00Z'},'observation_unavailable'],['future',{observed_at:'2026-11-02T08:00:01Z'},'observation_unavailable'],['too long',{valid_until:'2026-11-02T08:02:00Z'},'observation_unavailable'],['invalid time',{observed_at:'yesterday'},'observation_unavailable'],['secret',{raw:'private-secret'},'observation_unavailable']
])test(`explicit cloud stays blocked for ${label} and never falls back`,()=>{
 const result=view({requestedNodeId:'owned-cloud',observations:[observation('desktop'),observation('owned-cloud',patch)]});
 assert.equal(result.selected_node_id,null);assert.equal(result.reason,reason);assert.equal(JSON.stringify(result).includes('private-secret'),false);
});

test('authorization capability unknown identity and duplicate observations fail closed',()=>{
 assert.equal(view({config:cfg([{...cloud,authorized:false}]),requestedNodeId:'owned-cloud'}).reason,'not_authorized');
 assert.equal(view({executorId:'claude',requestedNodeId:'owned-cloud'}).reason,'incompatible_executor');
 assert.equal(view({requestedNodeId:'missing'}).reason,'node_not_registered');
 assert.equal(view({observations:[observation('owned-cloud'),observation('owned-cloud')],requestedNodeId:'owned-cloud'}).reason,'observation_unavailable');
 for(const observations of [null,{},Array(65).fill(observation('desktop'))])assert.equal(view({observations}).selected_node_id,null);
 assert.equal(view({nowMs:NaN}).selected_node_id,null);
 assert.equal(view({nowMs:now+20000}).selected_node_id,null);
});
