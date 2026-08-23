const ADAPTER_ID = /^[a-z][a-z0-9-]{1,31}$/;

export function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) {
    throw new TypeError("Web adapter must be an object");
  }
  if (!ADAPTER_ID.test(adapter.id)) {
    throw new TypeError("Web adapter id is invalid");
  }
  if (typeof adapter.displayName !== "string" || !adapter.displayName.trim()) {
    throw new TypeError("Web adapter displayName is required");
  }
  if (!Array.isArray(adapter.matches) || adapter.matches.length === 0) {
    throw new TypeError("Web adapter must declare at least one match");
  }
  if (!Array.isArray(adapter.origins) || adapter.origins.length === 0) {
    throw new TypeError("Web adapter must declare at least one origin");
  }
  for (const origin of adapter.origins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.protocol !== "https:") {
      throw new TypeError(`Web adapter origin is not a canonical HTTPS origin: ${origin}`);
    }
  }
  for (const match of adapter.matches) {
    if (!adapter.origins.some((origin) => match === `${origin}/*`)) {
      throw new TypeError(`Web adapter match is not covered by its origins: ${match}`);
    }
  }
  return Object.freeze({
    id: adapter.id,
    displayName: adapter.displayName.trim(),
    matches: Object.freeze([...adapter.matches]),
    origins: Object.freeze([...adapter.origins]),
  });
}

export function createAdapterRegistry(adapters) {
  const normalized = adapters.map(validateAdapter);
  const ids = new Set();
  const origins = new Set();
  for (const adapter of normalized) {
    if (ids.has(adapter.id)) throw new TypeError(`Duplicate web adapter id: ${adapter.id}`);
    ids.add(adapter.id);
    for (const origin of adapter.origins) {
      if (origins.has(origin)) throw new TypeError(`Duplicate web adapter origin: ${origin}`);
      origins.add(origin);
    }
  }
  return Object.freeze({
    adapters: Object.freeze(normalized),
    resolve(locationLike) {
      const origin = String(locationLike?.origin ?? "");
      return normalized.find((adapter) => adapter.origins.includes(origin)) ?? null;
    },
  });
}
