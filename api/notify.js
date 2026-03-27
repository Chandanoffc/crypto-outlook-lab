const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { hasDatabase, getRuntimeState, insertAlertDelivery, upsertRuntimeState } = require("../lib/neon-db");
const {
  applyRuntimeSettings,
  buildResetRuntimeState,
  defaultRuntimeState: defaultPlaygroundRuntimeState,
  runPlaygroundScan,
  sanitizeRuntimeState: sanitizePlaygroundRuntimeState,
  sendTestAlert,
} = require("../lib/playground-runtime");

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

async function loadPersistedPlaygroundState() {
  if (!hasDatabase()) {
    return {
      available: false,
      state: defaultPlaygroundRuntimeState(),
      updatedAt: null,
    };
  }

  const stored = await getRuntimeState("playground_ops");
  if (stored.found && stored.state) {
    return {
      available: true,
      state: sanitizePlaygroundRuntimeState(stored.state),
      updatedAt: stored.updatedAt || null,
    };
  }

  const seeded = defaultPlaygroundRuntimeState();
  const saved = await upsertRuntimeState("playground_ops", seeded);
  return {
    available: true,
    state: sanitizePlaygroundRuntimeState(saved.state || seeded),
    updatedAt: saved.updatedAt || null,
  };
}

async function handlePlaygroundRuntimeAction(req, res, body) {
  if (!hasDatabase()) {
    buildJsonResponse(res, 200, {
      ok: true,
      backgroundAvailable: false,
      reason: "DATABASE_URL not configured.",
      state: defaultPlaygroundRuntimeState(),
    });
    return true;
  }

  const loaded = await loadPersistedPlaygroundState();
  const runtimeBody = body?.runtime || {};
  const action = String(runtimeBody?.action || "get").trim().toLowerCase();
  const baseUrl = inferBaseUrl(req);

  if (action === "get") {
    buildJsonResponse(res, 200, {
      ok: true,
      backgroundAvailable: loaded.available,
      state: loaded.state,
      updatedAt: loaded.updatedAt,
    });
    return true;
  }

  if (action === "reset") {
    const resetState = buildResetRuntimeState();
    const saved = await upsertRuntimeState("playground_ops", resetState);
    buildJsonResponse(res, 200, {
      ok: true,
      backgroundAvailable: true,
      state: sanitizePlaygroundRuntimeState(saved.state || resetState),
      updatedAt: saved.updatedAt,
    });
    return true;
  }

  if (action === "scan") {
    const settings = runtimeBody?.settings || {};
    const inputState = Object.keys(settings).length
      ? applyRuntimeSettings(loaded.state, settings)
      : loaded.state;
    const result = await runPlaygroundScan(inputState, {
      manual: true,
      modules: Array.isArray(runtimeBody?.modules) ? runtimeBody.modules : undefined,
      baseUrl,
    });
    const saved = await upsertRuntimeState("playground_ops", result.state);
    buildJsonResponse(res, 200, {
      ok: true,
      backgroundAvailable: true,
      state: sanitizePlaygroundRuntimeState(saved.state || result.state),
      updatedAt: saved.updatedAt,
      summary: result.summary,
    });
    return true;
  }

  if (action === "test") {
    const moduleKey = String(runtimeBody?.module || "").trim().toLowerCase() === "dlmm" ? "dlmm" : "perps";
    const nextState = await sendTestAlert(loaded.state, moduleKey, { baseUrl });
    const saved = await upsertRuntimeState("playground_ops", nextState);
    buildJsonResponse(res, 200, {
      ok: true,
      backgroundAvailable: true,
      state: sanitizePlaygroundRuntimeState(saved.state || nextState),
      updatedAt: saved.updatedAt,
    });
    return true;
  }

  const nextState = applyRuntimeSettings(loaded.state, runtimeBody?.settings || {});
  const saved = await upsertRuntimeState("playground_ops", nextState);
  buildJsonResponse(res, 200, {
    ok: true,
    backgroundAvailable: true,
    state: sanitizePlaygroundRuntimeState(saved.state || nextState),
    updatedAt: saved.updatedAt,
  });
  return true;
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
  if (String(event?.bannerLabel || "").trim()) return String(event.bannerLabel).trim().toUpperCase();
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

const BANNER_WIDTH = 720;
const BANNER_HEIGHT = 405;
const BANNER_DELAY_CS = 90;
const BANNER_PALETTE = [
  [4, 10, 22],
  [8, 18, 34],
  [12, 28, 52],
  [18, 42, 74],
  [31, 211, 238],
  [72, 246, 224],
  [255, 255, 255],
  [161, 173, 194],
  [255, 210, 87],
  [255, 96, 96],
  [58, 76, 105],
  [11, 18, 30],
  [17, 34, 58],
  [214, 175, 55],
  [84, 226, 151],
  [8, 14, 26],
];

const FONT_5X7 = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "|": ["00100", "00100", "00100", "00100", "00100", "00100", "00100"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
  ":": ["00000", "00110", "00110", "00000", "00110", "00110", "00000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "%": ["11001", "11010", "00100", "01000", "10110", "00110", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  "J": ["00001", "00001", "00001", "00001", "10001", "10001", "01110"],
  "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

function sanitizeBannerText(value, fallback = "") {
  const uppercase = String(value || fallback || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!uppercase) return String(fallback || "").toUpperCase().trim();
  return uppercase
    .split("")
    .map((char) => (FONT_5X7[char] ? char : " "))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function createBannerFrameBuffer() {
  return new Uint8Array(BANNER_WIDTH * BANNER_HEIGHT);
}

function fillRect(frame, x, y, width, height, colorIndex) {
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(BANNER_WIDTH, Math.floor(x + width));
  const endY = Math.min(BANNER_HEIGHT, Math.floor(y + height));
  for (let py = startY; py < endY; py += 1) {
    const rowOffset = py * BANNER_WIDTH;
    frame.fill(colorIndex, rowOffset + startX, rowOffset + endX);
  }
}

function drawText(frame, text, x, y, scale, colorIndex) {
  const safeText = sanitizeBannerText(text);
  let cursorX = Math.floor(x);
  for (const char of safeText) {
    const glyph = FONT_5X7[char] || FONT_5X7[" "];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] !== "1") continue;
        fillRect(frame, cursorX + col * scale, y + row * scale, scale, scale, colorIndex);
      }
    }
    cursorX += 6 * scale;
  }
}

