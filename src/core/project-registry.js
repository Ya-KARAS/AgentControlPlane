import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ControlPlaneError } from "./errors.js";

const PROJECT_MARKERS = new Set([
  ".git",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
]);

function now() {
  return new Date().toISOString();
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function canonicalDirectory(target, code = "project_path_not_found") {
  const resolved = path.resolve(String(target ?? ""));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new ControlPlaneError(code, `Project directory does not exist: ${resolved}`);
  }
  return fs.realpathSync.native(resolved);
}

function normalizeCategory(value) {
  const category = String(value ?? "未分类").trim() || "未分类";
  if (category.length > 64 || /[\r\n]/.test(category)) {
    throw new ControlPlaneError(
      "invalid_project_category",
      "Project category must contain at most 64 characters",
    );
  }
  return category;
}

function projectMarkerNames(projectPath) {
  return [...PROJECT_MARKERS]
    .filter((name) => fs.existsSync(path.join(projectPath, name)))
    .sort();
}

function gitRemote(projectPath) {
  const dotGit = path.join(projectPath, ".git");
  let configPath = path.join(dotGit, "config");
  try {
    if (fs.existsSync(dotGit) && fs.statSync(dotGit).isFile()) {
      const pointer = fs.readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/im)?.[1];
      if (pointer) configPath = path.resolve(projectPath, pointer.trim(), "config");
    }
    if (!fs.existsSync(configPath)) return null;
    const config = fs.readFileSync(configPath, "utf8");
    return config.match(/^\s*url\s*=\s*(.+)$/im)?.[1]?.trim().toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function fingerprint(projectPath) {
  const markers = projectMarkerNames(projectPath);
  if (markers.length === 0) return null;
  const remote = gitRemote(projectPath);
  const identity = remote
    ? `git:${remote}`
    : `local:${path.basename(projectPath).toLowerCase()}:${markers.join(",")}`;
  return crypto.createHash("sha256").update(identity).digest("hex");
}

function emptyState() {
  return { version: 1, discovery_roots: [], projects: {} };
}

export class ProjectRegistry {
  constructor({
    stateDir,
    workspaceRoots = [],
    discoveryRoots = [],
    maxDepth = 2,
    maxProjects = 1000,
    maxEntriesPerDirectory = 2000,
    maxScannedDirectories = 1000,
    maxScanMs = 1500,
    maxRegistryProjects = 5000,
    maxStateBytes = 8 * 1024 * 1024,
    audit = () => {},
    hasActiveTasks = () => false,
  }) {
    fs.mkdirSync(stateDir, { recursive: true });
    this.stateDir = canonicalDirectory(stateDir, "project_state_directory_not_found");
    this.path = path.join(stateDir, "project-registry.json");
    this.workspaceRoots = workspaceRoots
      .filter((root) => fs.existsSync(path.resolve(root)))
      .map((root) => canonicalDirectory(root));
    this.maxDepth = Math.max(1, Math.min(4, Number(maxDepth) || 2));
    this.maxProjects = Math.max(1, Math.min(5000, Number(maxProjects) || 1000));
    this.maxEntriesPerDirectory = Math.max(
      1,
      Math.min(10000, Number(maxEntriesPerDirectory) || 2000),
    );
    this.maxScannedDirectories = Math.max(
      1,
      Math.min(10000, Number(maxScannedDirectories) || 1000),
    );
    this.maxScanMs = Math.max(100, Math.min(10000, Number(maxScanMs) || 1500));
    this.maxRegistryProjects = Math.max(
      1,
      Math.min(20000, Number(maxRegistryProjects) || 5000),
    );
    this.maxStateBytes = Math.max(
      1024,
      Math.min(32 * 1024 * 1024, Number(maxStateBytes) || 8 * 1024 * 1024),
    );
    this.audit = audit;
    this.hasActiveTasks = hasActiveTasks;
    this.state = this.#load();
    for (const root of discoveryRoots) {
      const resolved = path.resolve(root);
      if (fs.existsSync(resolved)) {
        this.#addDiscoveryRoot(resolved, false);
      } else if (
        !this.state.discovery_roots.some(
          (entry) => entry.toLowerCase() === resolved.toLowerCase(),
        )
      ) {
        this.state.discovery_roots.push(resolved);
        this.#persist();
      }
    }
    for (const workspace of this.workspaceRoots) {
      this.#register(workspace, { source: "legacy-workspace-root" });
    }
    this.refresh();
  }

  #load() {
    if (!fs.existsSync(this.path)) return emptyState();
    try {
      if (fs.statSync(this.path).size > this.maxStateBytes) {
        throw new ControlPlaneError(
          "project_registry_state_too_large",
          "Project registry state exceeds the configured size limit",
        );
      }
      const parsed = JSON.parse(fs.readFileSync(this.path, "utf8"));
      return {
        version: 1,
        discovery_roots: Array.isArray(parsed.discovery_roots)
          ? parsed.discovery_roots.filter((entry) => typeof entry === "string")
          : [],
        projects:
          parsed.projects && typeof parsed.projects === "object"
            ? parsed.projects
            : {},
      };
    } catch (error) {
      if (error instanceof ControlPlaneError) throw error;
      throw new ControlPlaneError(
        "project_registry_state_invalid",
        "Project registry state is invalid and requires local repair",
      );
    }
  }

  #persist() {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(temporary, this.path);
  }

  #addDiscoveryRoot(inputPath, emitAudit) {
    const root = canonicalDirectory(inputPath, "project_discovery_root_not_found");
    if (path.parse(root).root.toLowerCase() === root.toLowerCase()) {
      throw new ControlPlaneError(
        "project_discovery_root_denied",
        "A filesystem volume root cannot be used as a project discovery root",
      );
    }
    if (isInside(root, this.stateDir) || isInside(this.stateDir, root)) {
      throw new ControlPlaneError(
        "project_discovery_root_denied",
        "The project discovery root must be separate from ACP state",
      );
    }
    if (!this.state.discovery_roots.some((entry) => entry.toLowerCase() === root.toLowerCase())) {
      this.state.discovery_roots.push(root);
      this.state.discovery_roots.sort((left, right) => left.localeCompare(right));
      this.#persist();
      if (emitAudit) this.audit("project.discovery_root_added", { root });
    }
    return root;
  }

  addDiscoveryRoot(inputPath) {
    const root = this.#addDiscoveryRoot(inputPath, true);
    this.refresh();
    return root;
  }

  discoveryRoots() {
    return [...this.state.discovery_roots];
  }

  #registeredByPath(projectPath) {
    return Object.values(this.state.projects).find(
      (entry) => entry.current_path?.toLowerCase() === projectPath.toLowerCase(),
    );
  }

  #register(projectPath, { source = "scan", category = "未分类" } = {}) {
    const existing = this.#registeredByPath(projectPath);
    if (existing) return existing;
    if (Object.keys(this.state.projects).length >= this.maxRegistryProjects) {
      throw new ControlPlaneError(
        "project_registry_limit_reached",
        "Project registry reached its configured record limit",
      );
    }
    const id = crypto.randomUUID();
    const createdAt = now();
    const entry = {
      id,
      display_name: path.basename(projectPath),
      category: normalizeCategory(category),
      current_path: projectPath,
      path_revision: 1,
      fingerprint: fingerprint(projectPath),
      status: "available",
      relink_candidates: [],
      source,
      created_at: createdAt,
      updated_at: createdAt,
    };
    this.state.projects[id] = entry;
    this.#persist();
    this.audit("project.registered", {
      projectId: id,
      displayName: entry.display_name,
      source,
    });
    return entry;
  }

  #scanDirectory(directory, depth, found, budget) {
    if (
      depth > this.maxDepth ||
      found.size >= this.maxProjects ||
      budget.directories >= this.maxScannedDirectories ||
      Date.now() >= budget.deadline
    ) {
      budget.truncated = true;
      return;
    }
    budget.directories += 1;
    let children;
    try {
      children = fs
        .readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, this.maxEntriesPerDirectory);
    } catch {
      return;
    }
    for (const child of children) {
      if (
        found.size >= this.maxProjects ||
        budget.directories >= this.maxScannedDirectories ||
        Date.now() >= budget.deadline ||
        budget.truncated
      ) {
        budget.truncated = true;
        break;
      }
      if (!child.isDirectory() || child.name.startsWith(".")) continue;
      const candidate = path.join(directory, child.name);
      let actual;
      try {
        actual = canonicalDirectory(candidate);
      } catch {
        continue;
      }
      if (!isInside(directory, actual)) continue;
      if (projectMarkerNames(actual).length > 0) {
        found.add(actual);
      } else {
        this.#scanDirectory(actual, depth + 1, found, budget);
      }
    }
  }

  refresh() {
    const found = new Set(this.workspaceRoots);
    const budget = {
      directories: 0,
      deadline: Date.now() + this.maxScanMs,
      truncated: false,
    };
    for (const root of this.state.discovery_roots) {
      if (!fs.existsSync(root)) continue;
      this.#scanDirectory(root, 1, found, budget);
      if (budget.truncated) break;
    }

    let changed = false;
    for (const project of Object.values(this.state.projects)) {
      let actual = null;
      try {
        actual = canonicalDirectory(project.current_path);
      } catch {
        // A missing or unreadable path remains unavailable until local relinking.
      }
      const currentFingerprint = actual ? fingerprint(actual) : null;
      const sameCanonicalPath =
        actual?.toLowerCase() === project.current_path?.toLowerCase();
      const sameFingerprint =
        !project.fingerprint || project.fingerprint === currentFingerprint;
      const available = Boolean(
        actual && currentFingerprint && sameCanonicalPath && sameFingerprint,
      );
      const nextStatus = available
        ? "available"
        : actual && currentFingerprint
          ? "relink_required"
          : "missing";
      const nextCandidates =
        nextStatus === "relink_required" && actual ? [actual] : [];
      if (
        project.status !== nextStatus ||
        JSON.stringify(project.relink_candidates ?? []) !==
          JSON.stringify(nextCandidates)
      ) {
        project.status = nextStatus;
        project.relink_candidates = nextCandidates;
        project.updated_at = now();
        changed = true;
      }
    }

    for (const candidatePath of found) {
      if (this.#registeredByPath(candidatePath)) continue;
      if (Object.keys(this.state.projects).length >= this.maxRegistryProjects) {
        budget.truncated = true;
        break;
      }
      const candidateFingerprint = fingerprint(candidatePath);
      const matches = Object.values(this.state.projects).filter(
        (entry) =>
          entry.status === "missing" &&
          candidateFingerprint &&
          entry.fingerprint === candidateFingerprint,
      );
      if (matches.length > 0) {
        for (const match of matches) {
          match.status = "relink_required";
          match.relink_candidates = [
            ...new Set([...(match.relink_candidates ?? []), candidatePath]),
          ];
          match.updated_at = now();
          changed = true;
        }
      } else {
        this.#register(candidatePath, { source: "scan" });
      }
    }
    if (budget.truncated) {
      this.audit("project.scan_truncated", {
        directories: budget.directories,
        projects: found.size,
      });
    }
    if (changed) this.#persist();
    return this.list();
  }

  list() {
    return Object.values(this.state.projects)
      .map((entry) => structuredClone(entry))
      .sort((left, right) =>
        `${left.category}/${left.display_name}`.localeCompare(
          `${right.category}/${right.display_name}`,
        ),
      );
  }

  publicProjects() {
    return this.list().map((entry) => ({
      id: `project:${entry.id}`,
      name: entry.display_name,
      category: entry.category,
      alias: `${entry.category}/${entry.display_name}`,
      status: entry.status,
      path_revision: entry.path_revision,
      relink_candidate_count: entry.relink_candidates?.length ?? 0,
    }));
  }

  #entry(reference) {
    const value = String(reference ?? "").trim();
    const id = value.startsWith("project:") ? value.slice("project:".length) : value;
    if (this.state.projects[id]) return this.state.projects[id];
    const normalized = value.toLowerCase();
    const matches = Object.values(this.state.projects).filter((entry) =>
      [entry.display_name, `${entry.category}/${entry.display_name}`]
        .map((candidate) => candidate.toLowerCase())
        .includes(normalized),
    );
    return matches.length === 1 ? matches[0] : null;
  }

  resolve(reference) {
    let entry = this.#entry(reference);
    if (!entry && typeof reference === "string") {
      const projectReference = this.referenceForPath(reference);
      if (projectReference) entry = this.#entry(projectReference);
    }
    if (!entry) return null;
    if (entry.status !== "available") {
      throw new ControlPlaneError(
        "project_relink_required",
        "The selected project moved or is unavailable and must be relinked locally",
        { project_id: `project:${entry.id}`, status: entry.status },
      );
    }
    const workspace = canonicalDirectory(entry.current_path);
    const currentFingerprint = fingerprint(workspace);
    if (
      workspace.toLowerCase() !== entry.current_path.toLowerCase() ||
      !currentFingerprint ||
      (entry.fingerprint && currentFingerprint !== entry.fingerprint)
    ) {
      throw new ControlPlaneError(
        "project_relink_required",
        "The selected project identity changed and must be relinked locally",
        { project_id: `project:${entry.id}` },
      );
    }
    const trustedRoots = [...this.workspaceRoots, ...this.state.discovery_roots];
    if (!trustedRoots.some((root) => isInside(root, workspace))) {
      throw new ControlPlaneError(
        "project_workspace_denied",
        "The project path is outside every trusted local root",
      );
    }
    return {
      projectId: `project:${entry.id}`,
      workspace,
      pathRevision: entry.path_revision,
    };
  }

  referenceForPath(inputPath) {
    if (typeof inputPath !== "string" || !inputPath) return null;
    const stored = Object.values(this.state.projects).find(
      (entry) => entry.current_path?.toLowerCase() === inputPath.toLowerCase(),
    );
    if (stored) return `project:${stored.id}`;
    let actual;
    try {
      actual = canonicalDirectory(inputPath);
    } catch {
      return null;
    }
    const entry = this.#registeredByPath(actual);
    return entry ? `project:${entry.id}` : null;
  }

  updateCategory(reference, category) {
    const entry = this.#entry(reference);
    if (!entry) throw new ControlPlaneError("project_not_found", "Project not found");
    entry.category = normalizeCategory(category);
    entry.updated_at = now();
    this.#persist();
    this.audit("project.category_updated", {
      projectId: entry.id,
      category: entry.category,
    });
    return structuredClone(entry);
  }

  relink(reference, newPath) {
    const entry = this.#entry(reference);
    if (!entry) throw new ControlPlaneError("project_not_found", "Project not found");
    if (this.hasActiveTasks(`project:${entry.id}`)) {
      throw new ControlPlaneError(
        "project_relink_conflict",
        "A queued or running task still uses this project",
      );
    }
    const actual = canonicalDirectory(newPath);
    if (!this.state.discovery_roots.some((root) => isInside(root, actual))) {
      throw new ControlPlaneError(
        "project_relink_denied",
        "The new project path must be inside a trusted discovery root",
      );
    }
    if (projectMarkerNames(actual).length === 0) {
      throw new ControlPlaneError(
        "project_relink_denied",
        "The new path does not look like a supported software project",
      );
    }
    const collision = this.#registeredByPath(actual);
    if (collision && collision.id !== entry.id) {
      throw new ControlPlaneError(
        "project_path_conflict",
        "The new path is already registered to another project",
      );
    }
    const previousPath = entry.current_path;
    entry.current_path = actual;
    entry.display_name = path.basename(actual);
    entry.path_revision = Number(entry.path_revision ?? 1) + 1;
    entry.fingerprint = fingerprint(actual);
    entry.status = "available";
    entry.relink_candidates = [];
    entry.updated_at = now();
    this.#persist();
    this.audit("project.relinked", {
      projectId: entry.id,
      previousPath,
      currentPath: actual,
      pathRevision: entry.path_revision,
    });
    return structuredClone(entry);
  }
}
