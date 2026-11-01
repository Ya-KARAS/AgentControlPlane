#!/usr/bin/env node
// Local operator import; never starts an executor or reads browser sessions.
import fs from 'node:fs';
import { loadConfig } from '../src/core/config.js';
import { TaskStore } from '../src/core/store.js';
try {
 if(process.argv.length !== 3) throw new Error('usage');
 const file=process.argv[2];
 if(!fs.statSync(file).isFile() || fs.statSync(file).size>65536) throw new Error('size');
 const input=JSON.parse(fs.readFileSync(file,'utf8'));
 const config=loadConfig();
 const store=new TaskStore(config.stateDir,config.limits.maxStoredEventsPerTask,config.limits.maxStoredTasks,config.limits.maxAuditBytes,config.audit?.integrityKey);
 store.recordManualSubscription(input);
 process.stdout.write('Manual subscription snapshot imported. No quota probe was performed.\n');
} catch {
 process.stderr.write('Subscription import failed. Supply one valid manual/user_reported JSON file (maximum64KiB) and check local state/configuration.\n');
 process.exitCode=1;
}
