// Reads and validates configuration once at startup, so a missing variable
// fails immediately and obviously instead of surfacing later as a confusing
// error deep inside a request handler.

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT) || 3000,

  supabaseUrl: required("SUPABASE_URL"),
  supabaseSecretKey: required("SUPABASE_SECRET_KEY"),

  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  // Telegram sends this back on every webhook call so we can tell a genuine
  // update from a request forged by someone who found the URL.
  telegramWebhookSecret: required("TELEGRAM_WEBHOOK_SECRET"),

  // Shared with the update-tle-data.yml workflow, which is the only caller
  // of POST /api/refresh — without this anyone could trigger a rescan.
  refreshSecret: required("REFRESH_SECRET"),

  // The tle-data branch is public, so this is a plain, unauthenticated fetch.
  tleDataUrl:
    process.env.TLE_DATA_URL ??
    "https://raw.githubusercontent.com/dheer-io/space-debris-collision-risk/tle-data/data/raw/tle-latest.json",
};
