import { EventEmitter } from "node:events";

export class RecordingExecutor extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.kind = "cli";
    this.ready = false;
    this.capabilities = { persistentThreads: true, tokenUsage: true };
    this.discovery = { available: null, status: "unknown" };
    this.startedThreads = [];
    this.resumedThreads = [];
    this.turnStarts = [];
    this.threadCounter = 0;
  }

  async probe() {
    return { available: true, status: "available", reason: null };
  }

  setDiscovery(result) {
    this.discovery = result;
    return result;
  }

  async start() {
    this.ready = true;
  }

  async stop() {}
  respond() {}
  async listModels() { return { data: [] }; }
  async getSandboxReadiness() { return { status: "ready" }; }

  async startThread() {
    this.threadCounter += 1;
    const id = `${this.id}-thread-${this.threadCounter}`;
    this.startedThreads.push(id);
    return { thread: { id } };
  }

  async resumeThread({ threadId }) {
    this.resumedThreads.push(threadId);
    const ownThread = String(threadId).startsWith(`${this.id}-thread-`)
      || (this.id === "codex" && threadId === "legacy-codex-thread");
    if (!ownThread) {
      throw new Error(`${this.id} cannot resume foreign thread ${threadId}`);
    }
    return { thread: { id: threadId, turns: [] } };
  }

  async setGoal() { return {}; }
  async getGoal() { return { goal: null }; }

  async startTurn(params) {
    this.turnStarts.push(params);
    if (this.failNext) {
      const failure = this.failNext;
      this.failNext = false;
      if (failure instanceof Error) throw failure;
      const error = new Error("insufficient balance");
      error.status = 402;
      throw error;
    }
    const turnId = `${this.id}-turn-${this.turnStarts.length}`;
    const completionFailure = this.failNextCompletion;
    this.failNextCompletion = null;
    queueMicrotask(() => {
      if (this.transcript) {
        this.emit("notification", {
          method: "item/completed",
          params: { threadId: params.threadId, turnId,
            item: { type: "agentMessage", phase: "commentary", text: this.transcript } },
        });
      }
      this.emit("notification", {
        method: "turn/completed",
        params: {
          threadId: params.threadId,
          executorSessionId: params.threadId,
          turn: {
            id: turnId,
            status: completionFailure ? "failed" : "completed",
            ...(completionFailure ? { error: {
              code: completionFailure.code,
              message: completionFailure.message,
              status: completionFailure.status,
            } } : {}),
            items: completionFailure ? [] : [{
              type: "agentMessage",
              phase: "final_answer",
              text: JSON.stringify(this.report ?? {
                status: "completed",
                summary: `${this.id} completed ${this.turnStarts.length}`,
                changed_files: [`${this.id}.txt`],
                tests: [{ command: `${this.id} test`, status: "passed", detail: null }],
                blockers: [],
                next_action: null,
              }),
            }],
          },
        },
      });
    });
    return { turn: { id: turnId } };
  }

  async interruptTurn() { return {}; }
}

