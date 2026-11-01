import assert from "node:assert/strict";
import test from "node:test";
import { ControlPlaneError } from "../src/core/errors.js";
import { claimControlLease, renewControlLease, releaseControlLease } from "../src/core/controller-lease.js";

const nowMs = Date.parse("2026-11-01T12:00:00Z");
const ttlMs = 120_000;
const lease = Object.freeze({ owner: "dot", generation: 1, expires_at: "2026-11-01T12:02:00.000Z" });
const fails = (fn, code) => assert.throws(fn, (error) => error instanceof ControlPlaneError && error.code === code);

test("first claim sets a bounded server-clock lease without mutating input", () => {
  assert.deepEqual(claimControlLease({ lease: null, ownerId: "dot", nowMs, ttlMs }), lease);
  const repeated = claimControlLease({ lease, ownerId: "dot", nowMs: nowMs + 1000, ttlMs });
  assert.deepEqual(repeated, lease); // A retry must not extend expiry.
  assert.notEqual(repeated, lease);
});

test("busy claims reject; exact-expiry takeover increments fencing generation", () => {
  fails(() => claimControlLease({ lease, ownerId: "muse", nowMs, ttlMs }), "control_lease_busy");
  assert.deepEqual(claimControlLease({ lease, ownerId: "muse", nowMs: nowMs + ttlMs, ttlMs }), {
    owner: "muse", generation: 2, expires_at: "2026-11-01T12:04:00.000Z",
  });
});

test("renew requires current owner and generation and a live lease", () => {
  assert.deepEqual(renewControlLease({ lease, ownerId: "dot", generation: 1, nowMs: nowMs + 1000, ttlMs }), {
    owner: "dot", generation: 1, expires_at: "2026-11-01T12:02:01.000Z",
  });
  for (const input of [{ ownerId: "muse", generation: 1 }, { ownerId: "dot", generation: 2 }, { ownerId: "dot" }]) {
    fails(() => renewControlLease({ lease, nowMs, ttlMs, ...input }), "control_lease_mismatch");
  }
  fails(() => renewControlLease({ lease, ownerId: "dot", generation: 1, nowMs: nowMs + ttlMs, ttlMs }), "control_lease_expired");
});

test("release retains fencing tombstone; reclaim cannot revive an old generation (ABA)", () => {
  const released = releaseControlLease({ lease, ownerId: "dot", generation: 1, nowMs: nowMs + 1 });
  assert.deepEqual(released, { owner: null, generation: 1, expires_at: "2026-11-01T12:00:00.001Z" });
  const reclaimed = claimControlLease({ lease: released, ownerId: "dot", nowMs: nowMs + 2, ttlMs });
  assert.equal(reclaimed.generation, 2);
  for (const transition of [renewControlLease, releaseControlLease]) {
    fails(() => transition({ lease: reclaimed, ownerId: "dot", generation: 1, nowMs: nowMs + 3, ttlMs }), "control_lease_mismatch");
    fails(() => transition({ lease: released, ownerId: "dot", generation: 1, nowMs: nowMs + 3, ttlMs }), "control_lease_mismatch");
  }
});

test("old owners cannot renew or release after takeover even if they use new generation", () => {
  const taken = claimControlLease({ lease, ownerId: "muse", nowMs: nowMs + ttlMs, ttlMs });
  for (const transition of [renewControlLease, releaseControlLease]) {
    for (const generation of [1, 2]) {
      fails(() => transition({ lease: taken, ownerId: "dot", generation, nowMs: nowMs + ttlMs + 1, ttlMs }), "control_lease_mismatch");
    }
  }
  assert.equal(taken.owner, "muse");
});

for (const input of [
  ...[NaN, Infinity, -1, 1.2, "1000", 8.64e15].map((nowMs) => ({ nowMs })),
  ...[0, 29_999, 600_001, 30_000.5, "120000", Infinity].map((ttlMs) => ({ ttlMs })),
  ...["", null, "a b", "x".repeat(65)].map((ownerId) => ({ ownerId })),
  ...[{ owner: "dot", generation: 0, expires_at: lease.expires_at },
    { ...lease, generation: 1.5 }, { ...lease, expires_at: "invalid" },
    { ...lease, owner: "a b" }].map((lease) => ({ lease })),
]) {
  test(`rejects invalid lease transition input ${JSON.stringify(input)}`, () => {
    fails(() => claimControlLease({ lease, ownerId: "dot", nowMs, ttlMs, ...input }), "invalid_control_lease");
  });
}

test("fencing counter overflow fails closed", () => {
  fails(() => claimControlLease({ lease: { ...lease, generation: Number.MAX_SAFE_INTEGER }, ownerId: "muse", nowMs: nowMs + ttlMs, ttlMs }), "invalid_control_lease");
});

test("accepted server clocks round-trip when expiry crosses into an extended ISO year", () => {
  const boundary = Date.parse("9999-12-31T23:59:50.000Z");
  const claimed = claimControlLease({ lease: null, ownerId: "dot", nowMs: boundary, ttlMs: 30_000 });
  assert.deepEqual(claimed, { owner: "dot", generation: 1, expires_at: "+010000-01-01T00:00:20.000Z" });
  const renewed = renewControlLease({ lease: claimed, ownerId: "dot", generation: 1, nowMs: boundary + 1, ttlMs: 30_000 });
  assert.equal(renewed.expires_at, "+010000-01-01T00:00:20.001Z");
  const released = releaseControlLease({ lease: renewed, ownerId: "dot", generation: 1, nowMs: boundary + 2 });
  assert.equal(claimControlLease({ lease: released, ownerId: "muse", nowMs: boundary + 3, ttlMs: 30_000 }).generation, 2);
});
