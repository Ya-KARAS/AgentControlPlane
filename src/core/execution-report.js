const REPORT_STATUSES = new Set([
  "completed",
  "partial",
  "blocked",
  "failed",
  "success",
  "error",
  "cancelled",
]);

const NON_SUCCESS_STATUSES = new Set([
  "partial",
  "blocked",
  "failed",
  "error",
  // Cancellation is already a terminal task state; preserve it on ingestion
  // without changing the schema requested from executors.
  "cancelled",
]);

const REPORT_FIELDS = [
  "status", "summary", "changed_files", "tests", "blockers", "next_action",
];
const JSON_OBJECT_MARKER = /\{\s*(?:["']|[A-Za-z_$][\w$]*\s*:|}|$)/;
const JSON_ARRAY_MARKER = /\[\s*(?:[\[{"'\]\d-]|true\b|false\b|null\b|$)/;
const JSON_OBJECT_START = new RegExp(`^${JSON_OBJECT_MARKER.source}`);
const JSON_ARRAY_START = new RegExp(`^${JSON_ARRAY_MARKER.source}`);

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

function isRecoverableReport(value) {
  // An incomplete success envelope is not evidence of success. Non-success
  // reports may omit fields, but must still have a recognizable report shape.
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    NON_SUCCESS_STATUSES.has(value.status) &&
    ["summary", "changed_files", "tests", "blockers", "next_action"].some(
      (key) => Object.hasOwn(value, key),
    )
  );
}

export function isJsonLikeExecutionOutput(text) {
  const cleaned = String(text ?? "").trim();
  try {
    JSON.parse(cleaned);
    return true;
  } catch {
    // Also identify malformed/fenced/mixed JSON so transport completion cannot
    // turn a rejected structured result into a successful task report.
    return (
      /```(?:json)?\s*(?:\{|\[)/i.test(cleaned) ||
      JSON_OBJECT_MARKER.test(cleaned) ||
      JSON_ARRAY_MARKER.test(cleaned)
    );
  }
}

function parseContainerAt(text, start) {
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
    } else if (character === "{" || character === "[") {
      depth += 1;
    } else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          return { value: JSON.parse(text.slice(start, index + 1)), end: index + 1 };
        } catch {
          return { value: null, end: index + 1 };
        }
      }
    }
  }
  return { value: null, end: text.length };
}

export function extractExecutionReportObject(text) {
  const cleaned = String(text ?? "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (isStructuredReport(parsed) || isRecoverableReport(parsed)) {
      return parsed;
    }
    // Direct JSON must itself be a report, not an array or unrelated envelope
    // containing an example that happens to look like a successful report.
    return null;
  } catch {
    // Compatible providers may add a short verification note around the JSON.
  }

  let candidateCount = 0;
  let candidate = null;
  const containerStart = /\{|\[/g;
  let start = containerStart.exec(cleaned)?.index ?? -1;
  while (start >= 0 && candidateCount < 256) {
    candidateCount += 1;
    const { value: parsed, end } = parseContainerAt(cleaned, start);
    const malformedContainer = !parsed && (
      JSON_OBJECT_START.test(cleaned.slice(start)) ||
      JSON_ARRAY_START.test(cleaned.slice(start))
    );
    if (isStructuredReport(parsed) || isRecoverableReport(parsed)) {
      candidate = parsed;
    } else if (
      (parsed && REPORT_FIELDS.some((key) => Object.hasOwn(parsed, key))) ||
      malformedContainer
    ) {
      // A rejected final report must not resurrect an earlier success.
      candidate = null;
    }
    // Skip whole JSON containers, including their nested test results/examples.
    // Non-JSON prose braces are not containers and can precede a real report.
    containerStart.lastIndex =
      parsed || malformedContainer || cleaned[start] === "[" ? end : start + 1;
    start = containerStart.exec(cleaned)?.index ?? -1;
  }
  // Do not claim success from a prefix when the scan limit leaves output unread.
  return start >= 0 ? null : candidate;
}

export function normalizeExecutionReportObject(parsed) {
  const status = ["completed", "partial", "blocked", "failed", "cancelled"].includes(
    parsed?.status,
  )
    ? parsed.status
    : parsed?.status === "success"
      ? "completed"
      : "failed";
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
