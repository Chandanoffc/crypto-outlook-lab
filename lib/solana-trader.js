"use strict";
/**
 * solana-trader.js — real on-chain execution via Jupiter + Helius.
 *
 * Intentionally avoids `new Connection()` from @solana/web3.js to prevent
 * the rpc-websockets → uuid ESM crash on Vercel. All RPC calls use plain fetch.
 * Only Keypair (signing) and VersionedTransaction (deserialize) are used from SDK.
 */

const { Keypair, VersionedTransaction } = require("@solana/web3.js");

const USDC_MINT             = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WALLET_ADDRESS        = "44hG7cY4xoYie1SYZvoSYqAscZM28KSECkdokmm3meKU";
const JUPITER_QUOTE         = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP          = "https://quote-api.jup.ag/v6/swap";
const SLIPPAGE_BPS          = 500;
const PRIORITY_FEE_LAMPORTS = 100_000;
const REAL_TRADE_USDC       = 10;
const MIN_LIQUIDITY_REAL    = 8_000;

// ── Base58 decode ─────────────────────────────────────────────────────────────

function fromBase58(str) {
  const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of str) {
    const i = ALPHA.indexOf(c);
    if (i < 0) throw new Error(`Invalid base58 char: ${c}`);
    n = n * 58n + BigInt(i);
  }
  const hex = n.toString(16).padStart(128, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

// ── Wallet ────────────────────────────────────────────────────────────────────

function getWallet() {
  const raw = String(process.env.TRADING_WALLET_PRIVKEY || "").trim();
  if (!raw) throw new Error("TRADING_WALLET_PRIVKEY env var not set");
  return Keypair.fromSecretKey(fromBase58(raw));
}

// ── Helius JSON-RPC (plain fetch — no Connection/WebSocket) ──────────────────

function rpcUrl() {
  const key = String(process.env.HELIUS_API_KEY || "").trim();
  return key
    ? `https://mainnet.helius-rpc.com/?api-key=${key}`
    : "https://api.mainnet-beta.solana.com";
}

async function rpc(method, params) {
  const r = await fetch(rpcUrl(), {
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
  const wallet = getWallet();
  const result = await rpc("getTokenAccountsByOwner", [
    wallet.publicKey.toBase58(),
    { mint: mintAddress },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  const accounts = result?.value || [];
  if (!accounts.length) return 0;
  return parseFloat(accounts[0].account.data.parsed.info.tokenAmount.uiAmount || 0);
}

// ── Transaction send + confirm via fetch ──────────────────────────────────────

async function sendAndConfirm(tx) {
  const serialized = Buffer.from(tx.serialize()).toString("base64");

  // Send
  const sig = await rpc("sendTransaction", [
    serialized,
    { encoding: "base64", skipPreflight: false, maxRetries: 3, preflightCommitment: "confirmed" },
  ]);

  // Confirm — poll getSignatureStatuses up to 60s
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const result = await rpc("getSignatureStatuses", [[sig], { searchTransactionHistory: false }]);
    const status = result?.value?.[0];
    if (status) {
      if (status.err) throw new Error(`Tx ${sig} failed on-chain: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return sig;
    }
  }
  // Timed out — return sig anyway, tx likely landed
  return sig;
}

// ── Jupiter quote + swap ──────────────────────────────────────────────────────

async function getQuote(inputMint, outputMint, amountRaw) {
  const url = `${JUPITER_QUOTE}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&slippageBps=${SLIPPAGE_BPS}&onlyDirectRoutes=false`;
  const r   = await fetch(url);
  if (!r.ok) throw new Error(`Jupiter quote failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function executeSwap(quote) {
  const wallet = getWallet();

  const swapRes = await fetch(JUPITER_SWAP, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse:             quote,
      userPublicKey:             wallet.publicKey.toBase58(),
      wrapAndUnwrapSol:          true,
      dynamicComputeUnitLimit:   true,
      prioritizationFeeLamports: PRIORITY_FEE_LAMPORTS,
    }),
  });
  if (!swapRes.ok) throw new Error(`Jupiter swap build failed: ${swapRes.status} ${await swapRes.text()}`);
  const { swapTransaction } = await swapRes.json();

  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  tx.sign([wallet]);

  return sendAndConfirm(tx);
}

// ── Public API ────────────────────────────────────────────────────────────────

async function buyToken(mint, usdcAmount = REAL_TRADE_USDC, liquidity = 0) {
  if (liquidity > 0 && liquidity < MIN_LIQUIDITY_REAL) {
    throw new Error(`Liquidity $${liquidity} below minimum $${MIN_LIQUIDITY_REAL}`);
  }
  const usdcRaw      = Math.floor(usdcAmount * 1_000_000);
  const quote        = await getQuote(USDC_MINT, mint, usdcRaw);
  const outDecimals  = parseInt(quote.outputDecimals ?? 6);
  const tokensReceived = parseInt(quote.outAmount) / Math.pow(10, outDecimals);
  const actualPrice  = usdcAmount / tokensReceived;
  const txSig        = await executeSwap(quote);
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
