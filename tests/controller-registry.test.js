import assert from "node:assert/strict";
import test from "node:test";
import { normalizeControllerIdentity } from "../src/controllers/controller.js";
import { normalizeAgentRegistry, resolveControllerActor, isTrustedControllerActor } from "../src/controllers/registry.js";

const agents = [{ id: "dot", kind: "mcp", display_name: "Dot", principal_id: "verified-dot", token: "must-not-leak" }];

test("registry freezes bounded public descriptors and hides principal and secret extras", () => {
  const registry = normalizeAgentRegistry(agents);
  assert.deepEqual(registry, [{ id: "dot", kind: "mcp", display_name: "Dot" }]);
  assert.ok(Object.isFrozen(registry) && Object.isFrozen(registry[0]));
  assert.equal(JSON.stringify(registry).includes("verified-dot"), false);
  assert.equal(JSON.stringify(registry).includes("must-not-leak"), false);
  assert.throws(() => { registry[0].id = "muse"; }, TypeError);
});

test("verified principal and transport kind resolve only configured actors", () => {
  const registry = normalizeAgentRegistry(agents);
  const actor = resolveControllerActor({ principalId: "verified-dot", kind: "mcp", registry });
  assert.deepEqual(actor, { id: "dot", kind: "mcp", display_name: "Dot", trusted: true });
  assert.equal(isTrustedControllerActor(actor), true);
  assert.equal(isTrustedControllerActor({ ...actor }), false);
  assert.equal(resolveControllerActor({ principalId: "verified-dot", kind: "browser", registry }).trusted, false);
});

test("anonymous and forged request metadata never resolve registered identities", () => {
  const registry = normalizeAgentRegistry(agents);
  for (const input of [{}, { principalId: "dot" }, { controller_id: "dot", caller_id: "verified-dot" }, { principalId: "unknown" }]) {
    const actor = resolveControllerActor({ ...input, registry });
    assert.equal(actor.trusted, false);
    assert.equal(actor.id, null);
    assert.equal(isTrustedControllerActor(actor), false);
  }
  // Copying public data cannot recreate its private principal bindings.
  assert.equal(resolveControllerActor({ principalId: "verified-dot", registry: [...registry] }).trusted, false);
});

test("explicit server-bound local operator remains distinct from personal agents", () => {
  const actor = resolveControllerActor({ principalId: "local-operator", kind: "api", registry: normalizeAgentRegistry() });
  assert.equal(actor.id, "local-operator");
  assert.equal(isTrustedControllerActor(actor), true);
});

for (const input of [null, {}, [{ id: "" }], [{ id: "a b" }], [{ id: "x".repeat(65) }],
  [{ id: "dot", kind: "shell" }], [{ id: "dot", display_name: "a\nb" }],
  [{ id: "dot", principal_id: "" }], [{ id: "dot", principal_id: "a\nb" }],
  [{ id: "dot" }, { id: "dot" }], [{ id: "dot", principal_id: "p" }, { id: "muse", principal_id: "p" }],
  [{ id: "local-operator" }], [{ id: "dot", principal_id: "local-operator" }],
]) {
  test(`rejects malformed or ambiguous registry: ${JSON.stringify(input)}`, () => {
    assert.throws(() => normalizeAgentRegistry(input), (error) => error.code === "invalid_config");
  });
}

test("legacy identity normalization is unchanged", () => {
  assert.deepEqual(normalizeControllerIdentity(), { id: "unknown", kind: "mcp", model: null });
  assert.deepEqual(normalizeControllerIdentity({ id: 5, model: "m", kind: "browser" }), { id: "5", kind: "browser", model: "m" });
});
