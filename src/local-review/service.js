import path from "node:path";
import { CandidateReviewService } from "../core/candidate-review.js";
import { ControlPlaneError } from "../core/errors.js";
import { resolveWorkspace } from "../core/workspace.js";

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
    execution: {
      executor: task.executor ?? null,
      profile: task.policy?.name ?? null,
      model: task.policy?.model ?? null,
      reasoning_effort: task.policy?.effort ?? null,
    },
    has_error: Boolean(task.error),
    updated_at: task.updatedAt ?? null,
    completed_at: task.completedAt ?? null,
  };
}

export function validateLocalSelection(config, orchestrator, selection) {
  const requestedWorkspace = String(selection?.workspace ?? "").trim();
  const executor = String(selection?.executor ?? "");
  const profile = String(selection?.profile ?? "");
  const roots = config.workspaceRoots ?? [];
  const exactRoot = roots.find(
    (root) => path.resolve(root).toLowerCase() === path.resolve(requestedWorkspace).toLowerCase(),
  );
  const aliases = roots.filter(
    (root) => path.basename(root).toLowerCase() === requestedWorkspace.toLowerCase(),
  );
  let workspace = exactRoot ?? (aliases.length === 1 ? aliases[0] : null);
  if (!workspace) {
    try {
      workspace = resolveWorkspace(requestedWorkspace, roots);
    } catch (error) {
      if (error instanceof ControlPlaneError) {
        throw new ControlPlaneError(
          "candidate_workspace_denied",
          "Workspace must be a configured alias or a path inside the local allowlist",
        );
      }
      throw error;
    }
  }
  const executorEntry = (orchestrator.getExecutors?.() ?? []).find(
    (entry) => entry.id === executor && entry.ready !== false,
  );
  if (!executorEntry) {
    throw new ControlPlaneError(
      "candidate_executor_denied",
      "Executor must be ready and selected from the local registry",
    );
  }
  if (!Object.hasOwn(config.profiles ?? {}, profile)) {
    throw new ControlPlaneError(
      "candidate_profile_denied",
      "Profile must be selected from the local configuration",
    );
  }
  const model = String(selection?.model ?? "").trim() || null;
  const reasoningEffort =
    String(selection?.reasoning_effort ?? selection?.reasoningEffort ?? "").trim() ||
    null;
  const catalog = orchestrator.getModels?.(executor) ?? [];
  const availableModels = catalog
    .map((entry) => entry.model ?? entry.id)
    .filter(Boolean);
  const selectedModel = model
    ? catalog.find((entry) => (entry.model ?? entry.id) === model)
    : null;
  if (model && !selectedModel) {
    throw new ControlPlaneError(
      "candidate_model_denied",
      "Model must be advertised by the selected local executor",
      { available: availableModels },
    );
  }
  const modelEfforts = selectedModel?.supportedReasoningEfforts?.map(
    (entry) => entry.reasoningEffort,
  ) ?? [];
  const executorEfforts = new Set([
    ...Object.values(config.profiles ?? {}).map((entry) => entry.effort),
    ...catalog.flatMap(
      (entry) =>
        entry.supportedReasoningEfforts?.map((effort) => effort.reasoningEffort) ?? [],
    ),
  ].filter(Boolean));
  if (
    reasoningEffort &&
    ((modelEfforts.length && !modelEfforts.includes(reasoningEffort)) ||
      (!modelEfforts.length && !executorEfforts.has(reasoningEffort)))
  ) {
    throw new ControlPlaneError(
      "candidate_reasoning_effort_denied",
      "Reasoning effort must be advertised for the selected execution route",
      { available: modelEfforts.length ? modelEfforts : [...executorEfforts] },
    );
  }
  return {
    workspace,
    executor,
    profile,
    model,
    reasoning_effort: reasoningEffort,
  };
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

function configuredExecutorModel(config, executor, catalog) {
  if (executor === "codex") {
    return null;
  }
  const builtIn = {
    opencode: config.executor?.opencode?.model,
    claude: config.executor?.claude?.model,
    deepseek: config.executor?.deepseek?.model,
    "openai-compatible": config.executor?.openaiCompat?.model,
  }[executor];
  const relay = config.executor?.relays?.find((entry) => entry.id === executor);
  return (
    builtIn ??
    relay?.model ??
    catalog.find((entry) => entry.isDefault)?.model ??
    catalog.find((entry) => entry.isDefault)?.id ??
    null
  );
}

export function localReviewCapabilities(config, orchestrator, settings) {
  const executors = (orchestrator.getExecutors?.() ?? [])
    .filter((entry) => entry.ready !== false)
    .map((entry) => ({
      id: entry.id,
      display_name: entry.display_name ?? entry.id,
    }));
  const models = {};
  for (const executor of executors) {
    models[executor.id] = (orchestrator.getModels?.(executor.id) ?? [])
      .slice(0, 200)
      .map((entry) => ({
        id: entry.model ?? entry.id,
        display_name: entry.displayName ?? entry.display_name ?? entry.model ?? entry.id,
        reasoning_efforts:
          entry.supportedReasoningEfforts?.map(
            (effort) => effort.reasoningEffort,
          ) ?? [],
      }))
      .filter((entry) => entry.id);
  }
  const currentProfile = config.profiles?.[settings.profile] ?? {};
  const currentCatalog = orchestrator.getModels?.(settings.executor) ?? [];
  const currentModel =
    settings.executor === "codex"
      ? currentProfile.model ?? null
      : configuredExecutorModel(config, settings.executor, currentCatalog);
  const workspaceLabels = (config.workspaceRoots ?? []).map((root) =>
    path.basename(root),
  );
  return {
    current: {
      workspace: path.basename(settings.workspace ?? "") || null,
      executor: settings.executor,
      profile: settings.profile,
      model: currentModel,
      reasoning_effort: currentProfile.effort ?? null,
    },
    workspaces: workspaceLabels.filter(
      (label) =>
        workspaceLabels.filter(
          (candidate) => candidate.toLowerCase() === label.toLowerCase(),
        ).length === 1,
    ),
    executors,
    profiles: Object.fromEntries(
      Object.entries(config.profiles ?? {}).map(([name, profile]) => [
        name,
        {
          model: profile.model ?? null,
          reasoning_effort: profile.effort ?? null,
        },
      ]),
    ),
    models,
  };
}
