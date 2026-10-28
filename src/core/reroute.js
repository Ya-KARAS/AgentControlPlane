import { ControlPlaneError } from "./errors.js";

export const REROUTE_REASONS = Object.freeze([
  "quota_exhausted",
  "rate_limited",
  "executor_unavailable",
  "authentication_unavailable",
  "provider_unavailable",
]);

export const DEFAULT_REROUTE_CONFIG = Object.freeze({
  enabled: false,
  max_reroutes: 2,
  allowed_reasons: REROUTE_REASONS,
});

function compactFailure(error, context) {
  const details = error?.details ?? error?.error ?? null;
  return [
    error?.code,
    error?.status,
    error?.statusCode,
    error?.name,
    error?.message,
    details?.code,
    details?.status,
    details?.message,
    context?.code,
    context?.status,
    context?.message,
  ]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).toLowerCase())
    .join(" ");
}

function testEvidenceStatus(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  if (typeof entry.status !== "string") return null;
  return entry.status.trim().toLowerCase();
}

function withoutZeroFailureCounts(text) {
  return String(text ?? "").toLowerCase().replace(
    /\b0\s+(?:failed|failing|failures?|errors?|blocked)\b|\b(?:failed|failing|failures?|errors?|blocked)\s*[:=]\s*0\b|[#\u2139]\uFE0F?\s*(?:fail(?:ed|ing|ures?)?|errors?)\s+0\b|\bno\s+(?:errors?|failures?|failing)\b/g,
    " ",
  );
}

function hasFailureKeyword(text) {
  const cleaned = withoutZeroFailureCounts(text);
  return /\b(?:fail|error|block)/.test(cleaned)
    || /\bnot\s+ok\b/.test(cleaned)
    || /[✖✗×]/.test(cleaned)
    || /\bexit(?:ed)?(?:\s+with)?\s+code\s+[1-9]\d*\b/.test(cleaned);
}

function testDetail(entry) {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
  return typeof entry.detail === "string" ? entry.detail : "";
}

function isExplicitPassOrNotRun(status) {
  return status === "passed" || status === "not_run";
}

// A test entry is benign only when it is explicitly passed, or explicitly
// not_run, and its detail has no failure wording or nonzero exit code.
// Every other entry is task-failure evidence, including a bare "npm test".
function isBenignTestEvidence(entry) {
  const status = testEvidenceStatus(entry);
  if (status) {
    return isExplicitPassOrNotRun(status) && !hasFailureKeyword(testDetail(entry));
  }
  if (typeof entry !== "string") return false;
  return /\b(?:passed|not_run)\b/.test(entry.toLowerCase()) && !hasFailureKeyword(entry);
}

function hasTaskFailureEvidence(context = {}) {
  const result = context.result ?? context;
  const tests = Array.isArray(result?.tests) ? result.tests : [];
  const blockers = Array.isArray(result?.blockers) ? result.blockers : [];
  if (tests.some((entry) => !isBenignTestEvidence(entry))) return true;
  const text = withoutZeroFailureCounts(
    [result?.summary, ...blockers]
      .map((value) =>
        typeof value === "string" ? value : JSON.stringify(value ?? ""),
      )
      .join(" "),
  );
  return /\b(test|build|implementation|validation)\b.{0,40}\b(fail|error|block)/.test(
    text,
  );
}

export function classifyExecutorFailure(error, context = {}) {
  if (hasTaskFailureEvidence(context)) return "task_failure";
  const signal = compactFailure(error, context);

  if (/\b429\b|rate[_ -]?limit|too many requests|retry-after/.test(signal)) {
    return "rate_limited";
  }
  if (
    /\b402\b|insufficient[_ -]?(balance|credits?)|quota[_ -]?exhausted|usage limit|credit balance/.test(
      signal,
    )
  ) {
    return "quota_exhausted";
  }
  if (
    /\b401\b|\b403\b|invalid[_ -]?api[_ -]?key|authentication|unauthenticated|unauthorized|forbidden/.test(
      signal,
    )
  ) {
    return "authentication_unavailable";
  }
  if (
    /\b5\d\d\b|provider[_ -]?unavailable|upstream error|do_request_failed|bad gateway|service unavailable/.test(
      signal,
    )
  ) {
    return "provider_unavailable";
  }
  if (
    /spawn|enoent|executor[_ -]?unavailable|app-server|process exited|timed? ?out|timeout|connection refused|econnrefused/.test(
      signal,
    )
  ) {
    return "executor_unavailable";
  }
  return "task_failure";
}

export function resolveRerouteConfig(value = undefined) {
  const config = value ?? {};
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new ControlPlaneError(
      "invalid_config",
      "executor.reroute must be an object",
    );
  }
  const enabled = config.enabled ?? DEFAULT_REROUTE_CONFIG.enabled;
  const maxReroutes = config.max_reroutes ?? DEFAULT_REROUTE_CONFIG.max_reroutes;
  const allowed = config.allowed_reasons ?? DEFAULT_REROUTE_CONFIG.allowed_reasons;
  if (typeof enabled !== "boolean") {
    throw new ControlPlaneError(
      "invalid_config",
      "executor.reroute.enabled must be a boolean",
    );
  }
  if (!Number.isInteger(maxReroutes) || maxReroutes < 0 || maxReroutes > 10) {
    throw new ControlPlaneError(
      "invalid_config",
      "executor.reroute.max_reroutes must be an integer from 0 to 10",
    );
  }
  if (
    !Array.isArray(allowed) ||
    allowed.some((reason) => !REROUTE_REASONS.includes(reason))
  ) {
    throw new ControlPlaneError(
      "invalid_config",
      "executor.reroute.allowed_reasons contains an unsupported reason",
    );
  }
  return {
    enabled,
    max_reroutes: maxReroutes,
    allowed_reasons: [...new Set(allowed)],
  };
}

