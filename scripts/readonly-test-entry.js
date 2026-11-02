#!/usr/bin/env node
import { createReadOnlyTestEntry } from '../src/readonly-test-entry.js';
try{
 const args=process.argv.slice(2);
 if(args.length!==0&&(args.length!==2||args[0]!=='--port'||!/^\d{1,5}$/.test(args[1])))throw new Error();
 const port=args.length?Number(args[1]):4328;
 const app=createReadOnlyTestEntry();await app.listen(port);
 process.stdout.write(JSON.stringify({mode:'read-only',executors_started:false,address:`http://127.0.0.1:${app.address().port}`,ordinary_chat_connected:false})+'\n');
 let stopping=false;const stop=()=>{if(stopping)return;stopping=true;app.close().catch(()=>{process.exitCode=1;});};process.once('SIGTERM',stop);process.once('SIGINT',stop);
}catch{process.stderr.write('Read-only test entry failed; use an available loopback port. No production ACP startup attempted.\n');process.exitCode=1;}