function measureTextWidth(text, scale) {
  const safeText = sanitizeBannerText(text);
  return Math.max(0, safeText.length * 6 * scale - scale);
}

function drawCenteredText(frame, text, y, scale, colorIndex) {
  const width = measureTextWidth(text, scale);
  const x = Math.max(32, Math.floor((BANNER_WIDTH - width) / 2));
  drawText(frame, text, x, y, scale, colorIndex);
}

function drawBannerShell(frame, accentPrimary, accentSecondary) {
  fillRect(frame, 0, 0, BANNER_WIDTH, BANNER_HEIGHT, 0);
  fillRect(frame, 18, 18, BANNER_WIDTH - 36, BANNER_HEIGHT - 36, 11);
  fillRect(frame, 28, 28, BANNER_WIDTH - 56, BANNER_HEIGHT - 56, 1);
  for (let x = 42; x < BANNER_WIDTH - 42; x += 28) {
    fillRect(frame, x, 52, 1, BANNER_HEIGHT - 104, 12);
  }
  for (let y = 52; y < BANNER_HEIGHT - 52; y += 28) {
    fillRect(frame, 42, y, BANNER_WIDTH - 84, 1, 12);
  }
  fillRect(frame, 56, 42, BANNER_WIDTH - 112, 34, 2);
  fillRect(frame, 60, 46, 72, 26, accentPrimary);
  fillRect(frame, BANNER_WIDTH - 182, 48, 102, 22, 3);
  fillRect(frame, 92, 102, BANNER_WIDTH - 184, 122, 1);
  fillRect(frame, 102, 112, BANNER_WIDTH - 204, 102, 2);
  fillRect(frame, 104, 154, BANNER_WIDTH - 208, 4, accentSecondary);
  fillRect(frame, 84, BANNER_HEIGHT - 58, BANNER_WIDTH - 168, 24, 2);
}