function modelEntryFor(catalog, modelId) {
  if (!Array.isArray(catalog) || !modelId) return null;
  return (
    catalog.find(
      (entry) => (entry?.model ?? entry?.id) === modelId,
    ) ?? null
  );
}

export function snapshotExecutorCapabilities(
  executor,
  { catalog = [], model = null, discovery = null } = {},
) {
  const endpoint = executor?.kind === "model-endpoint";
  const modelEntry = modelEntryFor(catalog, model);
  const modelCapabilities = modelEntry?.capabilities ?? null;
  const adapter = executor?.capabilities ?? {};
  return {
    executor: executor?.id ?? null,
    kind: endpoint ? "model-endpoint" : "cli",
    model: model ?? null,
    available: discovery?.available ?? executor?.ready ?? null,
    persistent_threads: adapter.persistentThreads ?? null,
    token_usage: adapter.tokenUsage ?? null,
    hard_interrupt: adapter.hardInterrupt ?? null,
    subagents: adapter.subagents ?? null,
    filesystem: endpoint ? true : true,
    shell: endpoint ? true : true,
    git: endpoint ? true : true,
    chat: modelCapabilities?.chat ?? null,
    responses: modelCapabilities?.responses ?? null,
    tools: endpoint ? modelCapabilities?.tools ?? null : true,
    reasoning: modelCapabilities?.reasoning ?? null,
    vision: modelCapabilities?.vision ?? null,
    context_tokens:
      modelEntry?.context != null && Number.isFinite(Number(modelEntry.context))
        ? Number(modelEntry.context)
        : null,
    source: modelCapabilities ? "model_catalog" : endpoint ? "unknown" : "cli",
  };
}

export function evaluateExecutorCompatibility(
  requirements = {},
  capabilities = {},
) {
  const reasons = [];
  const warnings = [];
  if (capabilities.available === false) reasons.push("executor_unavailable");
  if (requirements.tools_required && capabilities.tools !== true) {
    reasons.push(
      capabilities.tools === false ? "tools_unsupported" : "tools_unverified",
    );
  }
  if (requirements.vision_required && capabilities.vision !== true) {
    reasons.push(
      capabilities.vision === false
        ? "vision_unsupported"
        : "vision_unverified",
    );
  }
  const minimumContext = Number(requirements.minimum_context_tokens ?? 0);
  const context = capabilities.context_tokens;
  if (minimumContext > 0) {
    if (context == null) warnings.push("context_unknown");
    else if (Number(context) < minimumContext) reasons.push("context_insufficient");
  }
  if (
    ["high", "ultra"].includes(requirements.reasoning_level) &&
    capabilities.reasoning === false
  ) {
    reasons.push("reasoning_unsupported");
  } else if (
    ["high", "ultra"].includes(requirements.reasoning_level) &&
    capabilities.reasoning == null
  ) {
    warnings.push("reasoning_unknown");
  }
  for (const protocol of requirements.required_protocols ?? []) {
    if (capabilities[protocol] === false) {
      reasons.push(`protocol_unsupported:${protocol}`);
    } else if (capabilities[protocol] == null) {
      warnings.push(`protocol_unknown:${protocol}`);
    }
  }
  return {
    compatible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    warnings: [...new Set(warnings)],
  };
}
