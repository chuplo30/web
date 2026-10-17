/**
 * WAN ← Catph CustomVM bridge
 * Runs full Catph CustomVM (100% their compiler/VM/emit), then only:
 *  - WAN anti-tamper (optional)
 *  - WAN branding
 *  - optional setmetatable commercial shell
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CATPH_ROOT = path.join(ROOT, 'catph');
const RUNNER = path.join(CATPH_ROOT, 'run_wan_vm.lua');

function findLua() {
  const candidates = [
    path.join(ROOT, 'tools', 'lua54'),
    process.env.LUA_BIN,
    'lua5.4',
    'lua5.1',
    'lua',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (c.includes('/') || c.includes('\\')) {
        if (!fs.existsSync(c)) continue;
        try { fs.chmodSync(c, 0o755); } catch (_) {}
      }
      const r = spawnSync(c, ['-e', 'print(1)'], { encoding: 'utf8', timeout: 5000 });
      if (r.status === 0 && String(r.stdout).includes('1')) return c;
    } catch (_) {}
  }
  return null;
}

export function catphAvailable() {
  return !!(findLua() && fs.existsSync(RUNNER) && fs.existsSync(path.join(CATPH_ROOT, 'catph.lua')));
}

/**
 * @param {string} source  full Lua/Luau source (may already include AT)
 * @param {{ preset?: string, debug?: boolean }} opts
 * @returns {{ ok: boolean, code?: string, error?: string, bytes?: number }}
 */
export function runCatphVM(source, opts = {}) {
  const lua = findLua();
  if (!lua) return { ok: false, error: 'lua binary not found' };
  if (!fs.existsSync(RUNNER)) return { ok: false, error: 'catph runner missing' };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wan-cvm-'));
  const inFile = path.join(tmp, 'in.lua');
  const outFile = path.join(tmp, 'out.lua');
  try {
    fs.writeFileSync(inFile, String(source || ''), 'utf8');
    const preset = (opts && opts.preset) || 'customvm_max';
    const r = spawnSync(
      lua,
      [RUNNER, CATPH_ROOT, inFile, outFile, preset],
      {
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 64 * 1024 * 1024,
        cwd: CATPH_ROOT,
      }
    );
    const err = String(r.stderr || '') + String(r.stdout || '');
    if (opts && opts.debug && err.trim()) {
      console.log('[WAN-CVM]', err.trim().slice(0, 500));
    }
    if (!fs.existsSync(outFile)) {
      return { ok: false, error: err.slice(0, 1500) || 'no output' };
    }
    let code = fs.readFileSync(outFile, 'utf8');
    if (!code || code.length < 20) {
      return { ok: false, error: 'empty catph output' };
    }
    // Final brand pass
    code = code
      .replace(/Catph/gi, 'WAN')
      .replace(/CATPH/g, 'WAN')
      .replace(/discord\.gg\/[^\s"']+/g, 'WAN')
      .replace(/-- This File Protected By[^\n]*/g, '-- Protected By WAN OBFUSCATE');
    return { ok: true, code, bytes: code.length };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}
