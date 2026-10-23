import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { ControlPlaneError } from "../core/errors.js";

const failure = (code) => new ControlPlaneError(code, "DSH process range was not confirmed", { safeToReroute: false });

// The installed runner owns a suspended-before-assignment Windows Job. Target
// exit alone is not quiescence: runner exit 0 follows its ActiveProcesses=0 check.
// No PID-tree fallback or command replay is permitted at this boundary.
export function spawnDshOwnedProcess(invocation, { cwd, spawn = nodeSpawn,
  settlementTimeoutMs = 3000, platform = process.platform } = {}) {
  if (platform !== "win32" || !invocation?.owner || !cwd ||
      !Number.isSafeInteger(settlementTimeoutMs) || settlementTimeoutMs < 1 || settlementTimeoutMs > 30000) {
    throw failure("dsh_owner_unavailable");
  }
  const owner = new EventEmitter();
  owner.on("error", () => {}); // The settlement promise remains safe for standalone callers.
  owner.quiescent = false;
  owner.targetExitCode = null;
  let runner;
  let spawned = false;
  let closed = false;
  let unhealthy = false;
  let errorSent = false;
  let terminating = false;
  let graceTimer;
  let settled = false;
  let resolveSettlement;
  owner.settlement = new Promise((resolve) => { resolveSettlement = resolve; });
  const settle = (quiescent) => {
    if (settled) return;
    settled = true;
    clearTimeout(graceTimer);
    owner.quiescent = quiescent;
    resolveSettlement({ quiescent, targetExitCode: owner.targetExitCode });
  };
  const fail = (code) => {
    unhealthy = true;
    if (!errorSent) { errorSent = true; owner.emit("error", failure(code)); }
    if (!closed) owner.terminate();
  };
  owner.terminate = () => {
    if (closed || settled || terminating) return owner.settlement;
    terminating = true;
    graceTimer = setTimeout(() => {
      // Closing the sole runner closes its kill-on-close Job. This is a last
      // resort signal, not a positive observation of the entire range being empty.
      unhealthy = true;
      if (!errorSent) { errorSent = true; owner.emit("error", failure("dsh_owner_unconfirmed")); }
      try { runner?.kill(); } catch { /* Keep unknown; never launch a replacement. */ }
      settle(false);
    }, settlementTimeoutMs);
    if (!runner?.connected) {
      fail("dsh_owner_disconnected");
      return owner.settlement;
    }
    try {
      runner.send({ type: "terminate" }, (error) => { if (error) fail("dsh_owner_control_error"); });
    } catch { fail("dsh_owner_control_error"); }
    return owner.settlement;
  };
  owner.kill = owner.terminate;
  try {
    runner = spawn(invocation.owner.command, invocation.owner.args, {
      cwd, env: invocation.owner.env, windowsHide: true, shell: false,
      stdio: ["ignore", "ignore", "ignore", "ipc", "pipe", "pipe", "pipe"],
      serialization: "json",
    });
    owner.pid = runner.pid;
    owner.stdin = runner.stdio?.[4];
    owner.stdout = runner.stdio?.[5];
    owner.stderr = runner.stdio?.[6];
    if (!owner.stdin || !owner.stdout || !owner.stderr) {
      queueMicrotask(() => fail("dsh_owner_stdio_error"));
    }
    runner.on("spawn", () => {
      if (spawned || closed || terminating) return;
      spawned = true;
      if (!runner.connected) return fail("dsh_owner_disconnected");
      try {
        runner.send({ type: "start", cwd, env: invocation.options.env },
          (error) => { if (error) fail("dsh_owner_control_error"); });
      } catch { fail("dsh_owner_control_error"); }
    });
    runner.on("message", (frame) => {
      if (closed || unhealthy) return;
      if (!spawned || !frame || Array.isArray(frame) || typeof frame !== "object") {
        fail("dsh_owner_protocol_error"); return;
      }
      if (frame.type === "error") { fail("dsh_owner_native_error"); return; }
      if (frame.type !== "target-exit" || Object.keys(frame).sort().join(",") !== "exitCode,type" ||
          !Number.isSafeInteger(frame.exitCode) || frame.exitCode < 0 || owner.targetExitCode !== null) {
        fail("dsh_owner_protocol_error"); return;
      }
      owner.targetExitCode = frame.exitCode;
    });
    runner.on("error", () => fail("dsh_owner_spawn_error"));
    runner.on("disconnect", () => {
      // A normal result disconnects IPC before close; absence of a direct result
      // or a previously failed range cannot be promoted to success.
      if (owner.targetExitCode === null && !closed) fail("dsh_owner_disconnected");
    });
    runner.on("close", (code, signal) => {
      if (closed) return;
      closed = true;
      const confirmed = !unhealthy && code === 0 && !signal && owner.targetExitCode !== null;
      if (!confirmed) fail("dsh_owner_exit_unconfirmed");
      settle(confirmed);
      owner.emit("close", confirmed ? owner.targetExitCode : null, signal ?? null);
    });
  } catch {
    closed = true;
    queueMicrotask(() => {
      fail("dsh_owner_spawn_error"); settle(false); owner.emit("close", null, null);
    });
  }
  return owner;
}
