import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDisabledMcpOverride} from '../src/core/marker-mcp-isolation.js';
test('fixed top-level inline table quotes special names without copying server secrets',()=>{
 const names=['normal','dots.and spaces','quote"slash\\',"$(touch nope);`x`",'__proto__','雪'];
 const servers=Object.fromEntries(names.map(k=>[k,{enabled:true,url:'private-endpoint-marker',headers:{Authorization:'private-secret-marker'}}]));
 const before=JSON.stringify(servers),value=buildDisabledMcpOverride(servers);
 assert.equal(value,'mcp_servers={'+names.map(k=>JSON.stringify(k)+'={enabled=false}').join(',')+'}');
 assert.equal(JSON.stringify(servers),before);assert.equal(value.includes('private-'),false);assert.equal({}.enabled,undefined);
});
test('all configured entries including already disabled entries are covered; empty is not a clearing override',()=>{
 assert.equal(buildDisabledMcpOverride({a:{enabled:false},b:{}}),'mcp_servers={"a"={enabled=false},"b"={enabled=false}}');
 assert.equal(buildDisabledMcpOverride({}),null);
});
test('malformed or oversized MCP configuration fails with a fixed error, never a partial override',()=>{
 for(const servers of [null,[],true,{a:null},{a:'private-value'},Object.fromEntries([['',{}]]),Object.fromEntries([['x\nprivate-key',{}]]),Object.fromEntries([['\ud800',{}]]),Object.fromEntries([['x'.repeat(129),{}]]),Object.fromEntries(Array.from({length:33},(_,i)=>['s'+i,{}])),Object.fromEntries(Array.from({length:20},(_,i)=>['x'.repeat(100)+i,{}]))])
 assert.throws(()=>buildDisabledMcpOverride(servers),{message:'MCP process isolation unavailable'});
});
