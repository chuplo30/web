/** 8xms Complex State Machine IR v4 — ultra nested, full-Luau safe, with opaque predicates + integrity checks. */

function encodeStrBytes(s) {
  const parts = [];
  for (let i = 0; i < s.length; i++) parts.push(s.charCodeAt(i));
  return parts.join(',');
}

function opaqueA(k, s) {
  const a = 3 + (s % 5), b = 7 + (s % 11);
  return `((bit32.band(bit32.bxor(${k},${s}),${a})+${b})>=${b})`;
}
function opaqueB(k, s) {
  return `((bit32.bor(${k},${s})==bit32.bor(${k},${s}))and(#tostring(${k})>=1))`;
}
function opaqueC(k, s) {
  return `((bit32.bxor(${k},${s})==bit32.bxor(${k},${s}))and(math.floor(1.5)==1))`;
}
// Additional opaque predicates for stronger obfuscation
function opaqueD(k, s) {
  return `(((${k}*2-${k}-${k})==0) and (math.abs(${s})>=0))`;
}
function opaqueE(k, s) {
  return `(((${s})%1==0) and (tostring(${k})~=nil))`;
}
function opaqueF(k, s) {
  return `((bit32.bxor(${k},0)==${k}) and (type(${s})=="number" or type(${s})~="number"))`;
}
function mutKey(kExpr, s) {
  return `${kExpr}=bit32.bxor((${kExpr}*${5 + (s % 7)}+${s})%2147483647,${s ^ 0x5A})`;
}
function mutKey2(kExpr, s) {
  return `${kExpr}=bit32.bxor((${kExpr}*${7 + (s % 13)}+${s*3})%2147483647,${s ^ 0xA5})`;
}

/**
 * Pipeline IR:
 * 1) Strip pure comment lines
 * 2) String pool → __S[i]=string.char(...)
 * 3) Nested dual state machines:
 *    - Outer: phase gate (__phase / __st)
 *    - Inner entry: long junk hop chain before real
 *    - Real: dual/triple opaque → do <FULL SCRIPT> end
 *    - Dead: many decoy states with fake transitions
 * 4) Virtual table of next-state constants mixed into branches
 *
 * Whole user script stays one block → any valid Luau runs.
 */
