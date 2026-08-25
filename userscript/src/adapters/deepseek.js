export default Object.freeze({
  id: "deepseek",
  displayName: "DeepSeek",
  matches: ["https://chat.deepseek.com/*"],
  origins: ["https://chat.deepseek.com"],
  composer: ["textarea", '[contenteditable="true"]'],
  send: [
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'button[type="submit"]',
    'form button:not([type])',
  ],
  assistant: [".ds-markdown", '[data-role="assistant"]', ".markdown-body"],
  user: [
    '[data-message-author-role="user"]',
    '[data-role="user"]',
    '.ds-chat [class*="user"]',
    'main [class*="user"]',
  ],
});
