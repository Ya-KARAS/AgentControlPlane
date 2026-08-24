import fs from "node:fs";
import path from "node:path";
import { ControlPlaneError } from "../core/errors.js";

const REFRESH_TOKEN_PATTERN = /^(?:acpr_)?[A-Za-z0-9_-]{32,256}$/;
const ACCESS_TOKEN_PATTERN = /^(?:acpa_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9_-]{32,256})$/;
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
      const refreshToken = parsed.refresh_token ?? parsed.token;
      if (!REFRESH_TOKEN_PATTERN.test(refreshToken) || typeof parsed.client_id !== "string") {
        return null;
      }
      const accessToken = ACCESS_TOKEN_PATTERN.test(parsed.access_token ?? "")
        ? parsed.access_token
        : null;
      return {
        base_url: normalizeRelayUrl(parsed.base_url),
        client_id: parsed.client_id,
        label: String(parsed.label ?? "This computer").slice(0, 80),
        refresh_token: refreshToken,
        access_token: accessToken,
        access_token_expires_at: typeof parsed.access_token_expires_at === "string"
          ? parsed.access_token_expires_at
          : null,
        credential_version: Number(parsed.credential_version ?? (parsed.refresh_token ? 2 : 1)),
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

  async authorization() {
    if (!this.stored) return null;
    const expiresAt = Date.parse(this.stored.access_token_expires_at ?? "");
    if (
      this.stored.access_token &&
      (this.stored.credential_version === 1 || (Number.isFinite(expiresAt) && expiresAt - Date.now() > 60_000))
    ) {
      return `Bearer ${this.stored.access_token}`;
    }
    return this.#refreshAuthorization();
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
      headers: { "content-type": "application/json", "x-acp-credential-version": "2" },
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
      !REFRESH_TOKEN_PATTERN.test(body.refresh_token ?? body.token)
    ) {
      throw new ControlPlaneError(
        "remote_pairing_failed",
        body.error?.message ?? body.error ?? `Remote pairing failed with HTTP ${response.status}`,
      );
    }
    const refreshToken = body.refresh_token ?? body.token;
    const accessToken = ACCESS_TOKEN_PATTERN.test(body.access_token ?? "") ? body.access_token : refreshToken;
    this.stored = {
      base_url: normalizedUrl,
      client_id: body.client_id,
      label: String(label ?? "This computer").trim().slice(0, 80) || "This computer",
      refresh_token: refreshToken,
      access_token: accessToken,
      access_token_expires_at: typeof body.access_token_expires_at === "string"
        ? body.access_token_expires_at
        : null,
      credential_version: typeof body.access_token === "string" ? 2 : 1,
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

  async #refreshAuthorization() {
    const response = await this.fetch(`${this.stored.base_url}/api/acp/tokens/refresh`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.stored.refresh_token}` },
    });
    const body = await response.json().catch(() => ({}));
    if (
      response.status === 200 &&
      ACCESS_TOKEN_PATTERN.test(body.access_token ?? "") &&
      typeof body.access_token_expires_at === "string"
    ) {
      if (body.refresh_token !== undefined) {
        if (!REFRESH_TOKEN_PATTERN.test(body.refresh_token)) {
          throw new ControlPlaneError("remote_refresh_invalid", "Remote relay returned an invalid refresh credential");
        }
        this.stored.refresh_token = body.refresh_token;
      }
      this.stored.access_token = body.access_token;
      this.stored.access_token_expires_at = body.access_token_expires_at;
      this.stored.credential_version = 2;
      this.#persist();
      return `Bearer ${this.stored.access_token}`;
    }
    if (this.stored.credential_version === 1) {
      this.stored.access_token = this.stored.refresh_token;
      return `Bearer ${this.stored.refresh_token}`;
    }
    throw new ControlPlaneError(
      "remote_refresh_failed",
      body.error?.message ?? body.error ?? `Remote credential refresh failed with HTTP ${response.status}`,
    );
  }
}