function buildBannerTopLine(event = {}) {
  const type = String(event?.type || "").toLowerCase();
  const label = resolveNativeBannerLabel(event);
  const pair = formatBannerPair(event?.pair || event?.symbol) || "SIGNAL";
  const strategy = sanitizeBannerText(event?.strategy || "DLMM", "DLMM");
  const direction = sanitizeBannerText(event?.direction || event?.side || "", "");

  if (type === "dlmm") {
    return {
      left: label,
      center: strategy || "DLMM",
      right: pair,
    };
  }

  return {
    left: label,
    center: pair,
    right: direction || pair,
  };
}

function buildBannerFlashFrames(event = {}) {
  const configured = Array.isArray(event?.bannerFlashFrames) ? event.bannerFlashFrames : [];
  const pair = formatBannerPair(event?.pair || event?.symbol) || "SIGNAL";
  const label = resolveNativeBannerLabel(event);
  const frames = configured.length ? configured : [label, pair];
  const cleaned = frames
    .map((value, index) => sanitizeBannerText(value, index === 0 ? label : pair))
    .filter(Boolean);
  if (cleaned.length >= 2) return cleaned.slice(0, 2);
  if (cleaned.length === 1) return [cleaned[0], sanitizeBannerText(pair, "SIGNAL")];
  return [sanitizeBannerText(label, "NEW SIGNAL"), sanitizeBannerText(pair, "SIGNAL")];
}

function lzwEncode(minCodeSize, indices) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  const output = [];
  let currentByte = 0;
  let bitCount = 0;

  const writeCode = (code) => {
    let value = code;
    for (let bit = 0; bit < codeSize; bit += 1) {
      currentByte |= (value & 1) << bitCount;
      value >>= 1;
      bitCount += 1;
      if (bitCount === 8) {
        output.push(currentByte);
        currentByte = 0;
        bitCount = 0;
      }
    }
  };

  const resetDictionary = () => {
    const dictionary = new Map();
    for (let index = 0; index < clearCode; index += 1) {
      dictionary.set(String.fromCharCode(index), index);
    }
    codeSize = minCodeSize + 1;
    nextCode = endCode + 1;
    return dictionary;
  };

  let dictionary = resetDictionary();
  writeCode(clearCode);
  let sequence = String.fromCharCode(indices[0] || 0);

  for (let index = 1; index < indices.length; index += 1) {
    const symbol = String.fromCharCode(indices[index]);
    const nextSequence = sequence + symbol;
    if (dictionary.has(nextSequence)) {
      sequence = nextSequence;
      continue;
    }

    writeCode(dictionary.get(sequence));
    if (nextCode < 4096) {
      dictionary.set(nextSequence, nextCode);
      nextCode += 1;
      if (nextCode === 1 << codeSize && codeSize < 12) {
        codeSize += 1;
      }
    } else {
      writeCode(clearCode);
      dictionary = resetDictionary();
    }
    sequence = symbol;
  }

  writeCode(dictionary.get(sequence));
  writeCode(endCode);
  if (bitCount > 0) output.push(currentByte);
  return Buffer.from(output);
}

function packGifSubBlocks(buffer) {
  const blocks = [];
  for (let offset = 0; offset < buffer.length; offset += 255) {
    const chunk = buffer.subarray(offset, Math.min(offset + 255, buffer.length));
    blocks.push(Buffer.from([chunk.length]));
    blocks.push(chunk);
  }
  blocks.push(Buffer.from([0]));
  return Buffer.concat(blocks);
}

