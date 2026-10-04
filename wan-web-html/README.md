# WAN Paste (HTML + Vercel API)

## Files
- `public/index.html` — main UI (black night)
- `public/claim.html` — credit claim page
- `public/style.css` / `app.js`
- `api/*` — serverless upload / raw / claim / bot

## Deploy Vercel
1. Import this folder
2. Root directory = project root
3. Env:
   - `BOT_SECRET`
   - `SITE_URL` = https://xxx.vercel.app
4. Deploy (no build command needed)

Bot must use same paths:
- create claim: POST `/api/bot-create-claim`
- claims: GET/POST `/api/bot-claims`
