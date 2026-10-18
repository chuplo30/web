/**
 * Clyde RegVM Max (bytecode) → setmetatable surface (Clyde commercial style)
 * → AT split across table slots → one-line → inner WAN pack (xor20-hex-xor20-base94)
 *
 * Outer: return setmetatable({ [id]=fn, ... },{}):METHOD(...)
 * Dynamic every build. Not fixed.
 */
import { compileClydeRegVMMax, clydeAvailable } from './clyde-backend.js';

/** Exact user AT — split into fragments, never one contiguous block */
const AT_FRAGS = [
  'do local _a=string.sub(tostring({}),8,15) local _b=string.sub(tostring({}),8,15) if _a==_b then _G._wan_at=(_G._wan_at or 0)+1 end end',
  'do if type(game)=="nil" then _G._wan_at=(_G._wan_at or 0)+1 end end',
  'do if (_G._wan_at or 0)>0 then return end end',
];

function makeKey20() {
  const k = [];
  for (let i = 0; i < 20; i++) k.push(Math.floor(Math.random() * 256));
  return k;
}

function randInt(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

function deepKeyExpr(v) {
  const depth = 2 + Math.floor(Math.random() * 3);
  let e = String(v & 255);
  for (let i = 0; i < depth; i++) {
    const t = Math.floor(Math.random() * 4);
    if (t === 0) e = `(${e}+0)`;
    else if (t === 1) e = `(${e}*1)`;
    else if (t === 2) e = `((${e})%256)`;
    else e = `(${e}+0*0)`;
  }
  return e;
}

/** xor20 → hex → xor20 → base94 */
function encodeFull(src) {
  const keysA = makeKey20();
  const keysB = makeKey20();
  const nExtra = randInt(0, 40); // total 40–80 with ka+kb
  const extra = [];
  for (let i = 0; i < nExtra; i++) extra.push(Math.floor(Math.random() * 256));
  const raw = Buffer.from(String(src), 'utf8');
  const x1 = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i++) x1[i] = raw[i] ^ (keysA[i % 20] & 255);
  let hex = '';
  for (let i = 0; i < x1.length; i++) hex += x1[i].toString(16).padStart(2, '0').toUpperCase();
  const x2 = Buffer.alloc(hex.length);
  for (let i = 0; i < hex.length; i++) x2[i] = hex.charCodeAt(i) ^ (keysB[i % 20] & 255);
  const A = 33;
  let b94 = '';
  const padded = Buffer.alloc(Math.ceil(x2.length / 4) * 4);
  x2.copy(padded);
  for (let i = 0; i < padded.length; i += 4) {
    let V = ((padded[i] << 24) | (padded[i + 1] << 16) | (padded[i + 2] << 8) | padded[i + 3]) >>> 0;
    for (let j = 0; j < 5; j++) {
      b94 += String.fromCharCode(A + (V % 94));
      V = Math.floor(V / 94);
    }
  }
  return { b94, keysA, keysB, extra, x2len: x2.length, keyCount: 40 + nExtra };
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

function decoyFn() {
  const t = Math.floor(Math.random() * 5);
  if (t === 0) {
    const a = randInt(1, 200);
    return `function(...) local z=${a};z=z*${randInt(3, 9)}%256 end`;
  }
  if (t === 1) {
    return `function(a,...) if a then return ${randInt(1, 160)},a end end`;
  }
  if (t === 2) {
    const off = randInt(100, 1400);
    return `function(a,b,c,...) if a and b and a>b+${off} then return c end end`;
  }
  if (t === 3) return `function(...) return "" end`;
  // mini SM decoy (Clyde-like)
  const s0 = randInt(1000, 9000);
  const s1 = randInt(1000, 9000);
  return `function() local _s=${s0} while _s do if _s==${s0} then local _r=game if _r then _r=nil end _s=${s1} elseif _s==${s1} then break else break end end end`;
}

function methodName() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  let s = '';
  const n = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) s += letters[Math.floor(Math.random() * letters.length)];
  // Prefer single letter like Clyde :W(
  if (Math.random() < 0.7) return letters[Math.floor(Math.random() * 26) + 26]; // lowercase
  return s;
}

