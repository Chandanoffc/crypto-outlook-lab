"use strict";
/**
 * solana-trader.js — real on-chain execution via Jupiter + Helius.
 *
 * Uses @noble/curves for ed25519 signing instead of @solana/web3.js.
 * @solana/web3.js transitively loads rpc-websockets → uuid (ESM-only),
 * which crashes Vercel's CommonJS runtime even when Connection is not used.
 */

const { ed25519 } = require("@noble/curves/ed25519");

const USDC_MINT             = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WALLET_ADDRESS        = "44hG7cY4xoYie1SYZvoSYqAscZM28KSECkdokmm3meKU";
// Jupiter endpoints — resolved dynamically so we can inject the Helius API key
// quote-api.jup.ag blocks datacenter IPs; use their public lite API instead
const JUPITER_QUOTE_BASE    = "https://lite-api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_BASE     = "https://lite-api.jup.ag/swap/v1/swap";
const SLIPPAGE_BPS          = 500;
const PRIORITY_FEE_LAMPORTS = 100_000;
const REAL_TRADE_USDC       = 10;
const MIN_LIQUIDITY_REAL    = 8_000;

// ── Base58 ────────────────────────────────────────────────────────────────────

const BASE58_ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function fromBase58(str) {
  let n = 0n;
  for (const c of str) {
    const i = BASE58_ALPHA.indexOf(c);
    if (i < 0) throw new Error(`Invalid base58 char: ${c}`);
    n = n * 58n + BigInt(i);
  }
  const hex = n.toString(16).padStart(64, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function toBase58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) { s = BASE58_ALPHA[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = "1" + s; }
  return s;
}

// ── Wallet ────────────────────────────────────────────────────────────────────

function getWallet() {
  const raw = String(process.env.TRADING_WALLET_PRIVKEY || "").trim();
  if (!raw) throw new Error("TRADING_WALLET_PRIVKEY env var not set");
  // Solana keypair: 64 bytes — first 32 are the seed, last 32 are the public key
  const secretKey = fromBase58(raw);
  if (secretKey.length !== 64) throw new Error(`Invalid keypair length: ${secretKey.length} (expected 64)`);
  const seed      = secretKey.slice(0, 32);
  const publicKey = secretKey.slice(32, 64);
  return { seed, publicKey, address: toBase58(publicKey) };
}

// ── Helius JSON-RPC (plain fetch — no Connection/WebSocket) ──────────────────

function rpcUrl() {
  const key = String(process.env.HELIUS_API_KEY || "").trim();
  return key
    ? `https://mainnet.helius-rpc.com/?api-key=${key}`
    : "https://api.mainnet-beta.solana.com";
}

function fetchWithTimeout(url, options, ms = 12_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function rpc(method, params) {
  const r = await fetchWithTimeout(rpcUrl(), {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const d = await r.json();
  if (d.error) throw new Error(`RPC ${method}: ${d.error.message}`);
  return d.result;
}

// ── Balances ──────────────────────────────────────────────────────────────────

async function getWalletBalances() {
  const address = process.env.TRADING_WALLET_ADDRESS || WALLET_ADDRESS;
  const [solResult, tokenResult] = await Promise.all([
    rpc("getBalance", [address, { commitment: "confirmed" }]),
    rpc("getTokenAccountsByOwner", [address, { mint: USDC_MINT }, { encoding: "jsonParsed", commitment: "confirmed" }]),
  ]);
  const sol  = (solResult?.value ?? solResult ?? 0) / 1e9;
  const usdc = (tokenResult?.value || []).reduce(
    (s, a) => s + parseFloat(a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0
  );
  return { sol, usdc, address };
}

async function getTokenBalance(mintAddress) {
  const wallet  = getWallet();
  const result  = await rpc("getTokenAccountsByOwner", [
    wallet.address,
    { mint: mintAddress },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  const accounts = result?.value || [];
  if (!accounts.length) return 0;
  return parseFloat(accounts[0].account.data.parsed.info.tokenAmount.uiAmount || 0);
}

// ── Versioned transaction sign + send ────────────────────────────────────────
// Solana versioned transaction wire format:
//   compact_u16   number_of_signatures
//   [n * 64]      signature bytes (zeros = unsigned slot)
//   [...]         message bytes  ← what gets signed
//
// compact_u16 encoding: 1 byte if value < 128, else multi-byte little-endian.

function readCompactU16(buf, offset) {
  let val = 0, shift = 0, pos = offset;
  for (;;) {
    const b = buf[pos++];
    val |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return { value: val, bytesRead: pos - offset };
}

function signAndSerialize(txBytes, seed) {
  const buf = Buffer.isBuffer(txBytes) ? txBytes : Buffer.from(txBytes);
  const { value: nSigs, bytesRead } = readCompactU16(buf, 0);
  if (nSigs === 0) throw new Error("Transaction has no signature slots");

  const msgOffset = bytesRead + nSigs * 64;
  const message   = buf.slice(msgOffset);

  // Sign the raw message bytes with ed25519
  const signature = ed25519.sign(message, seed);

  // Write signature into slot 0
  signature.forEach((b, i) => { buf[bytesRead + i] = b; });
  return buf;
}

async function sendAndConfirm(txBytes, seed) {
  const signed     = signAndSerialize(txBytes, seed);
  const serialized = signed.toString("base64");

  const sig = await rpc("sendTransaction", [
    serialized,
    { encoding: "base64", skipPreflight: false, maxRetries: 3, preflightCommitment: "confirmed" },
  ]);

  // Poll up to 25s — fits within Vercel 60s budget
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const result = await rpc("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]);
    const status = result?.value?.[0];
    if (status) {
      if (status.err) throw new Error(`Tx ${sig} failed on-chain: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return sig;
    }
  }
  throw new Error(`Transaction ${sig} not confirmed within 25s — likely expired, will retry`);
}

// ── Jupiter quote + swap ──────────────────────────────────────────────────────

async function getQuote(inputMint, outputMint, amountRaw) {
  const url = `${JUPITER_QUOTE_BASE}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&slippageBps=${SLIPPAGE_BPS}&onlyDirectRoutes=false`;
  const r   = await fetchWithTimeout(url, {});
  if (!r.ok) throw new Error(`Jupiter quote failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function executeSwap(quote) {
  const wallet = getWallet();

  const swapRes = await fetchWithTimeout(JUPITER_SWAP_BASE, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse:             quote,
      userPublicKey:             wallet.address,
      wrapAndUnwrapSol:          true,
      dynamicComputeUnitLimit:   true,
      prioritizationFeeLamports: PRIORITY_FEE_LAMPORTS,
    }),
  });
  if (!swapRes.ok) throw new Error(`Jupiter swap build failed: ${swapRes.status} ${await swapRes.text()}`);
  const { swapTransaction } = await swapRes.json();

  const txBytes = Buffer.from(swapTransaction, "base64");
  return sendAndConfirm(txBytes, wallet.seed);
}

// ── Public API ────────────────────────────────────────────────────────────────

async function buyToken(mint, usdcAmount = REAL_TRADE_USDC, liquidity = 0) {
  if (liquidity > 0 && liquidity < MIN_LIQUIDITY_REAL) {
    throw new Error(`Liquidity $${liquidity} below minimum $${MIN_LIQUIDITY_REAL}`);
  }
  const usdcRaw        = Math.floor(usdcAmount * 1_000_000);
  const quote          = await getQuote(USDC_MINT, mint, usdcRaw);
  // outAmount is in the token's smallest unit; assume 6 decimals (Solana USDC-paired memes)
  // This value is stored and passed back to sellToken which uses the same 6-decimal assumption,
  // so the sell raw amount is always correct regardless of actual token decimals.
  const tokensReceived = parseInt(quote.outAmount) / 1_000_000;
  const actualPrice    = usdcAmount / tokensReceived;
  const txSig          = await executeSwap(quote);
  return { txSig, tokensReceived, usdcSpent: usdcAmount, actualPrice };
}

async function sellToken(mint, tokenAmount = 0, decimals = 6) {
  let amount = tokenAmount;
  if (!amount || amount <= 0) {
    amount = await getTokenBalance(mint);
    if (!amount || amount <= 0) throw new Error(`No ${mint} balance to sell`);
  }
  const tokenRaw     = Math.floor(amount * Math.pow(10, decimals));
  const quote        = await getQuote(mint, USDC_MINT, tokenRaw);
  const usdcReceived = parseInt(quote.outAmount) / 1_000_000;
  const actualPrice  = usdcReceived / amount;
  const txSig        = await executeSwap(quote);
  return { txSig, usdcReceived, actualPrice };
}

module.exports = {
  getWallet, getWalletBalances, getTokenBalance,
  buyToken, sellToken,
  REAL_TRADE_USDC, MIN_LIQUIDITY_REAL,
};
