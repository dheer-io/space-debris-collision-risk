import { Router } from "express";
import { env } from "../env.js";
import { getCatalog, searchCatalog } from "../tle.js";
import { sendTelegramMessage } from "../telegram.js";
import { supabase } from "../db.js";
import { buildScreenableCatalog, findCloseApproaches } from "../conjunctions.js";
import { CONJUNCTION_SCREEN_KM } from "../../../shared/conjunctionMath.js";

export const telegramRouter = Router();

const MAX_MATCHES_SHOWN = 5;
const LOOKUP_RESULTS_SHOWN = 5;
const ALERTS_SHOWN = 10;
const LIST_SHOWN = 50;

// Telegram's HTML parse mode only requires escaping these three — satellite
// names come from CelesTrak and are untrusted-ish, so anything interpolated
// into a message needs this (see htmlEscape calls below), same reasoning as
// the frontend's escapeHtml but for Telegram's smaller HTML subset.
function htmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const RISK_EMOJI = { critical: "⚠️", high: "🟠", moderate: "🟡", low: "🟢" };

const HELP_TEXT = [
  "🛰 <b>Space Debris Tracker</b>",
  "I track close approaches for satellites and debris.",
  "",
  "<b>/watch</b> <NORAD id or name> — get alerted on critical risk close approaches",
  "<b>/unwatch</b> <NORAD id or name> — stop watching",
  "<b>/list</b> — show what you're watching",
  "<b>/lookup</b> <NORAD id or name> — live scan for one object's closest approaches right now",
  "<b>/alerts</b> — everything currently critical risk, catalog-wide",
]
  .map((line) => line.replace(/<NORAD id or name>/g, "&lt;NORAD id or name&gt;"))
  .join("\n");

// One line per close approach, used by both /lookup (camelCase, live-
// computed) and /alerts (snake_case, straight from Supabase).
function formatApproachLine(approach) {
  const otherNoradId = approach.otherNoradId ?? approach.other_norad_id;
  const otherName = approach.otherName ?? approach.other_name;
  const distanceKm = approach.distanceKm ?? approach.distance_km;
  const riskLevel = approach.riskLevel ?? approach.risk_level;
  const closestApproachAt = approach.closestApproachAt ?? new Date(approach.closest_approach_at);
  const emoji = RISK_EMOJI[riskLevel] ?? "•";
  return (
    `${emoji} <b>${riskLevel.toUpperCase()}</b> — ${htmlEscape(otherName)} <code>#${otherNoradId}</code>\n` +
    `   ${distanceKm.toFixed(2)} km · ${closestApproachAt.toUTCString()}`
  );
}

async function resolveOneMatch(query, chatId) {
  const catalog = await getCatalog();
  const matches = searchCatalog(catalog, query);

  if (matches.length === 1) return matches[0];

  if (matches.length === 0) {
    await sendTelegramMessage(chatId, `No satellite matches "${htmlEscape(query)}". Try a NORAD id, or part of its name.`);
    return null;
  }

  const shown = matches
    .slice(0, MAX_MATCHES_SHOWN)
    .map((m) => `• <code>${m.norad_id}</code> — ${htmlEscape(m.name)}`)
    .join("\n");
  const more = matches.length > MAX_MATCHES_SHOWN ? `\n…and ${matches.length - MAX_MATCHES_SHOWN} more.` : "";
  await sendTelegramMessage(
    chatId,
    `"${htmlEscape(query)}" matches more than one object — try the NORAD id instead:\n${shown}${more}`,
  );
  return null;
}

async function handleWatch(chatId, query) {
  if (!query) return sendTelegramMessage(chatId, "Usage: <b>/watch</b> &lt;NORAD id or name&gt;");

  const object = await resolveOneMatch(query, chatId);
  if (!object) return;

  const { error } = await supabase
    .from("watchlist")
    .upsert(
      { telegram_chat_id: chatId, norad_id: object.norad_id, satellite_name: object.name },
      { onConflict: "telegram_chat_id,norad_id" },
    );
  if (error) throw error;

  await sendTelegramMessage(
    chatId,
    `✅ Now watching <b>${htmlEscape(object.name)}</b> <code>#${object.norad_id}</code>\n\n` +
      `You'll get a message here if it's predicted to come within critical risk range of something.`,
  );
}

async function handleUnwatch(chatId, query) {
  if (!query) return sendTelegramMessage(chatId, "Usage: <b>/unwatch</b> &lt;NORAD id or name&gt;");

  const object = await resolveOneMatch(query, chatId);
  if (!object) return;

  const { error } = await supabase
    .from("watchlist")
    .delete()
    .eq("telegram_chat_id", chatId)
    .eq("norad_id", object.norad_id);
  if (error) throw error;

  await sendTelegramMessage(chatId, `🛑 Stopped watching <b>${htmlEscape(object.name)}</b> <code>#${object.norad_id}</code>.`);
}

