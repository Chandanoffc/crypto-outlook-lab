# Apex Signals

Educational crypto dashboard built for perpetual futures analysis on Vercel.

## What it shows

- Live Binance perpetual chart
- Support and resistance zones
- Technical analysis signals
- Futures CVD, taker flow, and order-book imbalance
- Order-book whale walls
- Funding and open-interest positioning
- Liquidation tape and squeeze pressure
- Rule-based trade setup scoring
- Major crypto headlines
- Rule-based 5H to 24H outlook

## Run it

This app now uses a Vercel Function at `/api/market`, so a plain static server is no longer enough.

```bash
vercel dev
```

Then open the local URL Vercel prints, usually [http://localhost:3000](http://localhost:3000).

## Notes

- The dashboard resolves tokens against Binance USDT perpetual futures, not spot.
- Tokens like `PEPE` may resolve to the actual perp contract symbol, such as `1000PEPEUSDT`.
- News uses CryptoCompare headlines when available.
- Live updates come from Binance futures WebSocket streams.
- This is an educational dashboard, not trading advice.

## Deploy

### GitHub

1. Create a new empty GitHub repository without adding a README, `.gitignore`, or license.
2. From this folder, run:

```bash
git add .
git commit -m "Initial commit"
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

### Vercel

1. Import the GitHub repository in Vercel.
2. Set Framework Preset to `Other`.
3. Leave Build Command empty.
4. Keep the root directory as the repo root.
5. Leave Output Directory at its default unless you choose to override it later.
