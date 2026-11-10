# Deploy Anicore on Cloudflare only

Stack: **Worker** (API + site) · **D1** (database) · **D1** (uploaded images too) · custom domain.
No Render, no MongoDB.

## 1. Install
```bash
npm install
npx wrangler login
```

## 2. Create the database and bucket
```bash
npx wrangler d1 create anicore          # copy the database_id it prints
```
Paste the `database_id` into `wrangler.jsonc` (replace `PASTE_DATABASE_ID_HERE`).

## 3. Create the tables
```bash
npm run db:migrate
```

## 4. Set secrets
```bash
npx wrangler secret put SECRET_KEY        # 48+ random characters
npx wrangler secret put ADMIN_EMAIL       # your admin login email
npx wrangler secret put ADMIN_PASSWORD    # your admin password
# optional
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put WEBHOOK_URL
npx wrangler secret put GOOGLE_API_KEY   # Gemini key: fills episode names/descriptions in Bulk Add
```
Generate a key: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

## 5. Deploy
```bash
npm run deploy
```
You get a `https://anicore.<your-subdomain>.workers.dev` URL. Open it and sign in with the admin email/password
(the admin account is created automatically on the first request).

## 6. Connect your domain
1. Add the domain to Cloudflare (Add a site) and switch the nameservers at your registrar. Wait for **Active**.
2. Workers & Pages → **anicore** → Settings → **Domains & Routes** → **Add** → *Custom domain* → `yourdomain.com`
   (add `www.yourdomain.com` too).
3. SSL/TLS → set to **Full (strict)**, and turn on **Always Use HTTPS**.

## Local testing
```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

## Notes
- **Use the Workers Paid plan ($5/mo)** for a public site. Password hashing (PBKDF2) can exceed the Free plan's
  10 ms CPU limit; D1/Workers request limits are also much higher.
- Old accounts and catalogue from MongoDB are **not** copied. Start fresh, or ask for an export/import script.
- Old password hashes (scrypt) are not compatible, so existing users would need to reset or re-register.
- Notifications older than 90 days are deleted by a daily cron (replaces MongoDB's TTL index).
- Uploads (posters, avatars, backgrounds, max ~1.3MB each) live in D1 and are served from `/assets/uploads/...`.
