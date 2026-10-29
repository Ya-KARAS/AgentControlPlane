import assert from "node:assert/strict";
import test from "node:test";
import { HANDOFF_SCENARIOS, runHandoffAcceptance, runHandoffScenario } from "../scripts/lib/handoff-acceptance.js";
import { main, parseArgs } from "../scripts/accept-handoff.js";

for (const { id, name } of HANDOFF_SCENARIOS) {
  test(`handoff acceptance ${id}: ${name}`, async () => {
    await runHandoffScenario(id);
  });
}

test("handoff acceptance reports failures and continues through every scenario", async () => {
  const seen = [];
  const report = await runHandoffAcceptance({
    runScenario: async (id) => {
      if (id === "a") throw new Error("injected assertion failure");
    },
    onScenario: (result) => seen.push(result),
  });
  assert.equal(report.passed, false);
  assert.deepEqual(seen.map((entry) => entry.id), HANDOFF_SCENARIOS.map((entry) => entry.id));
  assert.equal(report.scenarios[0].error, "injected assertion failure");
  assert.ok(report.scenarios.slice(1).every((entry) => entry.passed));
});

test("handoff CLI JSON is one parseable report from the shared offline scenarios", async () => {
  const output = [];
  const report = await main(["--json"], { write: (line) => output.push(line) });
  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]), report);
  assert.equal(report.passed, true);
  assert.equal(report.scenarios.length, HANDOFF_SCENARIOS.length);
});

test("handoff CLI prints PASS/FAIL and propagates an unsuccessful report", async () => {
  const output = [];
  const report = await main([], {
    write: (line) => output.push(line),
    runAcceptance: (options) => runHandoffAcceptance({ ...options, runScenario: async (id) => {
      if (id === "b") throw new Error("injected failure");
    } }),
  });
  assert.equal(report.passed, false);
  assert.equal(output.length, HANDOFF_SCENARIOS.length);
  assert.match(output[0], /^PASS a:/);
  assert.match(output[1], /^FAIL b:.*injected failure/);
});

test("handoff CLI accepts only offline options and help does not run scenarios", async () => {
  assert.deepEqual(parseArgs(["--json"]), { json: true, help: false });
  for (const arg of ["--config", "--to", "--keep", "--live", "unexpected"]) {
    assert.throws(() => parseArgs([arg]), /Unknown argument/);
  }
  const output = [];
  const report = await main(["--help"], {
    write: (line) => output.push(line),
    runAcceptance: () => { throw new Error("help must not execute"); },
  });
  assert.equal(report.help, true);
  assert.match(output[0], /Usage:/);
});
