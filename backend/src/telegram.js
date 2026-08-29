import { env } from "./env.js";

const API_BASE = `https://api.telegram.org/bot${env.telegramBotToken}`;

// HTML parse mode everywhere — callers build messages with <b>, bullets,
// etc. (see routes/telegram.js's htmlEscape) instead of flat text.
export async function sendTelegramMessage(chatId, text) {
  const response = await fetch(`${API_BASE}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram sendMessage failed: HTTP ${response.status} ${body}`);
  }
}

// Registers our webhook URL with Telegram. Not called automatically — run
// once (locally, with the real env vars loaded) whenever the deployed URL
// changes. See backend/README.md.
export async function setTelegramWebhook(url) {
  const response = await fetch(`${API_BASE}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, secret_token: env.telegramWebhookSecret }),
  });
  return response.json();
}