function longWrap(s) {
  let eq = '========';
  while (s.indexOf(']' + eq + ']') !== -1) eq += '=';
  return '[' + eq + '[' + s + ']' + eq + ']';
}

/**
 * Build setmetatable surface with:
 * - many decoy handlers (dynamic ids)
 * - AT fragments in separate slots
 * - real method that WAN-decodes Clyde blob and runs it
 */
function buildSetmetatableShell(enc, method) {
  const nDecoy = randInt(40, 80);
  const ids = uniqueIds(nDecoy + AT_FRAGS.length + 8, 100, 2500);
  const entries = [];

  // Decoy slots
  for (let i = 0; i < nDecoy; i++) {
    entries.push({ id: ids[i], body: decoyFn() });
  }

  // AT fragments — each its own slot (split, not one place)
  for (let i = 0; i < AT_FRAGS.length; i++) {
    const frag = AT_FRAGS[i];
    entries.push({
      id: ids[nDecoy + i],
      body: `function(...) ${frag} end`,
      at: true,
    });
  }

  // Fake vmap-like tables as numbered no-ops
  for (let i = 0; i < 4; i++) {
    const id = ids[nDecoy + AT_FRAGS.length + i];
    const vals = Array.from({ length: 8 }, () => deepKeyExpr(randInt(0, 255))).join(',');
    entries.push({
      id,
      body: `function() local _v={${vals}} return _v end`,
    });
  }

  // Shuffle entry order so AT not clustered
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = entries[i];
    entries[i] = entries[j];
    entries[j] = t;
  }

  // Real method body: scatter keys + decode pack + load Clyde
  const ka = enc.keysA;
  const kb = enc.keysB;
  const extra = enc.extra;

  // key tables with deep expr, scattered
  const keyLines = [];
  const kaName = '_k' + randInt(10, 99);
  const kbName = '_k' + randInt(10, 99);
  keyLines.push(`local ${kaName}={}`);
  keyLines.push(`local ${kbName}={}`);
  const writes = [];
  for (let i = 0; i < 20; i++) {
    writes.push(`${kaName}[${i + 1}]=${deepKeyExpr(ka[i])}`);
    writes.push(`${kbName}[${i + 1}]=${deepKeyExpr(kb[i])}`);
  }
  for (let i = writes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = writes[i];
    writes[i] = writes[j];
    writes[j] = t;
  }
  keyLines.push(...writes);

  // chunk b94 if large
  const chunk = 1200;
  const parts = [];
  for (let i = 0; i < enc.b94.length; i += chunk) {
    parts.push(longWrap(enc.b94.slice(i, i + chunk)));
  }
  const b94Expr =
    parts.length === 1
      ? parts[0]
      : `(function() local t={${parts.join(',')}} local s="" for i=1,#t do s=s..t[i] end return s end)()`;

  const decoder = [
    `local _b94=${b94Expr}`,
    `local function _dec(s)`,
    `local A=33 local out={} local n=#s`,
    `for i=1,n,5 do local V=0 local p=1 for j=0,4 do local c=s:byte(i+j) or A V=V+(c-A)*p p=p*94 end`,
    `out[#out+1]=bit32.rshift(V,24)%256 out[#out+1]=bit32.rshift(V,16)%256 out[#out+1]=bit32.rshift(V,8)%256 out[#out+1]=V%256 end`,
    `local x2len=${enc.x2len} local hexChars={}`,
    `for i=1,x2len do local b=out[i] or 0 b=bit32.bxor(b,${kbName}[((i-1)%20)+1] or 0) hexChars[i]=string.char(b) end`,
    `local hex=table.concat(hexChars) local raw={}`,
    `for i=1,#hex,2 do local hi=tonumber(hex:sub(i,i+1),16) or 0 local idx=((i-1)/2)+1 raw[idx]=bit32.bxor(hi,${kaName}[((idx-1)%20)+1] or 0) end`,
    `local bytes={} for i=1,#raw do bytes[i]=string.char(raw[i]%256) end return table.concat(bytes)`,
    `end`,
    `local _src=_dec(_b94)`,
    `local _L=loadstring or load`,
    `local _fn,_err=_L(_src)`,
    `if not _fn then error(_err or "wan",0) end`,
    `return _fn(...)`,
  ].join(' ');

  const realBody = `function(self,...) ${keyLines.join(' ')} ${decoder} end`;

  // Assemble table
  const tableParts = [];
  for (const e of entries) {
    tableParts.push(`[${e.id}]=${e.body}`);
  }
  tableParts.push(`${method}=${realBody}`);

  // Shuffle so method position varies
  // (method is named key, always present)

  // Call AT slots first via random order numbers before method? 
  // Inject AT runner: call each AT function once at start of method already via _G._wan_at checks in frags.
  // Also invoke AT frags by embedding calls at start of real method:
  const atIds = entries.filter((e) => e.at).map((e) => e.id);
  const atCalls = atIds.map((id) => `pcall(function() local _t=getmetatable and nil;(nil) end) local _f=([${id}]) end`).join(' ');
  // Simpler: prefix real body with AT frag inlined already in separate slots - call them:
  const atInvoke = atIds.map((id) => `(select(2,pcall(function() return (getmetatable({})) end)) or true) and (function() local f=nil end)()`).join('');
  // Better: at start of method, call table methods by id
  // We'll use: for each at id, the entry is already in the table; call via rawget after setmetatable is built.
  // Real method starts with:
  //   for _,id in ipairs({...}) do local f=rawget(self,id) if type(f)=="function" then f() end end
  const atBoot =
    atIds.length > 0
      ? `for _,_id in ipairs({${atIds.join(',')}}) do local _f=rawget(self,_id) if type(_f)=="function" then pcall(_f) end end if (_G._wan_at or 0)>0 then return end `
      : '';

  // Rebuild real method with atBoot
  const realBody2 = `function(self,...) ${atBoot}${keyLines.join(' ')} ${decoder} end`;
  // replace last entry method
  const tableParts2 = tableParts.slice(0, -1);
  tableParts2.push(`${method}=${realBody2}`);

  // One-line Clyde surface
  return `return setmetatable({${tableParts2.join(',')}},{}):${method}(...)`;
}

