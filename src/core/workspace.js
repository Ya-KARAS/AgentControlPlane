import fs from "node:fs";
import path from "node:path";
import { ControlPlaneError } from "./errors.js";

function canonicalExisting(target) {
  return fs.realpathSync.native(target);
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveWorkspace(inputPath, configuredRoots) {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new ControlPlaneError("invalid_workspace", "workspace is required");
  }

  const requested = path.resolve(inputPath);
  if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) {
    throw new ControlPlaneError(
      "workspace_not_found",
      `Workspace directory does not exist: ${requested}`,
    );
  }

  const actual = canonicalExisting(requested);
  const roots = configuredRoots.flatMap((root) => {
    const resolved = path.resolve(root);
    if (!fs.existsSync(resolved)) {
      return [];
    }
    return [canonicalExisting(resolved)];
  });

  if (!roots.some((root) => isInside(root, actual))) {
    throw new ControlPlaneError(
      "workspace_denied",
      "Workspace is outside the configured allowlist",
      { workspace: actual, roots },
    );
  }
  return actual;
}
