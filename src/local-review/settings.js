import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ControlPlaneError } from "../core/errors.js";
import { normalizeLocalReviewLanguage } from "./i18n.js";

function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function defaultSelection(options) {
  const workspaces = options.workspaces ?? [];
  return {
    workspace: workspaces[0] ?? null,
    executor: "auto",
    profile: "auto",
    model: "auto",
    reasoning_effort: "auto",
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
        language: normalizeLocalReviewLanguage(parsed.language),
        workspace: typeof parsed.workspace === "string" ? parsed.workspace : null,
        executor: typeof parsed.executor === "string" ? parsed.executor : null,
        profile: typeof parsed.profile === "string" ? parsed.profile : null,
        model: typeof parsed.model === "string" ? parsed.model : "auto",
        reasoning_effort:
          typeof parsed.reasoning_effort === "string"
            ? parsed.reasoning_effort
            : "auto",
      };
    } catch {
      return {
        autoDispatch: false,
        returnResultToChat: false,
        language: "zh-CN",
        workspace: null,
        executor: null,
        profile: null,
        model: "auto",
        reasoning_effort: "auto",
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
      executor: this.stored.executor === "auto" || (options.executors ?? []).some(
        (entry) => entry.ready !== false && entry.id === this.stored.executor,
      )
        ? this.stored.executor
        : fallback.executor,
      profile: this.stored.profile === "auto" ||
        (options.profiles ?? []).includes(this.stored.profile)
        ? this.stored.profile
        : fallback.profile,
      model: this.#modelExists(options, this.stored.model)
        ? this.stored.model
        : fallback.model,
      reasoning_effort:
        this.stored.reasoning_effort === "auto" ||
        (options.reasoningEfforts ?? []).includes(this.stored.reasoning_effort)
          ? this.stored.reasoning_effort
          : fallback.reasoning_effort,
    };
    return {
      autoDispatch: this.stored.autoDispatch,
      returnResultToChat: this.stored.returnResultToChat,
      language: normalizeLocalReviewLanguage(this.stored.language),
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
      model: String(input.model ?? "auto"),
      reasoning_effort: String(input.reasoning_effort ?? "auto"),
    });
    this.stored = {
      autoDispatch: input.auto_dispatch === "on",
      returnResultToChat: input.return_result_to_chat === "on",
      language: normalizeLocalReviewLanguage(input.language),
      ...selection,
    };
    this.#persist();
    this.audit("local_review.settings_updated", {
      autoDispatch: this.stored.autoDispatch,
      returnResultToChat: this.stored.returnResultToChat,
      language: this.stored.language,
      workspace: selection.workspace,
      executor: selection.executor,
      profile: selection.profile,
      model: selection.model,
      reasoningEffort: selection.reasoning_effort,
    });
    return this.current();
  }

  setWorkspace(formSecret, workspace) {
    this.authorizeFormSecret(formSecret);
    const current = this.current();
    const selection = this.validateSelection({
      workspace: String(workspace ?? ""),
      executor: current.executor,
      profile: current.profile,
      model: current.model,
      reasoning_effort: current.reasoning_effort,
    });
    this.stored = {
      ...this.stored,
      ...selection,
    };
    this.#persist();
    this.audit("local_review.default_project_updated", {
      workspace: selection.workspace,
    });
    return this.current();
  }

  #persist() {
    const temporary = `${this.path}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.stored, null, 2), "utf8");
    fs.renameSync(temporary, this.path);
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

  #modelExists(options, model) {
    if (model === "auto") return true;
    return Object.values(options.models ?? {}).some((entries) =>
      entries.some((entry) => (entry.id ?? entry.model) === model),
    );
  }

  #pruneSecrets() {
    for (const [key, expiresAt] of this.formSecrets) {
      if (expiresAt <= this.now()) this.formSecrets.delete(key);
    }
  }
}
