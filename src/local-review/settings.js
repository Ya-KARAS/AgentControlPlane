import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ControlPlaneError } from "../core/errors.js";

function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function defaultSelection(options) {
  const workspaces = options.workspaces ?? [];
  const executors = (options.executors ?? []).filter((entry) => entry.ready !== false);
  const profiles = options.profiles ?? [];
  return {
    workspace: workspaces[0] ?? null,
    executor:
      executors.find((entry) => entry.selected === true)?.id ??
      executors[0]?.id ??
      null,
    profile: profiles.includes("economy") ? "economy" : profiles[0] ?? null,
  };
}

export class LocalReviewSettings {
  constructor({
    stateDir,
    getOptions,
    validateSelection,
    normalizeWorkspace = (value) => value,
    audit = () => {},
    now = () => Date.now(),
  }) {
    this.path = path.join(stateDir, "local-review-settings.json");
    this.getOptions = getOptions;
    this.validateSelection = validateSelection;
    this.normalizeWorkspace = normalizeWorkspace;
    this.audit = audit;
    this.now = now;
    this.formSecrets = new Map();
    this.stored = this.#load();
  }

  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.path, "utf8"));
      return {
        autoDispatch: parsed.autoDispatch === true,
        returnResultToChat: parsed.returnResultToChat === true,
        workspace: typeof parsed.workspace === "string" ? parsed.workspace : null,
        executor: typeof parsed.executor === "string" ? parsed.executor : null,
        profile: typeof parsed.profile === "string" ? parsed.profile : null,
      };
    } catch {
      return {
        autoDispatch: false,
        returnResultToChat: false,
        workspace: null,
        executor: null,
        profile: null,
      };
    }
  }

  current() {
    const options = this.getOptions();
    const fallback = defaultSelection(options);
    const storedWorkspace = this.normalizeWorkspace(this.stored.workspace);
    const storedProject = (options.projects ?? []).find(
      (entry) => entry.id === storedWorkspace,
    );
    const selected = {
      workspace: storedProject
        ? storedProject.id
        : (options.workspaces ?? []).includes(storedWorkspace)
          ? storedWorkspace
          : fallback.workspace,
      executor: (options.executors ?? []).some(
        (entry) => entry.ready !== false && entry.id === this.stored.executor,
      )
        ? this.stored.executor
        : fallback.executor,
      profile: (options.profiles ?? []).includes(this.stored.profile)
        ? this.stored.profile
        : fallback.profile,
    };
    return {
      autoDispatch: this.stored.autoDispatch,
      returnResultToChat: this.stored.returnResultToChat,
      workspaceStatus: storedProject?.status ?? "available",
      ...selected,
    };
  }

  issueFormSecret() {
    this.#pruneSecrets();
    const secret = crypto.randomBytes(32).toString("base64url");
    this.formSecrets.set(hashSecret(secret), this.now() + 10 * 60 * 1000);
    return secret;
  }

  save(formSecret, input) {
    this.authorizeFormSecret(formSecret);
    const selection = this.validateSelection({
      workspace: String(input.workspace ?? ""),
      executor: String(input.executor ?? ""),
      profile: String(input.profile ?? ""),
    });
    this.stored = {
      autoDispatch: input.auto_dispatch === "on",
      returnResultToChat: input.return_result_to_chat === "on",
      ...selection,
    };
    const temporary = `${this.path}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.stored, null, 2), "utf8");
    fs.renameSync(temporary, this.path);
    this.audit("local_review.settings_updated", {
      autoDispatch: this.stored.autoDispatch,
      returnResultToChat: this.stored.returnResultToChat,
      workspace: selection.workspace,
      executor: selection.executor,
      profile: selection.profile,
    });
    return this.current();
  }

  authorizeFormSecret(formSecret) {
    this.#pruneSecrets();
    const key = hashSecret(formSecret ?? "");
    const expiresAt = this.formSecrets.get(key);
    this.formSecrets.delete(key);
    if (!expiresAt || expiresAt <= this.now()) {
      throw new ControlPlaneError(
        "local_settings_denied",
        "Settings form is invalid or expired",
      );
    }
  }

  autoDispatchSelection() {
    const current = this.current();
    if (!current.autoDispatch) return null;
    try {
      return this.validateSelection(current);
    } catch {
      return null;
    }
  }

  #pruneSecrets() {
    for (const [key, expiresAt] of this.formSecrets) {
      if (expiresAt <= this.now()) this.formSecrets.delete(key);
    }
  }
}
