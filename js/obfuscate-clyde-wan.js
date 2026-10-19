/**
 * Pipeline (user order):
 *   source → Clyde regCompile (rename+CF max) → binary bytecode + anti-hook(debug.info)
 *   → Runtime (buffer.fromstring → parser → VM dispatch table)
 *   → WAN pack bytecode: xor20→hex→xor20→base94 + 40–80 keys + fake vmaps
 *   → setmetatable surface (decoy + anti-deobf + AT + 50 junk)
 *   → VM run (NO loadstring)
 *
 * All random names 1-char; no plaintext "op==N"; dispatch via table.
 */
import { compileClydeChunk, clydeAvailable } from './clyde-backend.js';

/** Shared AT (user anti-envcrack) — same condition every payload; checksum unique per build */
const AT_FRAGS = [
  // slot A: envcrack probe (exact user logic, split)
  'do local a=string.sub(tostring({}),8,15) local b=string.sub(tostring({}),8,15) if a==b or not game then _G._wan_at=(_G._wan_at or 0)+1 end end',
  // slot B: reinforce
  'do if type(game)=="nil" then _G._wan_at=(_G._wan_at or 0)+1 end end',
  // slot C: trip → decoy print + abort (user style)
  'do if (_G._wan_at or 0)>0 then local _=math.random() end end',
];

function randInt(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}
function makeKey20() {
  const k = [];
  for (let i = 0; i < 20; i++) k.push(randInt(0, 255));
  return k;
}
function deepKeyExpr(v) {
  let e = String(v & 255);
  for (let i = 0, d = 2 + Math.floor(Math.random() * 3); i < d; i++) {
    const t = Math.floor(Math.random() * 4);
    if (t === 0) e = `(${e}+0)`;
    else if (t === 1) e = `(${e}*1)`;
    else if (t === 2) e = `((${e})%256)`;
    else e = `(${e}+0*0)`;
  }
  return e;
}

/** 1-char name allocator (reuses across scopes carefully) */
function makeNamePool() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let i = 0;
  return function rn() {
    if (i < chars.length) {
      return chars[i++];
    }
    const a = chars[i % 52];
    const b = chars[Math.floor(i / 52) % 52];
    i++;
    return a + b;
  };
}

function uniqueIds(n, min, max) {
  const used = new Set();
  const out = [];
  while (out.length < n) {
    const id = randInt(min, max);
    if (!used.has(id)) {
      used.add(id);
      out.push(id);
    }
  }
  return out;
}
function methodName() {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  return letters[Math.floor(Math.random() * letters.length)];
}
function decoyFn() {
  const t = Math.floor(Math.random() * 5);
  if (t === 0) return `function(...) local z=${randInt(1, 200)};z=z*${randInt(2, 9)}%256 end`;
  if (t === 1) return `function(a,...) if a then return ${randInt(1, 160)},a end end`;
  if (t === 2)
    return `function(a,b,c,...) if a and b and a>b+${randInt(100, 1400)} then return c end end`;
  if (t === 3) return `function(...) return "" end`;
  const s0 = randInt(1000, 9000),
    s1 = randInt(1000, 9000);
  return `function() local s=${s0} while s do if s==${s0} then local r=game if r then r=nil end s=${s1} elseif s==${s1} then break else break end end end`;
}
function antiDeobfSlot() {
  const t = Math.floor(Math.random() * 5);
  if (t === 0)
    return `function(...) do local function f(e,I) if e and I and e>I+${randInt(10, 90)} then return I end return (e or 0)+(I or 0) end end end`;
  if (t === 1)
    return `function(...) if not(1<0) then local Y={${randInt(1, 9)},${randInt(1, 9)}} if #Y~=2 then local r=0 end end end`;
  if (t === 2)
    return `function(...) do local k=${randInt(100, 9000)} for _=1,2 do k=(k*3+1)%97 end end end`;
  if (t === 3)
    return `function(...) do local A=${randInt(5, 90)} local e=function(C,i) if C and C>${randInt(20, 80)} then return i end return C end e(A,A+1) end end`;
  return `function(...) if not(0>1) then local F={${randInt(1, 9)},${randInt(1, 9)}} if #F~=2 then local u=0 end end end`;
}

/** 50 junk longstrings — change every build */
function emitJunk50KB() {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{};:,.<>?/|~";
  const target = 52 * 1024;
  const parts = [];
  let total = 0;
  let n = 0;
  while (total < target) {
    let s = "";
    const len = 1000 + Math.floor(Math.random() * 400);
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    let eq = "========";
    while (s.indexOf("]" + eq + "]") !== -1) eq += "=";
    parts.push("local j" + n + "=[" + eq + "[" + s + "]" + eq + "]");
    total += len;
    n++;
  }
  return parts.join(" ");
}

