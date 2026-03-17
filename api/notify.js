const crypto = require("crypto");
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
  return `${title}\n${event?.message || ""}\n${event?.symbol || "Signal"} • ${when}`;
}

async function sendDiscord(webhookUrl, title, event) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      content: formatAlertMessage(title, event),
    }),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed (${response.status})`);
  }
}

async function sendTelegram(botToken, chatId, title, event) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
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
    const title = String(body?.title || "Soloris Alert").slice(0, 140);
    const event = body?.event || {};
    const meta = body?.meta || {};
    const destinations = body?.destinations || {};
    const results = {};

    if (destinations.discordWebhook) {
      try {
        await sendDiscord(String(destinations.discordWebhook).trim(), title, event);
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
          event
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
