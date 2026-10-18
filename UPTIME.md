# UptimeRobot + Flask

```bash
pip install -r requirements.txt
# Node 18+ required for /api/obfuscate
npm install   # express still available via: npm start
python3 app.py
# or: PORT=8080 python3 app.py
```

UptimeRobot HTTP(s) monitor:
- URL: `https://YOUR_HOST/api/health`  (or `/health` / `/ping`)
- Keyword: `"ok":true` optional
- Interval: 5 min

Express alternative: `npm start` → same `/api/health`.