// ---- Binary serialize (same format) ----
function writeVarint(buf, n) {
  n = n >>> 0;
  while (n >= 0x80) {
    buf.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  buf.push(n & 0x7f);
}
/** ZigZag signed varint — preserves negative JMP offsets */
function writeSignedVarint(buf, n) {
  n = n | 0;
  const z = ((n << 1) ^ (n >> 31)) >>> 0;
  writeVarint(buf, z);
}
function writeF64(buf, num) {
  const ab = new ArrayBuffer(8);
  new DataView(ab).setFloat64(0, num, true);
  const u8 = new Uint8Array(ab);
  for (let i = 0; i < 8; i++) buf.push(u8[i]);
}
function serProto(buf, chunk, opMap) {
  buf.push((chunk.nParams || 0) & 255);
  buf.push((chunk.maxRegs || 0) & 255);
  buf.push(chunk.isVararg ? 1 : 0);
  const ups = chunk.upvalues || [];
  buf.push(ups.length & 255);
  const K = chunk.K || [];
  writeVarint(buf, K.length);
  for (const c of K) {
    if (c === null || c === undefined) buf.push(0);
    else if (typeof c === 'boolean') {
      buf.push(1);
      buf.push(c ? 1 : 0);
    } else if (typeof c === 'number') {
      buf.push(2);
      writeF64(buf, c);
    } else {
      const s = String(c);
      buf.push(3);
      writeVarint(buf, s.length);
      for (let i = 0; i < s.length; i++) buf.push(s.charCodeAt(i) & 255);
    }
  }
  const code = chunk.code || [];
  const nInst = chunk.nInstructions != null ? chunk.nInstructions : (code.length / 4) | 0;
  writeVarint(buf, nInst);
  for (let i = 0; i < nInst; i++) {
    const base = i * 4;
    let op = code[base] | 0;
    op = opMap[op & 63] ?? op;
    writeVarint(buf, op);
    writeSignedVarint(buf, code[base + 1] | 0);
    writeSignedVarint(buf, code[base + 2] | 0);
    writeSignedVarint(buf, code[base + 3] | 0);
  }
  const protos = chunk.protos || [];
  writeVarint(buf, protos.length);
  for (const p of protos) serProto(buf, p, opMap);
  for (const u of ups) {
    if (Array.isArray(u)) {
      buf.push(u[0] ? 1 : 0);
      buf.push((u[1] || 0) & 255);
    } else if (u && typeof u === 'object') {
      buf.push(u.isLocal ? 1 : 0);
      buf.push((u.index || 0) & 255);
    } else {
      buf.push(0);
      buf.push(0);
    }
  }
}

/** ---- Light SM (source-level, before bytecode) — style _5i99oqo==N then ... ---- */
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
/** Light SM — user style: while _5i99oqo do if ==N then junk/real elseif ... */
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
  const MAX = 8;
  if (units.length > MAX) {
    units = units.slice(0, MAX - 1).concat([units.slice(MAX - 1).join('\n')]);
  }
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
  // junk states with arithmetic decoy (user style)
  const junkStates = [];
  const nJunk = 3 + randInt(0, 4);
  for (let j = 0; j < nJunk; j++) junkStates.push(sid());
  const st = '_' + randInt(1, 9) + 'abcdefghijklmnopqrstuvwxyz'[randInt(0, 25)] + randInt(10, 99) +
    'abcdefghijklmnopqrstuvwxyz'[randInt(0, 25)] + 'abcdefghijklmnopqrstuvwxyz'[randInt(0, 25)] + randInt(0, 9);
  const branches = [];
  for (let i = 0; i < units.length; i++) {
    const next = i + 1 < units.length ? realStates[i + 1] : halt;
    branches.push({ id: realStates[i], body: units[i].replace(/;\s*$/, ''), next, real: true });
  }
  // chain junk states into a hop path that never runs real code (entry is realStates[0])
  for (let j = 0; j < junkStates.length; j++) {
    const jv = randInt(10, 90);
    const junkBody = 'do local _j' + j + '=' + jv + ' _j' + j + '=(_j' + j + '*3+1)%97 end';
    const next = j + 1 < junkStates.length ? junkStates[j + 1] : realStates[0];
    branches.push({ id: junkStates[j], body: junkBody, next, real: false });
  }
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
    // occasional opaque predicate on junk
    let cond = st + '==' + b.id;
    if (!b.real && Math.random() < 0.4) {
      cond = st + '==' + b.id + ' and (' + randInt(2, 9) + '*' + randInt(2, 9) + '~=' + randInt(100, 200) + ' or true)';
    }
    parts.push((bi === 0 ? 'if ' : 'elseif ') + cond + ' then');
    parts.push(b.body);
    parts.push(st + '=' + (b.next === halt ? 'nil' : b.next));
  }
  parts.push('else ' + st + '=nil end end end');
  return parts.join('\n');
}

function serializeChunk(chunk) {
  const pool = [];
  for (let i = 0; i < 64; i++) pool.push(i);
  for (let i = 63; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i];
    pool[i] = pool[j];
    pool[j] = t;
  }
  const opMap = pool.slice();
  const invMap = new Array(64);
  for (let i = 0; i < 64; i++) invMap[opMap[i]] = i;
  const buf = [];
  // random magic per build (NOT fixed WAN\x01)
  const magic = [randInt(1, 254), randInt(1, 254), randInt(1, 254), randInt(1, 254)];
  buf.push(magic[0], magic[1], magic[2], magic[3]);
  for (let i = 0; i < 64; i++) buf.push(invMap[i] & 255);
  serProto(buf, chunk, opMap);
  // checksum over bytes after magic (unique / payload)
  let sum = 1, sum2 = 0;
  for (let i = 4; i < buf.length; i++) {
    sum = (sum + buf[i]) % 65521;
    sum2 = (sum2 + sum) % 65521;
  }
  const chk = ((sum2 << 16) | sum) >>> 0;
  // embed checksum XOR'd with magic (not plaintext trailer layout only)
  const c0 = ((chk >>> 24) & 255) ^ magic[0];
  const c1 = ((chk >>> 16) & 255) ^ magic[1];
  const c2 = ((chk >>> 8) & 255) ^ magic[2];
  const c3 = (chk & 255) ^ magic[3];
  buf.push(c0, c1, c2, c3);
  return { bytes: Uint8Array.from(buf), checksum: chk, magic };
}

function wanPack(bytes) {
  const ka = makeKey20();
  const kb = makeKey20();
  const nExtra = randInt(20, 60);
  const extra = [];
  for (let i = 0; i < nExtra; i++) extra.push(randInt(0, 255));
  // alphabet base fixed 33 — random 34+ can emit ] [ = and break Lua longstrings
  const alpha = 33;
  const x1 = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) x1[i] = bytes[i] ^ (ka[i % 20] & 255);
  let hex = '';
  for (let i = 0; i < x1.length; i++) hex += x1[i].toString(16).padStart(2, '0').toUpperCase();
  const x2 = new Uint8Array(hex.length);
  for (let i = 0; i < hex.length; i++) x2[i] = hex.charCodeAt(i) ^ (kb[i % 20] & 255);
  let b94 = '';
  const padded = new Uint8Array(Math.ceil(x2.length / 4) * 4);
  padded.set(x2);
  for (let i = 0; i < padded.length; i += 4) {
    let V = ((padded[i] << 24) | (padded[i + 1] << 16) | (padded[i + 2] << 8) | padded[i + 3]) >>> 0;
    for (let j = 0; j < 5; j++) {
      b94 += String.fromCharCode(alpha + (V % 94));
      V = Math.floor(V / 94);
    }
  }
  return { b94, ka, kb, extra, x2len: x2.length, keyCount: 40 + nExtra, alpha, magic: null };
}
function longWrap(s) {
  let eq = '========';
  while (s.indexOf(']' + eq + ']') !== -1) eq += '=';
  return '[' + eq + '[' + s + ']' + eq + ']';
}

