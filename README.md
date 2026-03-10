# Crypto Outlook Lab

Simple educational crypto dashboard built as a static app.

## What it shows

- Live `TOKEN/USDT` price chart
- Support and resistance zones
- Technical analysis signals
- Large-trade flow as a smart-money proxy
- Order-book whale walls
- Funding and open-interest positioning
- Major crypto headlines
- Rule-based 5H to 24H outlook

## Run it

Serve the folder over HTTP so browser API requests work cleanly:

```bash
python3 -m http.server 4173
```

Then open [http://localhost:4173](http://localhost:4173).

## Notes

- The dashboard assumes a Binance spot pair in the format `TOKENUSDT`.
- Funding and some positioning data only appear for tokens that also trade on Binance perpetual futures.
- News uses CryptoCompare headlines when available.
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

### Render

This repo includes a root-level `render.yaml` Blueprint for a static site.

1. In Render, create a new Blueprint or Static Site from your GitHub repo.
2. If you use the Blueprint flow, Render will read `render.yaml` automatically.
3. If you use the Static Site UI instead, use:
   - Build Command: `echo 'No build step required'`
   - Publish Directory: `.`

### Vercel

1. Import the GitHub repository in Vercel.
2. Set Framework Preset to `Other`.
3. Override Build Command and leave it empty.
4. Keep the root directory as the repo root.
5. Leave Output Directory at its default unless you choose to override it later.