async function handleList(chatId) {
  const { data, error } = await supabase
    .from("watchlist")
    .select("norad_id, satellite_name")
    .eq("telegram_chat_id", chatId)
    .order("satellite_name");
  if (error) throw error;

  if (data.length === 0) {
    return sendTelegramMessage(chatId, "You're not watching anything yet. Try <b>/watch</b> &lt;NORAD id or name&gt;.");
  }

  // Telegram rejects messages over 4096 chars — sendTelegramMessage() then
  // throws, which the webhook handler's outer try/catch silently swallows,
  // so a big-enough watchlist would otherwise get no reply at all.
  const list = data
    .slice(0, LIST_SHOWN)
    .map((row) => `• ${htmlEscape(row.satellite_name)} <code>#${row.norad_id}</code>`)
    .join("\n");
  const more = data.length > LIST_SHOWN ? `\n\n…and ${data.length - LIST_SHOWN} more.` : "";
  await sendTelegramMessage(chatId, `📡 <b>Watching</b>\n\n${list}${more}`);
}

// Runs the same live single-target scan runConjunctionScan() does, on
// demand, for whatever's asked for — not a read of stored results, so it
// works for any object regardless of whether it happened to be in a
// recent scheduled scan's rotation batch.
async function handleLookup(chatId, query) {
  if (!query) return sendTelegramMessage(chatId, "Usage: <b>/lookup</b> &lt;NORAD id or name&gt;");

  const catalog = await getCatalog();
  const object = await resolveOneMatch(query, chatId);
  if (!object) return;

  const screenable = buildScreenableCatalog(catalog.objects);
  const target = screenable.find((entry) => entry.noradId === object.norad_id);
  if (!target) {
    return sendTelegramMessage(
      chatId,
      `<b>${htmlEscape(object.name)}</b> <code>#${object.norad_id}</code> has unusable orbital elements right now — can't scan it.`,
    );
  }

  const closeApproaches = findCloseApproaches(target, screenable);
  const header = `🔭 <b>${htmlEscape(object.name)}</b> <code>#${object.norad_id}</code>`;

  if (closeApproaches.length === 0) {
    return sendTelegramMessage(chatId, `${header}\nNothing within ${CONJUNCTION_SCREEN_KM}km over the next 5 hours.`);
  }

  const shown = closeApproaches.slice(0, LOOKUP_RESULTS_SHOWN).map(formatApproachLine).join("\n\n");
  const more =
    closeApproaches.length > LOOKUP_RESULTS_SHOWN
      ? `\n\n…and ${closeApproaches.length - LOOKUP_RESULTS_SHOWN} more.`
      : "";
  await sendTelegramMessage(chatId, `${header}\nClosest approaches right now:\n\n${shown}${more}`);
}

// Reads active_alerts (see db/schema.sql) — the live critical set kept
// in sync by every scheduled scan, same data GET /api/alerts serves.
async function handleAlerts(chatId) {
  // A scan-skipped/late row can outlive its own closest_approach_at (the
  // table is only cleaned up during a scan) — filter it out here too, same
  // as GET /api/alerts, so this never shows something already in the past.
  const { data, error } = await supabase
    .from("active_alerts")
    .select("norad_id, satellite_name, other_norad_id, other_name, distance_km, risk_level, closest_approach_at")
    .gt("closest_approach_at", new Date().toISOString())
    .order("distance_km", { ascending: true })
    .limit(ALERTS_SHOWN);
  if (error) throw error;

  if (data.length === 0) return sendTelegramMessage(chatId, "🟢 Nothing catalog-wide is critical risk right now.");

  const lines = data.map(
    (row) =>
      `⚠️ <b>${htmlEscape(row.satellite_name)}</b> <code>#${row.norad_id}</code> vs ` +
      `<b>${htmlEscape(row.other_name)}</b> <code>#${row.other_norad_id}</code>\n` +
      `   ${row.distance_km.toFixed(2)} km · ${new Date(row.closest_approach_at).toUTCString()}`,
  );
  await sendTelegramMessage(chatId, `🚨 <b>Current critical alerts</b>\n\n${lines.join("\n\n")}`);
}

// Telegram calls this on every message sent to the bot. Registered once via
// scripts/setWebhook.js — see backend/README.md.
telegramRouter.post("/webhook", async (req, res) => {
  if (req.get("x-telegram-bot-api-secret-token") !== env.telegramWebhookSecret) {
    return res.sendStatus(401);
  }

  // Must await all of this before responding, not respond-then-process —
  // on a serverless function (unlike a long-running server) the execution
  // environment can be frozen the instant the response is sent, so any
  // work still in flight after that point isn't reliably completed. This
  // was silently eating every single command: the response looked fine,
  // but handleWatch/etc. never actually finished running.
  try {
    const text = req.body?.message?.text;
    const chatId = req.body?.message?.chat?.id;

    if (text && chatId) {
      const [rawCommand, ...rest] = text.trim().split(/\s+/);
      // Telegram appends "@BotName" to commands in group chats (and
      // sometimes in DMs too, depending on client) — "/watch@MySatBot
      // 25544" is the same command as "/watch 25544".
      const command = rawCommand.split("@")[0];
      const argument = rest.join(" ");

      if (command === "/watch") await handleWatch(chatId, argument);
      else if (command === "/unwatch") await handleUnwatch(chatId, argument);
      else if (command === "/list") await handleList(chatId);
      else if (command === "/lookup") await handleLookup(chatId, argument);
      else if (command === "/alerts") await handleAlerts(chatId);
      else await sendTelegramMessage(chatId, HELP_TEXT);
    }
  } catch (error) {
    console.error("Error handling Telegram webhook:", error);
  }

  // Always 200 once we're actually done — Telegram retries on non-2xx, and
  // there's nothing it could usefully retry here even on our own error.
  res.sendStatus(200);
});
