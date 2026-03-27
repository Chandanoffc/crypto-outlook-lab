const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { insertAlertDelivery } = require("../lib/neon-db");

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

function formatAlertMessage(title, event) {
  if (event?.formattedMessage) {
    return String(event.formattedMessage);
  }
  const when = event?.time ? new Date(event.time).toLocaleString() : new Date().toLocaleString();
  return `${title}\n${event?.message || ""}\n${event?.pair || event?.symbol || "Signal"} • ${when}`;
}

function inferBaseUrl(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const forwardedHost = req.headers["x-forwarded-host"];
  const proto = forwardedProto ? String(forwardedProto).split(",")[0].trim() : "https";
  const host = forwardedHost || req.headers.host || "soloris-signals.vercel.app";
  return `${proto}://${host}`;
}

function formatBannerPair(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  if (raw.includes("/")) return raw;
  if (raw.endsWith("USDT")) return `${raw.slice(0, -4)}/USDT`;
  if (raw.endsWith("USDC")) return `${raw.slice(0, -4)}/USDC`;
  return raw;
}

function resolveNativeBannerLabel(event = {}) {
  const type = String(event?.type || "").toLowerCase();
  if (type === "perps") return "NEW PERPS ALERT";
  if (type === "dlmm") return "NEW DLMM ALERT";
  return "NEW SIGNAL";
}

function buildNativeBannerTitle(fallbackTitle, event = {}) {
  const label = resolveNativeBannerLabel(event);
  const pair = formatBannerPair(event?.pair || event?.symbol);
  const direction = String(event?.direction || event?.side || "").trim().toUpperCase();
  const strategy = String(event?.strategy || "").trim();

  if (String(event?.type || "").toLowerCase() === "dlmm") {
    return [label, strategy || "DLMM", pair].filter(Boolean).join(" | ");
  }

  if (String(event?.type || "").toLowerCase() === "perps") {
    return [label, pair, direction].filter(Boolean).join(" | ");
  }

  if (pair || direction) {
    return [label, pair, direction].filter(Boolean).join(" | ");
  }

  return fallbackTitle;
}

function resolveAlertBannerFile(event, meta = {}) {
  const strategy = String(meta?.strategy || "").toLowerCase();
  const signalType = String(event?.type || "").toLowerCase();
  const supportsNativeSignalBanner =
    strategy === "ema_book" ||
    strategy === "house_trend" ||
    strategy === "perps_alerts" ||
    strategy === "dlmm_alerts" ||
    signalType === "house" ||
    signalType === "tradez" ||
    signalType === "perps" ||
    signalType === "dlmm";
  if (!supportsNativeSignalBanner) return "";
  const eventType = String(meta?.eventType || event?.deliveryType || "").toLowerCase();
  const titleText = String(event?.title || meta?.title || "").toLowerCase();
  const messageText = String(event?.message || event?.formattedMessage || "").toLowerCase();
  const isProtected =
    eventType === "break_even_exit" ||
    eventType === "safe_exit" ||
    titleText.includes("protected at entry") ||
    titleText.includes("breakeven") ||
    messageText.includes("protected at entry") ||
    messageText.includes("breakeven exit") ||
    messageText.includes("sl moved to entry");
  if (!eventType && !isProtected) return "";

  if (eventType === "entry_opened" || eventType === "test_signal") {
    const quality = Number(event?.qualityScore) || 0;
    return quality > 140 ? "new-signal-gold.gif" : "new-signal-cyan.gif";
  }
  if (eventType === "tp1_hit" || eventType === "tp_hit") {
    return "profits.gif";
  }
  if (isProtected) {
    return "safe.gif";
  }
  if (eventType === "sl_hit") {
    return "loss.gif";
  }
  return "";
}

async function loadAlertBanner(event, meta = {}) {
  const filename = resolveAlertBannerFile(event, meta);
  if (!filename) return null;

  try {
    const buffer = await fs.readFile(path.join(__dirname, "..", "assets", "alerts", filename));
    const ext = path.extname(filename).toLowerCase();
    return {
      filename,
      buffer,
      mimeType: ext === ".gif" ? "image/gif" : "image/png",
    };
  } catch (error) {
    return null;
  }
}

function buildDiscordPayload(title, event, bannerAttachment) {
  const message = formatAlertMessage(title, event);
  if (!bannerAttachment) {
    return {
      content: message,
    };
  }

  return {
    content: message,
    embeds: [
      {
        color:
          event?.side === "Short"
            ? 0xef4444
            : Number(event?.qualityScore) > 140
              ? 0xd4af37
              : 0x22d3ee,
        image: {
          url: `attachment://${bannerAttachment.filename}`,
        },
      },
    ],
  };
}

