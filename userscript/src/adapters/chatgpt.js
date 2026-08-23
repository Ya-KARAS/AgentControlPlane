export default Object.freeze({
  id: "chatgpt",
  displayName: "ChatGPT",
  matches: ["https://chatgpt.com/*"],
  origins: ["https://chatgpt.com"],
  composer: ["#prompt-textarea", "textarea"],
  send: ['button[data-testid="send-button"]', 'button[aria-label*="Send"]'],
  assistant: ['[data-message-author-role="assistant"]'],
  user: ['[data-message-author-role="user"]'],
});
