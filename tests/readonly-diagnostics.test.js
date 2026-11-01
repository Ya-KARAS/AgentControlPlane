import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {createReadOnlyTestEntry} from '../src/readonly-test-entry.js';

async function run(fn,options={}){
 const app=createReadOnlyTestEntry(options);await app.listen(0);const base=`http://127.0.0.1:${app.address().port}`;
 const get=async(path='/diagnostics',headers={})=>{const r=await fetch(base+path,{headers});return {status:r.status,text:await r.text()};};
 const rpc=async(method,params={})=>{const r=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return {status:r.status,text:await r.text()};};
 try{await fn({base,get,rpc});}finally{await app.close();}
}
const parse=result=>{assert.equal(result.status,200);return JSON.parse(result.text);};

test('diagnostics distinguishes no parsed MCP traffic from fixed method categories without adding tools',async()=>run(async({get,rpc})=>{
 const initial=parse(await get());assert.equal(initial.mode,'read-only');assert.deepEqual(initial.methods,{initialize:0,list:0,call:0,other:0,invalid:0});assert.equal(initial.requests_total,1);
 await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'diagnostic-fixture',version:'1'}});
 const list=JSON.parse((await rpc('tools/list')).text);assert.deepEqual(list.result.tools.map(x=>x.name).sort(),['get_requirements','read_capabilities']);
 await rpc('tools/call',{name:'read_capabilities',arguments:{}});
 const observed=parse(await get());assert.deepEqual(observed.methods,{initialize:1,list:1,call:1,other:0,invalid:0});assert.equal(observed.statuses['200'],4);assert.equal(observed.requests_total,5);
}));

test('rejections and caller markers remain private across diagnostics health errors and unknown paths',async()=>run(async({base,get,rpc})=>{
 const marker='diagnostic-sensitive-marker';
 const host=await new Promise((resolve,reject)=>{const r=http.get(base+'/diagnostics',{headers:{host:marker}},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>resolve({status:res.statusCode,text}));});r.on('error',reject);});assert.equal(host.status,403);assert.equal(host.text.includes(marker),false);
 const origin=await get('/diagnostics',{origin:`https://${marker}.invalid`});assert.equal(origin.status,403);assert.equal(origin.text.includes(marker),false);
 for(let i=0;i<30;i++){const r=await get(`/unknown-${marker}-${i}?${marker}`,{'x-fixture-private':marker});assert.equal(r.status,404);assert.equal(r.text.includes(marker),false);}
 const bad=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:`{${marker}`});assert.equal(bad.status,400);assert.equal((await bad.text()).includes(marker),false);
 const rejected=await rpc('tools/call',{name:'get_requirements',arguments:{[marker]:marker}});assert.equal(rejected.text.includes(marker),false);
 const health=await get('/health');assert.equal(health.text.includes(marker),false);
 const diag=parse(await get());assert.equal(JSON.stringify(diag).includes(marker),false);assert.equal(diag.rejections.host_origin,2);assert.equal(diag.rejections.route,30);assert.equal(diag.rejections.invalid_json,1);assert.equal(diag.rejections.tool_call,1);assert.equal(diag.statuses['403'],2);assert.equal(diag.statuses['404'],30);assert.equal(diag.statuses['400'],1);
 assert.deepEqual(Object.keys(diag),['mode','counter_limit','requests_total','statuses','rejections','methods','transport']);
 assert.deepEqual(Object.keys(diag.methods),['initialize','list','call','other','invalid']);
 for(const category of [diag.statuses,diag.rejections,diag.methods,diag.transport])for(const value of Object.values(category))assert.ok(Number.isSafeInteger(value)&&value>=0&&value<=diag.counter_limit);
}));

test('503 and expired incomplete requests stay visible and do not bypass diagnostic resource limits',async()=>run(async({base,get})=>{
 const pending=[];
 try{
  for(let i=0;i<8;i++){const r=http.request(base+'/mcp',{method:'POST',headers:{'content-type':'application/json','transfer-encoding':'chunked'}});r.on('error',()=>{});r.write('{');pending.push(r);}
  await new Promise(r=>setTimeout(r,25));assert.equal((await get()).status,503);
  await new Promise(r=>setTimeout(r,250));const diag=parse(await get());assert.equal(diag.rejections.capacity,1);assert.equal(diag.statuses['503'],1);assert.equal(diag.statuses.closed,8);assert.ok(diag.transport.connection_deadline+diag.rejections.deadline>=8);
 }finally{for(const r of pending)r.destroy();}
},{deadlineMs:100}));

test('diagnostic reads reject bodies and malformed HTTP without retaining request bytes',async()=>run(async({base,get})=>{
 const marker='diagnostic-private-body';
 const result=await new Promise((resolve,reject)=>{const r=http.request(base+'/diagnostics',{method:'GET',headers:{'content-length':String(marker.length)}},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>resolve({status:res.statusCode,text}));});r.on('error',reject);r.end(marker);});
 assert.equal(result.status,400);assert.equal(result.text.includes(marker),false);
 const {connect}=await import('node:net');
 const raw=await new Promise((resolve,reject)=>{const socket=connect(Number(new URL(base).port),'127.0.0.1',()=>socket.end(`INVALID ${marker}\r\n\r\n`));let text='';socket.on('data',d=>text+=d);socket.on('end',()=>resolve(text));socket.on('error',reject);});
 assert.match(raw,/400 Bad Request/);assert.equal(raw.includes(marker),false);
 const diag=parse(await get());assert.equal(diag.rejections.diagnostic_body,1);assert.ok(diag.transport.invalid_http>=1);assert.equal(JSON.stringify(diag).includes(marker),false);
}));