/**
 * Emit Runtime: 1-char names, dispatch TABLE (no op==N), parser, buffer.
 * Bytecode arrives already WAN-decoded as byte array `B`.
 */
function emitRuntimeFromBytes(pack) {
  const rn = makeNamePool();
  for (const r of ['R','K','A','B','C','S','i','f','n','t','k','v','u','s','p']) rn();
  // burn reserved handler param letters so outer locals never equal R,K,A,B,C,S,i
  const N = {
    ka: rn(), kb: rn(), fc: rn(), fd: rn(), fe: rn(), ff: rn(), d1: rn(), d2: rn(), d3: rn(), d4: rn(), al: rn(), cx: rn(),
    bx: rn(), wd: rn(), p: rn(), bytes: rn(), buf: rn(), pos: rn(),
    rb: rn(), rv: rn(), rf: rn(), om: rn(), proto: rn(), ch: rn(),
    run: rn(), env: rn(), H: rn(),
    R: rn(), K: rn(), code: rn(), P: rn(), ip: rn(), top: rn(),
    va: rn(), A: rn(), B: rn(), C: rn(), op: rn(), base: rn(),
    RK: rn(), un: rn(), rsv: rn(),
  };

  const L = [];
  {
    let esc = '"';
    for (let i = 0; i < 256; i++) esc += '\\' + String(i).padStart(3, '0');
    esc += '"';
    L.push(`local ${N.al}=` + esc);
    L.push(`local function ${N.cx}(n) n=math.floor((tonumber(n)or 0)%256) return ${N.al}:sub(n+1,n+1) end`);
  }
  // key scatter + 6 fake vmaps same shape
  L.push(`local ${N.ka}={} local ${N.kb}={} local ${N.fc}={} local ${N.fd}={} local ${N.fe}={} local ${N.ff}={}`);
  const writes = [];
  for (let i = 0; i < 20; i++) {
    writes.push(`${N.ka}[${i + 1}]=${deepKeyExpr(pack.ka[i])}`);
    writes.push(`${N.kb}[${i + 1}]=${deepKeyExpr(pack.kb[i])}`);
    writes.push(`${N.fc}[${i + 1}]=${deepKeyExpr(randInt(0, 255))}`);
    writes.push(`${N.fd}[${i + 1}]=${deepKeyExpr(randInt(0, 255))}`);
    writes.push(`${N.fe}[${i + 1}]=${deepKeyExpr(randInt(0, 255))}`);
    writes.push(`${N.ff}[${i + 1}]=${deepKeyExpr(randInt(0, 255))}`);
  }
  for (let i = writes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = writes[i];
    writes[i] = writes[j];
    writes[j] = t;
  }
  L.push(...writes);
  L.push(`if false then ${N.ka}=${N.fc} ${N.kb}=${N.fd} end`);
  L.push(`if (0>1) then ${N.ka}=${N.fe} ${N.kb}=${N.ff} end`);

  // b94 payload
  const chunk = 1000;
  const parts = [];
  for (let i = 0; i < pack.b94.length; i += chunk) parts.push(longWrap(pack.b94.slice(i, i + chunk)));
  const b94e =
    parts.length === 1
      ? parts[0]
      : `(function() local t={${parts.join(',')}} local s="" for i=1,#t do s=s..t[i] end return s end)()`;
  L.push(`local ${N.p}=${b94e}`);

  // WAN decode
  L.push(
    `local function ${N.bx}(a,b) a=math.floor((tonumber(a)or 0)%256) b=math.floor((tonumber(b)or 0)%256) if bit32 and bit32.bxor then return bit32.bxor(a,b)%256 end local r,p=0,1 for i=0,7 do local x,y=a%2,b%2 if x~=y then r=r+p end a=math.floor((a-x)/2) b=math.floor((b-y)/2) p=p*2 end return r%256 end`
  );
  const _alpha = (pack.alpha != null ? pack.alpha : 33);
  // Real decode chain (3 stages) + 4 fake twins (wrong key / wrong alpha / no xor)
  // Names all 1-char random via N.d1.. + extra rn() so static deobf cannot tell which is live
  const fk1 = rn(), fk2 = rn(), fk3 = rn(), fk4 = rn();
  const fk5 = rn(), fk6 = rn(), fk7 = rn(), fk8 = rn();
  const fakeKeyA = makeKey20();
  const fakeKeyB = makeKey20();
  // scatter fake key tables (look identical to real ka/kb)
  L.push(`local ${fk5}={} local ${fk6}={}`);
  for (let i = 0; i < 20; i++) {
    L.push(`${fk5}[${i + 1}]=${deepKeyExpr(fakeKeyA[i])}`);
    L.push(`${fk6}[${i + 1}]=${deepKeyExpr(fakeKeyB[i])}`);
  }
  // REAL stage1: base94 → bytes
  L.push(`local function ${N.d1}(s) local A=${deepKeyExpr(_alpha)} local out={} local n=#s for i=1,n,5 do local V=0 local p=1 for j=0,4 do local c=s:byte(i+j) or A V=V+(c-A)*p p=p*94 end out[#out+1]=math.floor(V/16777216)%256 out[#out+1]=math.floor(V/65536)%256 out[#out+1]=math.floor(V/256)%256 out[#out+1]=V%256 end return out end`);
  // FAKE stage1 twins (wrong alphabet offset → garbage)
  L.push(`local function ${fk1}(s) local A=${deepKeyExpr((_alpha + 7) % 50 + 30)} local out={} local n=#s for i=1,n,5 do local V=0 local p=1 for j=0,4 do local c=s:byte(i+j) or A V=V+(c-A)*p p=p*94 end out[#out+1]=math.floor(V/16777216)%256 out[#out+1]=math.floor(V/65536)%256 out[#out+1]=math.floor(V/256)%256 out[#out+1]=V%256 end return out end`);
  L.push(`local function ${fk2}(s) local A=${deepKeyExpr((_alpha + 13) % 40 + 33)} local out={} local n=#s for i=1,n,5 do local V=0 local p=1 for j=0,4 do local c=s:byte(i+j) or A V=V+(c-A)*p p=p*91 end out[#out+1]=math.floor(V/16777216)%256 out[#out+1]=math.floor(V/65536)%256 out[#out+1]=math.floor(V/256)%256 out[#out+1]=V%256 end return out end`);
  // REAL stage2: xor kb → hex chars
  L.push(`local function ${N.d2}(out) local x2len=${pack.x2len} local hexChars={} for i=1,x2len do local bb=out[i] or 0 bb=${N.bx}(bb,${N.kb}[((i-1)%20)+1] or 0) hexChars[i]=${N.cx}(bb) end local hex="" for i=1,x2len do hex=hex..(hexChars[i] or "") end return hex end`);
  // FAKE stage2 (wrong key table)
  L.push(`local function ${fk3}(out) local x2len=${pack.x2len} local hexChars={} for i=1,x2len do local bb=out[i] or 0 bb=${N.bx}(bb,${fk6}[((i-1)%20)+1] or 0) hexChars[i]=${N.cx}(bb) end local hex="" for i=1,x2len do hex=hex..(hexChars[i] or "") end return hex end`);
  // REAL stage3: hex → xor ka → raw
  L.push(`local function ${N.d3}(hex) local raw={} for i=1,#hex,2 do local hi=tonumber(hex:sub(i,i+1),16) or 0 local idx=((i-1)/2)+1 raw[idx]=${N.bx}(hi,${N.ka}[((idx-1)%20)+1] or 0) end return raw end`);
  // FAKE stage3
  L.push(`local function ${fk4}(hex) local raw={} for i=1,#hex,2 do local hi=tonumber(hex:sub(i,i+1),16) or 0 local idx=((i-1)/2)+1 raw[idx]=${N.bx}(hi,${fk5}[((idx-1)%20)+1] or 0) end return raw end`);
  L.push(`local function ${N.d4}(s) local t={} for i=1,#s do t[i]=(s:byte(i) or 0) end return t end`);
  L.push(`local function ${fk7}(s) local t={} for i=1,#s do t[i]=${N.bx}(s:byte(i) or 0,${deepKeyExpr(randInt(1,200))}) end return t end`);
  L.push(`local function ${fk8}(a,b,c) return ${fk4}(${fk3}(${fk1}(a or ${N.p}))) end`);
  // Dead calls so deobf sees multiple entry points
  L.push(`if false then local _=${fk8}(${N.p}) local __=${fk7}(${N.p}) local ___=${fk2}(${N.p}) end`);
  // intermediate identity transforms (look like real crypto steps)
  const mid1 = rn(), mid2 = rn(), mid3 = rn();
  const ik = randInt(1, 255);
  L.push(`local function ${mid1}(t) local o={} local k=${deepKeyExpr(ik)} for i=1,#t do o[i]=${N.bx}(${N.bx}(t[i] or 0,k),k) end return o end`);
  L.push(`local function ${mid2}(s) if type(s)~="string" then return s end local o="" local k=${deepKeyExpr(ik)} for i=1,#s do local b=s:byte(i) or 0 o=o..${N.cx}(${N.bx}(${N.bx}(b,k),k)) end return o end`);
  L.push(`local function ${mid3}(t) local n=#t local o={} for i=1,n do o[i]=t[i] end return o end`);
  // opaque pick: only real path when 1+1==2; fakes never run
  L.push(`local ${N.bytes}=(function() local a,b,c if (1+1==2) then a=${N.d1}(${N.p}) a=${mid1}(a) b=${N.d2}(a) b=${mid2}(b) c=${N.d3}(b) c=${mid3}(c) else a=${fk1}(${N.p}) b=${fk3}(a) c=${fk4}(b) end return c end)()`);
  // Clyde-style anti-hook: debug.info / getinfo — names via alphabet, no plaintext
  L.push(`do local _dn=${N.cx}(100)..${N.cx}(101)..${N.cx}(98)..${N.cx}(117)..${N.cx}(103) local _in=${N.cx}(105)..${N.cx}(110)..${N.cx}(102)..${N.cx}(111) local _gi=${N.cx}(103)..${N.cx}(101)..${N.cx}(116)..${N.cx}(105)..${N.cx}(110)..${N.cx}(102)..${N.cx}(111) local _ok,_d=pcall(function() local e=getfenv and getfenv(0) return type(e)=="table" and e[_dn] or nil end) if type(_d)~="table" then _ok,_d=pcall(function() return rawget(getfenv and getfenv(0) or {},_dn) end) end if type(_d)=="table" then if type(_d.sethook)=="function" then pcall(function() _d.sethook() end) end local _inf=_d[_in] or _d[_gi] if type(_inf)=="function" then local function _isC(fn) local ok,r=pcall(_inf,fn,"s") if not ok then ok,r=pcall(_inf,fn,"S") end if ok and type(r)=="string" then return r==${N.cx}(91)..${N.cx}(67)..${N.cx}(93) or r:sub(1,3)==${N.cx}(91)..${N.cx}(67)..${N.cx}(93) end if ok and type(r)=="table" and r.what then return r.what==${N.cx}(67) end return true end local _bad=false if not _isC(pcall) then _bad=true end if type(print)=="function" and not _isC(print) then _bad=true end if type(tostring)=="function" and not _isC(tostring) then _bad=true end if _bad then for i=1,#${N.bytes} do ${N.bytes}[i]=${N.bx}(${N.bytes}[i] or 0,${deepKeyExpr(randInt(1,200))}) end return end end end end`);


  // buffer.fromstring
  L.push(
    `local ${N.buf} if type(buffer)=="table" and type(buffer.fromstring)=="function" then local t={} for i=1,#${N.bytes} do t[i]=${N.cx}(${N.bytes}[i]%256) end local ss="" for i=1,#${N.bytes} do ss=ss..(t[i] or "") end ${N.buf}=buffer.fromstring(ss) else ${N.buf}=${N.bytes} end`
  );
  L.push(`local ${N.pos}=1`);
  L.push(
    `local function ${N.rb}() local b if type(${N.buf})=="table" and ${N.buf}[1]~=nil then b=${N.buf}[${N.pos}] or 0 elseif type(buffer)=="table" and type(buffer.readu8)=="function" then b=buffer.readu8(${N.buf},${N.pos}-1) else b=0 end ${N.pos}=${N.pos}+1 return b end`
  );
  L.push(
    `local function ${N.rv}() local x,s,n=0,0,0 repeat local b=${N.rb}() x=x+((b%128)*(2^s)) s=s+7 n=n+1 until b<128 or n>6 return math.floor(x) end`
  );
  L.push(
    `local function ${N.rsv}() local u=${N.rv}() local sign=u%2 local v=math.floor(u/2) if sign==1 then return -v-1 end return v end`
  );
  L.push(
    `local function ${N.rf}() local b={} for i=1,8 do b[i]=${N.rb}() end if string.unpack then local s="" for i=1,8 do s=s..${N.cx}(b[i]) end return string.unpack("<d",s) end return b[1]+b[2]*256+b[3]*65536+b[4]*16777216 end`
  );

  // magic (per-build, opaque compare — not WAN\x01)
  const mg = (pack.magic && pack.magic.length === 4) ? pack.magic : [87, 65, 78, 1];
  L.push(
    `do local a,b,c,d=${N.rb}(),${N.rb}(),${N.rb}(),${N.rb}() local e0,e1,e2,e3=${deepKeyExpr(mg[0])},${deepKeyExpr(mg[1])},${deepKeyExpr(mg[2])},${deepKeyExpr(mg[3])} if a~=e0 or b~=e1 or c~=e2 or d~=e3 then return end end`
  );
  L.push(`local ${N.om}={} for i=0,63 do ${N.om}[i]=${N.rb}() end`);


  // All structure field names 1-char random — never K/code/nInst/op plaintext
  const F = {
    K: rn(), code: rn(), nInst: rn(), maxRegs: rn(), nParams: rn(),
    isVA: rn(), P: rn(), ups: rn(),
    ip: rn(), top: rn(), env: rn(), uv: rn(),
  };
  const rnU = makeNamePool(); // will use upper only below
  const _U = "ABCDEFGHJKLMNPQRSTUVWXYZ".split("");
  for (let _i=_U.length-1;_i>0;_i--){const _j=Math.floor(Math.random()*(_i+1));const _t=_U[_i];_U[_i]=_U[_j];_U[_j]=_t;}
  let _ui=0; const rnUpper=()=>_U[_ui++];
  const hR = rn(), hK = rn(), hA = rn(), hB = rn(), hC = rn(), hS = rn();

  // parser
  L.push(`local function ${N.proto}()`);
  const Lnp=rn(),Lmr=rn(),Liv=rn(),Lnu=rn(),Lnk=rn(),Lk=rn(),Lni=rn(),Lcd=rn(),Lbs=rn(),Lnpr=rn(),Lpr=rn(),Lup=rn(),Lty=rn(),Lln=rn(),Lss=rn(),Lz=rn(),Lu=rn(),Lv=rn(),Lw=rn();
  L.push(`local ${Lnp}=${N.rb}() local ${Lmr}=${N.rb}() local ${Liv}=${N.rb}() local ${Lnu}=${N.rb}() local ${Lnk}=${N.rv}() local ${Lk}={} for i=1,${Lnk} do local ${Lty}=${N.rb}() if ${Lty}==0 then ${Lk}[i]=nil elseif ${Lty}==1 then ${Lk}[i]=(${N.rb}()~=0) elseif ${Lty}==2 then ${Lk}[i]=${N.rf}() else local ${Lln}=${N.rv}() local t={} for j=1,${Lln} do t[j]=${N.cx}(${N.rb}()) end local ${Lss}="" for j=1,${Lln} do ${Lss}=${Lss}..t[j] end ${Lk}[i]=${Lss} end end`);
  L.push(`local ${Lni}=${N.rv}() local ${Lcd}={} for i=1,${Lni} do local ${Lz}=${N.rv}() ${Lz}=${N.om}[${Lz}%64] or ${Lz} local ${Lu}=${N.rsv}() local ${Lv}=${N.rsv}() local ${Lw}=${N.rsv}() local ${Lbs}=(i-1)*4 ${Lcd}[${Lbs}+1]=${Lz} ${Lcd}[${Lbs}+2]=${Lu} ${Lcd}[${Lbs}+3]=${Lv} ${Lcd}[${Lbs}+4]=${Lw} end`);
  L.push(`local ${Lnpr}=${N.rv}() local ${Lpr}={} for i=1,${Lnpr} do ${Lpr}[i]=${N.proto}() end local ${Lup}={} for i=1,${Lnu} do ${Lup}[i]={${N.rb}(),${N.rb}()} end return {["${F.K}"]=${Lk},["${F.code}"]=${Lcd},["${F.nInst}"]=${Lni},["${F.maxRegs}"]=${Lmr},["${F.nParams}"]=${Lnp},["${F.isVA}"]=${Liv},["${F.P}"]=${Lpr},["${F.ups}"]=${Lup}} end`);

  L.push(`local ${N.ch}=${N.proto}()`);
  // checksum: trailer XOR magic (layout not obvious plaintext adler)
  L.push(`do local b=${N.bytes} local n=#b if n>=8 then local sum,sum2=1,0 for i=5,n-4 do local v=b[i] or 0 sum=(sum+v)%65521 sum2=(sum2+sum)%65521 end local got=(sum2*65536+sum)%4294967296 local m0,m1,m2,m3=b[1] or 0,b[2] or 0,b[3] or 0,b[4] or 0 local exp=(${N.bx}(b[n-3] or 0,m0)*16777216+${N.bx}(b[n-2] or 0,m1)*65536+${N.bx}(b[n-1] or 0,m2)*256+${N.bx}(b[n] or 0,m3))%4294967296 if got~=exp then return end end end`);

  L.push(`local ${N.un}=table.unpack or unpack`);
  L.push(`local function ${N.RK}(${hR},${hK},x) if x>=256 then return ${hK}[x-255] end return ${hR}[x+1] end`);

  // handlers with mangled param names
  const handlers = {
    1: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hR}[${hA}+1]=${hK}[${hB}+1] end`,
    2: `function(${hR},${hK},${hA},${hB},${hC},${hS}) for i=${hA},${hA}+${hB} do ${hR}[i+1]=nil end end`,
    3: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hR}[${hA}+1]=(${hB}~=0) if ${hC}~=0 then ${hS}["${F.ip}"]=${hS}["${F.ip}"]+1 end end`,
    4: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hR}[${hA}+1]=${hR}[${hB}+1] end`,
    5: `function(${hR},${hK},${hA},${hB},${hC},${hS}) local n=${hK}[${hB}+1] ${hR}[${hA}+1]=${hS}["${F.env}"][n] end`,
    6: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hS}["${F.env}"][${hK}[${hB}+1]]=${hR}[${hA}+1] end`,
    7: `function(${hR},${hK},${hA},${hB},${hC},${hS}) local t=${hR}[${hB}+1] local k=${N.RK}(${hR},${hK},${hC}) if t==nil or k==nil then ${hR}[${hA}+1]=nil else local ok,v=pcall(function() return t[k] end) ${hR}[${hA}+1]=ok and v or nil end end`,
    8: `function(${hR},${hK},${hA},${hB},${hC},${hS}) local t=${hR}[${hA}+1] if t~=nil then local k=${N.RK}(${hR},${hK},${hB}) local v=${N.RK}(${hR},${hK},${hC}) pcall(function() t[k]=v end) end end`,
    9: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hR}[${hA}+1]={} end`,
    10: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hR}[${hA}+1]=${N.RK}(${hR},${hK},${hB})+${N.RK}(${hR},${hK},${hC}) end`,
    11: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hR}[${hA}+1]=${N.RK}(${hR},${hK},${hB})-${N.RK}(${hR},${hK},${hC}) end`,
    12: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hR}[${hA}+1]=${N.RK}(${hR},${hK},${hB})*${N.RK}(${hR},${hK},${hC}) end`,
    13: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hR}[${hA}+1]=${N.RK}(${hR},${hK},${hB})/${N.RK}(${hR},${hK},${hC}) end`,
    14: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hR}[${hA}+1]=${N.RK}(${hR},${hK},${hB})%${N.RK}(${hR},${hK},${hC}) end`,
    15: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hR}[${hA}+1]=${N.RK}(${hR},${hK},${hB})^${N.RK}(${hR},${hK},${hC}) end`,
    16: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hR}[${hA}+1]=math.floor(${N.RK}(${hR},${hK},${hB})/${N.RK}(${hR},${hK},${hC})) end`,
    17: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hR}[${hA}+1]=-${hR}[${hB}+1] end`,
    18: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hR}[${hA}+1]=not ${hR}[${hB}+1] end`,
    19: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hR}[${hA}+1]=#${hR}[${hB}+1] end`,
    20: `function(${hR},${hK},${hA},${hB},${hC},${hS}) local s=tostring(${hR}[${hB}+1] or "") for i=${hB}+1,${hC} do s=s..tostring(${hR}[i+1] or "") end ${hR}[${hA}+1]=s end`,
    21: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hS}["${F.ip}"]=${hS}["${F.ip}"]+${hB} end`,
    22: `function(${hR},${hK},${hA},${hB},${hC},${hS}) if (${N.RK}(${hR},${hK},${hB})==${N.RK}(${hR},${hK},${hC}))~=(${hA}~=0) then ${hS}["${F.ip}"]=${hS}["${F.ip}"]+1 end end`,
    23: `function(${hR},${hK},${hA},${hB},${hC},${hS}) if (${N.RK}(${hR},${hK},${hB})<${N.RK}(${hR},${hK},${hC}))~=(${hA}~=0) then ${hS}["${F.ip}"]=${hS}["${F.ip}"]+1 end end`,
    24: `function(${hR},${hK},${hA},${hB},${hC},${hS}) if (${N.RK}(${hR},${hK},${hB})<=${N.RK}(${hR},${hK},${hC}))~=(${hA}~=0) then ${hS}["${F.ip}"]=${hS}["${F.ip}"]+1 end end`,
    25: `function(${hR},${hK},${hA},${hB},${hC},${hS}) if (not ${hR}[${hA}+1])==(${hC}~=0) then ${hS}["${F.ip}"]=${hS}["${F.ip}"]+1 end end`,
    26: `function(${hR},${hK},${hA},${hB},${hC},${hS}) local v=${hR}[${hB}+1] ${hR}[${hA}+1]=v if (not v)==(${hC}~=0) then ${hS}["${F.ip}"]=${hS}["${F.ip}"]+1 end end`,
    27: `function(${hR},${hK},${hA},${hB},${hC},${hS}) local narg=${hB} if narg==0 then narg=${hS}["${F.top}"]-${hA} else narg=narg-1 end if narg<0 then narg=0 end local nret=${hC} local fn=${hR}[${hA}+1] if fn==nil then if nret==0 then ${hR}[${hA}+1]=nil elseif nret>1 then for i=1,nret-1 do ${hR}[${hA}+i]=nil end end else local args={} for i=1,narg do args[i]=${hR}[${hA}+1+i] end local ok,a1,a2,a3,a4,a5,a6,a7,a8=pcall(fn,${N.un}(args,1,narg)) if not ok then if nret==0 then ${hR}[${hA}+1]=nil elseif nret>1 then for i=1,nret-1 do ${hR}[${hA}+i]=nil end end else local res={a1,a2,a3,a4,a5,a6,a7,a8} if nret==0 then for i=1,#res do ${hR}[${hA}+i]=res[i] end ${hS}["${F.top}"]=${hA}+#res elseif nret==1 then else for i=1,nret-1 do ${hR}[${hA}+i]=res[i] end end end end end`,
    28: `function(${hR},${hK},${hA},${hB},${hC},${hS}) local narg=${hB} if narg==0 then narg=${hS}["${F.top}"]-${hA} else narg=narg-1 end local fn=${hR}[${hA}+1] local args={} for i=1,narg do args[i]=${hR}[${hA}+1+i] end if type(fn)=="function" then if narg>0 then return fn(${N.un}(args,1,narg)) else return fn() end else return end end`,
    29: `function(${hR},${hK},${hA},${hB},${hC},${hS}) local nval=${hB} if nval==0 then nval=math.max(0,${hS}["${F.top}"]-${hA}+1) elseif nval>=1 then nval=nval-1 end if nval<=0 then return end return ${N.un}(${hR},${hA}+1,${hA}+nval) end`,
    34: `function(${hR},${hK},${hA},${hB},${hC},${hS}) local pr=${hS}["${F.P}"][${hB}+1] local uvs={} if pr then local ups=pr["${F.ups}"] or {} for i=1,#ups do local u=ups[i] if type(u)=="table" then if (u[1] or 0)~=0 then uvs[i]={c=1,v=${hR}[(u[2] or 0)+1]} else local pu=(${hS}["${F.uv}"] or {})[((u[2] or 0)+1)] if type(pu)=="table" and pu.c then uvs[i]={c=1,v=pu.v} else uvs[i]=pu end end else uvs[i]=(${hS}["${F.uv}"] or {})[i] end end ${hR}[${hA}+1]=function(...) return ${N.run}(pr,uvs,${hS}["${F.env}"],...) end else ${hR}[${hA}+1]=function() end end end`,
    36: `function(${hR},${hK},${hA},${hB},${hC},${hS}) local obj=${hR}[${hB}+1] ${hR}[${hA}+2]=obj local k=${N.RK}(${hR},${hK},${hC}) if obj==nil or k==nil then ${hR}[${hA}+1]=nil else local ok,v=pcall(function() return obj[k] end) ${hR}[${hA}+1]=ok and v or nil end end`,
    37: `function(${hR},${hK},${hA},${hB},${hC},${hS}) local u=(${hS}["${F.uv}"] or {})[${hB}+1] if type(u)=="table" then if u.c then ${hR}[${hA}+1]=u.v elseif u.r then ${hR}[${hA}+1]=u.r[(u.i or 0)+1] else ${hR}[${hA}+1]=u end else ${hR}[${hA}+1]=u end end`,
    38: `function(${hR},${hK},${hA},${hB},${hC},${hS}) local u=(${hS}["${F.uv}"] or {})[${hB}+1] if type(u)=="table" then if u.c then u.v=${hR}[${hA}+1] elseif u.r then u.r[(u.i or 0)+1]=${hR}[${hA}+1] end end end`,
    39: `function(${hR},${hK},${hA},${hB},${hC},${hS}) end`,
    30: `function(${hR},${hK},${hA},${hB},${hC},${hS}) ${hR}[${hA}+1]=${hR}[${hA}+1]-${hR}[${hA}+3] ${hS}["${F.ip}"]=${hS}["${F.ip}"]+${hB} end`,
    31: `function(${hR},${hK},${hA},${hB},${hC},${hS}) local step=${hR}[${hA}+3] local idx=${hR}[${hA}+1]+step ${hR}[${hA}+1]=idx local lim=${hR}[${hA}+2] if step>0 then if idx<=lim then ${hS}["${F.ip}"]=${hS}["${F.ip}"]+${hB} ${hR}[${hA}+4]=idx end else if idx>=lim then ${hS}["${F.ip}"]=${hS}["${F.ip}"]+${hB} ${hR}[${hA}+4]=idx end end end`,
    32: `function(${hR},${hK},${hA},${hB},${hC},${hS}) local f=${hR}[${hA}+1] local s=${hR}[${hA}+2] local v=${hR}[${hA}+3] local r={f(s,v)} for _i=1,${hC} do ${hR}[${hA}+3+_i]=r[_i] end if r[1]~=nil then ${hR}[${hA}+3]=r[1] ${hS}["${F.ip}"]=${hS}["${F.ip}"]+1 end end`,
  };

  L.push(`local ${N.run}`);
  L.push(`local ${N.H}={}`);
  const opKeys = Object.keys(handlers).map(Number);
  for (let i = opKeys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = opKeys[i]; opKeys[i] = opKeys[j]; opKeys[j] = tmp;
  }
  for (const op of opKeys) {
    const a = 2 + Math.floor(Math.random() * 9);
    const c = Math.floor(Math.random() * a);
    const b = Math.floor((op - c) / a);
    const expr = (a * b + c === op) ? `(${a}*${b}+${c})` : String(op);
    L.push(`${N.H}[${expr}]=${handlers[op]}`);
  }
  for (let i = 0; i < 12; i++) {
    L.push(`${N.H}[${50 + Math.floor(Math.random() * 40)}]=function() end`);
  }

  L.push(`${N.run}=function(ch,uv,env,...)`);;
  L.push(`local ${hR}={} local ${hK}=ch["${F.K}"] local ${Lcd}=ch["${F.code}"] local ${Lpr}=ch["${F.P}"] or {} local ${hS}={["${F.ip}"]=0,["${F.top}"]=0,["${F.env}"]=env,["${F.P}"]=${Lpr},["${F.uv}"]=uv} local vararg={...} local nparams=ch["${F.nParams}"] or 0 for i=1,nparams do ${hR}[i]=vararg[i] end if ch["${F.isVA}"] and ch["${F.isVA}"]~=0 then for i=nparams+1,#vararg do ${hR}[i]=vararg[i] end end`);
  L.push(`while true do local ${Lbs}=${hS}["${F.ip}"]*4 local ${Lz}=${Lcd}[${Lbs}+1] if ${Lz}==nil then break end local ${hA}=${Lcd}[${Lbs}+2] or 0 local ${hB}=${Lcd}[${Lbs}+3] or 0 local ${hC}=${Lcd}[${Lbs}+4] or 0 local f=${N.H}[${Lz}] if f then local r=f(${hR},${hK},${hA},${hB},${hC},${hS}) if r~=nil or (${Lz}>27 and ${Lz}<30) then return r end end ${hS}["${F.ip}"]=${hS}["${F.ip}"]+1 end end`);

  // Env: getfenv only — no _ENV/_G/shared/game/workspace tokens
  L.push(`local ${N.env}=setmetatable({},{__index=function(_,k) local ok,v=pcall(function() local e=getfenv and getfenv(0) if type(e)=="table" then return e[k] end end) if ok and v~=nil then return v end ok,v=pcall(function() local e=getfenv and getfenv(1) if type(e)=="table" then return e[k] end end) if ok and v~=nil then return v end return nil end})`);
  L.push(`${N.run}(${N.ch},{},${N.env})`);


  return L.join(' ');
}


