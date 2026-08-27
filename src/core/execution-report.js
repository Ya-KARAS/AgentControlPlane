const REPORT_STATUSES = new Set([
  "completed",
  "partial",
  "blocked",
  "failed",
  "success",
  "error",
]);

export const EXECUTION_REPORT_INSTRUCTION =
  "The report must be a JSON object with keys: status, summary, changed_files, tests, blockers, next_action.";

function isStructuredReport(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    REPORT_STATUSES.has(value.status) &&
    typeof value.summary === "string" &&
    Array.isArray(value.changed_files) &&
    Array.isArray(value.tests) &&
    Array.isArray(value.blockers) &&
    Object.hasOwn(value, "next_action") &&
    (value.next_action === null || typeof value.next_action === "string")
  );
}

function parseObjectAt(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function extractExecutionReportObject(text) {
  const cleaned = String(text ?? "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Compatible providers may add a short verification note around the JSON.
  }

  let candidateCount = 0;
  for (
    let start = cleaned.lastIndexOf("{");
    start >= 0 && candidateCount < 256;
    start = cleaned.lastIndexOf("{", start - 1)
  ) {
    candidateCount += 1;
    const parsed = parseObjectAt(cleaned, start);
    if (isStructuredReport(parsed)) return parsed;
  }
  return null;
}

export function normalizeExecutionReportObject(parsed) {
  const status = ["completed", "partial", "blocked", "failed"].includes(
    parsed?.status,
  )
    ? parsed.status
    : parsed?.status === "error"
      ? "failed"
      : "completed";
  const tests = Array.isArray(parsed?.tests)
    ? parsed.tests.map((entry) => ({
        command: String(entry?.command ?? ""),
        status: ["passed", "failed", "not_run"].includes(entry?.status)
          ? entry.status
          : "not_run",
        detail: entry?.detail == null ? null : String(entry.detail),
      }))
    : [];
  return {
    status,
    summary: String(parsed?.summary ?? ""),
    changed_files: Array.isArray(parsed?.changed_files)
      ? parsed.changed_files.map((item) => String(item))
      : [],
    tests,
    blockers: Array.isArray(parsed?.blockers)
      ? parsed.blockers.map((item) => String(item))
      : [],
    next_action:
      parsed?.next_action == null ? null : String(parsed.next_action),
  };
}

export function normalizeExecutionReportText(text) {
  const cleaned = String(text ?? "").trim();
  const parsed = extractExecutionReportObject(cleaned);
  if (!parsed) return cleaned || "{}";
  return JSON.stringify(normalizeExecutionReportObject(parsed));
}
