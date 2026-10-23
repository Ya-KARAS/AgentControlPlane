import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const denied = () => new Error("DSH readonly ASCII compatibility contract rejected");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

// This changes no execution/confinement method. The native sandbox subclass
// still owns policy resolution, confinement, subprocess, cancellation and output.
export function createReadonlyAsciiPwshExecutor(NativeSandbox, contract, encodingPreamble) {
  if (typeof NativeSandbox !== "function" || typeof NativeSandbox.prototype.confine !== "function" ||
      !/^7\.\d+\.\d+(?:[.-][A-Za-z0-9.-]+)?$/.test(contract?.pwshVersion) ||
      !path.isAbsolute(contract?.pwshPath ?? "") || !/^[a-f0-9]{64}$/.test(contract?.pwshSha256) ||
      !/^Write-Output 'ACP_[A-Z0-9_]{1,100}'$/.test(contract?.command) ||
      typeof encodingPreamble !== "string" || encodingPreamble.length < 1 || encodingPreamble.length > 1024) throw denied();
  const pinned = Object.freeze({ ...contract });
  return class ReadonlyAsciiPwsh extends NativeSandbox {
    argv(spec) {
      if (spec?.sandboxPolicy?.mode !== "read-only" || spec.command !== pinned.command ||
          spec.onExpiry !== "kill" || !same(this.pwshPath, pinned.pwshPath)) throw denied();
      const stat = fs.lstatSync(pinned.pwshPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16777216 ||
          digest(fs.readFileSync(pinned.pwshPath)) !== pinned.pwshSha256) throw denied();
      const argv = super.argv(spec);
      if (!Array.isArray(argv) || argv.length !== 6 || !same(argv[0], pinned.pwshPath) ||
          argv.slice(1, 5).join(",") !== "-NoLogo,-NoProfile,-NonInteractive,-Command" ||
          argv[5] !== encodingPreamble + pinned.command) throw denied();
      return [...argv.slice(0, 5), pinned.command];
    }
  };
}

// Profile-local Cordis plugin. The ACP profile verifier binds this module's
// bytes, exact config, CLI root, shell hash/version and installed archive.
export async function apply(ctx, config) {
  const require = createRequire(config.cliEntry);
  const [{ SandboxPwshExecutor }, { ENCODING_PREAMBLE }] = await Promise.all([
    import(pathToFileURL(require.resolve("@deepseek-ai/dsh-pwsh-sandbox")).href),
    import(pathToFileURL(require.resolve("@deepseek-ai/dsh-pwsh-local")).href),
  ]);
  const Compat = createReadonlyAsciiPwshExecutor(SandboxPwshExecutor, config, ENCODING_PREAMBLE);
  ctx.plugin(Compat, { pwshPath: config.pwshPath });
}
