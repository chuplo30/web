/**
 * WAN pack v10
 * Pipeline (NO loadstring):
 *   Luau → 1-char rename → StateMachine/AST light
 *   → AT1 soft + AT2 env (outside VM) + user → Hercules
 *   → Hercules VM (100 real opcodes + emitter)  [VM runs payload]
 *   → outer: anti-debug shell + fake CF + fake opcodes + ~20KB junk
 *   → 1-line setmetatable commercial shell
 * All AT inside VM bytecode. Outer never uses loadstring.
 */
import {
  randInt, multiLayerEncode, encode20, makeKey20, luaLongWrap,
  generateOuterJunk, randJunkStrSafe
} from './encode.js';
import { spawnSync } from 'child_process';
import { compileOfficialToVM, luauCompileAvailable } from './luau-official-bc.js';
import { emitVMRuntime } from './vm-runtime.js';
import { packVmData } from './pack-data.js';
import { mangleVmSource } from './vm-runtime.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AT_STAGE_ENVCRACK, AT_STAGE_STRONG, AT_STAGE_SOFT_HOOK } from './at-stages.js';
import { compileToVM } from './vm-compiler.js';
import { catphAvailable, runCatphVM } from './catph-backend.js';

function rv() {
  // single-letter names only (a-z A-Z), cycle with rare digit suffix avoided
  if (!rv._pool || rv._i >= rv._pool.length) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const arr = chars.split('');
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    rv._pool = arr;
    rv._i = 0;
  }
  return rv._pool[rv._i++];
}
function rvMany(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(rv());
  return out;
}

