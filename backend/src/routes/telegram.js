import { Router } from "express";
import { env } from "../env.js";
import { getCatalog, searchCatalog } from "../tle.js";
import { sendTelegramMessage } from "../telegram.js";
import { supabase } from "../db.js";

export const telegramRouter = Router();

const MAX_MATCHES_SHOWN = 5;

const HELP_TEXT = [
  "I track close approaches for satellites and debris.",
  "",
  "/watch <NORAD id or name> — get alerted on high/critical risk close approaches",
  "/unwatch <NORAD id or name> — stop watching",
  "/list — show what you're watching",
].join("\n");

async function resolveOneMatch(query, chatId) {
  const catalog = await getCatalog();
  const matches = searchCatalog(catalog, query);

  if (matches.length === 1) return matches[0];

  if (matches.length === 0) {
    await sendTelegramMessage(chatId, `No satellite matches "${query}". Try a NORAD id, or part of its name.`);
    return null;
  }

  const shown = matches.slice(0, MAX_MATCHES_SHOWN).map((m) => `${m.norad_id} — ${m.name}`).join("\n");
  const more = matches.length > MAX_MATCHES_SHOWN ? `\n…and ${matches.length - MAX_MATCHES_SHOWN} more.` : "";
  await sendTelegramMessage(chatId, `"${query}" matches more than one object — try the NORAD id instead:\n${shown}${more}`);
  return null;
}

async function handleWatch(chatId, query) {
  if (!query) return sendTelegramMessage(chatId, "Usage: /watch <NORAD id or name>");

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
    `Watching ${object.name} (${object.norad_id}). I'll message you here if it's predicted to come within high/critical risk range of something.`,
  );
}

async function handleUnwatch(chatId, query) {
  if (!query) return sendTelegramMessage(chatId, "Usage: /unwatch <NORAD id or name>");

  const object = await resolveOneMatch(query, chatId);
  if (!object) return;

  const { error } = await supabase
    .from("watchlist")
    .delete()
    .eq("telegram_chat_id", chatId)
    .eq("norad_id", object.norad_id);
  if (error) throw error;

  await sendTelegramMessage(chatId, `Stopped watching ${object.name} (${object.norad_id}).`);
}

async function handleList(chatId) {
  const { data, error } = await supabase
    .from("watchlist")
    .select("norad_id, satellite_name")
    .eq("telegram_chat_id", chatId)
    .order("satellite_name");
  if (error) throw error;

  if (data.length === 0) return sendTelegramMessage(chatId, "You're not watching anything yet. Try /watch <NORAD id or name>.");

  const list = data.map((row) => `${row.satellite_name} (${row.norad_id})`).join("\n");
  await sendTelegramMessage(chatId, `Watching:\n${list}`);
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
      else await sendTelegramMessage(chatId, HELP_TEXT);
    }
  } catch (error) {
    console.error("Error handling Telegram webhook:", error);
  }

  // Always 200 once we're actually done — Telegram retries on non-2xx, and
  // there's nothing it could usefully retry here even on our own error.
  res.sendStatus(200);
});
