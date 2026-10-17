/**
 * WAN pack v7
 * - renameLocals (string-safe)
 * - State Machine CF flatten (statement units → random states + junk states)
 * - 40 key bytes, each emitted in different places, rebuilt at runtime
 * - 3 AT branches: soft-hook + envcrack INLINE (no loadstring), strong encode20 with payload
 * - commercial setmetatable + 220+ op decoys + comparison junk
 * - encode20: xor20 → hex → xor20 → base94
 */
import {
  randInt, multiLayerEncode, encode20, makeKey20, luaLongWrap,
  generateOuterJunk, randJunkStrSafe
} from './encode.js';
import { AT_STAGE_ENVCRACK, AT_STAGE_STRONG, AT_STAGE_SOFT_HOOK } from './at-stages.js';

function rv() { return '_' + Math.random().toString(36).slice(2, 9); }

function stripLuaComments(src) {
  src = String(src || '');
  src = src.replace(/--\[\[[\s\S]*?\]\]/g, '\n');
  src = src.replace(/--[^\n]*/g, '');
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

  const used = new Set();
  function sid() {
    let n;
    do { n = 100 + randInt(0, 8900); } while (used.has(n));
    used.add(n);
    return n;
  }
  const realStates = units.map(() => sid());
  const halt = sid();
  const junkCount = Math.min(10, 4 + Math.min(units.length, 6));
  const junkStates = [];
  for (let j = 0; j < junkCount; j++) junkStates.push(sid());

  const st = rv();
  const parts = [];
  parts.push('do local ' + st + '=' + realStates[0]);
  parts.push('while ' + st + ' do');

  const branches = [];
  for (let i = 0; i < units.length; i++) {
    const next = (i + 1 < units.length) ? realStates[i + 1] : halt;
    branches.push({ id: realStates[i], body: units[i], next, real: true });
  }
  for (let j = 0; j < junkStates.length; j++) {
    branches.push({
      id: junkStates[j],
      body: 'do local _j' + j + '=' + randInt(1, 90) + ' _j' + j + '=(_j' + j + '*3+1)%97 end',
      next: junkStates[(j + 1) % junkStates.length],
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
    n++; names.set(name, '__n' + n.toString(36));
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
  const names = all.map(() => rv());
  // Shuffle emission order of indices
  const order = all.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  const decls = [];
  for (const i of order) {
    decls.push('local ' + names[i] + '=' + opaqueNum(all[i]));
    if (Math.random() < 0.35) decls.push(emitCompareJunk());
  }
  const rebuildA = '{' + names.slice(0, 20).map((n) => n).join(',') + '}';
  const rebuildB = '{' + names.slice(20, 40).map((n) => n).join(',') + '}';
  return { decls, rebuildA, rebuildB, ka, kb, names };
}

export function obfuscate(input, opts = {}) {
  input = stripLuaComments(String(input || ''));
  if (!input || !input.trim()) throw new Error('Input is empty');
  const debug = !!(opts && opts.debug);
  const log = debug ? (m) => console.log('[WAN] ' + m) : () => {};
  const wantAT = !(opts && opts.noAT);
  const doRename = !(opts && opts.noRename);

  // 1) rename user source
  if (doRename) {
    input = renameLocals(input);
    log('rename done');
  }

  // 2) light CF scramble on user payload
  if (!(opts && opts.noCF)) {
    input = controlFlowScramble(input);
    log('state-machine CF applied (' + input.length + ' bytes)');
  }

  const at = buildAT(wantAT);

  // 3) secret for encode20 = strong AT + user payload (soft/env stay INLINE outside loadstring)
  let secret = '';
  if (at.strong && at.strong.length > 50) {
    secret += 'do\n' + at.strong + '\nend\n';
  }
  secret += input;
  log('secret bytes ' + secret.length + ' strong=' + (at.strong ? at.strong.length : 0));

  // 4) 40 scattered keys
  const sk = scatterKeys40();
  const enc = encode20(secret, sk.ka, sk.kb);

  // decoys
  const decoys = [];
  const decoyN = 18 + randInt(0, 10);
  for (let d = 0; d < decoyN; d++) {
    const dka = makeKey20(), dkb = makeKey20();
    decoys.push({
      enc: encode20(randJunkStrSafe(60 + randInt(0, 120)), dka, dkb),
      ka: dka, kb: dkb
    });
  }

  const parts = [];
  const nBx = rv(), nD20 = rv(), nSrc = rv(), nFn = rv(), nEr = rv(), nL = rv();
  const nE = rv(), nKA = rv(), nKB = rv();
  const entryKey = 100 + randInt(0, 1900);
  const _mnA = 'rqtpxznsmwkjhg';
  const _mnB = 'HKJQMVWZNPBCDF';
  const methodName = _mnA[randInt(0, _mnA.length - 1)] + _mnB[randInt(0, _mnB.length - 1)];

  parts.push('return setmetatable({');
  const usedKeys = new Set();
  usedKeys.add(entryKey);
  emitOpcodeTable(parts, 220 + randInt(0, 40), usedKeys);
  log('opcode handlers ~' + usedKeys.size);

  parts.push('[' + entryKey + ']=function(...)');
  parts.push(generateOuterJunk(4 + randInt(0, 4)));
  parts.push(emitCompareJunk());

  // --- AT branch 1: soft anti-hook INLINE (no loadstring) ---
  if (at.soft) {
    parts.push('do ' + at.soft + ' end');
    parts.push(emitCompareJunk());
  }

  // outer longstring noise
  for (let j = 0; j < 5 + randInt(0, 3); j++) {
    parts.push('do local _j' + j + '=' + luaLongWrap(randJunkStrSafe(50 + randInt(0, 80))) + ' end');
    if (j % 2 === 0) parts.push(emitCompareJunk());
  }

  // --- AT branch 2: envcrack INLINE ---
  if (at.env) {
    parts.push('do ' + at.env + ' end');
    parts.push(emitCompareJunk());
  }

  parts.push('local ' + nBx + '=(bit32 and bit32.bxor) or function(a,b)local r,p=0,1 for _=1,8 do local x,y=a%2,b%2 if x~=y then r=r+p end a=(a-x)/2 b=(b-y)/2 p=p*2 end return r end');

  // decoder
  parts.push(
    'local function ' + nD20 + '(s,kA,kB)' +
    ' if type(s)~="string" or #s<5 or type(kA)~="table" or type(kB)~="table" then return nil end' +
    ' local _4,_5={},1' +
    ' while _5+4<=#s do' +
    ' local _6=s:byte(_5)-33 local _7=s:byte(_5+1)-33 local _8=s:byte(_5+2)-33 local _9=s:byte(_5+3)-33 local _10=s:byte(_5+4)-33' +
    ' local _11=_6*78074896+_7*830584+_8*8836+_9*94+_10' +
    ' _4[#_4+1]=string.char(math.floor(_11/16777216)%256)' +
    ' _4[#_4+1]=string.char(math.floor(_11/65536)%256)' +
    ' _4[#_4+1]=string.char(math.floor(_11/256)%256)' +
    ' _4[#_4+1]=string.char(math.floor(_11)%256)' +
    ' _5=_5+5 end' +
    ' local _12=table.concat(_4) if #_12<4 then return nil end' +
    ' local _13=_12:byte(1)*16777216+_12:byte(2)*65536+_12:byte(3)*256+_12:byte(4)' +
    ' local hx={}' +
    ' for i=1,_13 do local b=_12:byte(4+i) if not b then break end' +
    ' local kb=kB[((i-1)%#kB)+1] or 0 hx[i]=string.char(' + nBx + '(b,kb%256)) end' +
    ' local hs=table.concat(hx) local raw={} local ri=0' +
    ' for i=1,#hs,2 do local A,B=hs:byte(i),hs:byte(i+1) if not B then break end' +
    ' local hi if A<=57 then hi=A-48 elseif A>=65 and A<=70 then hi=A-55 elseif A>=97 and A<=102 then hi=A-87 else hi=0 end' +
    ' local lo if B<=57 then lo=B-48 elseif B>=65 and B<=70 then lo=B-55 elseif B>=97 and B<=102 then lo=B-87 else lo=0 end' +
    ' local v=hi*16+lo ri=ri+1 local ka=kA[((ri-1)%#kA)+1] or 0 raw[ri]=string.char(' + nBx + '(v,ka%256)) end' +
    ' return table.concat(raw) end'
  );

  // scatter 40 keys among junk (each key one place)
  for (let i = 0; i < sk.decls.length; i++) {
    parts.push(sk.decls[i]);
    if (i % 4 === 0) parts.push(emitCompareJunk());
  }

  // real payload longstring
  parts.push('local ' + nE + '=' + luaLongWrap(enc));
  parts.push(emitCompareJunk());

  // rebuild key tables from scattered locals
  parts.push('local ' + nKA + '=' + sk.rebuildA);
  parts.push(generateOuterJunk(2));
  parts.push('local ' + nKB + '=' + sk.rebuildB);

  // decoy longstrings + fake keys (opaque, not flat number arrays)
  for (let d = 0; d < decoys.length; d++) {
    const de = rv(), dka = rv(), dkb = rv();
    parts.push('do local ' + de + '=' + luaLongWrap(decoys[d].enc));
    const kaParts = decoys[d].ka.map((v) => opaqueNum(v));
    const kbParts = decoys[d].kb.map((v) => opaqueNum(v));
    parts.push('local ' + dka + '={' + kaParts.join(',') + '}');
    parts.push('local ' + dkb + '={' + kbParts.join(',') + '} end');
    if (d % 3 === 0) parts.push(emitCompareJunk());
  }

  parts.push(generateOuterJunk(2));
  parts.push(emitCompareJunk());
  parts.push('local ' + nSrc + '=' + nD20 + '(' + nE + ',' + nKA + ',' + nKB + ')');
  parts.push('if type(' + nSrc + ')~="string" or #' + nSrc + '<1 then error("WAN OBFUSCATE chao may ku:>",0) end');
  parts.push('local ' + nL + '=(loadstring or load)');
  parts.push('if type(' + nL + ')~="function" then error("WAN OBFUSCATE chao may ku:>",0) end');
  parts.push('local ' + nFn + ',' + nEr + '=' + nL + '(' + nSrc + ',"wan")');
  parts.push('if type(' + nFn + ')~="function" then error("WAN OBFUSCATE chao may ku:> "..tostring(' + nEr + '),0) end');
  // AT branch 3 (strong) already inside nSrc; runs first when nFn executes
  parts.push(nFn + '(...)');
  parts.push('end,');

  emitOpcodeTable(parts, 40 + randInt(0, 20), usedKeys);

  const mName = methodName;
  parts.push(mName + '=function(self,...) local f=self[' + entryKey + '] if type(f)~="function" then error("WAN OBFUSCATE chao may ku:>",0) end return f(...) end,');
  parts.push('[' + (200 + randInt(0, 50)) + ']=function()end');
  parts.push('},{}):' + mName + '(...)');


  let code = parts.join('\n');
  code = toOneLinePreserveLongstrings(code);

  log('out ' + code.length + ' entry=' + entryKey + ' method=:' + methodName + ' keys40=yes');
  return {
    code,
    meta: {
      inputBytes: secret.length,
      outputBytes: code.length,
      fragments: 1,
      decoys: decoyN,
      atStages: wantAT ? 3 : 0,
      opcodes: usedKeys.size,
      keys: 40,
      rename: doRename,
      cf: !(opts && opts.noCF),
      vmMode: 'commercial-encode20-scatter40-cf'
    }
  };
}

export default obfuscate;
