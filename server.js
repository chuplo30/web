/**
 * 8xms Obfuscate — Express (Pella / any Node host)
 * Static UI + POST /api/obfuscate (Clyde RegVM Max on server)
 */
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { obfuscate } from './js/obfuscate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.text({ type: ['text/plain', 'application/lua'], limit: '8mb' }));

// API first
app.post('/api/obfuscate', (req, res) => {
  try {
    let code = '';
    if (typeof req.body === 'string') code = req.body;
    else if (req.body && typeof req.body === 'object') {
      code = req.body.code || req.body.source || '';
    }
    if (!String(code).trim()) {
      return res.status(400).json({ ok: false, error: 'empty code' });
    }
    const result = obfuscate(code);
    return res.json({
      ok: true,
      code: result.code,
      meta: result.meta,
    });
  } catch (e) {
    console.error('[8xms] obfuscate error:', e);
    return res.status(500).json({
      ok: false,
      error: String(e && e.message ? e.message : e),
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: '8xms', runtime: 'express' });
});

// Static site (index, css, js, clyde modules for optional client)
app.use(express.static(__dirname, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    }
  },
}));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[8xms] Express listening on :${PORT}`);
  console.log(`[8xms] POST /api/obfuscate  GET /api/health`);
});
