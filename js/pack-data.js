/** Shared encode helpers + pack VM body data (strings + number arrays) */
import { randomBytes } from 'crypto';

function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function makeKey20() {
  const k = [];
  for (let i = 0; i < 20; i++) k.push(randInt(0, 255));
  return k;
}
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
function luaLongWrapSafe(str) {
  // Always use enough = so base94 (may contain ]) never breaks the longstring
  let eq = "========";
  while (str.indexOf("]" + eq + "]") !== -1) eq += "=";
  return "[" + eq + "[" + str + "]" + eq + "]";
}
function chunkLongstring(b94, chunkSize) {
  const size = chunkSize || 280;
  const parts = [];
  for (let i = 0; i < b94.length; i += size) {
    parts.push(luaLongWrapSafe(b94.slice(i, i + size)));
  }
  if (!parts.length) parts.push(luaLongWrapSafe(""));
  if (parts.length === 1) return parts[0];
  // table.concat avoids C stack overflow from a..b..c chains
  // join longstring chunks without table.concat name in output
  if (parts.length === 1) return parts[0];
  return "(" + parts.join("..") + ")";
}
function rn(reuse) {
  if (!rn._n) rn._n = 0;
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const n = rn._n++;
  // unique 4-char: avoids VM 1-letter collisions
  return letters[n % 26] + letters[(n*3)%26] + letters[(n*7)%26] + String(n % 10);
}

