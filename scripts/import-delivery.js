#!/usr/bin/env node
import fs from 'node:fs';
import { loadConfig } from '../src/core/config.js';
import { TaskStore } from '../src/core/store.js';

// Offline is an operator assertion: stop ACP before importing, then restart.
try {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== '--offline' || args[1].startsWith('-')) throw new Error();
  const file = args[2];
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > 65536) throw new Error();
  const input = JSON.parse(fs.readFileSync(file, 'utf8'));
  const config = loadConfig();
  const store = new TaskStore(config.stateDir, config.limits.maxStoredEventsPerTask,
    config.limits.maxStoredTasks, config.limits.maxAuditBytes, config.audit?.integrityKey);
  store.recordDelivery(args[1], input);
  process.stdout.write('Unverified delivery observation recorded; no approval or GitHub action performed.\n');
} catch {
  process.stderr.write('Delivery import refused. Use --offline TASK_ID FILE after stopping ACP; check bounded metadata and task identity. Human approval is unsupported.\n');
  process.exitCode = 1;
}
