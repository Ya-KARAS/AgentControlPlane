import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { conversationHtml } from '../src/conversation-page.js';

// A deliberately small DOM contract harness, not a browser or vendor integration.
// The actual fixed page script runs; no HTML sink is allowed for remote text.
class Element {
 constructor(tag='div'){this.tag=tag;this.children=[];this.listeners={};this._value='';this.textContent='';}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;this._value='';}
 get options(){return this.children;}
 get value(){return this.tag==='select'?(this._value||this.children[0]?.value||''):this._value;}
 set value(v){this._value=v;}
 set innerHTML(_){throw Error('unsafe HTML sink');}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
 async fire(type){for(const fn of this.listeners[type]??[])await fn({});}
}
test('actual page script renders untrusted text and uses confirmed stop while navigation stays read-only',async()=>{
 const html=conversationHtml(),elements=new Map();for(const m of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g))elements.set(m[2],new Element(m[1]));
 const $=id=>elements.get(id),window=new Element(),location={hash:''},writes=[],marker='<img src=x onerror="throw Error()">';let stopped=false,confirmed=false;
 const snapshot=()=>({conversation_id:'task-a',agents:[{id:'dot',display_name:marker,connection:'not_connected'}],messages:[{key:'m',text:marker,channels:['foreground'],sequence:1}],tasks:[{id:'t',objective:marker,status:'running',summary:marker,can_stop:true,can_follow_up:false,stop_requested:stopped}]});
 const fetch=async(url,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');if(options.method==='POST'){writes.push({url,body:JSON.parse(options.body)});if(url.endsWith('/stop'))stopped=true;return {ok:true,json:async()=>({})};}return {ok:true,json:async()=>url==='/v1/conversations'?{conversations:[{id:'task-a',label:marker}]}:snapshot()};};
 const context={document:{getElementById:$,createElement:tag=>new Element(tag),visibilityState:'hidden'},window,location,history:{replaceState:(_,__,hash)=>{location.hash=hash;}},Option:class extends Element{constructor(label,value){super('option');this.textContent=label;this.value=value;}},fetch,confirm:()=>confirmed,crypto:{randomUUID:()=> 'one'},AbortController,setTimeout,clearTimeout,setInterval:()=>1,clearInterval:()=>{}};
 vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);$('token').value='test-only-secret';await $('connect').fire('click');assert.equal($('token').value,'');assert.equal($('messages').children[0].children[1].textContent,marker);assert.match($('target').children[1].textContent,/未连接/);
 const stop=()=> $('tasks').children[0].children.find(e=>e.tag==='button');await stop().fire('click');assert.equal(writes.length,0);confirmed=true;await stop().fire('click');assert.equal(writes.length,1);assert.equal(writes[0].url,'/v1/conversations/stop');assert.equal(writes[0].body.task_id,'t');assert.equal(stop().disabled,true);assert.match($('tasks').children[0].children[0].textContent,/running/);
 $('draft').value='discussion';await $('draft').fire('input');await $('send').fire('click');assert.equal(writes[1].url,'/v1/conversations/post');await $('refresh').fire('click');await window.fire('hashchange');assert.equal(writes.length,2);await window.fire('pagehide');assert.equal($('messages').children.length,0);assert.equal($('draft').value,'');
 assert.equal(JSON.stringify([...elements.values()].map(e=>e.textContent)).includes('test-only-secret'),false);
});
