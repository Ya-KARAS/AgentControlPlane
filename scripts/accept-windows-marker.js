#!/usr/bin/env node
// Explicit live gate. No production config or state is imported by this entry.
const args=process.argv.slice(2),usage='Usage (Windows, subscribed live task): node scripts/accept-windows-marker.js --run-marker --model <advertised-model> [--port 18891] [--timeout-seconds 120] [--codex-command <native-exe>]';
try{
 if(args[0]!=='--run-marker')throw Error();const values={};for(let i=1;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!['--model','--port','--timeout-seconds','--codex-command'].includes(key)||value===undefined||Object.hasOwn(values,key))throw Error();values[key]=value;}
 if(!values['--model']||values['--port']&&!/^\d{1,5}$/.test(values['--port'])||values['--timeout-seconds']&&!/^\d{1,3}$/.test(values['--timeout-seconds']))throw Error();
 const {createMarkerAcceptance}=await import('../src/marker-acceptance.js');const app=createMarkerAcceptance({enabled:true,model:values['--model'],command:values['--codex-command']??'codex',timeoutMs:1000*Number(values['--timeout-seconds']??120)});
 const stop=()=>{app.close().catch(()=>{process.exitCode=1;});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{await app.listen(Number(values['--port']??18891));process.stdout.write(JSON.stringify({mode:'windows-live-marker',address:`http://127.0.0.1:${app.address().port}`,one_new_fixture_task_only:true,human_approval_verified:false})+'\n');const receipt=await app.run();process.stdout.write(JSON.stringify({receipt_path:app.receiptPath,receipt})+'\n');process.exitCode=receipt.outcome==='passed'?0:receipt.outcome==='cancelled'?130:1;}finally{await app.close();process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}catch{process.stderr.write(usage+'\nAcceptance did not start or could not be confirmed. No normal ACP startup attempted.\n');process.exitCode=2;}