function encodeGif(frames, delayCs = BANNER_DELAY_CS) {
  const header = Buffer.from("474946383961", "hex");
  const logicalScreenDescriptor = Buffer.from([
    BANNER_WIDTH & 0xff,
    (BANNER_WIDTH >> 8) & 0xff,
    BANNER_HEIGHT & 0xff,
    (BANNER_HEIGHT >> 8) & 0xff,
    0xf3,
    0x00,
    0x00,
  ]);
  const globalColorTable = Buffer.from(BANNER_PALETTE.flat());
  const loopExtension = Buffer.from([
    0x21, 0xff, 0x0b,
    0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
    0x03, 0x01, 0x00, 0x00, 0x00,
  ]);
  const chunks = [header, logicalScreenDescriptor, globalColorTable, loopExtension];

  for (const frame of frames) {
    const graphicsControl = Buffer.from([
      0x21, 0xf9, 0x04, 0x00,
      delayCs & 0xff,
      (delayCs >> 8) & 0xff,
      0x00, 0x00,
    ]);
    const imageDescriptor = Buffer.from([
      0x2c,
      0x00, 0x00, 0x00, 0x00,
      BANNER_WIDTH & 0xff,
      (BANNER_WIDTH >> 8) & 0xff,
      BANNER_HEIGHT & 0xff,
      (BANNER_HEIGHT >> 8) & 0xff,
      0x00,
    ]);
    const minCodeSize = 4;
    const imageData = lzwEncode(minCodeSize, frame);
    chunks.push(graphicsControl, imageDescriptor, Buffer.from([minCodeSize]), packGifSubBlocks(imageData));
  }

  chunks.push(Buffer.from([0x3b]));
  return Buffer.concat(chunks);
}

function createNativeBannerFrame(event, flashText) {
  const frame = createBannerFrameBuffer();
  const quality = Number(event?.qualityScore) || 0;
  const gold = quality > 140;
  const accentPrimary = gold ? 8 : 4;
  const accentSecondary = gold ? 13 : 5;
  const topLine = buildBannerTopLine(event);

  drawBannerShell(frame, accentPrimary, accentSecondary);
  drawText(frame, "SS", 79, 52, 3, 6);
  drawText(frame, topLine.left, 150, 52, 2, 6);
  drawText(frame, topLine.center, Math.max(172, Math.floor((BANNER_WIDTH - measureTextWidth(topLine.center, 2)) / 2)), 52, 2, 6);
  const rightWidth = measureTextWidth(topLine.right, 2);
  drawText(frame, topLine.right, Math.max(150, BANNER_WIDTH - 92 - rightWidth), 52, 2, 6);
  drawCenteredText(frame, flashText, 142, 6, 6);
  drawCenteredText(frame, "SOLORIS SIGNALS", 222, 2, 7);
  drawText(frame, "SOLARIS-SIGNALS.VERCEL.APP", 96, BANNER_HEIGHT - 51, 1, 7);
  drawText(frame, resolveNativeBannerLabel(event), BANNER_WIDTH - 212, BANNER_HEIGHT - 51, 1, 6);
  return frame;
}

function generateNativeEntryBanner(event = {}) {
  const flashFrames = buildBannerFlashFrames(event);
  const frames = flashFrames.map((text) => createNativeBannerFrame(event, text));
  return {
    filename: `soloris-${String(event?.type || "signal").toLowerCase() || "signal"}-banner.gif`,
    buffer: encodeGif(frames, BANNER_DELAY_CS),
    mimeType: "image/gif",
  };
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
    if (signalType === "perps") return "new-perps-alert.gif";
    if (signalType === "dlmm") return "new-dlmm-alert.gif";
    const quality = Number(event?.qualityScore) || 0;
    return quality > 140 ? "new-signal-gold.gif" : "new-signal-cyan.gif";
  }
  if (eventType === "scanner_signal") {
    if (signalType === "perps") return "new-perps-alert.gif";
    if (signalType === "dlmm") return "new-dlmm-alert.gif";
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
  const eventType = String(meta?.eventType || event?.deliveryType || "").toLowerCase();
  const type = String(event?.type || "").toLowerCase();
  const nativeSignalType =
    type === "house" || type === "tradez" || type === "perps" || type === "dlmm";
  if (nativeSignalType && (eventType === "entry_opened" || eventType === "test_signal" || eventType === "scanner_signal")) {
    return generateNativeEntryBanner(event);
  }

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
    if (String(body?.action || "").trim().toLowerCase() === "playground_runtime") {
      await handlePlaygroundRuntimeAction(req, res, body);
      return;
    }
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
