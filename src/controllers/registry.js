import { CONTROLLER_KINDS } from "./controller.js";
import { ControlPlaneError } from "../core/errors.js";

const kinds = new Set(Object.values(CONTROLLER_KINDS));
const bindings = new WeakMap();
const trustedActors = new WeakSet();
const invalid = () => new ControlPlaneError("invalid_config", "controllers.agents must contain bounded, unique controller identities and principal bindings");
const safeText = (value, maximum) => typeof value === "string" && value.length > 0 &&
  value.length <= maximum && value.trim() === value && !/[\x00-\x1f\x7f-\x9f]/.test(value);

// Config is operator-owned. Public descriptors deliberately exclude principal
// bindings and arbitrary config extras (including any credentials).
export function normalizeAgentRegistry(agents = []) {
  if (!Array.isArray(agents) || agents.length > 128) throw invalid();
  const ids = new Set();
  const principals = new Map();
  const registry = Object.freeze(agents.map((agent) => {
    if (!agent || !safeText(agent.id, 64) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(agent.id) ||
        agent.id === "local-operator" || ids.has(agent.id)) throw invalid();
    ids.add(agent.id);
    const kind = agent.kind ?? "mcp";
    const displayName = agent.display_name ?? agent.id;
    if (!kinds.has(kind) || !safeText(displayName, 80)) throw invalid();
    const descriptor = Object.freeze({ id: agent.id, kind, display_name: displayName });
    if (agent.principal_id !== undefined) {
      const principal = agent.principal_id;
      if (!safeText(principal, 200) || principal === "local-operator" || principals.has(principal)) throw invalid();
      principals.set(principal, descriptor);
    }
    return descriptor;
  }));
  bindings.set(registry, principals);
  return registry;
}

// principalId MUST come from a verified transport, never request metadata.
// Current shared-bearer transports bind only the explicit local operator;
// an absent/unknown principal never authenticates a named personal agent.
export function resolveControllerActor({ principalId, kind = "mcp", registry } = {}) {
  const validKind = kinds.has(kind);
  const descriptor = validKind && principalId === "local-operator"
    ? { id: "local-operator", kind, display_name: "Local operator" }
    : bindings.get(registry)?.get(principalId);
  if (!validKind || !descriptor || descriptor.kind !== kind) {
    return Object.freeze({ id: null, kind: validKind ? kind : "mcp", trusted: false });
  }
  const actor = Object.freeze({ ...descriptor, trusted: true });
  trustedActors.add(actor);
  return actor;
}

// Store-facing provenance check: copied/request-created objects are not actors.
export function isTrustedControllerActor(actor) {
  return trustedActors.has(actor);
}
