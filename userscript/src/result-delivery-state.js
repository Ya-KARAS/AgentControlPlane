export const RESULT_DELIVERY_RECORD_VERSION = 1;
export const RESULT_DELIVERY_MAX_ENTRIES = 32;

function normalizeTaskId(value) {
  const taskId = String(value ?? "").trim();
  return taskId && taskId.length <= 128 ? taskId : null;
}

export function resultDeliveryStorageKey(scope) {
  return `acp-result-delivery-v1:${String(scope ?? "")}`;
}

export function readResultDeliveryRecord(value, { scope, now = Date.now() }) {
  if (
    !value ||
    value.version !== RESULT_DELIVERY_RECORD_VERSION ||
    value.scope !== scope ||
    !Array.isArray(value.deliveries)
  ) {
    return null;
  }

  const seen = new Set();
  const deliveries = [];
  for (const entry of value.deliveries) {
    const taskId = normalizeTaskId(entry?.taskId);
    const deliveredAt = Number(entry?.deliveredAt);
    const expiresAt = Number(entry?.expiresAt);
    if (
      !taskId ||
      seen.has(taskId) ||
      !Number.isFinite(deliveredAt) ||
      !Number.isFinite(expiresAt) ||
      deliveredAt < 0 ||
      now >= expiresAt
    ) {
      continue;
    }
    seen.add(taskId);
    deliveries.push({ taskId, deliveredAt, expiresAt });
    if (deliveries.length >= RESULT_DELIVERY_MAX_ENTRIES) break;
  }

  return {
    version: RESULT_DELIVERY_RECORD_VERSION,
    scope,
    deliveries,
  };
}

export function resultWasDelivered(value, { scope, taskId, now = Date.now() }) {
  const normalizedTaskId = normalizeTaskId(taskId);
  if (!normalizedTaskId) return false;
  return Boolean(
    readResultDeliveryRecord(value, { scope, now })?.deliveries
      .some((entry) => entry.taskId === normalizedTaskId),
  );
}

export function rememberResultDelivery(value, {
  scope,
  taskId,
  deliveredAt = Date.now(),
  expiresAt,
}) {
  const normalizedTaskId = normalizeTaskId(taskId);
  if (
    !normalizedTaskId ||
    !Number.isFinite(deliveredAt) ||
    !Number.isFinite(expiresAt) ||
    deliveredAt < 0 ||
    expiresAt <= deliveredAt
  ) {
    throw new Error("invalid_result_delivery");
  }

  const current = readResultDeliveryRecord(value, { scope, now: deliveredAt });
  const deliveries = [
    { taskId: normalizedTaskId, deliveredAt, expiresAt },
    ...(current?.deliveries ?? []).filter(
      (entry) => entry.taskId !== normalizedTaskId,
    ),
  ].slice(0, RESULT_DELIVERY_MAX_ENTRIES);

  return {
    version: RESULT_DELIVERY_RECORD_VERSION,
    scope,
    deliveries,
  };
}
