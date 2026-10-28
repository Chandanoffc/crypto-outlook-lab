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
const WSOL_MINT             = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM         = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const WALLET_ADDRESS        = "44hG7cY4xoYie1SYZvoSYqAscZM28KSECkdokmm3meKU";
const SOL_TOP_UP_THRESHOLD  = 0.05;  // top up when SOL drops below this
const SOL_TOP_UP_USDC       = 12;    // swap this many USDC → SOL when topping up
// Jupiter endpoints — resolved dynamically so we can inject the Helius API key
// quote-api.jup.ag blocks datacenter IPs; use their public lite API instead
const JUPITER_QUOTE_BASE    = "https://lite-api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_BASE     = "https://lite-api.jup.ag/swap/v1/swap";
const SLIPPAGE_BPS          = 500;
const PRIORITY_FEE_LAMPORTS = 1_000_000; // 0.001 SOL — ensures landing during congestion
const REAL_TRADE_USDC       = 5;
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
    { encoding: "base64", skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" },
  ]);

  // Poll up to 45s — Solana blockhash expires ~28s but priority fee helps land faster
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const result = await rpc("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]);
    const status = result?.value?.[0];
    if (status) {
      if (status.err) throw new Error(`Tx ${sig} failed on-chain: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return sig;
    }
  }
  throw new Error(`Transaction ${sig} not confirmed within 60s — likely expired, will retry`);
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

// ── SOL top-up ────────────────────────────────────────────────────────────────
// Swaps USDC → SOL via Jupiter when wallet SOL drops below threshold.

async function topUpSolIfNeeded() {
  const balances = await getWalletBalances();
  if (balances.sol >= SOL_TOP_UP_THRESHOLD) return null;
  const usdcRaw = Math.floor(SOL_TOP_UP_USDC * 1_000_000);
  const quote   = await getQuote(USDC_MINT, WSOL_MINT, usdcRaw);
  const txSig   = await executeSwap(quote);
  return { txSig, solBefore: balances.sol, usdcSpent: SOL_TOP_UP_USDC };
}

// ── Close empty token accounts (reclaim rent) ─────────────────────────────────
// Each closed account returns ~0.002 SOL. Builds a raw legacy Solana tx
// with a SPL Token closeAccount instruction (opcode 9) — no web3.js needed.

function buildCloseAccountMsg(tokenAccountPubkey, walletAddress, recentBlockhash) {
  const wallet    = fromBase58(walletAddress);
  const tokenAcc  = fromBase58(tokenAccountPubkey);
  const tokenProg = fromBase58(TOKEN_PROGRAM);
  const blockhash = fromBase58(recentBlockhash);

  // Account order: [wallet(signer+writable), tokenAcc(writable), TOKEN_PROGRAM(readonly)]
  // Header: 1 required sig, 0 readonly signed, 1 readonly unsigned
  const header     = Buffer.from([1, 0, 1]);
  const accountKeys = Buffer.concat([Buffer.from(wallet), Buffer.from(tokenAcc), Buffer.from(tokenProg)]);

  // closeAccount instruction: opcode=9, accounts=[tokenAcc(1), dest=wallet(0), auth=wallet(0)]
  const ix = Buffer.concat([
    Buffer.from([2]),       // programIdIndex (TOKEN_PROGRAM at index 2)
    Buffer.from([3]),       // compact_u16: 3 account indices
    Buffer.from([1, 0, 0]), // tokenAcc, wallet(dest), wallet(authority)
    Buffer.from([1]),       // compact_u16: 1 data byte
    Buffer.from([9]),       // closeAccount opcode
  ]);

  return Buffer.concat([
    header,
    Buffer.from([3]),           // compact_u16: 3 account keys
    accountKeys,
    Buffer.from(blockhash),
    Buffer.from([1]),           // compact_u16: 1 instruction
    ix,
  ]);
}

async function closeEmptyTokenAccounts() {
  const wallet = getWallet();
  const result = await rpc("getTokenAccountsByOwner", [
    wallet.address,
    { programId: TOKEN_PROGRAM },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);

  const empty = (result?.value || []).filter(a => {
    const amt = parseFloat(a.account.data.parsed.info.tokenAmount.amount || "0");
    return amt === 0;
  });
  if (!empty.length) return 0;

  const { value: { blockhash } } = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);

  let closed = 0;
  for (const acc of empty) {
    try {
      const msg    = buildCloseAccountMsg(acc.pubkey, wallet.address, blockhash);
      // Wrap in legacy tx wire format: compact_u16(1 sig) + 64 zero bytes + message
      const tx     = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), msg]);
      const signed = signAndSerialize(tx, wallet.seed);
      await rpc("sendTransaction", [signed.toString("base64"), { encoding: "base64", skipPreflight: false, maxRetries: 2 }]);
      closed++;
    } catch (_) { /* skip failed — will retry next daily run */ }
  }
  return closed;
}

module.exports = {
  getWallet, getWalletBalances, getTokenBalance,
  buyToken, sellToken, topUpSolIfNeeded, closeEmptyTokenAccounts,
  REAL_TRADE_USDC, MIN_LIQUIDITY_REAL,
};
