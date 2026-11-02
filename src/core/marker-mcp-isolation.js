const fail=()=>new Error('MCP process isolation unavailable');
// Codex0.165 CLI splits override keys on dots. Keep that key fixed and put
// names inside a TOML inline-table VALUE. Empty tables merge, never clear.
// Only names + enabled=false enter argv, not user commands/URLs/auth fields.
export function buildDisabledMcpOverride(servers){
 if(!servers||typeof servers!=='object'||Array.isArray(servers))throw fail();
 const names=Object.keys(servers);if(names.length>32)throw fail();
 for(const key of names){
  if(!key||key.length>128||/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(key)||key.isWellFormed()===false||!servers[key]||typeof servers[key]!=='object'||Array.isArray(servers[key]))throw fail();
 }
 if(!names.length)return null;
 // After rejecting controls/unpaired surrogates, JSON quoting uses only the
 // quote/backslash escapes shared with TOML basic quoted keys. Native argv,
 // never a shell command; metacharacters remain data.
 const value='mcp_servers={'+names.map(key=>JSON.stringify(key)+'={enabled=false}').join(',')+'}';
 if(value.length>1800)throw fail();return value;
}
