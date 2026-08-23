import fs from "node:fs";
import path from "node:path";
import { ControlPlaneError } from "../core/errors.js";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const CODE_PATTERN = /^[A-Z0-9]{6,16}$/;

export function normalizeRelayUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new ControlPlaneError("remote_relay_url_invalid", "Remote relay URL is invalid");
  }
  const local = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new ControlPlaneError(
      "remote_relay_url_denied",
      "Remote relay must use HTTPS; HTTP is allowed only on loopback",
    );
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

export class RemoteRelayCredentials {
  constructor({ stateDir, fetchImpl = fetch }) {
    this.path = path.join(stateDir, "remote-relay.json");
    this.fetch = fetchImpl;
    this.stored = this.#load();
  }

  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.path, "utf8"));
      if (!TOKEN_PATTERN.test(parsed.token) || typeof parsed.client_id !== "string") {
        return null;
      }
      return {
        base_url: normalizeRelayUrl(parsed.base_url),
        client_id: parsed.client_id,
        label: String(parsed.label ?? "This computer").slice(0, 80),
        token: parsed.token,
      };
    } catch {
      return null;
    }
  }

  current() {
    return this.stored
      ? {
          configured: true,
          base_url: this.stored.base_url,
          client_id: this.stored.client_id,
          label: this.stored.label,
        }
      : {
          configured: false,
          base_url: null,
          client_id: null,
          label: null,
        };
  }

  authorization() {
    return this.stored ? `Bearer ${this.stored.token}` : null;
  }

  async pair({ baseUrl, code, label = "This computer" }) {
    const normalizedUrl = normalizeRelayUrl(baseUrl);
    const normalizedCode = String(code ?? "").trim().toUpperCase().replaceAll("-", "");
    if (!CODE_PATTERN.test(normalizedCode)) {
      throw new ControlPlaneError(
        "remote_pairing_code_invalid",
        "Pairing code must contain 6 to 16 letters or digits",
      );
    }
    const response = await this.fetch(`${normalizedUrl}/api/acp/pairings/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: normalizedCode,
        kind: "executor",
        label: String(label ?? "This computer").trim().slice(0, 80),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (
      response.status !== 201 ||
      typeof body.client_id !== "string" ||
      !TOKEN_PATTERN.test(body.token)
    ) {
      throw new ControlPlaneError(
        "remote_pairing_failed",
        body.error?.message ?? body.error ?? `Remote pairing failed with HTTP ${response.status}`,
      );
    }
    this.stored = {
      base_url: normalizedUrl,
      client_id: body.client_id,
      label: String(label ?? "This computer").trim().slice(0, 80) || "This computer",
      token: body.token,
    };
    this.#persist();
    return this.current();
  }

  disconnect() {
    this.stored = null;
    try {
      fs.rmSync(this.path, { force: true });
    } catch {
      // The in-memory credential is cleared even if cleanup is delayed.
    }
    return this.current();
  }

  #persist() {
    const temporary = `${this.path}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.stored, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporary, this.path);
    try {
      fs.chmodSync(this.path, 0o600);
    } catch {
      // Windows ACLs remain the authority when POSIX modes are unavailable.
    }
  }
}
