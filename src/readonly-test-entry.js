import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const fixtureSchema=z.object({id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),summary:z.string().min(1).max(512),body:z.string().min(1).refine(s=>Buffer.byteLength(s,'utf8')<=16384)}).strict();
const toolCallSchema=z.object({name:z.enum(['get_requirements','read_capabilities']),arguments:z.object({}).strict().optional()}).strict();
const defaultFixture={id:'synthetic-requirements',summary:'Synthetic read-only protocol test',body:'Prepare an engineering document for a synthetic example. No execution is requested.'};
const capabilities=Object.freeze({mode:'read-only',executors_started:false,ordinary_chat_connected:false,production_state_loaded:false,tools:['get_requirements','read_capabilities'],fixture_only:true});
function json(response,status,body){response.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(JSON.stringify(body));}
function readBody(request){return new Promise((resolve,reject)=>{
 let size=0,parts=[],done=false;
 request.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>32768){done=true;parts=[];reject(413);}else parts.push(chunk);});
 request.on('end',()=>{if(done)return;try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{reject(400);}});
 request.on('error',()=>reject(400));request.on('aborted',()=>reject(400));
});}

// Deliberately separate composition root. Do not import production config,
// store, application, executors, pairing, relay or environment loaders here.
export function createReadOnlyTestEntry({fixture=defaultFixture,deadlineMs=5000}={}) {
 if(!Number.isInteger(deadlineMs)||deadlineMs<50||deadlineMs>5000)throw new Error('Invalid bounded HTTP deadline');
 const data=Object.freeze({...fixtureSchema.parse(fixture),synthetic:fixture===defaultFixture,source:fixture===defaultFixture?'synthetic_fixture':'host_supplied_fixture'});
 let active=0;
 const mcpServers=new Set();
 const counterLimit=Number.MAX_SAFE_INTEGER;
 const counters={mode:'read-only',counter_limit:counterLimit,requests_total:0,
  statuses:{'200':0,'202':0,'400':0,'403':0,'404':0,'405':0,'406':0,'413':0,'415':0,'429':0,'500':0,'503':0,other:0,closed:0},
  rejections:{host_origin:0,capacity:0,route:0,content_type:0,invalid_json:0,invalid_rpc:0,tool_call:0,body_size:0,diagnostic_body:0,deadline:0,handler:0},
  methods:{initialize:0,list:0,call:0,other:0,invalid:0},
  transport:{connection_deadline:0,invalid_http:0}};
 const bump=(category,key)=>{category[key]=Math.min(counterLimit,category[key]+1);};
 const server=http.createServer(async(request,response)=>{
  bump(counters,'requests_total');
  let statusRecorded=false;
  const recordStatus=()=>{if(statusRecorded)return;statusRecorded=true;const code=String(response.statusCode);bump(counters.statuses,response.writableFinished?(Object.hasOwn(counters.statuses,code)?code:'other'):'closed');};
  response.once('finish',recordStatus);response.once('close',recordStatus);
  const port=server.address()?.port;
  if(request.headers.host!==`127.0.0.1:${port}` || (request.headers.origin!==undefined&&request.headers.origin!==`http://127.0.0.1:${port}`)){
   bump(counters.rejections,'host_origin');json(response,403,{error:'Loopback origin and host required'});return;
  }
  if(active>=8){bump(counters.rejections,'capacity');json(response,503,{error:'Read-only request limit reached'});return;}
  const requestDeadline=setTimeout(()=>{bump(counters.rejections,'deadline');request.socket.destroy();},deadlineMs);requestDeadline.unref();
  active++;let finished=false;const finish=()=>{if(!finished){finished=true;clearTimeout(requestDeadline);active--;}};response.once('finish',finish);response.once('close',finish);
  if(request.method==='GET'&&request.url==='/health'){json(response,200,{status:'ok',...capabilities,scope:'isolated test entry liveness only'});return;}
  if(request.method==='GET'&&request.url==='/diagnostics'){
   if(request.headers['transfer-encoding']!==undefined || (request.headers['content-length']!==undefined&&request.headers['content-length']!=='0')){
    bump(counters.rejections,'diagnostic_body');json(response,400,{error:'Diagnostic reads do not accept a body'});return;
   }
   json(response,200,structuredClone(counters));return;
  }
  if(request.method!=='POST'||request.url!=='/mcp'){bump(counters.rejections,'route');json(response,404,{error:'Read-only test route not found'});return;}
  let mcp;
  try{
   if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']??'')){bump(counters.rejections,'content_type');bump(counters.methods,'invalid');json(response,415,{error:'JSON required'});return;}
   let body;
   try{body=await readBody(request);}catch(error){bump(counters.rejections,error===413?'body_size':'invalid_json');bump(counters.methods,'invalid');throw error;}
   if(!body||Array.isArray(body)||typeof body!=='object'||body.jsonrpc!=='2.0'||typeof body.method!=='string'){bump(counters.rejections,'invalid_rpc');bump(counters.methods,'invalid');json(response,400,{error:'Invalid JSON-RPC request'});return;}
   bump(counters.methods,body.method==='initialize'?'initialize':body.method==='tools/list'?'list':body.method==='tools/call'?'call':'other');
   if(body.method==='tools/call'&&!toolCallSchema.safeParse(body.params).success){
    bump(counters.rejections,'tool_call');json(response,200,{jsonrpc:'2.0',id:typeof body.id==='string'||typeof body.id==='number'?body.id:null,error:{code:-32602,message:'Only read-only test tools are available'}});return;
   }
   mcp=new McpServer({name:'acp-readonly-test',version:'1.0.0'},{maxToolInputElements:256});
   const annotations={readOnlyHint:true,destructiveHint:false,openWorldHint:false,idempotentHint:true};
   const empty=z.object({}).strict();
   mcp.registerTool('get_requirements',{description:'Read the controlled test fixture; no dispatch or approval.',inputSchema:empty,annotations},async()=>({structuredContent:{fixture:data},content:[{type:'text',text:JSON.stringify({fixture:data})}]}));
   mcp.registerTool('read_capabilities',{description:'Read this isolated entry capability limits; not normal ACP readiness.',inputSchema:empty,annotations},async()=>({structuredContent:{...capabilities},content:[{type:'text',text:JSON.stringify(capabilities)}]}));
   mcpServers.add(mcp);
   const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
   await mcp.connect(transport);
   await transport.handleRequest(request,response,body);
  }catch(error){if(typeof error!=='number')bump(counters.rejections,'handler');if(!response.headersSent&&!response.destroyed)json(response,typeof error==='number'?error:400,{error:'Read-only request rejected'});}
  finally{if(mcp){mcpServers.delete(mcp);await mcp.close().catch(()=>{});}}
 });
 // Deadlines are tied only to active HTTP connections/requests, not a polling
 // registry. The socket deadline also covers clients that never finish headers;
 // Node's requestTimeout sweep alone does not enforce a five-second wall clock.
 server.on('connection',socket=>{
  const deadline=setTimeout(()=>{bump(counters.transport,'connection_deadline');socket.destroy();},deadlineMs);deadline.unref();
  socket.once('close',()=>clearTimeout(deadline));
 });
 server.on('clientError',(_error,socket)=>{
  bump(counters.transport,'invalid_http');
  if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
 });
 server.maxConnections=16;
 server.requestTimeout=deadlineMs;server.headersTimeout=deadlineMs;server.keepAliveTimeout=1000;
 return Object.freeze({
  listen(port=4328,host='127.0.0.1'){
   if(host!=='127.0.0.1'||!Number.isInteger(port)||port<0||port>65535)return Promise.reject(new Error('Explicit loopback and valid port required'));
   return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});});
  },
  address:()=>server.address(),
  async close(){for(const mcp of mcpServers)await mcp.close().catch(()=>{});server.closeAllConnections();if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));},
 });
}