/**
 * Outer surface: setmetatable + decoy + AT.
 * Real method WAN-decodes FULL packed runtime (junk50KB + VM) then loadstring once.
 * User payload stays bytecode inside VM — no source of user script.
 */

/**
 * setmetatable surface — runtime INLINE (no loadstring).
 * 50KB junk as real longstrings in method body.
 */
function buildShell(runtime, opts = {}) {
  const noAT = !!opts.noAT;
  const method = methodName();
  const nDecoy = randInt(60, 100);
  const nAnti = randInt(30, 50);
  const atList = noAT ? [] : AT_FRAGS;
  const ids = uniqueIds(nDecoy + nAnti + atList.length + 8, 100, 4000);
  const entries = [];
  for (let i = 0; i < nDecoy; i++) entries.push({ id: ids[i], body: decoyFn() });
  for (let i = 0; i < nAnti; i++) entries.push({ id: ids[nDecoy + i], body: antiDeobfSlot() });
  for (let i = 0; i < atList.length; i++)
    entries.push({
      id: ids[nDecoy + nAnti + i],
      body: `function(...) ${atList[i]} end`,
      at: true,
    });
  for (let i = 0; i < 6; i++) {
    const vals = Array.from({ length: 8 }, () => deepKeyExpr(randInt(0, 255))).join(',');
    entries.push({
      id: 9000 + i,
      body: `function() local _v={${vals}} return _v end`,
    });
  }
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = entries[i];
    entries[i] = entries[j];
    entries[j] = tmp;
  }
  const atIds = entries.filter((e) => e.at).map((e) => e.id);
  // Surface AT slots = decoys only (real AT runs inside bytecode layer2)
  const atBoot =
    atIds.length > 0
      ? `for _,i in ipairs({${atIds.join(',')}}) do local f=rawget(self,i) if type(f)=="function" then pcall(f) end end `
      : '';

  // 50KB+ junk INLINE (not packed — no loadstring needed)
  const junk = emitJunk50KB();
  const realBody = `function(self,...) ${atBoot}${junk} ${runtime} end`;
  const tableParts = entries.map((e) => `[${e.id}]=${e.body}`);
  tableParts.push(`${method}=${realBody}`);
  return `return setmetatable({${tableParts.join(',')}},{}):${method}(...)`;
}

