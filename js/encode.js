/** 8xms encode / junk / long-string helpers */
export function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
export function randVar(len) {
  len = len || 7;
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '_';
  for (let i = 0; i < len; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

const SAFE_CHARS = (() => {
  let s = '';
  for (let i = 32; i <= 126; i++) s += String.fromCharCode(i);
  return s;
})();

export function randJunkStrSafe(len) {
  for (let attempt = 0; attempt < 8; attempt++) {
    let s = '';
    for (let i = 0; i < len; i++) s += SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)];
    if (!/\]={1,}\]/.test(s)) return s;
  }
  return 'x'.repeat(len);
}

export function multiLayerEncode(source, seed1, seed2) {
  const raw = new TextEncoder().encode(source);
  const keys = new Uint8Array(50);
  let k = seed1 & 0xff;
  for (let i = 0; i < 50; i++) { k = (97 * k + 33) % 256; keys[i] = k; }
  const x1 = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) x1[i] = raw[i] ^ keys[i % 50];
  let hexStr = '';
  for (let i = 0; i < x1.length; i++) hexStr += x1[i].toString(16).padStart(2, '0').toUpperCase();
  const x2 = new Uint8Array(hexStr.length);
  const s2 = seed2 & 0xff;
  for (let i = 0; i < hexStr.length; i++) x2[i] = hexStr.charCodeAt(i) ^ s2;
  const total = 4 + x2.length;
  const padded = new Uint8Array(Math.ceil(total / 4) * 4);
  const len = x2.length;
  padded[0] = (len >>> 24) & 0xff; padded[1] = (len >>> 16) & 0xff;
  padded[2] = (len >>> 8) & 0xff; padded[3] = len & 0xff;
  padded.set(x2, 4);
  let b94 = '';
  const A = 33;
  for (let i = 0; i < padded.length; i += 4) {
    const b0 = padded[i], b1 = padded[i + 1], b2 = padded[i + 2], b3 = padded[i + 3];
    let V = b0 * 16777216 + b1 * 65536 + b2 * 256 + b3;
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


/** XOR20 → HEX → XOR20 → Base94. keysA/keysB = number[20] each. */
export function makeKey20() {
  const k = [];
  for (let i = 0; i < 20; i++) k.push(Math.floor(Math.random() * 256));
  return k;
}
export function encode20(source, keysA, keysB) {
  const raw = new TextEncoder().encode(String(source));
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
export function luaLongWrap(s) {
  let n = 3;
  while (s.indexOf(']' + '='.repeat(n) + ']') !== -1) n++;
  return '[' + '='.repeat(n) + '[' + s + ']' + '='.repeat(n) + ']';
}

export function generateJunkAssignments(count) {
  // scoped in do-end → no outer locals
  const n = Math.max(1, count || 1);
  const body = [];
  for (let i = 0; i < n; i++) {
    const v = randVar(randInt(6, 10));
    const t = Math.random();
    if (t < 0.35) {
      body.push(`local ${v}=${randInt(1,9999)}`);
      body.push(`${v}=${v}*${randInt(2,5)}%${randInt(100,9999)}`);
    } else if (t < 0.6) {
      body.push(`local ${v}=math.random(${randInt(1,100)})`);
    } else if (t < 0.8) {
      body.push(`local ${v}={${randInt(1,5)},${randInt(1,5)},${randInt(1,5)}}`);
    } else {
      body.push(`local ${v}=string.char(${randInt(65,90)},${randInt(65,90)},${randInt(65,90)})`);
    }
  }
  return 'do ' + body.join(' ') + ' end';
}

export function generateOuterJunk(count) {
  // Algorithmic junk with comparisons — never affects control flow (opaque false/true).
  // ALL locals inside do/if so they do NOT consume outer register slots (Luau limit ~200)
  const lines = [];
  const rn = () => '_' + Math.random().toString(36).slice(2, 8);
  const hx = () => '0x' + (1 + Math.floor(Math.random() * 200)).toString(16);
  for (let i = 0; i < (count || 1); i++) {
    const a = rn(), b = rn(), c = rn(), d = rn();
    const n1 = 2 + Math.floor(Math.random() * 40);
    const n2 = 2 + Math.floor(Math.random() * 40);
    const n3 = 10 + Math.floor(Math.random() * 90);
    const t = Math.floor(Math.random() * 12);
    if (t === 0) {
      // dead loop + compare
      lines.push(`do local function ${a}(...) local ${b}=0 for _=1,${n1} do ${b}=${b}+1 if ${b}>${n1 + 5} then ${b}=0 end end end end`);
    } else if (t === 1) {
      // always-false compare
      lines.push(`if (${hx()}>=0xFF+1) then local ${a}=0 end`);
    } else if (t === 2) {
      lines.push(`do local ${a}=${hx()}; ${a}=${a} end`);
    } else if (t === 3) {
      // bit32 compare noise
      lines.push(`do local ${a}=${n1} local ${b}=${n2} if bit32 and bit32.bxor(${a},${b})==(${a}+${b}+1) then local ${c}=0 end end`);
    } else if (t === 4) {
      // equality that never holds
      lines.push(`do local ${a}=${n1} local ${b}=${a}*2 if ${a}==${b} then local ${c}=1 end if ${a}~=${a} then local ${d}=2 end end`);
    } else if (t === 5) {
      // range compare
      lines.push(`do local ${a}=${n3} if ${a}>=${n3 + 20} and ${a}<=${n3 - 1} then local ${b}=0 end if not(${a}>${n3 - 1}) then local ${c}=${a} ${c}=${c} end end`);
    } else if (t === 6) {
      // table size compare junk
      lines.push(`do local ${a}={${n1},${n2}} if #${a}~=2 then local ${b}=0 end if ${a}[1]>${a}[2]+999 then local ${c}=0 end end`);
    } else if (t === 7) {
      // nested false branch with math
      lines.push(`do local ${a}=(${n1}*${n2})%${n3 + 7} if ${a}<0 then local ${b}=1 elseif ${a}~=${a} then local ${c}=2 else local ${d}=${a} ${d}=${d} end end`);
    } else if (t === 8) {
      // string compare dead
      lines.push(`do local ${a}="${rn()}" if ${a}=="" and #${a}>0 then local ${b}=0 end end`);
    } else if (t === 9) {
      // type compare
      lines.push(`do local ${a}=${n1} if type(${a})~="number" or type(${a})=="table" then local ${b}=0 end end`);
    } else if (t === 10) {
      // xor identity compare
      lines.push(`do local ${a}=${n1} local ${b}=bit32 and bit32.bxor(${a},0) or ${a} if ${b}~=${a} then local ${c}=0 end end`);
    } else {
      lines.push(`if not (1<0) then local ${a}=0 end`);
    }
  }
  return lines.join(' ');
}
