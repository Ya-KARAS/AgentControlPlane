export const STAGE_RECORD_VERSION = 2;

function boundedInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

export function conversationScope(locationLike) {
  const origin = String(locationLike?.origin ?? "").trim();
  const pathname = String(locationLike?.pathname ?? "/").trim() || "/";
  return `${origin}${pathname}`;
}

export function stageStorageKey(scope) {
  return `acp-stage-v2:${String(scope ?? "")}`;
}

export function stageLockName(scope) {
  return `acp-stage-lock-v2:${String(scope ?? "")}`;
}

export function createStageRecord(stage, { scope, expiresAt }) {
  return {
    version: STAGE_RECORD_VERSION,
    state: "staged",
    scope,
    id: stage.id,
    revision: stage.revision,
    ownerId: stage.ownerId,
    envelope: stage.envelope,
    changes: Array.isArray(stage.changes) ? stage.changes.slice(0, 6) : [],
    changeConfirmed: stage.changeConfirmed === true,
    assistantOrdinal: boundedInteger(stage.assistantOrdinal),
    expiresAt,
  };
}

export function createPlanningRecord({
  scope,
  revision,
  ownerId,
  assistantOrdinal,
  baselineEnvelope,
  expiresAt,
}) {
  return {
    version: STAGE_RECORD_VERSION,
    state: "planning",
    scope,
    revision,
    ownerId,
    assistantOrdinal: boundedInteger(assistantOrdinal),
    baselineEnvelope: baselineEnvelope ?? null,
    expiresAt,
  };
}

export function readStageRecord(value, { scope, now = Date.now() }) {
  if (
    !value ||
    value.version !== STAGE_RECORD_VERSION ||
    value.scope !== scope ||
    !["staged", "planning"].includes(value.state) ||
    now >= Number(value.expiresAt ?? 0) ||
    typeof value.revision !== "string" ||
    !value.revision
  ) {
    return null;
  }
  if (
    value.state === "staged" &&
    (typeof value.id !== "string" ||
      !value.id ||
      !value.envelope ||
      typeof value.envelope !== "object" ||
      Array.isArray(value.envelope))
  ) {
    return null;
  }
  return value;
}

export function stageRecordsMatch(left, right) {
  return Boolean(
    left &&
    right &&
    left.state === "staged" &&
    right.state === "staged" &&
    left.scope === right.scope &&
    left.id === right.id &&
    left.revision === right.revision,
  );
}

export function observationCanReplace(record, observation) {
  if (!record) return true;
  if (record.state === "staged" && record.id === observation.id) return true;
  return boundedInteger(observation.assistantOrdinal) >
    boundedInteger(record.assistantOrdinal);
}