function stripLuaComments(src) {
  // Longstring / quote aware — never strip inside strings (base94 packs)
  src = String(src || '');
  let out = '', i = 0, n = src.length;
  while (i < n) {
    if (src[i] === '-' && src[i + 1] === '-') {
      // long comment --[=[...]=]
      if (src[i + 2] === '[') {
        const mm = src.slice(i + 2).match(/^\[(=*)\[/);
        if (mm) {
          const close = ']' + mm[1] + ']';
          const j = src.indexOf(close, i + 2 + mm[0].length);
          if (j !== -1) { i = j + close.length; continue; }
        }
      }
      // line comment
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (src[i] === '[') {
      const mm = src.slice(i).match(/^\[(=*)\[/);
      if (mm) {
        const close = ']' + mm[1] + ']';
        const j = src.indexOf(close, i + mm[0].length);
        if (j !== -1) {
          out += src.slice(i, j + close.length);
          i = j + close.length;
          continue;
        }
      }
    }
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      out += q; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += src[i]; i++;
  }
  return out;
}


function lowerLuau(src) {
  src = String(src || '');
  function mapCode(transform) {
    let out = '', i = 0, n = src.length;
    while (i < n) {
      if (src[i] === '-' && src[i + 1] === '-') {
        if (src[i + 2] === '[') {
          const mm = src.slice(i + 2).match(/^\[(=*)\[/);
          if (mm) {
            const close = ']' + mm[1] + ']';
            const j = src.indexOf(close, i + 2 + mm[0].length);
            if (j !== -1) { out += src.slice(i, j + close.length); i = j + close.length; continue; }
          }
        }
        const start = i;
        while (i < n && src[i] !== '\n') i++;
        out += src.slice(start, i);
        continue;
      }
      if (src[i] === '[') {
        const mm = src.slice(i).match(/^\[(=*)\[/);
        if (mm) {
          const close = ']' + mm[1] + ']';
          const j = src.indexOf(close, i + mm[0].length);
          if (j !== -1) { out += src.slice(i, j + close.length); i = j + close.length; continue; }
        }
      }
      if (src[i] === '"' || src[i] === "'") {
        const q = src[i];
        out += q; i++;
        while (i < n) {
          if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
          out += src[i];
          if (src[i] === q) { i++; break; }
          i++;
        }
        continue;
      }
      let j = i;
      while (j < n) {
        if (src[j] === '-' && src[j + 1] === '-') break;
        if (src[j] === '"' || src[j] === "'") break;
        if (src[j] === '[') {
          const mm = src.slice(j).match(/^\[(=*)\[/);
          if (mm) break;
        }
        j++;
      }
      out += transform(src.slice(i, j));
      i = j;
    }
    return out;
  }
  src = mapCode((code) => {
    let c = code;
    const pairs = [['+=','+'],['-=','-'],['*=','*'],['/=','/'],['%=','%']];
    for (const [op, base] of pairs) {
      const esc = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(
        '([A-Za-z_][\\w]*(?:\\.[A-Za-z_][\\w]*|\\[[^\\]]+\\])*)\\s*' + esc +
        '\\s*([^\\n;]+?)(?=\\s*(?:\\bend\\b|\\belse\\b|\\belseif\\b|\\buntil\\b|;|$))',
        'gm'
      );
      c = c.replace(re, (_, lhs, rhs) => lhs + ' = ' + lhs + ' ' + base + ' (' + rhs.trim() + ')');
    }
    c = c.replace(
      /([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*|\[[^\]]+\])*)\s*\.\.=\s*([^\n;]+?)(?=\s*(?:\bend\b|\belse\b|\belseif\b|\buntil\b|;|$))/gm,
      (_, lhs, rhs) => lhs + ' = ' + lhs + ' .. (' + rhs.trim() + ')'
    );
    return c;
  });
  src = mapCode((code) => {
    let c = code;
    // Luau type annotations only — NEVER strip method calls (game:GetService)
    // Match ": Type" after locals/params, not "obj:Method("
    c = c.replace(/(\)\s*|\w\s*):\s*\{[^}]*\}(?=\s*[=,;\)\n])/g, '$1');
    c = c.replace(/(\)\s*):\s*[A-Za-z_][\w\.]*(?=\s*[=,;\)\n])/g, '$1');
    // local x: number = ...  or  local x: number
    c = c.replace(/\b(local\s+[A-Za-z_]\w*)\s*:\s*[A-Za-z_][\w\.|]*(?=\s*[=,;\n])/g, '$1');
    c = c.replace(/\bcontinue\b/g, 'do end');
    return c;
  });
  return src;
}

function toOneLinePreserveLongstrings(src) {
  src = String(src || '');
  let out = '', i = 0, n = src.length;
  while (i < n) {
    if (src[i] === '[') {
      const m = src.slice(i).match(/^\[(=*)\[/);
      if (m) {
        const close = ']' + m[1] + ']';
        const j = src.indexOf(close, i + m[0].length);
        if (j === -1) { out += src.slice(i); break; }
        out += src.slice(i, j + close.length);
        i = j + close.length;
        continue;
      }
    }
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      out += q; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (src[i] === '\n' || src[i] === '\r' || src[i] === '\t') {
      out += ' '; i++;
      while (i < n && (src[i] === ' ' || src[i] === '\n' || src[i] === '\r' || src[i] === '\t')) i++;
      continue;
    }
    out += src[i]; i++;
  }
  return out.replace(/ {2,}/g, ' ').trim();
}

function opaqueNum(n) {
  n = n & 255;
  const t = Math.floor(Math.random() * 3);
  if (t === 0) return String(n);
  if (t === 1) { const a = Math.floor(Math.random() * (n + 1)); return '(' + a + '+' + (n - a) + ')'; }
  const a = n + 1 + Math.floor(Math.random() * 30); return '(' + a + '-' + (a - n) + ')';
}

/** Hercules-inspired CF: wrap body in opaque while + state (always runs once). */
/**
 * Split Luau into top-level statement units (depth-aware).
 * Keeps functions / if-blocks / loops intact as one unit.
 */
/**
 * Split Luau into top-level statement units (depth-aware).
 * Depth rules: +1 function|if|do|repeat, -1 end|until
 * (for/while do NOT add depth — their trailing `do` does)
 */
function splitTopLevelStatements(code) {
  const src = String(code || '');
  const units = [];
  let buf = '';
  let depth = 0;
  let i = 0;
  let inS = null;
  let longEq = 0;

  function flush() {
    const t = buf.trim();
    if (t) units.push(t);
    buf = '';
  }

  while (i < src.length) {
    const ch = src[i];
    const nx = src[i + 1];

    if (!inS && ch === '[' && /^=*\[/.test(src.slice(i))) {
      const m = src.slice(i).match(/^\[(=*)\[/);
      longEq = m[1].length;
      inS = 'long';
      buf += m[0];
      i += m[0].length;
      continue;
    }
    if (inS === 'long') {
      const close = ']' + '='.repeat(longEq) + ']';
      if (src.startsWith(close, i)) {
        buf += close; i += close.length; inS = null; continue;
      }
      buf += ch; i++; continue;
    }

    if (!inS && (ch === '"' || ch === "'")) {
      inS = ch; buf += ch; i++; continue;
    }
    if (inS === '"' || inS === "'") {
      if (ch === '\\') { buf += ch + (nx || ''); i += 2; continue; }
      if (ch === inS) inS = null;
      buf += ch; i++; continue;
    }

    if (!inS && ch === '-' && nx === '-') {
      const bm = src.slice(i).match(/^--\[(=*)\[/);
      if (bm) {
        const close = ']' + '='.repeat(bm[1].length) + ']';
        const endPos = src.indexOf(close, i + bm[0].length);
        if (endPos >= 0) { i = endPos + close.length; continue; }
      }
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    if (!inS && /[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const prev = i > 0 ? src[i - 1] : ' ';
      if (!/[a-zA-Z0-9_]/.test(prev)) {
        if (word === 'function' || word === 'if' || word === 'do' || word === 'repeat') depth++;
        else if (word === 'end' || word === 'until') depth = Math.max(0, depth - 1);
      }
      buf += word;
      i = j;
      continue;
    }

    if (!inS && (ch === '\n' || ch === ';')) {
      if (ch === ';') buf += ';';
      else buf += '\n';
      i++;
      if (depth === 0) {
        const t = buf.trim();
        if (t && !/^(else|elseif|then|in)\b/.test(t)) flush();
      }
      continue;
    }

    buf += ch;
    i++;
  }
  flush();
  return units.length ? units : [src.trim()];
}

/**
 * State Machine CF Flatten:
 * each top-level unit → random state id; junk states mixed; while/if-elseif dispatch.
 */
function stripLocalKeyword(unit) {
  let u = unit.replace(/^\s*local\s+function\s+([A-Za-z_][\w]*)\s*\(/m, '$1 = function(');
  u = u.replace(/^\s*local\s+([\w,\s]+)=/m, '$1 =');
  u = u.replace(/^\s*local\s+([A-Za-z_][\w]*)\s*$/m, '$1 = nil');
  return u;
}
function collectHoistedNames(units) {
  const names = [], seen = new Set();
  for (const unit of units) {
    let m = unit.match(/^\s*local\s+function\s+([A-Za-z_][\w]*)/m);
    if (m && !seen.has(m[1])) { seen.add(m[1]); names.push(m[1]); }
    m = unit.match(/^\s*local\s+([\w,\s]+?)(?:\s*=|\s*$)/m);
    if (m && !/^\s*local\s+function/.test(unit)) {
      m[1].split(',').map(x => x.trim()).filter(Boolean).forEach(n => {
        if (/^[A-Za-z_][\w]*$/.test(n) && !seen.has(n)) { seen.add(n); names.push(n); }
      });
    }
  }
  return names;
}

/** Light SM — style _5i99oqo==4564 then ... elseif — keeps locals, few states, safe for BC */
function toStateMachineLight(code) {
  const body = String(code || '').trim();
  if (!body || body.length < 8) return body;

  let units = [];
  try { units = splitTopLevelStatements(body); } catch (_) { units = [body]; }
  if (!units || units.length < 2) {
    const lines = body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) units = lines;
    else return body;
  }
  const MAX = 6;
  if (units.length > MAX) {
    units = units.slice(0, MAX - 1).concat([units.slice(MAX - 1).join('\n')]);
  }

  // HOIST locals across states (required — otherwise later states lose Players/apply)
  const hoisted = collectHoistedNames(units);
  units = units.map((u) => {
    if (/^\s*local\s+function\b/.test(u)) {
      return u.replace(/^\s*local\s+function\s+([A-Za-z_][\w]*)\s*\(/m, '$1 = function(');
    }
    return stripLocalKeyword(u);
  });

  const used = new Set();
  function sid() {
    let n;
    do { n = 1000 + randInt(0, 8000); } while (used.has(n));
    used.add(n);
    return n;
  }
  const realStates = units.map(() => sid());
  const halt = sid();
  const junkStates = [];
  for (let j = 0; j < 2 + randInt(0, 2); j++) junkStates.push(sid());

  const st = '_' + randInt(1, 9) + 'abcdefghijklmnopqrstuvwxyz'[randInt(0, 25)] + randInt(10, 99) +
    'abcdefghijklmnopqrstuvwxyz'[randInt(0, 25)] + 'abcdefghijklmnopqrstuvwxyz'[randInt(0, 25)] + randInt(0, 9);

  const branches = [];
  for (let i = 0; i < units.length; i++) {
    const next = i + 1 < units.length ? realStates[i + 1] : halt;
    branches.push({ id: realStates[i], body: units[i].replace(/;\s*$/, ''), next });
  }
  for (const js of junkStates) branches.push({ id: js, body: 'do local _=0 end', next: halt });
  for (let i = branches.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const tmp = branches[i]; branches[i] = branches[j]; branches[j] = tmp;
  }

  const parts = [];
  if (hoisted.length) parts.push('do local ' + hoisted.join(',') + ' local ' + st + '=' + realStates[0]);
  else parts.push('do local ' + st + '=' + realStates[0]);
  parts.push('while ' + st + ' do');
  for (let bi = 0; bi < branches.length; bi++) {
    const b = branches[bi];
    parts.push((bi === 0 ? 'if ' : 'elseif ') + st + '==' + b.id + ' then');
    parts.push(b.body);
    parts.push(st + '=' + (b.next === halt ? 'nil' : b.next));
  }
  parts.push('else ' + st + '=nil end end end');
  return parts.join('\n');
}

function toStateMachine(code) {

  const body = String(code || '').trim();
  if (!body || body.length < 8) return body;

  let units = splitTopLevelStatements(body);
  // Fallback only if still 1 unit AND no nested blocks: split by blank lines / simple statements
  if (units.length <= 1) {
    // try split on lines that are complete at depth 0 using a simpler line scan
    const lines = body.split('\n');
    const tmp = [];
    let chunk = [];
    let d = 0;
    for (const raw of lines) {
      const ln = raw.trim();
      if (!ln) continue;
      // rough depth on this line only
      const words = ln.match(/\b(function|if|do|repeat|end|until)\b/g) || [];
      for (const w of words) {
        if (w === 'function' || w === 'if' || w === 'do' || w === 'repeat') d++;
        else d = Math.max(0, d - 1);
      }
      chunk.push(raw);
      if (d === 0 && chunk.length) {
        tmp.push(chunk.join('\n'));
        chunk = [];
      }
    }
    if (chunk.length) tmp.push(chunk.join('\n'));
    if (tmp.length > 1) units = tmp;
  }
  if (units.length < 1) return body;
  const hoisted = collectHoistedNames(units);
  // Only strip local var decls; keep "local function" structure for upvalue safety in VM
  units = units.map(u => {
    if (/^\s*local\s+function\b/.test(u)) return u;
    return stripLocalKeyword(u);
  });

  const used = new Set();
  function sid() {
    let n;
    do { n = 100 + randInt(0, 8900); } while (used.has(n));
    used.add(n);
    return n;
  }
  const realStates = units.map(() => sid());
  const halt = sid();
  const junkCount = Math.min(28, 10 + Math.min(units.length * 2, 18));
  const junkStates = [];
  for (let j = 0; j < junkCount; j++) junkStates.push(sid());

  const st = '_' + randInt(1,9) + ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z'][randInt(0,25)] + randInt(10,99) + ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t'][randInt(0,19)] + ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t'][randInt(0,19)] + randInt(0,9);
  const parts = [];
  if (hoisted.length) parts.push('do local ' + hoisted.join(',') + ' local ' + st + '=' + realStates[0]);
  else parts.push('do local ' + st + '=' + realStates[0]);
  parts.push('while ' + st + ' do');

  const branches = [];
  for (let i = 0; i < units.length; i++) {
    const next = (i + 1 < units.length) ? realStates[i + 1] : halt;
    branches.push({ id: realStates[i], body: units[i], next, real: true });
  }
  for (let j = 0; j < junkStates.length; j++) {
    const jn = '_' + ['a','b','c','d','e','f'][j%6] + randInt(10,99);
    const kind = j % 3;
    let jbody;
    if (kind === 0) jbody = 'do local ' + jn + '=' + randInt(1, 90) + ' ' + jn + '=(' + jn + '*3+1)%97 end';
    else if (kind === 1) jbody = 'do local ' + jn + '=' + randInt(2, 50) + ' if ' + jn + '>9999 then ' + jn + '=0 end end';
    else jbody = 'do local ' + jn + '={' + randInt(0,255) + ',' + randInt(0,255) + '} ' + jn + '[1]=(' + jn + '[1]*2)%256 end';
    // CRITICAL: junk must return to a real state (or halt), never pure junk cycle (freezes VM)
    const back = realStates[j % realStates.length];
    branches.push({
      id: junkStates[j],
      body: jbody,
      next: back,
      real: false
    });
  }
  for (let i = branches.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = branches[i]; branches[i] = branches[j]; branches[j] = t;
  }

  for (let i = 0; i < branches.length; i++) {
    const b = branches[i];
    const kw = i === 0 ? 'if' : 'elseif';
    const cond = (Math.random() < 0.3)
      ? (st + '==' + b.id + ' and (' + randInt(2, 9) + '*' + randInt(2, 9) + '~=' + randInt(100, 200) + ' or true)')
      : (st + '==' + b.id);
    parts.push(kw + ' ' + cond + ' then');
    parts.push(b.body);
    if (b.real && b.next === halt) parts.push(st + '=nil');
    else parts.push(st + '=' + b.next);
  }
  parts.push('elseif ' + st + '==' + halt + ' then');
  parts.push(st + '=nil');
  parts.push('else ' + st + '=nil end');
  parts.push('end end');
  return parts.join('\n');
}

function controlFlowScramble(code) {
  return toStateMachine(code);
}

function emitOpcodeTable(parts, count, usedIn) {
  const used = usedIn || new Set();
  const rp = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let s = chars[Math.floor(Math.random() * 52)];
    const len = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 52)];
    return s;
  };
  for (let i = 0; i < count; i++) {
    let k = 1 + Math.floor(Math.random() * 2000);
    while (used.has(k)) k = 1 + Math.floor(Math.random() * 2000);
    used.add(k);
    const kind = i % 10;
    const P = [];
    for (let pi = 0; pi < 11; pi++) P.push(rp());
    if (kind === 0) {
      parts.push('[' + k + ']=function(' + P.slice(0,11).join(',') + ')if ' + P[6] + ' then if ' + P[5] + '<=' + (100 + randInt(0, 50)) + ' then return ' + randInt(1, 160) + ',' + P[1] + ',' + P[4] + ',' + P[7] + ',' + P[10] + ',' + P[3] + ',1+' + P[8] + ' else return ' + randInt(1, 160) + ',' + P[1] + ',' + P[4] + ',' + P[6] + ',' + P[10] + ',' + P[3] + ',' + P[8] + ' end elseif ' + P[5] + '<=' + (145 + randInt(0, 20)) + ' then return ' + randInt(1, 160) + ',' + P[1] + ',' + P[4] + ',' + P[7] + ',' + P[10] + ',' + P[3] + ',' + P[6] + ' elseif ' + P[5] + '<=' + (150 + randInt(0, 20)) + ' then return ' + randInt(1, 160) + ',' + P[1] + ',' + P[4] + '+4,' + P[7] + ',' + P[10] + ',' + P[2] + ',' + P[8] + ' else return ' + randInt(1, 160) + ',{1-' + P[7] + ',' + P[2] + '+0,nil,' + P[1] + ',' + P[7] + '},' + P[4] + ',' + P[5] + ',' + P[6] + ',' + P[3] + ',' + P[8] + ' end end,');
    } else if (kind === 1) {
      parts.push('[' + k + ']=function(' + P.slice(0,7).join(',') + ')if ' + P[6] + '<=1 then if ' + P[6] + '<=0 then return ' + randInt(1, 160) + ',' + P[3] + ',' + P[1] + ',' + P[4] + ' else return ' + randInt(1, 160) + ',' + P[3] + ',' + P[1] + ',' + P[4] + ',' + P[5] + ' end elseif ' + P[6] + '<=2 then return ' + randInt(1, 160) + ',' + P[3] + ',' + P[1] + ',' + P[4] + '+1,' + P[5] + ' elseif ' + P[6] + '<=3 then return ' + randInt(1, 160) + ',' + P[3] + ',' + P[1] + ',' + P[4] + '+4,' + P[5] + ' else return ' + randInt(1, 160) + ',1+' + P[4] + ',' + P[1] + ',' + P[4] + ',' + P[5] + ' end end,');
    } else if (kind === 2) {
      parts.push('[' + k + ']=function(' + P.slice(0,8).join(',') + ')if ' + P[6] + '<=' + randInt(20, 40) + ' then return ' + randInt(1, 40) + ',' + P[2] + ',' + P[4] + ' elseif ' + P[6] + '<=' + randInt(41, 60) + ' then return ' + randInt(1, 40) + ',' + P[2] + ',' + P[4] + ' else return ' + randInt(1, 40) + ',' + P[2] + ',' + P[4] + ' end end,');
    } else if (kind === 3) {
      parts.push('[' + k + ']=function(' + P[0] + ',' + P[1] + ',' + P[2] + ')if ' + P[0] + ' and ' + P[1] + ' and ' + P[0] + '>' + P[1] + '+' + (500 + randInt(0, 800)) + ' then return ' + P[2] + ' end end,');
    } else if (kind === 4) {
      parts.push('[' + k + ']=function(' + P[0] + ',' + P[1] + ',' + P[2] + ')if ' + P[1] + ' then return 12,' + P[2] + ',' + P[0] + ' elseif ' + P[2] + ' then return 40,' + P[0] + ',' + P[1] + ' else return 99,' + P[1] + ',' + P[2] + ' end end,');
    } else if (kind === 5) {
      parts.push('[' + k + ']=function()local z=' + randInt(1, 200) + ';z=z*' + randInt(1, 9) + '%256 end,');
    } else if (kind === 6) {
      parts.push('[' + k + ']=function(' + P[0] + ',' + P[1] + ')return""end,');
    } else if (kind === 7) {
      parts.push('[' + k + ']=function(' + P[0] + ',' + P[1] + ',' + P[2] + ')local t=(' + P[0] + ' or 0)+(' + P[1] + ' or 0);if t>' + randInt(100, 999) + ' then return ' + P[2] + ' end return t%256 end,');
    } else if (kind === 8) {
      parts.push('[' + k + ']=function(' + P[0] + ',' + P[1] + ',' + P[2] + ')if ' + P[1] + ' then ' + P[0] + '[' + P[1] + '.A or 0]=' + P[0] + '[' + P[1] + '.B or 0] end return ' + P[2] + ' end,');
    } else {
      parts.push('[' + k + ']=function(' + P[0] + ',' + P[1] + ',' + P[2] + ')if ' + P[1] + ' and ' + P[1] + '.A then ' + P[0] + '[' + P[1] + '.A]=(' + P[1] + '.D~=nil and ' + P[1] + '.D) or ' + P[0] + '[' + P[1] + '.B or 0] end end,');
    }
  }
  for (let i = 0; i < 8; i++) {
    let k = 1 + Math.floor(Math.random() * 2000);
    while (used.has(k)) k = 1 + Math.floor(Math.random() * 2000);
    used.add(k);
    parts.push('[' + k + ']=string.' + ['match', 'find', 'sub', 'byte', 'char', 'len', 'rep', 'reverse'][i] + ',');
  }
  function pickKey() {
    let k = 1 + Math.floor(Math.random() * 2000);
    while (used.has(k)) k = 1 + Math.floor(Math.random() * 2000);
    used.add(k);
    return k;
  }
  parts.push('[' + pickKey() + ']=buffer and buffer.readu16 or function()return 0 end,');
  parts.push('[' + pickKey() + ']=buffer and buffer.writef64 or function()end,');
  parts.push('[' + pickKey() + ']=buffer and buffer.readu32 or function()return 0 end,');
  return used;
}


function renameLocals(src) {
  const RESERVED = new Set([
    'and','break','do','else','elseif','end','false','for','function','goto','if','in',
    'local','nil','not','or','repeat','return','then','true','until','while',
    'game','workspace','script','plugin','shared','_G','_ENV','typeof','type','pairs','ipairs',
    'next','select','unpack','table','string','math','bit32','coroutine','debug','os','utf8','buffer',
    'Instance','Enum','Color3','Vector3','Vector2','CFrame','UDim','UDim2','Ray','Region3','TweenInfo',
    'pcall','xpcall','error','assert','print','warn','tonumber','tostring','rawequal','rawget','rawset',
    'rawlen','getmetatable','setmetatable','loadstring','load','require','task','tick','time','wait',
    'delay','spawn','getfenv','setfenv','Players','RunService','UserInputService','TweenService',
    'CoreGui','Lighting','HttpService','Workspace','self','super','continue',
    'GetService','FindFirstChild','FindFirstChildOfClass','FindFirstChildWhichIsA','WaitForChild',
    'GetChildren','GetDescendants','IsA','Destroy','Clone','Connect','Disconnect','Once','Wait',
    'Character','CharacterAdded','LocalPlayer','Humanoid','HumanoidRootPart','WalkSpeed','JumpPower',
    'Parent','Name','ClassName','Heartbeat','RenderStepped','Stepped','Changed','Enabled','Disabled','Value',
    'failures','passed','fail','expect','exact','near','check','callback'
  ]);
  const masks = [];
  function mask(m) { const id = masks.length; masks.push(m); return '___MASK' + id + '___'; }
  let scan = String(src || '');
  scan = scan.replace(/\[(=*)\[[\s\S]*?\]\1\]/g, mask);
  scan = scan.replace(/"(?:\\.|[^"\\])*"/g, mask);
  scan = scan.replace(/'(?:\\.|[^'\\])*'/g, mask);
  const names = new Map();
  let n = 0;
  function mapName(name) {
    if (!name || RESERVED.has(name) || names.has(name)) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
    if (/^[A-Z]/.test(name) && name.length > 2) return;
    // sequential unique short ids — never collide
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let id;
    do {
      n++;
      if (n <= alphabet.length) id = alphabet[n - 1];
      else {
        const a = alphabet[Math.floor((n - 1) / alphabet.length) % alphabet.length];
        const b = alphabet[(n - 1) % alphabet.length];
        id = a + b;
      }
    } while (RESERVED.has(id) || [...names.values()].includes(id));
    names.set(name, id);
  }
  let m;
  const reLocalFn = /\blocal\s+function\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((m = reLocalFn.exec(scan))) mapName(m[1]);
  const reFn = /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  while ((m = reFn.exec(scan))) mapName(m[1]);
  const reLocals = /\blocal\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)/g;
  while ((m = reLocals.exec(scan))) {
    if (m[1].startsWith('function')) continue;
    m[1].split(',').forEach((p) => mapName(p.trim().split(/\s+/)[0]));
  }
  let out = scan;
  if (names.size > 0) {
    const sorted = [...names.keys()].sort((a, b) => b.length - a.length);
    for (const name of sorted) {
      out = out.replace(new RegExp('\\b' + name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '\\b', 'g'), names.get(name));
    }
  }
  for (let i = masks.length - 1; i >= 0; i--) out = out.split('___MASK' + i + '___').join(masks[i]);
  return out;
}

/** Comparison / algorithmic junk (opaque, never changes control). */
function emitCompareJunk() {
  const a = rv(), b = rv(), c = rv();
  const x = randInt(10, 90), y = randInt(10, 90);
  const kinds = [
    'do local ' + a + '=' + x + ' local ' + b + '=' + y + ' if ' + a + '>' + b + ' and ' + a + '<' + b + ' then ' + a + '=' + a + '+1 end if ' + a + '==' + a + ' then ' + b + '=' + b + ' end end',
    'do local ' + a + '=' + opaqueNum(x) + ' local ' + b + '=' + opaqueNum(y) + ' local ' + c + '=(' + a + '~=' + b + ') and 1 or 0 if ' + c + '>2 then error(0) end end',
    'do local ' + a + '=bit32 and bit32.bxor(' + x + ',' + y + ') or 0 if type(' + a + ')~="number" then end end',
    'do local ' + a + '={' + randInt(1,5) + ',' + randInt(1,5) + '} if #' + a + '==0 then table.insert(' + a + ',1) end if ' + a + '[1]==' + a + '[1] then end end',
    'do local ' + a + '=' + x + ' if not(' + a + '<' + a + ') then ' + a + '=(' + a + '*' + randInt(2,7) + ')%' + randInt(100,900) + ' end end'
  ];
  return kinds[randInt(0, kinds.length - 1)];
}

function buildAT(wantAT) {
  if (!wantAT) return { soft: '', env: '', strong: '' };
  return {
    soft: String(AT_STAGE_SOFT_HOOK || '').trim(),
    env: String(AT_STAGE_ENVCRACK || '').trim(),
    strong: String(AT_STAGE_STRONG || '').trim()
  };
}

/**
 * Emit 40 key bytes as separate locals mixed with junk; return { decls: string[], rebuildA, rebuildB, ka, kb }
 * ka = first 20, kb = next 20
 */
function scatterKeys40() {
  const ka = makeKey20();
  const kb = makeKey20();
  const all = ka.concat(kb); // 40
  const names = all.map((_, i) => '_k' + i + '_' + randInt(100,999));
  // Shuffle emission order of indices
  const order = all.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  const decls = [];
  for (const i of order) {
    decls.push('local ' + names[i] + '=' + String(all[i] & 255));
    if (Math.random() < 0.35) decls.push(emitCompareJunk());
  }
  const rebuildA = '{' + names.slice(0, 20).map((n) => n).join(',') + '}';
  const rebuildB = '{' + names.slice(20, 40).map((n) => n).join(',') + '}';
  return { decls, rebuildA, rebuildB, ka, kb, names };
}


/** Run Hercules custom bytecode VM (no loadstring of user source). */
function runHerculesVM(source) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(__dirname, '..');
  const luaBin = path.join(root, 'tools', 'lua54');
  const runner = path.join(root, 'tools', 'run_her_vm.lua');
  if (!fs.existsSync(luaBin) || !fs.existsSync(runner)) {
    return { ok: false, error: 'hercules tools missing' };
  }
  const tmpIn = path.join('/tmp', 'wan_vm_in_' + process.pid + '_' + Date.now() + '.lua');
  const tmpOut = path.join('/tmp', 'wan_vm_out_' + process.pid + '_' + Date.now() + '.lua');
  try {
    fs.writeFileSync(tmpIn, source);
    const r = spawnSync(luaBin, [runner, tmpIn, tmpOut], {
      encoding: 'utf8',
      timeout: 45000,
      maxBuffer: 20 * 1024 * 1024
    });
    if (r.status !== 0) {
      return { ok: false, error: (r.stderr || r.stdout || 'vm fail').slice(0, 500) };
    }
    if (!fs.existsSync(tmpOut)) return { ok: false, error: 'no vm output' };
    const out = fs.readFileSync(tmpOut, 'utf8');
    if (!out || out.length < 50) return { ok: false, error: 'vm empty' };
    // Strip hercules watermark header line noise lightly
    // KEEP bootstrap: hercules,v1,alpha,__,_ = ... (defines alpha/__/_)
    let cleaned = out
      .replace(/Protected By Hercules[^'"\n]*/gi, 'WAN')
      .replace(/github\.com\/zeusssz\/hercules-obfuscator/gi, 'WAN')
      .replace(/\bHercules\b/g, 'WAN')
      .replace(/\bhercules\b/g, 'wan')
      .replace(/\bClyde\b/g, 'WAN')
      .replace(/\bclyde\b/g, 'wan')
      .replace(/\b8xms\b/gi, 'wan')
      .replace(/\b8XMS\b/g, 'WAN');
    return { ok: true, code: cleaned, bytes: cleaned.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally {
    try { fs.unlinkSync(tmpIn); } catch (_) {}
    try { fs.unlinkSync(tmpOut); } catch (_) {}
  }
}


/** Compact AT3: anti-debug / anti-hook loadstring (bytecode via Hercules). */
function buildAntiDebugAT() {
  return `
do
  local function __die() error("WAN OBFUSCATE chao may ku:>", 0) end
  local ls = (loadstring or load)
  if type(ls) == "function" then
    local d = rawget(_G, "debug") or debug
    if type(d) == "table" and type(d.getinfo) == "function" then
      local ok, info = pcall(d.getinfo, ls, "S")
      if ok and type(info) == "table" and info.what ~= nil and info.what ~= "C" then
        __die()
      end
    end
  end
  if type(getfenv) == "function" then
    local ok, e0 = pcall(getfenv, 0)
    if ok and type(e0) == "table" then
      local mt = getmetatable(e0)
      if mt ~= nil and type(mt) == "table" and mt.__index ~= nil and type(mt.__index) == "function" then
        -- proxy env often used by dumpers
      end
    end
  end
  if type(identifyexecutor) == "function" then
    local ok, n = pcall(identifyexecutor)
    if ok and type(n) == "string" then
      local low = string.lower(n)
      for _, bad in ipairs({"synapse", "scriptware", "sentinel"}) do
        if string.find(low, bad, 1, true) then end
      end
    end
  end
end
`.trim();
}

/** ~50KB algorithmic junk: single-char names only, fake CF, fake opcodes */

/** Exact user AT — outer opaque. Runs BEFORE vmBody so hooks that execute are blocked.
 *  No plaintext: elysium / WAN OBFUSCATE / classic AT block as readable source.
 */



/** Split exact user AT across N fragments (not one contiguous block in output). */
function emitSplitAT() {
  // Exact user AT — plain text, split across fragments (not one block)
  const fragA =
    'do local _a=tostring({}) if string.sub(_a,8,15)==string.sub(tostring({}),8,15) then _G._wan1=1 end end';
  const fragB =
    'do if not game then _G._wan1=1 end end';
  const fragC =
    'do if _G._wan1 then _G.elysium_was_here=math.random() print("WAN OBFUSCATE chao may ku:>") return end end';
  return { a: fragA, b: fragB, c: fragC };
}

/** Anti-dump vs string.char / table.concat return hooks (AZT-style dumpers). */
function emitAntiDump() {
  return (
    'do local S=string local T=table local ok=true ' +
    'if type(S.char)~="function" or type(T.concat)~="function" then ok=false end ' +
    'local _a=S.char(1,2,3) local _b=S.char(1,2,3) ' +
    'if _a~=_b then ok=false end ' +
    'if T.concat({"x","y"})~="xy" then ok=false end ' +
    'for _i=1,20 do S.char(65+(_i%26),66,67) end ' +
    'if not ok then _G._wan1=1 end end'
  );
}

function emitJunk20k() {
  const target = 50000;
  let out = '';
  let guard = 0;
  while (out.length < target && guard < 800) {
    guard++;
    const a = rv(), b = rv(), c = rv(), d = rv(), e = rv();
    const st = randInt(100, 9000);
    const kind = randInt(0, 5);
    if (kind === 0) {
      out += `do local ${a}=${randInt(1,90)} local ${b}=${a}*3%97 if ${b}>${randInt(100,200)} then local ${c}=0 end end;`;
    } else if (kind === 1) {
      out += `do local ${a}=${st} for _=1,2 do ${a}=(${a}*3+1)%97 end end;`;
    } else if (kind === 2) {
      out += `do local function ${a}(${b},${c}) if ${b} and ${c} and ${b}>${c}+${randInt(10,99)} then return ${c} end return (${b} or 0)+(${c} or 0) end end;`;
    } else if (kind === 3) {
      out += `if not(1<0) then local ${a}={${randInt(1,9)},${randInt(1,9)}} if #${a}~=2 then local ${b}=0 end end;`;
    } else if (kind === 4) {
      // fake CF only (valid inside function body) — no table-index assign
      out += `do local ${a}=${randInt(1,50)} local ${b}=function(${c},${d}) if ${c} and ${c}>${randInt(10,80)} then return ${d} end return ${c} end ${b}(${a},${a}+1) end;`;
    } else {
      out += `do local ${a}=(bit32 and bit32.bxor or function(x,y) local r,p=0,1 for _=1,8 do local u,v=x%2,y%2 if u~=v then r=r+p end x,y,p=(x-u)/2,(y-v)/2,p*2 end return r end)(${randInt(1,200)},${randInt(1,200)}) end;`;
    }
  }
  return out;
}

/** Fake control-flow opcode table (commercial look, single-char params) */
function emitFakeOpcodeTable(parts, count, used) {
  const usedSet = used || new Set();
  for (let n = 0; n < count; n++) {
    let k;
    do { k = 100 + randInt(0, 1800); } while (usedSet.has(k));
    usedSet.add(k);
    const params = rvMany(3 + randInt(0, 5)).join(',');
    const style = randInt(0, 3);
    if (style === 0) {
      parts.push(`[${k}]=function(${params}) if ${params.split(',')[0]} then return ${randInt(1,160)},${params.split(',')[0]} end end,`);
    } else if (style === 1) {
      const p = params.split(',');
      parts.push(`[${k}]=function(${params}) if ${p[0]} and ${p[1]} and ${p[0]}>${p[1]}+${randInt(100,1500)} then return ${p[2] || p[0]} end end,`);
    } else if (style === 2) {
      parts.push(`[${k}]=function(${params}) local z=${randInt(1,200)};z=z*${randInt(2,9)}%256 end,`);
    } else {
      parts.push(`[${k}]=function(${params}) return "" end,`);
    }
  }
  return usedSet;
}



/** Convert Hercules '\10\95' string literals → string.char(...) ASCII-only (no \xx spam, no binary longstring). */
/** Convert Hercules byte-escapes to string.char (ASCII-only, no \\xx spam). */

/** Encode Uint8Array: XOR20 → HEX → XOR20 → Base94 (same as encode20, binary-safe). */
function encode20Bytes(bytes, keysA, keysB) {
  const raw = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const x1 = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) x1[i] = raw[i] ^ (keysA[i % 20] & 255);
  let hex = '';
  for (let i = 0; i < x1.length; i++) hex += x1[i].toString(16).padStart(2, '0').toUpperCase();
  const x2 = new Uint8Array(hex.length);
  for (let i = 0; i < hex.length; i++) x2[i] = hex.charCodeAt(i) ^ (keysB[i % 20] & 255);
  const total = 4 + x2.length;
  const padded = new Uint8Array(Math.ceil(total / 4) * 4);
  const len = x2.length;
  padded[0] = (len >>> 24) & 255; padded[1] = (len >>> 16) & 255;
  padded[2] = (len >>> 8) & 255; padded[3] = len & 255;
  padded.set(x2, 4);
  let b94 = '';
  const A = 33;
  for (let i = 0; i < padded.length; i += 4) {
    let V = padded[i] * 16777216 + padded[i + 1] * 65536 + padded[i + 2] * 256 + padded[i + 3];
    const d = [0, 0, 0, 0, 0];
    d[0] = Math.floor(V / 78074896); V -= d[0] * 78074896;
    d[1] = Math.floor(V / 830584); V -= d[1] * 830584;
    d[2] = Math.floor(V / 8836); V -= d[2] * 8836;
    d[3] = Math.floor(V / 94); V -= d[3] * 94;
    d[4] = V;
    for (let j = 0; j < 5; j++) b94 += String.fromCharCode(A + d[j]);
  }
  return b94;
}

function escapesToBytes(esc) {
  const nums = [];
  const re = /\\([0-9]{1,3})/g;
  let m;
  while ((m = re.exec(esc))) {
    const n = parseInt(m[1], 10);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums.length ? Uint8Array.from(nums) : null;
}

/** Lua decoder for encode20Bytes — no loadstring, returns string. */
function emitDecode20Lua(packedExpr, kaExpr, kbExpr) {
  // packedExpr = longstring or var; kaExpr/kbExpr = table exprs of 20 numbers
  return `(function()`
    + `local p=${packedExpr}`
    + `local ka=${kaExpr} local kb=${kbExpr}`
    + `local A=33 local out={} local i=1`
    + `while i<=#p do`
    + `local V=0`
    + `for j=0,4 do V=V*94+((string.byte(p,i+j)or A)-A) end`
    + `out[#out+1]=string.char(math.floor(V/16777216)%256,math.floor(V/65536)%256,math.floor(V/256)%256,V%256)`
    + `i=i+5 end`
    + `local raw=table.concat(out)`
    + `local len=(string.byte(raw,1)or 0)*16777216+(string.byte(raw,2)or 0)*65536+(string.byte(raw,3)or 0)*256+(string.byte(raw,4)or 0)`
    + `local x2=raw:sub(5,4+len)`
    + `local hex={}`
    + `for i=1,#x2 do local b=string.byte(x2,i)or 0 hex[i]=string.char(bit32 and bit32.bxor(b,kb[(i-1)%20+1])or (b~kb[(i-1)%20+1])) end`
    + `hex=table.concat(hex)`
    + `local bytes={}`
    + `for i=1,#hex,2 do`
    + `local h=tonumber(hex:sub(i,i+1),16)or 0`
    + `local idx=(#bytes)%20+1`
    + `bytes[#bytes+1]=string.char(bit32 and bit32.bxor(h,ka[idx])or (h~ka[idx]))`
    + `end`
    + `return table.concat(bytes)`
    + `end)()`;
}

/**
 * Pack Hercules BcToState('\\xx...') blobs with xor20+hex+xor20+base94.
 * Scatter 40 keys in locals mixed with junk. No string.char spam, no loadstring.
 */

/**
 * Safe pack: do NOT re-encode Hercules bytecode (encode20 caused Roblox eof32).
 * Scatter many decoy key-vaults (fake vmaps) in multiple branches.
 */

function luaLongWrapSafe(str) {
  let n = 8;
  const s = String(str || '');
  for (;;) {
    const close = ']' + '='.repeat(n) + ']';
    if (s.indexOf(close) >= 0) { n++; continue; }
    let bad = false;
    for (let k = 0; k <= n; k++) {
      if (s.endsWith(']' + '='.repeat(k))) { bad = true; break; }
    }
    if (bad) { n++; continue; }
    break;
  }
  return '[' + '='.repeat(n) + '[' + s + ']' + '='.repeat(n) + ']';
}

function chunkLongstring(b94, chunkSize) {
  const size = chunkSize || 350;
  const parts = [];
  for (let i = 0; i < b94.length; i += size) {
    parts.push(luaLongWrapSafe(b94.slice(i, i + size)));
  }
  if (!parts.length) parts.push(luaLongWrapSafe(''));
  if (parts.length === 1) return parts[0];
  return 'table.concat({' + parts.join(',') + '})';
}

/**
 * Real pack: xor20 + hex + xor20 + base94
 * 40-50 keys scattered one-per-do-block; multiple fake vmaps
 * Bytecode embedded as longstring chunks (no \\xx visible)
 */

function packHerculesPayload(code) {
  let src = String(code || '');
  const re = /BcToState\('((?:\\[0-9]{1,3})+)','((?:\\[0-9]{1,3})+)'\)/;
  const m = src.match(re);
  if (!m) return { code: injectDecoyVaults(src), keys: 40 };
  const b1 = escapesToBytes(m[1]);
  const b2 = escapesToBytes(m[2]);
  if (!b1 || !b2) return { code: injectDecoyVaults(src), keys: 40 };

  const ka = makeKey20();
  const kb = makeKey20();
  const extra = [];
  for (let i = 0; i < 10; i++) extra.push(randInt(0, 255));
  const allKeys = ka.concat(kb).concat(extra); // 50

  // single-letter-ish random names (no __vmap / __fake / K)
  const alpha = 'abcdefghijklmnopqrstuvwxyz';
  function rn() {
    // single character only
    const reserved = {in:1,do:1,if:1,or:1,and:1,not:1,end:1,for:1,nil:1};
    if (!rn._i) rn._i = 0;
    let s;
    do {
      s = alpha[rn._i % 26];
      rn._i++;
    } while (reserved[s]);
    return s;
  }
  const tName = rn(); // real key table
  // 4 tables that look identical: 2 real rebuilds + 2 fakes — all same shape
  const nA = rn(), nB = rn(), nC = rn(), nD = rn();
  const nBx = rn(), nDfn = rn();
  const nP1 = rn(), nP2 = rn();

  // shuffle key write order
  const order = allKeys.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }

  // commercial junk longstring generator
  function junkLS() {
    const chars = "Y'g,^s)B<3TwD)jtZOWxMV5IJjtO@;[>\"#3L*3@>WsvIrkli!}F10LrJ9";
    let o = '';
    const n = 40 + randInt(0, 80);
    for (let i = 0; i < n; i++) o += chars[randInt(0, chars.length - 1)];
    return luaLongWrapSafe(o);
  }

  const pieces = [];
  pieces.push('local ' + tName + '={}');

  // interleave: key writes + fake table stubs + junk longstrings
  let fakeSlots = [
    { name: nC, vals: Array.from({length:20}, () => randInt(0,255)) },
    { name: nD, vals: Array.from({length:20}, () => randInt(0,255)) }
  ];
  let fi = 0;
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    pieces.push(tName + '[' + (i + 1) + ']=' + (allKeys[i] & 255));
    if (Math.random() < 0.3) {
      pieces.push('if ' + tName + '[' + (i + 1) + ']>9999 then ' + tName + '[' + (i + 1) + ']=0 end');
    }
    // drop a fake table mid-stream (looks like another key vault)
    if (fi < fakeSlots.length && (oi === 7 || oi === 22 || Math.random() < 0.08)) {
      const f = fakeSlots[fi++];
      pieces.push('local ' + f.name + '={' + f.vals.join(',') + '}');
    }
    if (Math.random() < 0.15) {
      const jn = rn();
      pieces.push('local ' + jn + '=' + junkLS());
    }
    if (Math.random() < 0.2) {
      pieces.push('do local z=0 z=z+1 end');
    }
  }
  // ensure fakes declared if not yet
  while (fi < fakeSlots.length) {
    const f = fakeSlots[fi++];
    pieces.push('local ' + f.name + '={' + f.vals.join(',') + '}');
  }

  // real rebuild tables — SAME syntax as fakes (table of 20 numbers OR refs)
  // Build as copies from tName so shape matches; name them randomly
  const rebuildA = nA + '={' + Array.from({length:20}, (_, i) => tName + '[' + (i + 1) + ']').join(',') + '}';
  const rebuildB = nB + '={' + Array.from({length:20}, (_, i) => tName + '[' + (i + 21) + ']').join(',') + '}';
  pieces.push('local ' + rebuildA);
  pieces.push('local ' + rebuildB);

  // dead branch that swaps real <-> fake (never taken) — all names look equal
  pieces.push('if false then ' + nA + '=' + nC + ' ' + nB + '=' + nD + ' end');
  pieces.push('if (0>1) then ' + nA + '=' + nD + ' ' + nB + '=' + nC + ' end');

  // more junk longstrings between
  pieces.push('local ' + rn() + '=' + junkLS());
  pieces.push('local ' + rn() + '=' + junkLS());

  const pack1 = encode20Bytes(b1, ka, kb);
  const pack2 = encode20Bytes(b2, ka, kb);
  const expr1 = chunkLongstring(pack1, 320);
  const expr2 = chunkLongstring(pack2, 320);

  // decode helpers with random short names
  const decFn =
    'local function ' + nBx + '(a,b) '
    + 'a=math.floor((tonumber(a)or 0)%256) b=math.floor((tonumber(b)or 0)%256) '
    + 'if bit32 and bit32.bxor then return bit32.bxor(a,b)%256 end '
    + 'local r,p=0,1 for i=0,7 do local x,y=a%2,b%2 if x~=y then r=r+p end '
    + 'a=math.floor((a-x)/2) b=math.floor((b-y)/2) p=p*2 end return r%256 end '
    + 'local function ' + nDfn + '(p,ka,kb) '
    + 'if type(p)~="string" or #p<5 then return "" end '
    + 'local A=33 local out={} local i=1 '
    + 'while i+4<=#p do '
    + 'local V=0 '
    + 'for j=0,4 do V=V*94+((string.byte(p,i+j)or A)-A) end '
    + 'local c1=math.floor(V/16777216)%256 local c2=math.floor(V/65536)%256 local c3=math.floor(V/256)%256 local c4=V%256 '
    + 'out[#out+1]=string.char(c1%256,c2%256,c3%256,c4%256) '
    + 'i=i+5 end '
    + 'local raw=table.concat(out) '
    + 'local len=(string.byte(raw,1)or 0)*16777216+(string.byte(raw,2)or 0)*65536+(string.byte(raw,3)or 0)*256+(string.byte(raw,4)or 0) '
    + 'if len<0 or len>#raw-4 then return "" end '
    + 'local x2=string.sub(raw,5,4+len) '
    + 'local hex_t={} '
    + 'for i=1,#x2 do '
    + 'local b=string.byte(x2,i)or 0 '
    + 'local xv=tonumber(kb[((i-1)%20)+1])or 0 '
    + 'hex_t[i]=string.char(' + nBx + '(b,xv)) '
    + 'end '
    + 'local hex=table.concat(hex_t) '
    + 'local bytes={} '
    + 'for i=1,#hex,2 do '
    + 'local h=tonumber(string.sub(hex,i,i+1),16)or 0 '
    + 'local idx=(math.floor((i-1)/2)%20)+1 '
    + 'local xv=tonumber(ka[idx])or 0 '
    + 'bytes[#bytes+1]=string.char(' + nBx + '(h,xv)) '
    + 'end '
    + 'return table.concat(bytes) end ';

  pieces.push(decFn);
  pieces.push('local ' + nP1 + '=' + expr1);
  pieces.push('local ' + nP2 + '=' + expr2);
  // one more decoy longstring after payload
  pieces.push('local ' + rn() + '=' + junkLS());
  pieces.push('return BcToState(' + nDfn + '(' + nP1 + ',' + nA + ',' + nB + '),' + nDfn + '(' + nP2 + ',' + nA + ',' + nB + '))');

  const inner = '(function() ' + pieces.join(' ') + ' end)()';
  src = src.replace(re, () => inner);
  return { code: src, keys: 50 };
}

function injectDecoyVaults(src) {
  const alpha = 'abcdefghijklmnopqrstuvwxyz';
  const vaults = [];
  for (let v = 0; v < 6; v++) {
    const vn = alpha[randInt(0, 25)] + alpha[randInt(0, 25)];
    const parts = [];
    for (let i = 0; i < 20; i++) parts.push(String(randInt(0, 255)));
    vaults.push('do local ' + vn + '={' + parts.join(',') + '} end');
  }
  return vaults.join(' ') + ' ' + src;
}


export function obfuscate(input, opts = {}) {
  input = stripLuaComments(String(input || ''));
  if (!input || !input.trim()) throw new Error('Input is empty');
  // lowerLuau OFF by default — it ate method calls (game:GetService) and is easy to strip
  if (opts && opts.lower) {
    input = lowerLuau(input);
  }
  const debug = !!(opts && opts.debug);
  const log = debug ? (m) => console.log('[WAN] ' + m) : () => {};
  const wantAT = !(opts && opts.noAT);
  const doRename = !(opts && opts.noRename);
  // default ON: Hercules VM, no loadstring
  const useHercules = !(opts && opts.noHercules);

  // Reset single-char pool each build
  rv._pool = null; rv._i = 0;

  // Catph has its own renamer — our renameLocals uses _catph_* prefix clash
  // Catph raw emit uses internal loadstring + breaks 'end' expected; only opt-in
  const useCatphSoon = !!(opts && opts.useCatph) && typeof catphAvailable === 'function' && catphAvailable();
  if (doRename && !useCatphSoon) {
    input = renameLocals(input);
    log('rename done ' + input.length);
  } else if (doRename && useCatphSoon) {
    log('rename skip (Catph internal)');
  }

  // SM: light with { cfLight: true }, full with { cf: true }. OFF default (stable BC).
  if (opts && (opts.cf || opts.cfLight)) {
    try {
      if (opts.cf) {
        input = toStateMachine(input);
        log('SM+CF full applied ' + input.length);
      } else {
        input = toStateMachineLight(input);
        log('SM light applied ' + input.length);
      }
    } catch (e) {
      log('SM skip: ' + (e && e.message));
    }
  }

  // AT split in outer shell; secret is payload only
  const at = buildAT(wantAT);
  // AT is OUTER only — split across shell (not bytecode). Payload-only secret.
  let secret = input;
  log('secret bytes=' + secret.length + ' at2=' + wantAT);

  // Full Luau path first (Catph-strength: official luau-compile + enriched VM ISA).
  // Output surface unchanged: same setmetatable shell + pack.
  let vmBody = null;
  let vmMode = 'none';
  let catphDirect = null; // full Catph output (already self-contained)

  // === PRIMARY: 100% Catph CustomVM (compiler + ISA + emit) ===
  if (!!(opts && opts.useCatph) && typeof catphAvailable === 'function' && catphAvailable()) {
    try {
      const cr = runCatphVM(secret, { preset: (opts && opts.catphPreset) || 'customvm_max', debug });
      if (cr && cr.ok && cr.code && cr.code.length > 100) {
        catphDirect = cr.code;
        vmMode = 'catph-cvm';
        log('Catph CustomVM ok ' + cr.code.length);
      } else {
        log('Catph fail: ' + ((cr && cr.error) || 'unknown'));
      }
    } catch (e) {
      log('Catph err: ' + (e && e.message));
    }
  }

  // Fallback: official luau-compile + WAN VM
  if (!catphDirect && !(opts && opts.noOfficial) && typeof luauCompileAvailable === 'function' && luauCompileAvailable()) {
    try {
      const oc = compileOfficialToVM(secret);
      if (oc && oc.ok) {
        let body = emitVMRuntime(oc);
        if (body && body.length > 40) {
          try {
            try { body = mangleVmSource(body); } catch (_) {}
            const pk = packVmData(body);
            body = pk.code;
            log('Official pack keys=' + pk.keys + ' numArrs=' + (pk.numArrs||0));
          } catch (e) {
            log('Official pack skip: ' + (e && e.message));
          }
          vmBody = body;
          vmMode = 'luau-catph-isa';
          log('Full Luau VM ok ' + vmBody.length);
        }
      } else {
        log('Official fail: ' + (oc && oc.error));
      }
    } catch (e) {
      log('Official err: ' + (e && e.message));
    }
  }
  // Hercules fallback (same shell) if official unavailable
  if (!catphDirect && !vmBody && useHercules) {
    try {
      const hr = runHerculesVM(secret);
      if (hr.ok) {
        vmBody = hr.code;
        const _pk = packHerculesPayload(vmBody);
        vmBody = _pk.code;
        vmBody = vmBody.replace(/\bloadstring\b/g, '(nil)');
        vmBody = vmBody.replace(/Protected By Hercules[^'"]*/g, 'WAN');
        vmMode = 'hercules-100';
        log('Hercules VM ok ' + vmBody.length);
      } else {
        log('Hercules fail: ' + (hr && hr.error));
      }
    } catch (e) {
      log('Hercules err: ' + (e && e.message));
    }
  }
  if (!catphDirect && !vmBody) {
    vmBody = secret;
    vmMode = 'inline-sm';
    log('fallback inline');
  }
  if (catphDirect) {
    vmMode = 'catph-cvm';
  }

  // Catph path: already self-contained VM + runtime — only AT was injected via secret
  if (catphDirect) {
    let code = catphDirect;
    // Ensure 1-line-ish optional; keep Catph structure (newlines ok for huge VM)
    code = stripLuaComments(code);
    code = toOneLinePreserveLongstrings(code);
    log('out ' + code.length + ' method=catph mode=' + vmMode + ' loadstring=false');
    return {
      code,
      meta: {
        inputBytes: secret.length,
        outputBytes: code.length,
        fragments: 1,
        decoys: usedKeys.size,
        method: 'catph',
        vmMode,
        rename: doRename,
        atStages: wantAT ? 3 : 0,
        loadstring: false,
        engine: 'catph-customvm',
      }
    };
  }

    // Outer shell: 1-line + dead SM + packed body (AT already inside bytecode)
  const parts = [];
  const entryKey = 100 + randInt(0, 1900);
  const safeMethodChars = 'pqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const methodName = safeMethodChars[(Math.random() * safeMethodChars.length) | 0];
  const usedKeys = new Set([entryKey]);
  const st = 's' + randInt(10,99) + 't' + randInt(10,99);
  const s0 = randInt(10,50), s1 = randInt(51,90), sH = randInt(91,120);

  parts.push('return setmetatable({');
  emitFakeOpcodeTable(parts, 22 + randInt(0, 12), usedKeys);
  {
    let dk = 2200 + randInt(0, 300);
    while (usedKeys.has(dk)) dk++;
    usedKeys.add(dk);
    // Live-looking SM decoy (user style) — never transforms real payload
    const sn = '_' + randInt(1,9) + ['i','a','o','u','e'][randInt(0,4)] + randInt(10,99) + ['o','q','x','k'][randInt(0,3)] + ['o','a','u'][randInt(0,2)];
    const sA = 1000 + randInt(0, 8000), sB = 1000 + randInt(0, 8000), sC = 1000 + randInt(0, 8000), sD = 1000 + randInt(0, 8000);
    parts.push(`[${dk}]=function() local ${sn}=${sA} while ${sn} do if ${sn}==${sA} then local _rs=game if _rs then _rs=nil end ${sn}=${sB} elseif ${sn}==${sC} then ${sn}=${sD} elseif ${sn}==${sB} then ${sn}=nil else ${sn}=nil end end end,`);
  }
  // Split AT + anti-dump across multiple table slots (not one place)
  const atFr = wantAT ? emitSplitAT() : null;
  const ad = wantAT ? emitAntiDump() : '';
  let kA = 1800 + randInt(0, 80), kB = 1900 + randInt(0, 80), kC = 2000 + randInt(0, 80), kD = 2100 + randInt(0, 80);
  while (usedKeys.has(kA)) kA++;
  usedKeys.add(kA);
  while (usedKeys.has(kB)) kB++;
  usedKeys.add(kB);
  while (usedKeys.has(kC)) kC++;
  usedKeys.add(kC);
  while (usedKeys.has(kD)) kD++;
  usedKeys.add(kD);
  if (wantAT) {
    parts.push(`[${kA}]=function() ${atFr.a} end,`);
    parts.push(`[${kB}]=function() ${ad} end,`);
    parts.push(`[${kC}]=function() ${atFr.b} end,`);
  }
  parts.push(`[${entryKey}]=function(...)`);
  if (wantAT) {
    // Call scattered AT/anti-dump first, then trip fragment, then body
    parts.push(`do local s=select(1,...) if type(s)=="table" then s[${kA}]() s[${kB}]() s[${kC}]() end end ${atFr.c}`);
  }
  parts.push(vmBody);
  parts.push('end,');
  // decoy slots after entry (look like more AT pieces but dead)
  if (wantAT) {
    parts.push(`[${kD}]=function() local _z=tostring({}) string.sub(_z,1,2) end,`);
  }
  emitFakeOpcodeTable(parts, 90 + randInt(0, 30), usedKeys);
  if (!(opts && opts.noJunk)) {
    parts.push(`[${300 + randInt(0, 40)}]=function() ${emitJunk20k()} end,`);
    parts.push(`[${340 + randInt(0, 40)}]=function() ${emitJunk20k()} end,`);
  }
  parts.push(`${methodName}=function(self,...) local f=self[${entryKey}] if type(f)~="function" then error("WAN",0) end return f(self,...) end`);
  parts.push(`},{}):${methodName}(...)`);

  let code = parts.join('\n');
  code = stripLuaComments(code);
  // Always 1-line (preserve longstrings / packed vault)
  code = toOneLinePreserveLongstrings(code);

  // Final assert: no loadstring
  if (/\bloadstring\b/.test(code)) {
    code = code.replace(/\bloadstring\b/g, 'nil');
  }
  // Brand scrub — only WAN
  code = code
    .replace(/\bHercules\b/g, 'WAN')
    .replace(/\bhercules\b/g, 'wan')
    .replace(/\bClydeProtection\b/g, 'WAN')
    .replace(/\bClyde\b/g, 'WAN')
    .replace(/\bclyde\b/g, 'wan')
    .replace(/\b8xms\b/gi, 'wan')
    .replace(/github\.com\/zeusssz[^\s'"]*/gi, 'WAN');

  log('out ' + code.length + ' method=:' + methodName + ' mode=' + vmMode + ' loadstring=false');
  return {
    code,
    meta: {
      inputBytes: secret.length,
      outputBytes: code.length,
      fragments: 1,
      decoys: 0,
      atStages: wantAT ? 3 : 0,
      opcodes: usedKeys.size,
      keys: 50,
      rename: doRename,
      cf: true,
      vm: vmMode.startsWith('hercules'),
      vmMode,
      pack: 'xor20-hex-xor20-base94',
      loadstring: false,
      junkTarget: 50000,
      realOpcodes: 100
    }
  };
}

export default obfuscate;
