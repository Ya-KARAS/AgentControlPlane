import { ControlPlaneError } from "./errors.js";
import { computeCostRange, normalizePricing } from "./recommend.js";
import { extractTokenEstimate } from "./token-estimate.js";

// Each token is billed once. Cached input uses the cached rate, and reasoning
// output uses the reasoning rate. This is an estimate from catalog prices,
// not a provider bill.
export const COST_FORMULA =
  "round(max(0, input_tokens - cached_input_tokens) * input_microusd_per_token + cached_input_tokens * cached_input_microusd_per_token + max(0, output_tokens - reasoning_output_tokens) * output_microusd_per_token + reasoning_output_tokens * reasoning_output_microusd_per_token)";

export function estimateCost(taskRequirements = {}, model = null, config = {}) {
  const modelId = typeof model === "string"
    ? model
    : model?.model ?? model?.id ?? null;
  const tokenEstimate = extractTokenEstimate(
    { profile: taskRequirements?.profile ?? "balanced" },
    config,
  );
  const pricing = normalizePricing(
    typeof model === "string" ? null : model?.pricing,
  );
  return {
    formula: COST_FORMULA,
    inputs: {
      model: modelId,
      token_estimate: tokenEstimate,
      pricing,
    },
    range: computeCostRange(tokenEstimate, pricing),
  };
}

const WINDOW_UNITS = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function parseWindow(window, now = Date.now()) {
  if (window && typeof window === "object" && !Array.isArray(window)) {
    const since = window.since == null ? null : Date.parse(window.since);
    const until = window.until == null ? now : Date.parse(window.until);
    if (window.since != null && !Number.isFinite(since)) {
      throw new ControlPlaneError("invalid_window", "window.since must be a time");
    }
    if (!Number.isFinite(until)) {
      throw new ControlPlaneError("invalid_window", "window.until must be a time");
    }
    if (since != null && since > until) {
      throw new ControlPlaneError("invalid_window", "window.since is after window.until");
    }
    return { since, until };
  }
  const match = /^(\d+)([mhd])$/.exec(String(window ?? "").trim());
  if (!match || match[1].length > 6) {
    throw new ControlPlaneError(
      "invalid_window",
      "window must be a duration such as 24h or 7d, or {since, until}",
    );
  }
  const until = now;
  return { since: until - Number(match[1]) * WINDOW_UNITS[match[2]], until };
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return Math.round(sorted[low] + (sorted[high] - sorted[low]) * (rank - low));
}

function taskModel(task) {
  if (typeof task?.model === "string" && task.model) return task.model;
  if (typeof task?.policy?.model === "string" && task.policy.model) return task.policy.model;
  return null;
}

function taskDurationMs(task) {
  const start = Date.parse(task?.startedAt ?? task?.started_at ?? "");
  const end = Date.parse(task?.completedAt ?? task?.completed_at ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

export function latencyStats(tasks, model, window, now = Date.now()) {
  const bounds = parseWindow(window, now);
  const wanted = String(model ?? "");
  const durations = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!wanted || taskModel(task) !== wanted) continue;
    const end = Date.parse(task?.completedAt ?? task?.completed_at ?? "");
    if (!Number.isFinite(end)) continue;
    if (bounds.since != null && end < bounds.since) continue;
    if (end > bounds.until) continue;
    const duration = taskDurationMs(task);
    if (duration == null) continue;
    durations.push(duration);
  }
  durations.sort((left, right) => left - right);
  return {
    model: wanted || null,
    window: {
      since: bounds.since == null ? null : new Date(bounds.since).toISOString(),
      until: new Date(bounds.until).toISOString(),
    },
    count: durations.length,
    p50_ms: percentile(durations, 50),
    p95_ms: percentile(durations, 95),
  };
}
