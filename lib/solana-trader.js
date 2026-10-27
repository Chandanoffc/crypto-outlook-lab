"use strict";
/**
 * solana-trader.js — real on-chain execution via Jupiter + Helius.
 *
 * USDC (EPjFWdd5…) is the base currency for all trades.
 * Private key lives in TRADING_WALLET_PRIVKEY (base58, 64-byte secret key).
 * RPC: Helius (already have the API key).
 */

const { Connection, Keypair, VersionedTransaction, PublicKey } = require("@solana/web3.js");

const USDC_MINT     = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUPITER_QUOTE = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP  = "https://quote-api.jup.ag/v6/swap";

const SLIPPAGE_BPS          = 500;   // 5% — needed for meme coins
const PRIORITY_FEE_LAMPORTS = 100_000; // ~$0.002 priority for fast landing
const REAL_TRADE_USDC       = 10;    // $10 per trade (10% of $100)
const MIN_LIQUIDITY_REAL    = 8_000; // min $8K liquidity to execute real trade

// ── Base58 decode (no extra dependency) ──────────────────────────────────────

function fromBase58(str) {
  const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of str) {
    const i = ALPHA.indexOf(c);
    if (i < 0) throw new Error(`Invalid base58 char: ${c}`);
    n = n * 58n + BigInt(i);
  }
  // pad to 64 bytes (512 bits)
  const hex = n.toString(16).padStart(128, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

// ── Wallet + connection ───────────────────────────────────────────────────────

function getWallet() {
  const raw = String(process.env.TRADING_WALLET_PRIVKEY || "").trim();
  if (!raw) throw new Error("TRADING_WALLET_PRIVKEY env var not set");
  return Keypair.fromSecretKey(fromBase58(raw));
}

function getConnection() {
  const key = String(process.env.HELIUS_API_KEY || "").trim();
  const url = key
    ? `https://mainnet.helius-rpc.com/?api-key=${key}`
    : "https://api.mainnet-beta.solana.com";
  return new Connection(url, "confirmed");
}

// ── Balances ──────────────────────────────────────────────────────────────────

// Use direct JSON-RPC for read-only balance checks — more reliable in serverless
async function rpc(method, params) {
  const key = String(process.env.HELIUS_API_KEY || "").trim();
  const url  = key
    ? `https://mainnet.helius-rpc.com/?api-key=${key}`
    : "https://api.mainnet-beta.solana.com";
  const r = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const d = await r.json();
  if (d.error) throw new Error(`RPC ${method}: ${d.error.message}`);
  return d.result;
}

const WALLET_ADDRESS = "44hG7cY4xoYie1SYZvoSYqAscZM28KSECkdokmm3meKU";

async function getWalletBalances() {
  // Use known public address — no private key needed for reads
  const address = process.env.TRADING_WALLET_ADDRESS || WALLET_ADDRESS;

  const [solResult, tokenResult] = await Promise.all([
    rpc("getBalance", [address, { commitment: "confirmed" }]),
    rpc("getTokenAccountsByOwner", [
      address,
      { mint: USDC_MINT },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]),
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

// ── Jupiter quote + swap ──────────────────────────────────────────────────────

async function getQuote(inputMint, outputMint, amountRaw) {
  const url = `${JUPITER_QUOTE}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&slippageBps=${SLIPPAGE_BPS}&onlyDirectRoutes=false`;
  const r   = await fetch(url);
  if (!r.ok) throw new Error(`Jupiter quote failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function executeSwap(quote) {
  const wallet = getWallet();
  const conn   = getConnection();

  // Build swap transaction
  const swapRes = await fetch(JUPITER_SWAP, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse:              quote,
      userPublicKey:              wallet.publicKey.toBase58(),
      wrapAndUnwrapSol:           true,
      dynamicComputeUnitLimit:    true,
      prioritizationFeeLamports:  PRIORITY_FEE_LAMPORTS,
    }),
  });
  if (!swapRes.ok) throw new Error(`Jupiter swap build failed: ${swapRes.status} ${await swapRes.text()}`);
  const { swapTransaction } = await swapRes.json();

  // Deserialize, sign, send
  const txBuf = Buffer.from(swapTransaction, "base64");
  const tx    = VersionedTransaction.deserialize(txBuf);
  tx.sign([wallet]);

  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight:       false,
    maxRetries:          3,
    preflightCommitment: "confirmed",
  });

  // Wait for confirmation (max 30s)
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

  return sig;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Buy a meme token with USDC.
 * @param {string} mint - token mint address
 * @param {number} usdcAmount - USDC to spend (default REAL_TRADE_USDC)
 * @param {number} liquidity - token's current liquidity in USD (safety check)
 * @returns {{ txSig, tokensReceived, usdcSpent, actualPrice }}
 */
async function buyToken(mint, usdcAmount = REAL_TRADE_USDC, liquidity = 0) {
  if (liquidity > 0 && liquidity < MIN_LIQUIDITY_REAL) {
    throw new Error(`Liquidity $${liquidity} below minimum $${MIN_LIQUIDITY_REAL} — skipping real trade`);
  }

  // USDC has 6 decimals
  const usdcRaw = Math.floor(usdcAmount * 1_000_000);
  const quote   = await getQuote(USDC_MINT, mint, usdcRaw);

  const outDecimals     = parseInt(quote.outputDecimals ?? 6);
  const outAmountRaw    = parseInt(quote.outAmount);
  const tokensReceived  = outAmountRaw / Math.pow(10, outDecimals);
  const actualPrice     = usdcAmount / tokensReceived;

  const txSig = await executeSwap(quote);
  return { txSig, tokensReceived, usdcSpent: usdcAmount, actualPrice };
}

/**
 * Sell meme tokens back to USDC.
 * @param {string} mint - token mint address
 * @param {number} tokenAmount - tokens to sell (pass 0 to sell entire wallet balance)
 * @param {number} decimals - token decimals (default 6)
 * @returns {{ txSig, usdcReceived, actualPrice }}
 */
async function sellToken(mint, tokenAmount = 0, decimals = 6) {
  // If tokenAmount not provided, sell the entire balance
  let amount = tokenAmount;
  if (!amount || amount <= 0) {
    amount = await getTokenBalance(mint);
    if (!amount || amount <= 0) throw new Error(`No ${mint} balance to sell`);
  }

  const tokenRaw    = Math.floor(amount * Math.pow(10, decimals));
  const quote       = await getQuote(mint, USDC_MINT, tokenRaw);
  const usdcRaw     = parseInt(quote.outAmount);
  const usdcReceived = usdcRaw / 1_000_000;
  const actualPrice  = usdcReceived / amount;

  const txSig = await executeSwap(quote);
  return { txSig, usdcReceived, actualPrice };
}

module.exports = {
  getWallet, getWalletBalances, getTokenBalance,
  buyToken, sellToken,
  REAL_TRADE_USDC, MIN_LIQUIDITY_REAL,
};
