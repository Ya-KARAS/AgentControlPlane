import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (name) => fs.readFileSync(path.resolve("scripts", name), "utf8");

test("Windows server startup keeps provider credentials optional and avoids duplicate listeners", () => {
  const source = read("start-server.ps1");

  assert.match(source, /if \(-not \[string\]::IsNullOrWhiteSpace\(\$key\)\)/);
  assert.doesNotMatch(source, /ASTERROUTE_API_KEY is not set/);
  assert.match(source, /already-running health=/);
  assert.match(source, /RedirectStandardOutput/);
  assert.match(source, /server\.pid/);
});

test("Windows autostart shortcut launches the same guarded startup script hidden", () => {
  const source = read("install-autostart.ps1");

  assert.match(source, /AgentControlPlane\.lnk/);
  assert.match(source, /start-server\.ps1/);
  assert.match(source, /-WindowStyle Hidden/);
  assert.match(source, /CreateShortcut/);
});

test("Windows stop script clears stale and completed pid records", () => {
  const source = read("stop-server.ps1");

  assert.match(source, /server\.pid/);
  assert.match(source, /Remove-Item -LiteralPath \$pidFile/);
});
