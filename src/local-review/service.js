import { CandidateReviewService } from "../core/candidate-review.js";
import { ControlPlaneError } from "../core/errors.js";

const PUBLIC_TASK_STATUSES = new Set([
  "queued",
  "running",
  "completed",
  "failed",
  "blocked",
  "partial",
  "cancelled",
]);

function boundedCount(value) {
  return Array.isArray(value) ? Math.min(value.length, 1000) : 0;
}

function testCounts(tests) {
  const entries = Array.isArray(tests) ? tests.slice(0, 1000) : [];
  let passed = 0;
  let failed = 0;
  for (const entry of entries) {
    const status = typeof entry === "object" && entry
      ? String(entry.status ?? "").toLowerCase()
      : String(entry).toLowerCase();
    if (/\b(pass|passed|ok)\b/.test(status)) passed += 1;
    else if (/\b(fail|failed|error)\b/.test(status)) failed += 1;
  }
  return { total: entries.length, passed, failed };
}

export function publicTaskStatus(task) {
  if (!task) return null;
  const status = PUBLIC_TASK_STATUSES.has(task.status) ? task.status : "unknown";
  const resultStatus = PUBLIC_TASK_STATUSES.has(task.result?.status)
    ? task.result.status
    : null;
  return {
    id: task.id,
    status,
    result_status: resultStatus,
    changed_files_count: boundedCount(task.result?.changed_files),
    tests: testCounts(task.result?.tests),
    blocker_count: boundedCount(task.result?.blockers),
    has_error: Boolean(task.error),
    updated_at: task.updatedAt ?? null,
    completed_at: task.completedAt ?? null,
  };
}

export function validateLocalSelection(config, orchestrator, selection) {
  const workspace = String(selection?.workspace ?? "");
  const executor = String(selection?.executor ?? "");
  const profile = String(selection?.profile ?? "");
  if (!(config.workspaceRoots ?? []).includes(workspace)) {
    throw new ControlPlaneError(
      "candidate_workspace_denied",
      "Workspace must be selected from the local allowlist",
    );
  }
  const executorIds = new Set(
    (orchestrator.getExecutors?.() ?? []).map((entry) => entry.id),
  );
  if (!executorIds.has(executor)) {
    throw new ControlPlaneError(
      "candidate_executor_denied",
      "Executor must be selected from the local registry",
    );
  }
  if (!Object.hasOwn(config.profiles ?? {}, profile)) {
    throw new ControlPlaneError(
      "candidate_profile_denied",
      "Profile must be selected from the local configuration",
    );
  }
  return { workspace, executor, profile };
}

export function createCandidateReviewService({ config, orchestrator, store }) {
  return new CandidateReviewService({
    dispatch: (request) => orchestrator.dispatch(request),
    validateApproval: (selection) =>
      validateLocalSelection(config, orchestrator, selection),
    audit: (type, payload) => store.audit(type, payload),
    resolveTaskStatus: (taskId) => publicTaskStatus(store.getTask(taskId)),
  });
}

export function localReviewOptions(config, orchestrator) {
  return {
    workspaces: [...(config.workspaceRoots ?? [])],
    executors: orchestrator.getExecutors?.() ?? [],
    profiles: Object.keys(config.profiles ?? {}),
  };
}
