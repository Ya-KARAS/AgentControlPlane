import { ControlPlaneError } from "./errors.js";

const invalid = () => new ControlPlaneError("invalid_control_lease", "Invalid controller lease or server clock parameters");
const validOwner = (owner) => typeof owner === "string" && owner.length <= 64 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(owner);

function expiry(lease) {
  if (!lease || !Number.isSafeInteger(lease.generation) || lease.generation < 1 ||
      !(lease.owner === null || validOwner(lease.owner)) ||
      typeof lease.expires_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(lease.expires_at)) throw invalid();
  const ms = Date.parse(lease.expires_at);
  const canonical = lease.expires_at.includes(".") ? lease.expires_at : lease.expires_at.replace("Z", ".000Z");
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== canonical) throw invalid();
  return ms;
}

function validate({ lease, ownerId, nowMs, ttlMs }, needsTtl = true) {
  if (!validOwner(ownerId) || !Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs >= 8.64e15) throw invalid();
  if (needsTtl && (!Number.isInteger(ttlMs) || ttlMs < 30_000 || ttlMs > 600_000 || nowMs + ttlMs >= 8.64e15)) throw invalid();
  return lease == null ? null : expiry(lease);
}

function assertOwner(lease, ownerId, generation, nowMs, expiresAt) {
  if (!lease || lease.owner !== ownerId || lease.generation !== generation) {
    throw new ControlPlaneError("control_lease_mismatch", "Controller owner or fencing generation does not match");
  }
  if (expiresAt <= nowMs) throw new ControlPlaneError("control_lease_expired", "Controller lease has expired");
}

// Pure transitions only. Caller supplies the server clock, never client time.
export function claimControlLease({ lease, ownerId, nowMs, ttlMs }) {
  const expiresAt = validate({ lease, ownerId, nowMs, ttlMs });
  if (lease?.owner != null && expiresAt > nowMs) {
    if (lease.owner !== ownerId) throw new ControlPlaneError("control_lease_busy", "Another controller owns the task");
    return { ...lease }; // Idempotent retry is not renewal.
  }
  const generation = (lease?.generation ?? 0) + 1;
  if (!Number.isSafeInteger(generation)) throw invalid();
  return { owner: ownerId, generation, expires_at: new Date(nowMs + ttlMs).toISOString() };
}

export function renewControlLease({ lease, ownerId, generation, nowMs, ttlMs }) {
  const expiresAt = validate({ lease, ownerId, nowMs, ttlMs });
  assertOwner(lease, ownerId, generation, nowMs, expiresAt);
  return { owner: ownerId, generation, expires_at: new Date(nowMs + ttlMs).toISOString() };
}

export function releaseControlLease({ lease, ownerId, generation, nowMs }) {
  const expiresAt = validate({ lease, ownerId, nowMs }, false);
  assertOwner(lease, ownerId, generation, nowMs, expiresAt);
  // Keep the fencing high-water mark through release and restart (no ABA).
  return { owner: null, generation, expires_at: new Date(nowMs).toISOString() };
}