function buildTelegramCaption(title, event) {
  const message = formatAlertMessage(title, event);
  if (message.length <= 900) return message;
  return [
    title,
    event?.symbol ? `Pair: ${event.symbol}` : "",
    event?.side ? `Side: ${event.side}` : "",
    Number.isFinite(Number(event?.entryPrice)) ? `Entry: $${event.entryPrice}` : "",
    Number.isFinite(Number(event?.tp1)) ? `TP1: $${event.tp1}` : "",
    Number.isFinite(Number(event?.tp2)) ? `TP2: $${event.tp2}` : "",
    Number.isFinite(Number(event?.stopLoss)) ? `SL: $${event.stopLoss}` : "",
    Number.isFinite(Number(event?.returnPct)) ? `Return: ${Number(event.returnPct).toFixed(2)}%` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendDiscord(webhookUrl, title, event, bannerAttachment) {
  let response;
  if (bannerAttachment) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(buildDiscordPayload(title, event, bannerAttachment)));
    form.append(
      "files[0]",
      new Blob([bannerAttachment.buffer], { type: bannerAttachment.mimeType }),
      bannerAttachment.filename
    );
    response = await fetch(webhookUrl, {
      method: "POST",
      body: form,
    });
  } else {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(buildDiscordPayload(title, event, null)),
    });
  }

  if (!response.ok) {
    throw new Error(`Discord webhook failed (${response.status})`);
  }
}

async function sendTelegram(botToken, chatId, title, event, bannerAttachment) {
  let response;
  if (bannerAttachment) {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", buildTelegramCaption(title, event));
    form.append("disable_web_page_preview", "true");
    form.append(
      "photo",
      new Blob([bannerAttachment.buffer], { type: bannerAttachment.mimeType }),
      bannerAttachment.filename
    );
    response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: "POST",
      body: form,
    });
  } else {
    response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatAlertMessage(title, event),
        disable_web_page_preview: true,
      }),
    });
  }

  if (!response.ok) {
    throw new Error(`Telegram send failed (${response.status})`);
  }
}

async function sendEmail(emailTo, title, event) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.ALERT_FROM_EMAIL || "onboarding@resend.dev",
      to: [emailTo],
      subject: title,
      text: formatAlertMessage(title, event),
    }),
  });

  if (!response.ok) {
    throw new Error(`Email send failed (${response.status})`);
  }
}

async function recordDelivery(destination, status, errorText, title, event, meta = {}) {
  try {
    await insertAlertDelivery({
      deliveryId: `${destination}:${meta?.eventType || "notification"}:${meta?.symbol || event?.symbol || "unknown"}:${crypto.randomUUID()}`,
      source: meta?.source || "notify_api",
      strategy: meta?.strategy || null,
      eventType: meta?.eventType || null,
      symbol: meta?.symbol || event?.symbol || null,
      title,
      destination,
      status,
      error: errorText || null,
      sentAt: Date.now(),
      payload: {
        event,
        meta,
      },
    });
  } catch (error) {
    // Alert logging is non-blocking and should never break delivery.
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    buildJsonResponse(res, 405, {
      error: "Method not allowed.",
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const inputTitle = String(body?.title || "Soloris Alert").slice(0, 140);
    const event = body?.event || {};
    const meta = body?.meta || {};
    const destinations = body?.destinations || {};
    const results = {};
    const title = buildNativeBannerTitle(inputTitle, event);
    const bannerAttachment = await loadAlertBanner(event, meta);

    if (destinations.discordWebhook) {
      try {
        await sendDiscord(String(destinations.discordWebhook).trim(), title, event, bannerAttachment);
        results.discord = "sent";
        await recordDelivery("discord", "sent", "", title, event, meta);
      } catch (error) {
        results.discord = error.message;
        await recordDelivery("discord", "failed", error.message, title, event, meta);
      }
    }

    if (destinations.telegramToken && destinations.telegramChatId) {
      try {
        await sendTelegram(
          String(destinations.telegramToken).trim(),
          String(destinations.telegramChatId).trim(),
          title,
          event,
          bannerAttachment
        );
        results.telegram = "sent";
        await recordDelivery("telegram", "sent", "", title, event, meta);
      } catch (error) {
        results.telegram = error.message;
        await recordDelivery("telegram", "failed", error.message, title, event, meta);
      }
    }

    if (destinations.emailTo) {
      try {
        await sendEmail(String(destinations.emailTo).trim(), title, event);
        results.email = "sent";
        await recordDelivery("email", "sent", "", title, event, meta);
      } catch (error) {
        results.email = error.message;
        await recordDelivery("email", "failed", error.message, title, event, meta);
      }
    }

    buildJsonResponse(res, 200, {
      ok: true,
      results,
    });
  } catch (error) {
    buildJsonResponse(res, 400, {
      error: error.message || "Unable to process alert delivery.",
    });
  }
};