/** Pack string.char clusters + large number arrays into xor20+hex+xor20+base94 */
export function packVmData(src) {
  src = String(src || '');
  rn._used = {};
  // Reserve single-char names already used in VM body (after mangle)
  {
    const re = /\b(?:local|function)\s+([a-zA-Z])\b/g;
    let m;
    while ((m = re.exec(src))) rn._used[m[1]] = 1;
    const re2 = /\b([a-zA-Z])\s*=\s*function\b/g;
    while ((m = re2.exec(src))) rn._used[m[1]] = 1;
  }
  const ka = makeKey20(), kb = makeKey20();
  const extra = [];
  for (let i = 0; i < 0; i++) extra.push(randInt(0, 255)); // ka+kb = 40 keys
  const allKeys = ka.concat(kb).concat(extra);

  // number arrays: pack bytecode streams (incl. nested field={n,n,n})
  const numArrs = [];
  function tryPackInner(inner) {
    const nums = inner.split(',').map((x) => (parseInt(x, 10) >>> 0));
    if (nums.length < 4) return null;
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    const allSmall = nums.every((n) => n < 256);
    if (allSmall && nums.length < 40) return null;
    if (nums.length < 8 && avg <= 1000) return null;
    numArrs.push(nums);
    return '__NA[' + numArrs.length + ']';
  }
  // field={n,n,...}  e.g. x={6180,...} o={...}  (nested proto / BC)
  src = src.replace(/=(\{)(\d+(?:,\d+){3,})(\})/g, (full, a, inner, c) => {
    const rep = tryPackInner(inner);
    return rep ? ('=' + rep) : full;
  });
  // bare {n,n,...} tables
  src = src.replace(/(\{)(\d+(?:,\d+){3,})(\})/g, (full, a, inner, c) => {
    if (full.indexOf('__NA') >= 0) return full;
    const rep = tryPackInner(inner);
    return rep || full;
  });

  // string.char(...) nested-aware
  const pool = [];
  {
    function evalByte(s) {
      s = s.trim();
      if (/^\d+$/.test(s)) return parseInt(s, 10) & 255;
      if (!/^[0-9+\-() ]+$/.test(s)) return null;
      while (s[0] === '(' && s[s.length - 1] === ')') {
        let d = 0, ok = true;
        for (let i = 0; i < s.length; i++) {
          if (s[i] === '(') d++;
          else if (s[i] === ')') { d--; if (d === 0 && i !== s.length - 1) { ok = false; break; } }
        }
        if (!ok) break;
        s = s.slice(1, -1).trim();
      }
      const toks = s.replace(/([+\-])/g, ' $1 ').split(/\s+/).filter(Boolean);
      let acc = 0, op = '+';
      for (const t of toks) {
        if (t === '+' || t === '-') { op = t; continue; }
        const n = parseInt(t, 10);
        if (isNaN(n)) return null;
        acc = op === '+' ? acc + n : acc - n;
      }
      return acc & 255;
    }
    let out = '', i = 0;
    const tag = 'string.char(';
    while (i < src.length) {
      const idx = src.indexOf(tag, i);
      if (idx < 0) { out += src.slice(i); break; }
      out += src.slice(i, idx);
      let j = idx + tag.length, depth = 1;
      while (j < src.length && depth > 0) {
        const ch = src[j++];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
      }
      const inner = src.slice(idx + tag.length, j - 1);
      const parts = [];
      let cur = '', d = 0, ok = true;
      for (let k = 0; k < inner.length; k++) {
        const ch = inner[k];
        if (ch === '(') { d++; cur += ch; }
        else if (ch === ')') { d--; cur += ch; }
        else if (ch === ',' && d === 0) {
          const v = evalByte(cur);
          if (v === null) { ok = false; break; }
          parts.push(v); cur = '';
        } else cur += ch;
      }
      if (ok && cur.trim()) {
        const v = evalByte(cur);
        if (v === null) ok = false; else parts.push(v);
      }
      if (ok && parts.length) {
        pool.push(parts);
        out += '__SP[' + pool.length + ']';
      } else out += src.slice(idx, j);
      i = j;
    }
    src = out;
  }

  const rawBytes = [];
  rawBytes.push(0);
  rawBytes.push(pool.length & 255, (pool.length >> 8) & 255, (pool.length >> 16) & 255, (pool.length >> 24) & 255);
  for (const parts of pool) {
    rawBytes.push((parts.length >> 8) & 255, parts.length & 255);
    for (const b of parts) rawBytes.push(b & 255);
  }
  rawBytes.push(1);
  rawBytes.push(numArrs.length & 255, (numArrs.length >> 8) & 255, (numArrs.length >> 16) & 255, (numArrs.length >> 24) & 255);
  for (const arr of numArrs) {
    rawBytes.push(arr.length & 255, (arr.length >> 8) & 255, (arr.length >> 16) & 255, (arr.length >> 24) & 255);
    for (const n of arr) {
      rawBytes.push(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255);
    }
  }

  // Commercial pack surface:
  //   xor20 → hex → xor20 → base94
  //   40 keys scattered (shuffled writes) + 2–4 fake vmaps (same shape, random names)
  //   real rebuild tables look identical to fakes
  const tName = rn(), nA = rn(), nB = rn(), nC = rn(), nD = rn();
  const nE = rn(), nF = rn(); // extra fake vmaps
  const nBx = rn(), nDfn = rn(), nP = rn(), nSp = rn(), nNa = rn();
  const order = allKeys.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  function junkLS() {
    const chars = "Y'g,^s)B<3TwD)jtZOWxMV5IJjtO@;{>\"#3L*3@>WsvIrkli!}F10LrJ9";
    let o = '';
    for (let i = 0; i < 280 + randInt(0, 220); i++) o += chars[randInt(0, chars.length - 1)];
    return luaLongWrapSafe(o);
  }
  const pieces = [];
  pieces.push('local ' + tName + '={}');
  for (let _j = 0; _j < 6; _j++) pieces.push('local ' + rn(true) + '=' + junkLS());
  // 4 fake key tables — empty first, filled with same-style writes as real keys
  const fakeSlots = [
    { name: nC, vals: Array.from({ length: 20 }, () => randInt(0, 255)) },
    { name: nD, vals: Array.from({ length: 20 }, () => randInt(0, 255)) },
    { name: nE, vals: Array.from({ length: 20 }, () => randInt(0, 255)) },
    { name: nF, vals: Array.from({ length: 20 }, () => randInt(0, 255)) },
  ];
  for (const f of fakeSlots) pieces.push('local ' + f.name + '={}');
  let fi = 0;
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    // one key write per step (scattered / shuffled order)
    // real key — one place, hard-to-read expr
    const kv = allKeys[i] & 255;
    const expr = '((' + kv + '+256)*1)%256';
    pieces.push(tName + '[' + (i + 1) + ']=' + expr);
    // FAKE key write — SAME expr form into fake table (hard to tell real vs fake)
    if (fakeSlots.length) {
      const f = fakeSlots[oi % fakeSlots.length];
      const fkv = randInt(0, 255);
      const fexpr = '((' + fkv + '+256)*1)%256';
      const fidx = 1 + (oi % 20);
      pieces.push(f.name + '[' + fidx + ']=' + fexpr);
    }
    // dead opaque guard (never fires)
    if (Math.random() < 0.28) {
      pieces.push('if ' + tName + '[' + (i + 1) + ']>9999 then ' + tName + '[' + (i + 1) + ']=0 end');
    }
    // also drop full fake vmap tables mid-stream
    if (fi < fakeSlots.length && (oi === 6 || oi === 14 || oi === 22 || oi === 31 || Math.random() < 0.07)) {
      const f = fakeSlots[fi++];
      pieces.push(f.name + '={' + f.vals.join(',') + '}');
    }
    if (Math.random() < 0.35) pieces.push('local ' + rn(true) + '=' + junkLS());
    if (Math.random() < 0.18) pieces.push('do local z=0 z=z+1 end');
  }
  while (fi < fakeSlots.length) {
    const f = fakeSlots[fi++];
    pieces.push(f.name + '={' + f.vals.join(',') + '}');
  }
  // real rebuild — SAME syntax as fakes (literal table of 20 refs)
  pieces.push('local ' + nA + '={' + Array.from({ length: 20 }, (_, i) => tName + '[' + (i + 1) + ']').join(',') + '}');
  pieces.push('local ' + nB + '={' + Array.from({ length: 20 }, (_, i) => tName + '[' + (i + 21) + ']').join(',') + '}');
  // dead branches swap real <-> fake (never taken) — all names look equal
  pieces.push('if false then ' + nA + '=' + nC + ' ' + nB + '=' + nD + ' end');
  pieces.push('if (0>1) then ' + nA + '=' + nE + ' ' + nB + '=' + nF + ' end');
  pieces.push('local ' + rn(true) + '=' + junkLS());
  pieces.push('local ' + rn(true) + '=' + junkLS());
  const packStr = encode20Bytes(rawBytes, ka, kb);
  const expr = chunkLongstring(packStr, 120);

  const nCh=rn(),nCat=rn(),nAb=rn();
  const nOut=rn(),nRaw=rn(),nLen=rn(),nX2=rn(),nHt=rn(),nHx=rn(),nBy=rn(),nH=rn(),nId=rn();
  const nRu=rn(),nKnd=rn(),nCnt=rn(),nLL=rn(),nT=rn(),nB0=rn(),nB1=rn(),nB2=rn(),nB3=rn();
  const nC1=rn(),nC2=rn(),nC3=rn(),nC4=rn(),nV=rn(),nJ=rn(),nXv=rn();
  {
    // string.format("%c") — AZT hooks string.char, not format
    pieces.push(
      'local function '+nCh+'(...) local n=select("#",...) local s="" for i=1,n do local b=(select(i,...)or 0)%256 s=s..string.format("%c",b) end return s end ' +
      'local function '+nCat+'(t) local s="" for i=1,#t do s=s..(t[i]or "") end return s end'
    );
  }
  const decFn =
    'local function '+nBx+'(a,b) a=math.floor((tonumber(a)or 0)%256) b=math.floor((tonumber(b)or 0)%256) if bit32 and bit32.bxor then return bit32.bxor(a,b)%256 end local r,p=0,1 for i=0,7 do local x,y=a%2,b%2 if x~=y then r=r+p end a=math.floor((a-x)/2) b=math.floor((b-y)/2) p=p*2 end return r%256 end '
    + 'local function '+nDfn+'(p,ka,kb) if type(p)~="string" or #p<5 then return "" end local A=33 local '+nOut+'={} local i=1 while i+4<=#p do local '+nV+'=0 for '+nJ+'=0,4 do '+nV+'='+nV+'*94+((string.byte(p,i+'+nJ+')or A)-A) end local '+nC1+'=math.floor('+nV+'/16777216)%256 local '+nC2+'=math.floor('+nV+'/65536)%256 local '+nC3+'=math.floor('+nV+'/256)%256 local '+nC4+'='+nV+'%256 '+nOut+'[#'+nOut+'+1]='+nCh+'('+nC1+'%256,'+nC2+'%256,'+nC3+'%256,'+nC4+'%256) i=i+5 end local '+nRaw+'='+nCat+'('+nOut+') local '+nLen+'=(string.byte('+nRaw+',1)or 0)*16777216+(string.byte('+nRaw+',2)or 0)*65536+(string.byte('+nRaw+',3)or 0)*256+(string.byte('+nRaw+',4)or 0) if '+nLen+'<0 or '+nLen+'>#'+nRaw+'-4 then return "" end local '+nX2+'=string.sub('+nRaw+',5,4+'+nLen+') local '+nHt+'={} for i=1,#'+nX2+' do local b=string.byte('+nX2+',i)or 0 local '+nXv+'=tonumber(kb[((i-1)%20)+1])or 0 '+nHt+'[i]='+nCh+'('+nBx+'(b,'+nXv+')) end local '+nHx+'='+nCat+'('+nHt+') local '+nBy+'={} for i=1,#'+nHx+',2 do local '+nH+'=tonumber(string.sub('+nHx+',i,i+1),16)or 0 local '+nId+'=(math.floor((i-1)/2)%20)+1 local '+nXv+'=tonumber(ka['+nId+'])or 0 '+nBy+'[#'+nBy+'+1]='+nCh+'('+nBx+'('+nH+','+nXv+')) end return '+nCat+'('+nBy+') end ';
  pieces.push(decFn);
  pieces.push('local '+nP+'='+expr);
  pieces.push(
    'local '+nSp+'={} local '+nNa+'={} do local '+nRaw+'='+nDfn+'('+nP+','+nA+','+nB+') local i=1 '
    + 'local function '+nRu+'() local '+nB0+'=string.byte('+nRaw+',i)or 0 local '+nB1+'=string.byte('+nRaw+',i+1)or 0 local '+nB2+'=string.byte('+nRaw+',i+2)or 0 local '+nB3+'=string.byte('+nRaw+',i+3)or 0 i=i+4 return '+nB0+'+'+nB1+'*256+'+nB2+'*65536+'+nB3+'*16777216 end '
    + 'if i<=#'+nRaw+' then local '+nKnd+'=string.byte('+nRaw+',i)or 0 i=i+1 local '+nCnt+'='+nRu+'() if '+nKnd+'==0 then for '+nId+'=1,'+nCnt+' do local '+nLL+'=(string.byte('+nRaw+',i)or 0)*256+(string.byte('+nRaw+',i+1)or 0) i=i+2 if i+'+nLL+'-1>#'+nRaw+' then break end '+nSp+'['+nId+']=string.sub('+nRaw+',i,i+'+nLL+'-1) i=i+'+nLL+' end end end '
    + 'if i<=#'+nRaw+' then local '+nKnd+'=string.byte('+nRaw+',i)or 0 i=i+1 local '+nCnt+'='+nRu+'() if '+nKnd+'==1 then for '+nId+'=1,'+nCnt+' do local '+nLL+'='+nRu+'() local '+nT+'={} for '+nJ+'=1,'+nLL+' do '+nT+'['+nJ+']='+nRu+'() end '+nNa+'['+nId+']='+nT+' end end end end '
  );
  let body = src.replace(/__SP\[(\d+)\]/g, nSp + '[$1]');
  body = body.replace(/__NA\[(\d+)\]/g, nNa + '[$1]');
  pieces.push(body);
  return { code: pieces.join(' '), keys: allKeys.length, numArrs: numArrs.length, strings: pool.length };
}