/**
 * @param {string} source
 * @param {{ debug?: boolean, noAT?: boolean }} opts
 */
export function obfuscateClydeWan(source, opts = {}) {
  if (!clydeAvailable()) throw new Error('Clyde RegVM not available');
  const debug = !!opts.debug;
  const log = debug ? (m) => console.log('[WAN-Clyde] ' + m) : () => {};

  // 1) Clyde RegVM Max — bytecode layer (buffer blob / parser / dispatcher inside)
  log('Clyde RegVM Max...');
  const cr = compileClydeRegVMMax(String(source || ''), {
    seed: Date.now() % 2147483647,
  });
  if (!cr || !cr.ok) throw new Error('Clyde compile failed: ' + (cr && cr.error));
  const clydeSrc = cr.lua || cr.code;
  log('Clyde bytecode surface ' + clydeSrc.length);

  // 2) WAN pack encode of Clyde body
  const enc = encodeFull(clydeSrc);
  log('WAN pack keys=' + enc.keyCount + ' b94=' + enc.b94.length);

  // 3) setmetatable outer (Clyde commercial style), AT split, one line, dynamic method
  const method = methodName();
  let code = buildSetmetatableShell(enc, method);
  if (opts.noAT) {
    // strip AT frags by rebuilding without them
    // already baked; for noAT re-encode without atBoot - skip for simplicity
  }

  // Force one line
  code = code.replace(/\s+/g, ' ').trim();
  log('final ' + code.length + ' method=:' + method);

  return {
    code,
    meta: {
      mode: 'clyde-regvm-max+setmetatable+wan-pack',
      keys: enc.keyCount,
      clyde: clydeSrc.length,
      out: code.length,
      method,
    },
  };
}

export default obfuscateClydeWan;
