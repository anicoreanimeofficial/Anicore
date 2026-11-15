# Anicore

Anime catalogue & streaming backend for **anicoreanimes.online** — serves the API, the static site, and uploaded media from a single Cloudflare Worker.

Stack: **Worker** (API + static assets) · **D1** (SQLite database & uploaded blobs) · **Cloudflare Workers Paid** plan. No Render, no MongoDB.

## Features

- **Content management** for `anime`, `tv_show` and `movie` with seasons/episodes, quality links, subtitles, posters, banners, ratings and scheduling (`published` / `scheduled_at`).
- **Auth & accounts** — PBKDF2 password hashing, HMAC-signed JWT session cookies, failed-sign-in rate limiting + lockouts, banned accounts, admin/uploader roles, moderation log, notifications and watchlists.
- **Media** — uploads (posters, avatars, backgrounds, ~1.3MB each) stored in the D1 `blobs` table and served from `/assets/uploads/...`.
- **Notifications** — new-episode alerts (watchlist) and admin activity; daily cron purges old notifications, expired trash and stale login failures.

## Tech

- [Hono](https://hono.dev) on Cloudflare Workers (`src/index.ts`)
- Cloudflare D1 database (`src/db.ts`), migrations in `migrations/`
- WebCrypto (PBKDF2 / HMAC-SHA256 / JWT) in `src/lib.ts`
- Static frontend in `public/`, API in `src/routes/`

## Getting started

```bash
npm install
npx wrangler login
```

## Local development

```bash
cp .dev.vars.example .dev.vars   # set a SECRET_KEY (32+ chars) — required, ENVIRONMENT is production in wrangler.jsonc
npm run db:migrate:local
npm run dev
```

## Database migrations

```bash
npm run db:migrate          # remote (D1 production)
npm run db:migrate:local    # local
npm run typecheck
```

## Deploy

```bash
npm run deploy
```

Full deployment walkthrough (secrets, D1 setup, custom domain): [DEPLOY.md](./DEPLOY.md).

## Configuration

| Variable | Purpose |
| --- | --- |
| `SECRET_KEY` | JWT signing key (48+ random chars) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin credentials (seeded on first run) |
| `TELEGRAM_BOT_TOKEN` | Optional bot notifications |
| `WEBHOOK_URL` | Optional external webhook |
| `GOOGLE_API_KEY` | Optional Gemini key for Bulk Add naming/descriptions |

Optional Worker vars: `ENVIRONMENT`, `APP_NAME`, `SITE_URL`, `ENABLE_AI_RECAPS`, `GEMINI_MODEL`.
