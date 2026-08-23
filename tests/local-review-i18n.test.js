import assert from "node:assert/strict";
import test from "node:test";
import {
  localReviewMessageKeys,
  localReviewText,
  normalizeLocalReviewLanguage,
} from "../src/local-review/i18n.js";

test("local review language accepts Chinese and English with a Chinese fallback", () => {
  assert.equal(normalizeLocalReviewLanguage("zh-CN"), "zh-CN");
  assert.equal(normalizeLocalReviewLanguage("en"), "en");
  assert.equal(normalizeLocalReviewLanguage("fr"), "zh-CN");
});

test("local review Chinese and English resources have matching keys", () => {
  assert.deepEqual(
    localReviewMessageKeys("zh-CN"),
    localReviewMessageKeys("en"),
  );
  assert.equal(localReviewText("zh-CN", "projectTools"), "项目工具（可选）");
  assert.equal(localReviewText("en", "projectTools"), "Project tools (optional)");
  assert.equal(
    localReviewText("en", "manyNewLocations", { count: 3 }),
    "3 possible locations found",
  );
});
