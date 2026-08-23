import assert from "node:assert/strict";
import test from "node:test";
import {
  readResultDeliveryRecord,
  rememberResultDelivery,
  resultDeliveryStorageKey,
  resultWasDelivered,
} from "../userscript/src/result-delivery-state.js";

const scope = "https://chat.deepseek.com/a/chat/s/deepseek-task-1";

test("result delivery records are scoped and remember each task once", () => {
  assert.equal(
    resultDeliveryStorageKey(scope),
    `acp-result-delivery-v1:${scope}`,
  );

  const first = rememberResultDelivery(null, {
    scope,
    taskId: "task-1",
    deliveredAt: 1_000,
    expiresAt: 10_000,
  });
  assert.equal(resultWasDelivered(first, { scope, taskId: "task-1", now: 2_000 }), true);
  assert.equal(resultWasDelivered(first, { scope, taskId: "task-2", now: 2_000 }), false);
  assert.equal(
    resultWasDelivered(first, { scope: `${scope}-other`, taskId: "task-1", now: 2_000 }),
    false,
  );

  const repeated = rememberResultDelivery(first, {
    scope,
    taskId: "task-1",
    deliveredAt: 2_000,
    expiresAt: 11_000,
  });
  assert.equal(repeated.deliveries.length, 1);
  assert.equal(repeated.deliveries[0].deliveredAt, 2_000);

  const second = rememberResultDelivery(repeated, {
    scope,
    taskId: "task-2",
    deliveredAt: 3_000,
    expiresAt: 12_000,
  });
  assert.deepEqual(
    second.deliveries.map((entry) => entry.taskId),
    ["task-2", "task-1"],
  );
});

test("expired or malformed result delivery entries cannot suppress a result", () => {
  const expired = {
    version: 1,
    scope,
    deliveries: [
      { taskId: "task-expired", deliveredAt: 1_000, expiresAt: 2_000 },
      { taskId: "", deliveredAt: 1_000, expiresAt: 9_000 },
    ],
  };

  const record = readResultDeliveryRecord(expired, { scope, now: 3_000 });
  assert.deepEqual(record.deliveries, []);
  assert.equal(
    resultWasDelivered(expired, { scope, taskId: "task-expired", now: 3_000 }),
    false,
  );
  assert.equal(
    readResultDeliveryRecord({ ...expired, scope: "wrong" }, { scope, now: 1_500 }),
    null,
  );
});

test("result delivery history is bounded", () => {
  let record = null;
  for (let index = 0; index < 40; index += 1) {
    record = rememberResultDelivery(record, {
      scope,
      taskId: `task-${index}`,
      deliveredAt: 1_000 + index,
      expiresAt: 20_000 + index,
    });
  }
  assert.equal(record.deliveries.length, 32);
  assert.equal(record.deliveries[0].taskId, "task-39");
  assert.equal(record.deliveries.at(-1).taskId, "task-8");
});
