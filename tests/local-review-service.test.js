import assert from "node:assert/strict";
import test from "node:test";
import { publicTaskStatus } from "../src/local-review/service.js";

test("public task status excludes raw task content, paths, logs, and errors", () => {
  const projected = publicTaskStatus({
    id: "task-1",
    status: "completed",
    workspace: "C:\\secret\\workspace",
    brief: { objective: "private objective" },
    executor: "opencode",
    updatedAt: "2026-08-23T12:00:00.000Z",
    completedAt: "2026-08-23T12:01:00.000Z",
    result: {
      status: "completed",
      summary: "secret summary",
      changed_files: ["C:\\secret\\workspace\\one.txt", "two.txt"],
      tests: [{ status: "passed" }, { status: "failed" }],
      blockers: [],
    },
    error: { code: "secret", message: "private error" },
    events: [{ output: "private log" }],
  });
  assert.deepEqual(projected, {
    id: "task-1",
    status: "completed",
    result_status: "completed",
    changed_files_count: 2,
    tests: { total: 2, passed: 1, failed: 1 },
    blocker_count: 0,
    has_error: true,
    updated_at: "2026-08-23T12:00:00.000Z",
    completed_at: "2026-08-23T12:01:00.000Z",
  });
  assert.doesNotMatch(JSON.stringify(projected), /secret|workspace|objective|summary|log/);
});
