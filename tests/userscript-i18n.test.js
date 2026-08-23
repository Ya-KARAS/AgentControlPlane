import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeUserscriptLanguage,
  resolveUserscriptLanguage,
  userscriptMessageKeys,
  userscriptText,
} from "../userscript/src/i18n.js";

test("userscript language mode accepts auto, Chinese, and English", () => {
  assert.equal(normalizeUserscriptLanguage("auto"), "auto");
  assert.equal(normalizeUserscriptLanguage("zh-CN"), "zh-CN");
  assert.equal(normalizeUserscriptLanguage("en"), "en");
  assert.equal(normalizeUserscriptLanguage("fr"), "auto");
});

test("automatic language follows Chinese browser locales and otherwise uses English", () => {
  assert.equal(resolveUserscriptLanguage("auto", ["zh-CN", "en"]), "zh-CN");
  assert.equal(resolveUserscriptLanguage("auto", ["en-US"]), "en");
  assert.equal(resolveUserscriptLanguage("zh-CN", ["en-US"]), "zh-CN");
  assert.equal(resolveUserscriptLanguage("en", ["zh-CN"]), "en");
});

test("Chinese and English UI messages are separate and support interpolation", () => {
  assert.deepEqual(userscriptMessageKeys("zh-CN"), userscriptMessageKeys("en"));
  assert.equal(userscriptText("zh-CN", "ready"), "就绪");
  assert.equal(userscriptText("en", "ready"), "Ready");
  assert.equal(userscriptText("zh-CN", "languageLabel"), "ACP 界面语言");
  assert.equal(userscriptText("en", "languageLabel"), "ACP interface language");
  assert.equal(
    userscriptText("zh-CN", "executionRoute", { route: "OpenCode · economy" }),
    "执行配置：OpenCode · economy",
  );
  assert.equal(
    userscriptText("en", "executionRoute", { route: "OpenCode · economy" }),
    "Execution route: OpenCode · economy",
  );
});
