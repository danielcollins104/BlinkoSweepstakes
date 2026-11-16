# BLINKO: Headline Chaos 2026 (Sweepstakes Social Casino)

Dual-currency (`GC` / `SC`) sweepstakes social casino built around current-events satire with server-authoritative provably fair drops (`HMAC-SHA256`), SHA-256 hash-chained audit ledger, SQLite persistence, and live deposit/payout rails (On-Chain Crypto, Cash App `$Cashtag`, Stripe Checkout & Connect, and NMI Collect.js).

## Local Development

```bash
npm install
cp .env.example .env.local
npm run build
npm run server
```

App listens on `http://localhost:3002` (or `npm run dev` for Vite on port `5174`).

## Deploying to Cloudflare Workers & Durable Objects (Git Integration)

This repository includes `wrangler.json` and `server/worker.js` configured for **Cloudflare Workers + SQLite-backed Durable Objects** (`BlinkoCore`, using `new_sqlite_classes` so it works on both Free and Paid plans):

1. In Cloudflare Dashboard, go to **Workers & Pages → Create → Import a repository** and select this GitHub repo.
2. Configure build settings:
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
3. Add encrypted **Secrets / Environment Variables** in Worker Settings:
   - `DC_ADMIN_SECRET` — operator secret key for the `#admin` console
   - `DC_LEDGER_SECRET` — HMAC secret for the audit ledger
   - `DC_SPIN_SIGNING_KEY` — persistent server seed override (optional)
   - `CASHTAG` — Cash App `$Cashtag` receiving handle
   - `CRYPTO_WALLET_BTC`, `CRYPTO_WALLET_ETH`, `CRYPTO_WALLET_SOL`, `CRYPTO_WALLET_USDT_SOL`, `CRYPTO_WALLET_USDT_ERC20`
   - `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (for live Stripe Checkout & payouts)
   - `NMI_SECURITY_KEY`, `NMI_TOKENIZATION_KEY` (optional NMI card rail)
   - `GEO_ENFORCE=true` (recommended in production to enforce US state geo-blocking via `request.cf`)
