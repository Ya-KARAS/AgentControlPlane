import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createWorkspaceInventory } from '../../src/core/workspace-inventory.js';
export function inventoryRepo(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'acp-inventory-')),dir=path.join(root,'repo');fs.mkdirSync(dir);const git=(...args)=>execFileSync('git',['-c','core.autocrlf=false','-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid',...args],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git('init','-b','main');fs.writeFileSync(path.join(dir,'a.txt'),'initial\n');git('add','a.txt');git('commit','-m','synthetic');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,dir,git,collector:extra=>createWorkspaceInventory({enabled:true,workspaceRoots:[root],...extra})};}
