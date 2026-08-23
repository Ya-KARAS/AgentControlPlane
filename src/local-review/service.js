import { CandidateReviewService } from "../core/candidate-review.js";
import { ControlPlaneError } from "../core/errors.js";

function validateLocalSelection(config, orchestrator, selection) {
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
  });
}

export function localReviewOptions(config, orchestrator) {
  return {
    workspaces: [...(config.workspaceRoots ?? [])],
    executors: orchestrator.getExecutors?.() ?? [],
    profiles: Object.keys(config.profiles ?? {}),
  };
}
