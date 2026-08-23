import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationScope,
  createPlanningRecord,
  createStageRecord,
  observationCanReplace,
  readStageRecord,
  stageLockName,
  stageRecordsMatch,
  stageStorageKey,
} from "../userscript/src/stage-state.js";

const scope = "https://chatgpt.com/c/task-1";
const envelope = {
  objective: "Test calculator",
  execution: { workspace: "acp-live-test" },
};

test("stage records are conversation-scoped, expiring, and revision-bound", () => {
  assert.equal(
    conversationScope({ origin: "https://chatgpt.com", pathname: "/c/task-1" }),
    scope,
  );
  assert.equal(stageStorageKey(scope), `acp-stage-v2:${scope}`);
  assert.equal(stageLockName(scope), `acp-stage-lock-v2:${scope}`);

  const first = createStageRecord({
    id: "envelope-a",
    revision: "revision-a",
    ownerId: "tab-a",
    envelope,
    changes: ["workspace"],
    changeConfirmed: false,
    assistantOrdinal: 4,
  }, { scope, expiresAt: 2_000 });
  assert.equal(readStageRecord(first, { scope, now: 1_000 }), first);
  assert.equal(readStageRecord(first, { scope: `${scope}-other`, now: 1_000 }), null);
  assert.equal(readStageRecord(first, { scope, now: 2_000 }), null);

  const same = { ...first };
  const revised = { ...first, revision: "revision-b" };
  assert.equal(stageRecordsMatch(first, same), true);
  assert.equal(stageRecordsMatch(first, revised), false);
});

test("planning barriers and newer assistant ordinals reject stale tab tasks", () => {
  const planning = createPlanningRecord({
    scope,
    revision: "planning-a",
    ownerId: "tab-new",
    assistantOrdinal: 5,
    baselineEnvelope: envelope,
    expiresAt: 2_000,
  });
  assert.equal(readStageRecord(planning, { scope, now: 1_000 }), planning);
  assert.equal(
    observationCanReplace(planning, { id: "old", assistantOrdinal: 5 }),
    false,
  );
  assert.equal(
    observationCanReplace(planning, { id: "new", assistantOrdinal: 6 }),
    true,
  );

  const current = createStageRecord({
    id: "new-envelope",
    revision: "revision-new",
    ownerId: "tab-new",
    envelope,
    changes: [],
    changeConfirmed: true,
    assistantOrdinal: 8,
  }, { scope, expiresAt: 2_000 });
  assert.equal(
    observationCanReplace(current, { id: "old-envelope", assistantOrdinal: 7 }),
    false,
  );
  assert.equal(
    observationCanReplace(current, { id: "new-envelope", assistantOrdinal: 7 }),
    true,
  );
});
