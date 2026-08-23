import { ControlPlaneError } from "./errors.js";

const PROFILE_ESTIMATE_MINUTES = { economy: 2, balanced: 5, deep: 12 };

export function inferProfileFromObjective(objective) {
  const text = String(objective ?? "");
  if (
    /(架构|重构|迁移|大规模|性能优化|安全审计|全面检查|深度)/.test(text) ||
    text.length > 400
  ) {
    return "deep";
  }
  if (
    /(最小|简单|单文件|一行|小修|微调|示例|hello|demo)/i.test(text) &&
    text.length < 200
  ) {
    return "economy";
  }
  return "balanced";
}

export function estimateTaskMinutes(profileName, timeLimitMinutes = null) {
  const base = PROFILE_ESTIMATE_MINUTES[profileName] ?? 5;
  return timeLimitMinutes != null ? Math.min(base, timeLimitMinutes) : base;
}

export function resolveEndpointModel(provider, requestModel, allowedModels = []) {
  if (!requestModel) return null;
  if (allowedModels.length && !allowedModels.includes(requestModel)) {
    throw new ControlPlaneError(
      "unknown_model",
      `Unknown model for ${provider}: ${requestModel}`,
      { available: allowedModels },
    );
  }
  return requestModel;
}

export function resolveProfile(config, request, modelCatalog = []) {
  const profileName = request.profile ?? "balanced";
  const profile = config.profiles[profileName];
  if (!profile) {
    throw new ControlPlaneError(
      "unknown_profile",
      `Unknown profile: ${profileName}`,
      { available: Object.keys(config.profiles) },
    );
  }

  const maxSubagents =
    request.max_subagents ?? request.maxSubagents ?? profile.maxSubagents;
  const tokenBudget =
    request.token_budget ?? request.tokenBudget ?? profile.tokenBudget;
  const effort =
    request.reasoning_effort ?? request.reasoningEffort ?? profile.effort;
  const timeLimitMinutes =
    request.time_limit_minutes ?? request.timeLimitMinutes ?? null;

  if (!Number.isInteger(maxSubagents) || maxSubagents < 0 || maxSubagents > 8) {
    throw new ControlPlaneError(
      "invalid_subagent_limit",
      "max_subagents must be an integer from 0 to 8",
    );
  }
  if (
    timeLimitMinutes != null &&
    (!Number.isInteger(timeLimitMinutes) ||
      timeLimitMinutes < 1 ||
      timeLimitMinutes > 240)
  ) {
    throw new ControlPlaneError(
      "invalid_time_limit",
      "time_limit_minutes must be an integer from 1 to 240",
    );
  }
  if (!Number.isInteger(tokenBudget) || tokenBudget < 1000) {
    throw new ControlPlaneError(
      "invalid_token_budget",
      "token_budget must be an integer of at least 1000",
    );
  }
  const maxTokenBudget = config.limits?.maxTokenBudget ?? 250000;
  if (tokenBudget > maxTokenBudget) {
    throw new ControlPlaneError(
      "invalid_token_budget",
      `token_budget must not exceed ${maxTokenBudget}`,
    );
  }

  const resolved = {
    name: profileName,
    model: request.model ?? profile.model ?? config.codex.defaultModel,
    effort,
    maxSubagents,
    tokenBudget,
    timeLimitMinutes,
    summary: profile.summary ?? "concise",
  };

  if (!resolved.model) {
    const defaultModel = modelCatalog.find((model) => model.isDefault);
    resolved.model = defaultModel?.model ?? defaultModel?.id ?? null;
  }
  if (!resolved.model) {
    throw new ControlPlaneError(
      "model_required",
      "No engineering model is configured and Codex did not advertise a default",
    );
  }

  if (modelCatalog.length) {
    const selected = modelCatalog.find(
      (model) => model.id === resolved.model || model.model === resolved.model,
    );
    if (!selected) {
      throw new ControlPlaneError(
        "unknown_model",
        `Codex does not advertise the requested model: ${resolved.model}`,
        { available: modelCatalog.map((model) => model.model ?? model.id) },
      );
    }
    const efforts = selected.supportedReasoningEfforts?.map(
      (entry) => entry.reasoningEffort,
    );
    if (efforts?.length && !efforts.includes(resolved.effort)) {
      throw new ControlPlaneError(
        "unsupported_reasoning_effort",
        `${resolved.model} does not advertise reasoning effort ${resolved.effort}`,
        { available: efforts },
      );
    }
  }
  return resolved;
}

export function publicProfiles(config) {
  return Object.fromEntries(
    Object.entries(config.profiles).map(([name, profile]) => [
      name,
      {
        model: profile.model,
        effort: profile.effort,
        max_subagents: profile.maxSubagents,
        token_budget: profile.tokenBudget,
        summary: profile.summary,
      },
    ]),
  );
}

export function publicModels(modelCatalog) {
  return modelCatalog.map((model) => ({
    id: model.id,
    model: model.model,
    display_name: model.displayName,
    description: model.description,
    is_default: model.isDefault,
    capabilities: model.capabilities ?? null,
    featured: model.featured ?? null,
    route_tier: model.route_tier ?? null,
    preferred_protocol: model.preferred_protocol ?? null,
    route_health: model.route_health ?? null,
    latency: model.latency ?? null,
    pricing: model.pricing ?? null,
    status: model.status ?? null,
    context: model.context ?? null,
    tier: model.tier ?? null,
    supported_reasoning_efforts: model.supportedReasoningEfforts?.map(
      (entry) => entry.reasoningEffort,
    ) ?? [],
  }));
}
