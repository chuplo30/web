/**
 * WAN Obfuscate — Express (Pella / any Node host)
 * Static UI + POST /api/obfuscate
 * Default: full pack xor20+hex+xor20+base94 + VM + setmetatable shell (no loadstring)
 */
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { obfuscate } from './js/obfuscate.js';
import { validateLuau } from './js/clyde-backend.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.text({ type: ['text/plain', 'application/lua'], limit: '8mb' }));

/** Always-on pack / VM options for web + API */
function buildOpts(body) {
  const o = (body && typeof body === 'object') ? { ...body } : {};
  // Force full WAN output (pack + setmetatable shell). Never disable pack on web.
  delete o.noPack;
  delete o.useCatph; // Catph emit breaks loadstring / wrong shell
  o.noCatph = true;
  // AT + anti-hook always on unless client sets noAT:true / at:false
  if (o.at === false || o.noAT === true) o.noAT = true;
  else o.noAT = false;
  if (o.debug === undefined) o.debug = false;
  return o;
}

app.post('/api/obfuscate', (req, res) => {
  try {
    let code = '';
    let bodyOpts = {};
    if (typeof req.body === 'string') code = req.body;
    else if (req.body && typeof req.body === 'object') {
      code = req.body.code || req.body.source || '';
      bodyOpts = req.body;
    }
    if (!String(code).trim()) {
      return res.status(400).json({ ok: false, error: 'empty code' });
    }
    const syn = validateLuau(code);
    if (!syn.ok) {
      return res.status(400).json({ ok: false, error: 'syntax: ' + (syn.error || 'invalid Luau'), syntax: false });
    }
    const opts = buildOpts(bodyOpts);
    const result = obfuscate(code, opts);
    return res.json({
      ok: true,
      code: result.code,
      meta: result.meta,
    });
  } catch (e) {
    console.error('[WAN] obfuscate error:', e);
    return res.status(500).json({
      ok: false,
      error: String(e && e.message ? e.message : e),
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'wan-obfuscate', runtime: 'express', pack: 'xor20-hex-xor20-base94' });
});

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
  console.log(`[WAN] Express listening on :${PORT}`);
  console.log(`[WAN] POST /api/obfuscate  GET /api/health  pack=FULL default`);
});
