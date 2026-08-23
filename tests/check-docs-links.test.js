import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "..", "scripts", "check-docs-links.js");
const fixture = (name) => path.join(here, "fixtures", "docs-links", name);

function run(files) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...files], {
      encoding: "utf8",
    });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status ?? 1, stdout: String(error.stdout ?? "") };
  }
}

test("ok.md passes: valid, https, anchor, title, and nested links resolve", () => {
  const result = run([fixture("ok.md")]);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(result.stdout.trim(), "");
});

test("broken.md fails and reports file:line and the missing target", () => {
  const result = run([fixture("broken.md")]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /broken\.md:3: broken link -> missing\.md/);
});

test("default scan recursively validates repository documentation", () => {
  const result = run([]);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(result.stdout.trim(), "");
});