export function obfuscateClydeWan(source, opts = {}) {
  if (!clydeAvailable()) throw new Error('Clyde not available');
  const debug = !!opts.debug;
  const log = debug ? (m) => console.log('[WAN-Clyde] ' + m) : () => {};

  // 1) binary bytecode
  // Light SM: auto only for small scripts (<=8 units). Large GUI → skip (prevents hang).
  // Force ON: opts.sm / opts.cfLight. Force OFF: opts.noSM.
  let srcIn = String(source || '');
  const forceSM = !!(opts && (opts.sm || opts.cfLight));
  const forceNoSM = !!(opts && opts.noSM);
  if (!forceNoSM) {
    try {
      let nUnits = 99;
      try {
        const u = splitTopLevelStatements(srcIn);
        nUnits = (u && u.length) || 99;
      } catch (_) {}
      if (forceSM || nUnits <= 8) {
        const sm = toStateMachineLight(srcIn);
        if (sm && sm.length > srcIn.length * 0.5) {
          srcIn = sm;
          log('SM light applied units=' + nUnits + ' len=' + srcIn.length);
        }
      } else {
        log('SM skip large script units=' + nUnits);
      }
    } catch (e) {
      log('SM skip: ' + (e && e.message));
    }
  }

  // Layer-2 AT: compile user AT into bytecode (not surface plaintext control)
  const wantAT = !(opts && opts.noAT);
  if (wantAT) {
    const atSrc =
      'do local a=string.sub(tostring({}),8,15) local b=string.sub(tostring({}),8,15) ' +
      'if a==b or not game then ' +
      '_G.elysium_was_here=math.random() ' +
      'print("WAN OBFUSCATE chao may ku:>") return end end\n';
    srcIn = atSrc + srcIn;
    log('AT layer2 prepended into bytecode source');
  }

  log('Clyde regCompile...');
  const cr = compileClydeChunk(srcIn, {
    noCF: !!(opts && opts.noCF),
    seed: opts && opts.seed,
  });
  if (!cr || !cr.ok) throw new Error('Clyde compile failed: ' + (cr && cr.error));
  const ser = serializeChunk(cr.chunk);
  const bin = ser.bytes;
  log('bytecode ' + bin.length + ' bytes checksum=' + (ser.checksum >>> 0));

  // 2) WAN pack ONLY bytecode (xor20→hex→xor20→base94 + random alpha)
  const pack = wanPack(bin);
  pack.checksum = ser.checksum;
  pack.magic = ser.magic;
  log('WAN pack keys=' + pack.keyCount + ' b94=' + pack.b94.length + ' alpha=' + pack.alpha);

  // 3) Runtime INLINE: buffer → parser → VM (no loadstring)
  const runtime = emitRuntimeFromBytes(pack);
  if (/\bloadstring\b/.test(runtime) || /\bload\s*\(/.test(runtime))
    throw new Error('loadstring/load leaked in runtime');
  if (/op==\d/.test(runtime)) throw new Error('op==N leaked');
  log('runtime ' + runtime.length);

  // 4) setmetatable + 50KB junk inline + VM run
  let code = buildShell(runtime, opts);
  code = code.replace(/\s+/g, ' ').trim();
  if (!code.startsWith('return setmetatable')) throw new Error('bad start');
  if (/\bloadstring\b/.test(code)) throw new Error('loadstring in output');
  // ban bare load(
  if (/(^|[^a-zA-Z_])load\s*\(/.test(code)) throw new Error('load( in output');

  log('final ' + code.length + ' (~' + (code.length / 1024).toFixed(1) + 'KB)');
  return {
    code,
    meta: {
      mode: 'clyde-wan', backend: 'clyde-cf-max',
      loadstring: false,
      bytes: bin.length,
      keys: pack.keyCount,
      out: code.length,
    },
  };
}

export default obfuscateClydeWan;