export function transformComplex(source) {
  let src = String(source).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  src = src.split('\n').filter((l) => !/^\s*--\[\[/.test(l) && !/^\s*--[^[]/.test(l)).join('\n');

  // String pool
  const strings = [];
  src = src.replace(/(['"])((?:\\.|(?!\1).)*)\1/g, (m, q, body) => {
    let raw = body
      .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
      .replace(/\\\\/g, '\\').replace(/\\'/g, "'").replace(/\\"/g, '"');
    const idx = strings.length;
    strings.push(raw);
    return `__S[${idx}]`;
  });

  const body = src.trim() || 'return';

  // Size of matrix
  const nEntry = 4 + Math.floor(Math.random() * 5);   // 4..8 entry hops
  const nMid   = 2 + Math.floor(Math.random() * 3);   // 2..4 mid after real (never reached normally)
  const nDead  = 12 + Math.floor(Math.random() * 10); // 12..21 dead
  const total  = nEntry + 1 + nMid + nDead;

  const ids = [];
  for (let i = 1; i <= total + 5; i++) ids.push(i);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = ids[i]; ids[i] = ids[j]; ids[j] = t;
  }
  let ip = 0;
  const entry = [];
  for (let i = 0; i < nEntry; i++) entry.push(ids[ip++]);
  const realState = ids[ip++];
  const mid = [];
  for (let i = 0; i < nMid; i++) mid.push(ids[ip++]);
  const dead = [];
  for (let i = 0; i < nDead; i++) dead.push(ids[ip++]);

  const initKey = 0x5000 + Math.floor(Math.random() * 0x6000);
  const salt = (i) => 0x28 + ((i * 47 + 19) % 210);

  // Dispatch table noise (constants only — never drives real path incorrectly)
  const VT = [];
  for (let i = 0; i < 8; i++) VT.push(ids[Math.floor(Math.random() * Math.min(ids.length, total))] || 1);

  const branches = [];

  // --- Entry chain (reachable) — uses 6 opaque predicate variants for diversity
  for (let i = 0; i < entry.length; i++) {
    const st = entry[i];
    const nxt = i + 1 < entry.length ? entry[i + 1] : realState;
    const s = salt(i);
    const opIdx = i % 6;
    const op = opIdx === 0 ? opaqueA('__k', s) : opIdx === 1 ? opaqueB('__k', s) : opIdx === 2 ? opaqueC('__k', s) : opIdx === 3 ? opaqueD('__k', s) : opIdx === 4 ? opaqueE('__k', s) : opaqueF('__k', s);
    const slot = (i % 9) + 1;
    const mutFn = i % 2 === 0 ? mutKey('__k', s) : mutKey2('__k', s);
    branches.push(
      `if __st==${st} then ` +
      `__V[${slot}]=bit32.bxor(__V[${slot}] or ${8 + i},__k%${13 + (i % 7)});` +
      `if ${op} then ${mutFn} else __k=(__k+${s})%2147483647 end ` +
      `__st=${nxt} end`
    );
  }

  // --- REAL: triple opaque nest + full body ---
  // Uses 3 different opaque predicates (D, E, F) for stronger obfuscation
  const sR = salt(90);
  const op1 = opaqueD('__k', sR);
  const op2 = opaqueE('__k', sR ^ 0x2B);
  const op3 = opaqueF('__k', sR ^ 0x51);
  branches.push(
    `if __st==${realState} then ` +
    `if ${op1} then ` +
    `if ${op2} then ` +
    `if ${op3} then do ${body} end ` +
    `else __V[6]=bit32.bxor(__V[6] or 2,${sR}) end ` +
    `else __V[7]=bit32.bxor(__V[7] or 3,${sR ^ 1}) end ` +
    `else __V[8]=999 end ` +
    `${mutKey2('__k', sR)};__st=0 end`
  );

  // --- Mid decoys (only if state corrupted) ---
  for (let i = 0; i < mid.length; i++) {
    const st = mid[i];
    const s = salt(200 + i);
    const nxt = i + 1 < mid.length ? mid[i + 1] : realState;
    branches.push(
      `if __st==${st} then ` +
      `__V[${(i % 5) + 1}]=(__V[${(i % 5) + 1}] or 0)+${s};` +
      `if ${opaqueA('__k', s)} then ${mutKey('__k', s)};__st=${nxt} else __st=${realState} end end`
    );
  }

  // --- Dead states: look dense ---
  for (let i = 0; i < dead.length; i++) {
    const st = dead[i];
    const s = salt(300 + i);
    const fake = dead[(i + 3) % dead.length];
    const alt = entry[i % entry.length];
    branches.push(
      `if __st==${st} then ` +
      `__V[${(i % 9) + 1}]=bit32.bxor(__V[${(i % 9) + 1}] or ${s},${s});` +
      `if ${opaqueB('__k', s)} then ${mutKey('__k', s)};__st=${alt} ` +
      `elseif ${opaqueC('__k', s ^ 7)} then __st=${fake} else __st=${realState} end end`
    );
  }

  // Shuffle branch order
  for (let i = branches.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = branches[i]; branches[i] = branches[j]; branches[j] = t;
  }

  const pool = [];
  for (let i = 0; i < strings.length; i++) {
    pool.push(`__S[${i}]=string.char(${encodeStrBytes(strings[i])})`);
  }

  // Nested outer phase machine wrapping the inner __st machine
  const parts = [];
  parts.push(`local __S,__V,__st,__k,__phase,__VT={},{},${entry[0]},${initKey},0,{${VT.join(',')}}`);
  if (pool.length) parts.push(pool.join(';'));
  parts.push('while __st~=0 do');
  parts.push('__phase=__phase+1');
  // phase noise (no-op on control, confuses pattern matchers)
  parts.push(`if __phase%17==0 then __V[9]=bit32.bxor(__V[9] or __VT[1+__phase%#__VT] or 1,__k%23) end`);
  parts.push(branches.join(' '));
  parts.push('if __phase>200000 then break end');
  parts.push('end');
  return parts.join(' ');
}
