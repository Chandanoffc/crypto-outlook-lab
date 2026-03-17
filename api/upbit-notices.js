const DEFAULT_LIMIT = 12;
const DEFAULT_TOKEN = "BTC";
const UPBIT_NOTICE_URL = "https://upbit.com/service_center/notice";
const CACHE_TTL_MS = 60 * 1000;

let noticeCache = {
  notices: null,
  expiresAt: 0,
};

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeToken(rawToken) {
  const cleaned = String(rawToken || "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]/g, "");
  return cleaned || DEFAULT_TOKEN;
}

function buildJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
  res.end(JSON.stringify(payload));
}

async function fetchText(url, label) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9,ko-KR;q=0.8,ko;q=0.7",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`${label} failed (${response.status})`);
  }

  return response.text();
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(html) {
  return decodeHtmlEntities(String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizeUrl(href) {
  if (!href) return UPBIT_NOTICE_URL;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("/")) return `https://upbit.com${href}`;
  return `https://upbit.com/${href.replace(/^\.\//, "")}`;
}

function extractTicker(title) {
  const match = String(title || "").match(/\(([A-Z0-9]{2,15})\)/);
  return match ? match[1] : "";
}

function extractTokenName(title, ticker) {
  const cleaned = cleanText(title);
  const englishMatch = cleaned.match(
    /(?:new\s+)?market support for\s+(.+?)\s*\(([A-Z0-9]{2,15})\)/i
  );
  if (englishMatch) return englishMatch[1].trim();

  const koreanMatch = cleaned.match(/(.+?)\s*\(([A-Z0-9]{2,15})\)\s*(?:신규\s*)?(?:거래지원|마켓\s*지원)/);
  if (koreanMatch) return koreanMatch[1].trim();

  if (ticker) {
    return cleaned.replace(new RegExp(`\\(${ticker}\\)`, "i"), "").trim();
  }
  return cleaned;
}

function buildTokenLabel(title) {
  const ticker = extractTicker(title);
  const tokenName = extractTokenName(title, ticker);
  if (tokenName && ticker) return `${tokenName} (${ticker})`;
  return tokenName || ticker || cleanText(title);
}

function isMarketSupportTitle(title) {
  const normalized = String(title || "").toLowerCase();
  return (
    /market support|trading support|new market support/.test(normalized) ||
    /신규\s*거래지원|거래지원\s*안내|마켓\s*지원/.test(title)
  );
}

function normalizeDateString(rawDate) {
  if (!rawDate) return null;
  const sanitized = rawDate.replace(/\./g, "-").replace(/\//g, "-").trim();
  const parsed = Date.parse(sanitized);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildNoticeId(url, title) {
  const idMatch = String(url || "").match(/[?&]id=(\d+)/i);
  if (idMatch) return idMatch[1];
  return `${title}-${url}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
}

function anchorNoticeCandidates(html) {
  const notices = [];
  const pattern =
    /<a\b[^>]*href=(["'])([^"']*service_center\/notice[^"']*)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    const href = match[2];
    if (/\/service_center\/notice\/?$/.test(href)) continue;
    const title = cleanText(match[3]);
    if (!title || title.length < 6 || title.length > 220) continue;
    const url = normalizeUrl(href);
    const context = html.slice(match.index, match.index + 1200);
    const dateMatch = context.match(/\b(20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?)\b/);

    notices.push({
      id: buildNoticeId(url, title),
      title,
      url,
      publishedAt: normalizeDateString(dateMatch?.[1]),
      ticker: extractTicker(title),
      tokenName: extractTokenName(title, extractTicker(title)),
      tokenLabel: buildTokenLabel(title),
      isMarketSupport: isMarketSupportTitle(title),
      source: "Upbit Notice",
    });
  }

  return notices;
}

function collectJsonNoticeCandidates(node, notices = []) {
  if (!node) return notices;
  if (Array.isArray(node)) {
    node.forEach((entry) => collectJsonNoticeCandidates(entry, notices));
    return notices;
  }
  if (typeof node !== "object") return notices;

  const titleCandidate = [node.title, node.subject, node.noticeTitle].find(
    (value) => typeof value === "string" && value.trim().length >= 6
  );
  const hrefCandidate = [node.url, node.link, node.noticeUrl].find(
    (value) => typeof value === "string" && value.includes("notice")
  );
  const idCandidate =
    node.id || node.noticeId || (typeof node.seq === "string" || typeof node.seq === "number" ? node.seq : null);
  const dateCandidate =
    node.createdAt || node.createDate || node.regDate || node.publishedAt || node.displayDate;

  if (titleCandidate && (hrefCandidate || idCandidate)) {
    const url = hrefCandidate
      ? normalizeUrl(hrefCandidate)
      : `${UPBIT_NOTICE_URL}?id=${String(idCandidate)}`;
    const ticker = extractTicker(titleCandidate);
    notices.push({
      id: String(idCandidate || buildNoticeId(url, titleCandidate)),
      title: cleanText(titleCandidate),
      url,
      publishedAt: normalizeDateString(String(dateCandidate || "")),
      ticker,
      tokenName: extractTokenName(titleCandidate, ticker),
      tokenLabel: buildTokenLabel(titleCandidate),
      isMarketSupport: isMarketSupportTitle(titleCandidate),
      source: "Upbit Notice",
    });
  }

  Object.values(node).forEach((value) => collectJsonNoticeCandidates(value, notices));
  return notices;
}

function nextDataCandidates(html) {
  const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return collectJsonNoticeCandidates(parsed, []);
  } catch (error) {
    return [];
  }
}

function dedupeNotices(notices) {
  const seen = new Set();
  return notices.filter((notice) => {
    const key = `${notice.id}:${notice.url}:${notice.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getUpbitNotices() {
  if (noticeCache.notices && Date.now() < noticeCache.expiresAt) {
    return noticeCache.notices;
  }

  const html = await fetchText(UPBIT_NOTICE_URL, "Upbit notices");
  const notices = dedupeNotices([...nextDataCandidates(html), ...anchorNoticeCandidates(html)])
    .sort((left, right) => {
      const rightTime = right.publishedAt || 0;
      const leftTime = left.publishedAt || 0;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return 0;
    })
    .slice(0, 40);

  noticeCache = {
    notices,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  return notices;
}

module.exports = async function handler(req, res) {
  const token = normalizeToken(firstQueryValue(req.query?.token) || DEFAULT_TOKEN);
  const tokenTicker = token.replace(/^\d+/, "");

  try {
    const notices = await getUpbitNotices();
    const ordered = [...notices].sort((left, right) => {
      const leftMatch = left.ticker === tokenTicker ? 1 : 0;
      const rightMatch = right.ticker === tokenTicker ? 1 : 0;
      if (rightMatch !== leftMatch) return rightMatch - leftMatch;
      if (right.isMarketSupport !== left.isMarketSupport) {
        return right.isMarketSupport ? 1 : -1;
      }
      return (right.publishedAt || 0) - (left.publishedAt || 0);
    });

    buildJsonResponse(res, 200, {
      token,
      notices: ordered.slice(0, DEFAULT_LIMIT).map((notice) => ({
        ...notice,
        matchedToken: notice.ticker === tokenTicker,
      })),
    });
  } catch (error) {
    buildJsonResponse(res, 502, {
      error: error.message || "Unable to fetch Upbit notices.",
    });
  }
};
