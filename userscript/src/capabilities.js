export function parseCapabilitiesResponse(response) {
  let body;
  try {
    body = JSON.parse(response?.responseText ?? "");
  } catch {
    throw new Error("invalid_capabilities_response");
  }
  if (
    response?.status !== 200
    || !body.capabilities
    || typeof body.capabilities !== "object"
    || Array.isArray(body.capabilities)
  ) {
    throw new Error(body.error?.code ?? `http_${response?.status ?? 0}`);
  }
  return body.capabilities;
}

export async function readCapabilitiesWithFallback({
  readLocal,
  readRemote = null,
  preferRemote = false,
}) {
  const readers = preferRemote && readRemote
    ? [readRemote, readLocal]
    : [readLocal, readRemote].filter(Boolean);
  let firstError = null;
  for (const reader of readers) {
    try {
      return parseCapabilitiesResponse(await reader());
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError ?? new Error("capabilities_unavailable");
}
