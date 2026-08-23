// Agent lifecycle contract.
//
// The orchestrator depends on this semantic surface instead of any specific
// agent protocol (for example, Codex app-server RPC). An executor that
// implements these methods can drive the control plane's thread/goal/turn
// lifecycle. Codex, OpenCode, Claude Code, Kimi Code, and OpenAI-compatible
// adapters map their own transports to this contract without changing the
// orchestrator.

export const AGENT_LIFECYCLE_METHODS = Object.freeze([
  "listModels",
  "getSandboxReadiness",
  "startThread",
  "resumeThread",
  "setGoal",
  "getGoal",
  "startTurn",
  "interruptTurn",
]);

export function assertLifecycle(executor) {
  if (!executor || typeof executor !== "object") {
    throw new TypeError("Executor must be an object");
  }
  for (const method of AGENT_LIFECYCLE_METHODS) {
    if (typeof executor[method] !== "function") {
      throw new TypeError(
        `Executor must implement ${method}() to satisfy the agent lifecycle`,
      );
    }
  }
  return executor;
}
