#!/usr/bin/env node
import fs from 'node:fs';
import { validateChatHandoff } from './lib/chat-handoff.js';
try {
  const args=process.argv.slice(2);
  if(args.length!==5||args[1]!=='--expected-parent'||args[3]!=='--logical-task'||!/^\d{1,6}$/.test(args[2]))throw new Error();
  const stat=fs.statSync(args[0]);if(!stat.isFile()||stat.size>262144)throw new Error();
  const input=JSON.parse(fs.readFileSync(args[0],'utf8'));
  const result=validateChatHandoff(input,{expectedParentVersion:Number(args[2]),logicalTaskId:args[4]});
  process.stdout.write(JSON.stringify(result)+'\n');
} catch {
  process.stderr.write('Offline handoff check failed; verify packet, expected parent version and logical task. No send, import or dispatch performed.\n');
  process.exitCode=1;
}
