import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationScope,
  createDispatchedRecord,
  createPlanningRecord,
  createStageRecord,
  observationCanReplace,
  observationWasDispatched,
  observationWaitsBehindBarrier,
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
    dispatchWhenReady: true,
    expiresAt: 2_000,
  });
  assert.equal(readStageRecord(planning, { scope, now: 1_000 }), planning);
  assert.equal(planning.dispatchWhenReady, true);
  assert.equal(
    observationCanReplace(planning, { id: "old", assistantOrdinal: 5 }),
    false,
  );
  assert.equal(
    observationWaitsBehindBarrier(planning, { id: "old", assistantOrdinal: 5 }),
    true,
  );
  assert.equal(
    observationCanReplace(planning, { id: "new", assistantOrdinal: 6 }),
    true,
  );
  assert.equal(
    observationWaitsBehindBarrier(planning, { id: "new", assistantOrdinal: 6 }),
    false,
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

test("dispatched records permanently consume the sent task but allow a newer task", () => {
  const dispatched = createDispatchedRecord({
    id: "sent-envelope",
    envelope,
    assistantOrdinal: 8,
  }, { scope, dispatchedAt: 1_500 });
  assert.equal(readStageRecord(dispatched, { scope, now: 9_999_999 }), dispatched);
  assert.equal("envelope" in dispatched, false);
  assert.equal(
    observationWasDispatched(dispatched, {
      id: "sent-envelope",
      assistantOrdinal: 8,
    }),
    true,
  );
  assert.equal(
    observationWasDispatched(dispatched, {
      id: "older-envelope",
      assistantOrdinal: 7,
    }),
    true,
  );
  assert.equal(
    observationCanReplace(dispatched, {
      id: "new-envelope",
      assistantOrdinal: 9,
    }),
    true,
  );
  assert.equal(
    observationWasDispatched(dispatched, {
      id: "new-envelope",
      assistantOrdinal: 9,
    }),
    false,
  );
});
