#!/usr/bin/env node
import { createConversationFixture } from './lib/conversation-fixture.js';
try{
 const args=process.argv.slice(2);if(args.length&&(args.length!==2||args[0]!=='--port'||!/^\d{1,5}$/.test(args[1])||Number(args[1])>65535))throw Error();
 const app=createConversationFixture();await app.listen(args.length?Number(args[1]):18889);
 process.stdout.write(JSON.stringify({fixture_only:true,credentials_required:false,executors_started:false,address:`http://127.0.0.1:${app.address().port}`})+'\n');
 let stopping=false;const stop=()=>{if(stopping)return;stopping=true;app.close().catch(()=>{process.exitCode=1;});};process.once('SIGTERM',stop);process.once('SIGINT',stop);
}catch{process.stderr.write('Synthetic conversation fixture failed. Use an available loopback port. No production startup attempted.\n');process.exitCode=1;}
