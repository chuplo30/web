# UptimeRobot + Flask (Render)

```bash
pip install -r requirements.txt
npm install   # node for /api/obfuscate
python3 app.py
# default PORT=10000  (Render sets $PORT automatically)
```

UptimeRobot:
- URL: `https://YOUR_RENDER_URL/api/health`
- or `/health` / `/ping`
- Interval: 5 min

Local:
```bash
PORT=10000 python3 app.py
```
