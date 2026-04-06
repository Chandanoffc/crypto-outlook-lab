function resolveBaseUrl(explicitBaseUrl) {
  if (explicitBaseUrl) return String(explicitBaseUrl).trim();
  if (process.env.SOLORIS_BASE_URL) return String(process.env.SOLORIS_BASE_URL).trim();
  if (process.env.VERCEL_URL) return `https://${String(process.env.VERCEL_URL).trim()}`;
  return "https://soloris-signals.vercel.app";
}

function isDiscordWebhook(url) {
  return /^https:\/\/(discord(?:app)?\.com)\/api\/webhooks\/\d+\/[\w-]+/i.test(String(url || "").trim());
}

async function sendDiscordNotify(baseUrl, webhook, title, event, meta = {}) {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/notify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      title,
      event,
      meta,
      destinations: {
        discordWebhook: String(webhook || "").trim(),
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Notify delivery failed (${response.status})`);
  }
  if (payload?.results?.discord !== "sent") {
    throw new Error(
      typeof payload?.results?.discord === "string" && payload.results.discord
        ? payload.results.discord
        : "Discord delivery did not complete."
    );
  }
  return payload;
}

module.exports = {
  isDiscordWebhook,
  resolveBaseUrl,
  sendDiscordNotify,
};
