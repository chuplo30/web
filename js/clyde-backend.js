/**
 * Clyde Register VM — Max grade (same path as Cypher Register+Max).
 * Pure JS (after fs stub). Browser + Netlify.
 */
import { lex } from '../clyde/lexer/Lexer.js';
import { parse } from '../clyde/parser/Parser.js';
import { obfuscate as clydeObfuscate } from '../clyde/obfuscator/Obfuscator.js';
import { scrambleControlFlow } from '../clyde/obfuscator/ControlFlowScrambler.js';
import { encodeStrings } from '../clyde/obfuscator/StringEncoder.js';
import { regCompile } from '../clyde/vm/RegCompiler.js';
import { generateRegVM } from '../clyde/vm/reg-vm-gen.js';

export function clydeAvailable() {
  return typeof lex === 'function' && typeof generateRegVM === 'function';
}

function serChunk(c) {
  return {
    K: c.K || [],
    code: c.code || [],
    nInstructions: c.nInstructions || ((c.code || []).length / 4) | 0,
    maxRegs: c.maxRegs || 0,
    nParams: c.nParams || 0,
    isVararg: !!c.isVararg,
    upvalues: c.upvalues || [],
    protos: (c.protos || []).map(serChunk),
  };
}

/** Bytecode only (legacy) */
export function compileClydeChunk(source, opts = {}) {
  try {
    const src = String(source || '');
    const { tokens, errors } = lex(src);
    if (errors && errors.length) {
      return { ok: false, error: errors.map((e) => e.message || String(e)).join('; ') };
    }
    const ast = parse(tokens);
    // Minify-rename
    let ob = clydeObfuscate(ast, { renameLocals: true, preserveGlobals: true, seed: opts.seed || (Date.now() % 2147483647) });
    // Control-flow Clyde full (opaque predicates on if/while/repeat)
    if (!(opts && opts.noCF)) {
      ob = scrambleControlFlow(ob, { enabled: true, seed: opts.seed || (Date.now() % 2147483647) });
    }
    // String encode OFF by default (decoder fragile under custom VM); enable opts.strEnc
    if (opts && opts.strEnc) {
      try {
        ob = encodeStrings(ob, { enabled: true, key: ((opts.seed || Date.now()) & 0xff) || 0x5A });
      } catch (_) {}
    }
    const chunk = regCompile(ob);
    return { ok: true, chunk: serChunk(chunk), meta: { insts: serChunk(chunk).nInstructions, backend: 'clyde-cf-max' } };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/**
 * Full Register VM Max — same as Cypher: regCompile + generateRegVM(level=max).
 * Returns ready-to-run Lua (Clyde blob bootstrap, no banner).
 */
export function compileClydeRegVMMax(source, opts = {}) {
  try {
    const src = String(source || '');
    const { tokens, errors } = lex(src);
    if (errors && errors.length) {
      return { ok: false, error: errors.map((e) => e.message || String(e)).join('; ') };
    }
    const ast = parse(tokens);
    const ob = clydeObfuscate(ast, {
      renameLocals: true,
      preserveGlobals: true,
      // align with Cypher advanced transforms when available
    });
    const chunk = regCompile(ob);
    const lua = generateRegVM(chunk, {
      level: 'max',
      _noWatermark: true,
      executorGlobals: true,
      polymorphicSeed: opts.seed || (Date.now() % 2147483647),
    });
    // Strip any residual Clyde banner / art
    let out = String(lua || '');
    out = out.replace(/^--[[\s*[\s\S]*?ClydeProtection[\s\S]*?]]\s*/i, '');
    // WAN brand strip
    out = out.replace(/ClydeProtection/gi, 'WAN');
    out = out.replace(/Clyde Protection/gi, 'WAN');
    out = out.replace(/clydeprotectionde\.cloud/gi, 'wan');
    out = out.replace(/\bClyde\b/g, 'WAN');
    out = out.replace(/^--\[\[\s*[\s\S]*?clydeprotection[\s\S]*?\]\]\s*/i, '');
    out = out.replace(/https:\/\/clydeprotectionde\.cloud[^\n]*/gi, '');
    // Flatten leftover newlines from watermark path if any
    if (out.includes('\n') && out.length < 5_000_000) {
      const lines = out.split('\n').filter((l) => l.trim().length > 0);
      // keep structure if bootstrap is multi-line and huge — only flatten if small header
      if (lines.length < 30) out = lines.join(' ');
    }
    return {
      ok: true,
      lua: out,
      meta: {
        insts: (chunk.code || []).length / 4,
        constants: (chunk.K || []).length,
        protos: (chunk.protos || []).length,
        maxRegs: chunk.maxRegs,
        backend: 'clyde-regvm-max',
        level: 'max',
        bytes: out.length,
      },
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}
