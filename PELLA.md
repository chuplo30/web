# Deploy 8xms on Pella (Express)

1. pella.app → New → **Express JS**
2. Upload this folder (or connect Git with these files)
3. Install: `npm install` (Pella usually runs this)
4. Start: `npm start`  (runs `node server.js`)
5. Open site → Obfuscate uses `POST /api/obfuscate` (Clyde RegVM Max on Node)

Health: `GET /api/health`
