import readline from 'node:readline';import fs from 'node:fs';
const mode=process.argv[2]??'complete',send=v=>process.stdout.write(JSON.stringify(v)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;const ok=result=>send({id:m.id,result});switch(m.method){
 case'initialize':return ok({});case'account/read':return ok({account:{type:mode==='api'?'apiKey':'chatgpt',email:'private-account-marker'}});
 case'config/read':return ok({config:{model_provider:'openai',mcp_servers:mode==='mcp'?{bad:{command:'private-marker'}}:{},hooks:{}}});
 case'account/rateLimits/read':return ok({rateLimits:{primary:{usedPercent:mode==='exhausted'?100:20},secondary:null,rateLimitReachedType:null,...(mode==='unknown-billing'?{}:{credits:{hasCredits:mode==='credits',unlimited:false}})}});
 case'model/list':return ok({data:[{id:'fixture-model',model:'fixture-model',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'low'}]}]});
 case'windowsSandbox/readiness':return ok({status:'ready'});case'thread/start':return ok({thread:{id:'fixture-thread'}});case'thread/goal/set':case'thread/goal/get':return ok({});
 case'turn/interrupt':ok({});return send({method:'turn/completed',params:{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'interrupted',items:[]}}});
 case'turn/start':ok({turn:{id:'fixture-turn'}});if(mode==='hang')return;if(mode!=='bad-marker')fs.writeFileSync('acceptance-marker.txt','ACP acceptance marker v1\n');else fs.writeFileSync('acceptance-marker.txt','private-bad-content-marker');send({method:'thread/tokenUsage/updated',params:{threadId:mode==='wrong-usage'?'unrelated-thread':'fixture-thread',turnId:'fixture-turn',tokenUsage:{last:{inputTokens:20,outputTokens:5,totalTokens:25}}}});return setTimeout(()=>send({method:'turn/completed',params:{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'completed',items:[{type:'agentMessage',phase:'final_answer',text:JSON.stringify({status:'completed',summary:'private-summary-marker',changed_files:['acceptance-marker.txt'],tests:[],blockers:[],next_action:null})}]}}}),20);
 default:return ok({});}});
