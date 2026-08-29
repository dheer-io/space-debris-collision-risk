// One-off setup script: node scripts/setWebhook.js https://your-app.onrender.com
// Run locally with the real .env loaded — see backend/README.md.

import "dotenv/config";
import { setTelegramWebhook } from "../src/telegram.js";

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("Usage: node scripts/setWebhook.js <public-base-url>");
  process.exitCode = 1;
} else {
  const result = await setTelegramWebhook(`${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`);
  console.log(result);
}
