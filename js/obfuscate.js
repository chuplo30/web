import {
  randInt, multiLayerEncode, encode20, makeKey20, luaLongWrap, generateJunkAssignments, randJunkStrSafe, generateOuterJunk
} from './encode.js';
import { transformComplex } from './transform.js';
import {
  buildATFragment1, buildATFragment2, buildATFragment3, buildATFragment4
} from './at.js';
import { compileToVM } from './vm-compiler.js';
import { emitVMRuntime, emitVMRuntimeSplit } from './vm-runtime.js';
import { clydeAvailable, compileClydeChunk, compileClydeRegVMMax } from './clyde-backend.js';
import { emit8xmsRegVM } from './emit-clyde-vm.js';

/**
      pipeline: (vmMode === 'clyde-regvm') ? 'luau→ClydeRegVM(Max)→8xmsPack' : ((vmMode === 'clyde-bc') ? 'luau→ClydeBC→8xmsVM→pack' : ((String(vmMode).indexOf('vm') === 0) ? 'luau→VM→pack' : 'luau→fallback→pack')),
 */

/**
 * Dense SM + thin VM shell for execstr — target ~40-60KB shell even for print("1").
 * User source stays in long brackets (correct Luau). Locals kept under 255.
 * Decoy string pools, many states, multi OP table, fake const tables, key mutation.
 */
function lightWrap(src) {
  // SAFE SM: body in do..end, no break-after-body (avoids "Expected end, got break")
  const body = String(src).trim() || 'return';
  const decoys = [
    'Players','Workspace','RunService','Humanoid','LocalPlayer','GetService','FindFirstChild',
    'Character','WalkSpeed','CFrame','loadstring','game','typeof','Instance','Enum','Heartbeat',
    'RenderStepped','RemoteEvent','FireServer','InvokeServer','WaitForChild','GetDescendants',
    'IsA','Destroy','Clone','vector','task','pcall','xpcall','setmetatable','HttpService',
  ];
  for (let i = decoys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = decoys[i]; decoys[i] = decoys[j]; decoys[j] = tmp;
  }
  const poolN = 60 + Math.floor(Math.random() * 40);
  const pool = [];
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < poolN; i++) {
    if (i < decoys.length) pool.push(decoys[i]);
    else {
      let s = '';
      const n = 6 + Math.floor(Math.random() * 10);
      for (let k = 0; k < n; k++) s += alpha[Math.floor(Math.random() * alpha.length)];
      pool.push(s);
    }
  }
  const ids = [];
  for (let i = 1; i <= 32; i++) ids.push(i);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
  }
  let ip = 0;
  const entry = ids[ip++], mid = ids[ip++], real = ids[ip++], done = ids[ip++];
  const dead = ids.slice(ip);
  const key = 0x2000 + Math.floor(Math.random() * 0x6000);
  const L = [];
  L.push('local bit32=bit32 or {bxor=function(a,b)a=math.floor(tonumber(a)or 0)%256;b=math.floor(tonumber(b)or 0)%256;local r,p=0,1 for _=1,8 do local x,y=a%2,b%2 if x~=y then r=r+p end a=math.floor(a/2)b=math.floor(b/2)p=p*2 end return r end}');
  L.push('local __st=' + entry + ' local __k=' + key + ' local __phase=0 local __S={}');
  for (let i = 0; i < pool.length; i++) {
    const bytes = [...pool[i]].map(c => c.charCodeAt(0) & 255).join(',');
    L.push('__S[' + i + ']=string.char(' + bytes + ')');
  }
  L.push('while __st~=0 do');
  L.push('__phase=__phase+1');
  L.push('if __st==' + entry + ' then __k=(bit32 and bit32.bxor(__k,31))or((__k+31)%2147483647);__st=' + mid);
  L.push('elseif __st==' + mid + ' then local _=__S[0];__k=(bit32 and bit32.bxor(__k,7))or((__k+7)%2147483647);__st=' + real);
  L.push('elseif __st==' + real + ' then');
  L.push('do');
  L.push(body);
  L.push('end');
  L.push('__st=0');
  L.push('elseif __st==' + done + ' then __st=0');
  for (const d of dead.slice(0, 8)) {
    L.push('elseif __st==' + d + ' then __k=(__k*3+11)%2147483647;__st=' + entry);
  }
  L.push('else __st=0 end');
  L.push('if __phase>200000 then __st=0 end');
  L.push('end');
  return L.join('\n');
}


/**
 * Pack shell for Clyde RegVM: AT + junk only, VM body embedded as REAL Lua
 * (no loadstring, no encode20 of the VM itself). Single VM layer.
 */
function packClydeDirect(clydeSrc, opts = {}) {
  const debug = opts.debug || false;
  const log = debug ? (msg) => console.log('[8xms] ' + msg) : () => {};
  const rv = () => '_' + Math.random().toString(36).slice(2, 9);
  const body = String(clydeSrc).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  const parts = [];
  parts.push('return(function()');
  // Outer junk (decoy)
  parts.push(generateOuterJunk(randInt(3, 6)));

  // Soft AT — runs first, no loadstring of payload
  parts.push('do');
  // Inline a few AT fragments as real code
  try {
    parts.push(buildATFragment1());
  } catch (_) {}
  try {
    parts.push(buildATFragment2());
  } catch (_) {}
  parts.push('end');
  parts.push(generateOuterJunk(randInt(2, 4)));

  // Soft hook check (do not false-positive on executor wrappers)
  parts.push('do local _L0=loadstring or load');
  parts.push('if type(_L0)=="function" then');
  parts.push('local ts=tostring(_L0)');
  parts.push('if type(ts)=="string" and (string.find(ts,"hook",1,true) or string.find(ts,"Hook",1,true)) then return end');
  parts.push('end end');

  parts.push(generateOuterJunk(randInt(2, 4)));

  // === Clyde RegVM body — direct execution, NOT loadstring ===
  parts.push('do');
  parts.push(body);
  parts.push('end');

  parts.push('end)()');

  // Preserve newlines inside the script (Clyde needs structure)
  const code = parts.join('\n');
  log('Clyde direct pack: ' + code.length + ' chars');
  return code;
}


export function obfuscate(input, opts = {}) {
  if (!input || !String(input).trim()) throw new Error('Input is empty');
  const debug = opts.debug || false;
  const log = debug ? (msg) => console.log('[8xms] ' + msg) : () => {};

  const userSeed1 = Math.floor(Math.random() * 256);
  const userSeed2 = Math.floor(Math.random() * 256);

  // 1) Clyde RegVM first (full Luau) — then 8xms pack
  log('Step 1: Compile');
  let sourceInput;
  let vmSplit = null;
  let compiled = null;
  let clydeMeta = null;
  let vmMode = '';

  if (typeof clydeAvailable === 'function' && clydeAvailable()) {
    log('  Clyde Register VM Max (Cypher-equivalent — NO thin-VM fallback)');
    const cr = compileClydeRegVMMax(input, { seed: (opts && opts.seed) || undefined });
    if (cr && cr.ok && cr.lua) {
      clydeMeta = cr.meta;
      vmMode = 'clyde-regvm';
      sourceInput = cr.lua;
      log('  Clyde RegVM Max: insts=' + (cr.meta && cr.meta.insts) + ' size=' + sourceInput.length + ' backend=' + (cr.meta && cr.meta.backend));
    } else {
      // Do NOT fall back to emit8xmsRegVM (leaks handlers / TREE). Surface error.
      const err = (cr && cr.error) || 'Clyde RegVM Max failed';
      log('  FATAL: ' + err);
      throw new Error('[8xms] Clyde RegVM Max failed: ' + err);
    }
  }

  if (!sourceInput) {
    compiled = compileToVM(input);
    vmMode = (compiled && compiled.mode) || 'execstr';
    log('  Fallback mode: ' + vmMode);
    if (String(vmMode).indexOf('vm') === 0) {
      vmSplit = emitVMRuntimeSplit(compiled);
      if (vmSplit && vmSplit.kind === 'split') {
        sourceInput = '--8xms\n' + randJunkStrSafe(100);
      } else {
        sourceInput = emitVMRuntime(compiled);
      }
    } else {
      sourceInput = emitVMRuntime(compiled);
    }
  }

  // Seed pool for multi-layer / encode20
  const seedList = [];
  const takeSeed = () => {
    const s = Math.floor(Math.random() * 256);
    seedList.push(s);
    return s;
  };

  // ~50KB junk pool
  const targetTotal = 50 * 1024 + randInt(0, 8 * 1024);
  const junkArray = [];
  let junkBytes = 0;
  while (junkBytes < targetTotal) {
    const piece = randJunkStrSafe(80 + randInt(0, 180));
    junkArray.push(piece);
    junkBytes += piece.length;
  }

  // loadstring / load name seeds
  const l1S1 = takeSeed(), l1S2 = takeSeed();
  const l2S1 = takeSeed(), l2S2 = takeSeed();
  // AT seeds (4 real)
  const atSeeds = [];
  for (let i = 0; i < 4; i++) atSeeds.push([takeSeed(), takeSeed()]);
  // decoy AT seeds
  const atDecoySeeds = [];
  for (let i = 0; i < 3; i++) atDecoySeeds.push([takeSeed(), takeSeed()]);

  const fragCount = 5 + Math.floor(Math.random() * 3); // 5..7 real
  const decoyFragCount = 2 + Math.floor(Math.random() * 3); // 2..4 decoy
  const frags = [];
  {
    let off = 0;
    const total = sourceInput.length;
    for (let fi = 0; fi < fragCount; fi++) {
      const left = fragCount - fi;
      const take = fi === fragCount - 1 ? total - off : Math.max(1, Math.floor((total - off) / left));
      const fragText = sourceInput.slice(off, off + take);
      off += take;
      const fS1 = takeSeed(), fS2 = takeSeed();
      const fS3 = takeSeed(), fS4 = takeSeed();
      const fS5 = takeSeed(), fS6 = takeSeed();
      const L1 = multiLayerEncode(fragText, fS1, fS2);
      const L2 = multiLayerEncode(L1, fS3, fS4);
      const L3 = multiLayerEncode(L2, fS5, fS6);
      frags.push({ enc: L3, s1: fS1, s2: fS2, s3: fS3, s4: fS4, s5: fS5, s6: fS6, real: true });
    }
  }
  // decoy payload fragments (noise)
  for (let i = 0; i < decoyFragCount; i++) {
    const fS1 = takeSeed(), fS2 = takeSeed();
    const fS3 = takeSeed(), fS4 = takeSeed();
    const fS5 = takeSeed(), fS6 = takeSeed();
    const noise = randJunkStrSafe(60 + randInt(0, 120));
    const L1 = multiLayerEncode(noise, fS1, fS2);
    const L2 = multiLayerEncode(L1, fS3, fS4);
    const L3 = multiLayerEncode(L2, fS5, fS6);
    frags.push({ enc: L3, s1: fS1, s2: fS2, s3: fS3, s4: fS4, s5: fS5, s6: fS6, real: false });
  }
  // shuffle fragment presentation order (decode still uses real-only order map)
  const fragOrder = frags.map((_, i) => i);
  for (let i = fragOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fragOrder[i], fragOrder[j]] = [fragOrder[j], fragOrder[i]];
  }
  const realFragAssemble = []; // original real indices in assemble order (0..fragCount-1)
  for (let i = 0; i < fragCount; i++) realFragAssemble.push(i);

  const lnaEncoded = multiLayerEncode('loadstring', l1S1, l1S2);
  const lnbEncoded = multiLayerEncode('load', l2S1, l2S2);
  const atReal = atSeeds.map((s, i) => multiLayerEncode(
    [buildATFragment1, buildATFragment2, buildATFragment3, buildATFragment4][i](), s[0], s[1]
  ));
  const atDecoy = atDecoySeeds.map((s) => multiLayerEncode('do local _=0 end\n', s[0], s[1]));

  // AT slot shuffle: real + decoy
  const atSlots = [];
  atReal.forEach((enc, i) => atSlots.push({ kind: 'r', i, enc, s1: atSeeds[i][0], s2: atSeeds[i][1] }));
  atDecoy.forEach((enc, i) => atSlots.push({ kind: 'd', i, enc, s1: atDecoySeeds[i][0], s2: atDecoySeeds[i][1] }));
  for (let i = atSlots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [atSlots[i], atSlots[j]] = [atSlots[j], atSlots[i]];
  }
  const atRealOrder = []; // positions in atSlots that are real, in AT fragment order 0..3
  for (let want = 0; want < 4; want++) {
    for (let p = 0; p < atSlots.length; p++) {
      if (atSlots[p].kind === 'r' && atSlots[p].i === want) { atRealOrder.push(p); break; }
    }
  }

  // --- Key vault: all seeds mixed with decoy bytes ---
  // seedList holds every seed in the order takeSeed() was called
  const vaultSize = Math.max(80, seedList.length * 3 + randInt(20, 50));
  const vault = new Array(vaultSize);
  for (let i = 0; i < vaultSize; i++) vault[i] = Math.floor(Math.random() * 256);
  const slots = [];
  const used = new Set();
  for (let i = 0; i < seedList.length; i++) {
    let slot;
    do { slot = Math.floor(Math.random() * vaultSize); } while (used.has(slot));
    used.add(slot);
    vault[slot] = seedList[i];
    slots.push(slot); // 0-based; Lua will use slots[i]+1 for 1-based array
  }
  // fake vmaps
  const fakeCount = 3 + Math.floor(Math.random() * 4);
  const allVmaps = [];
  const realVmapIdx = Math.floor(Math.random() * (fakeCount + 1));
  for (let i = 0; i < fakeCount + 1; i++) {
    if (i === realVmapIdx) allVmaps.push(slots.slice());
    else allVmaps.push(slots.map(() => Math.floor(Math.random() * vaultSize)));
  }

  // Helper: emit lua seed recovery: local name = _KV[_VM[idx]+1]
  // seed index in seedList is 0-based; VM is 1-based array of 0-based slots
  let seedCursor = 0;
  const nextSeedExpr = () => {
    const idx = seedCursor++; // 0-based into slots / seedList
    return `_KV[_VM[${idx + 1}]+1]`;
  };
  // We need expressions in same order as takeSeed calls
  // Reset: we'll generate expressions by walking same order

  const parts = [];
  const rv = () => '_' + Math.random().toString(36).slice(2, 9);
  const nP = rv(), nBx = rv(), nL = rv(), nGL = rv();
  const nKV = rv(), nVM = rv(), nParse = rv();
  const nSRC = rv(), nFN = rv(), nFE = rv(), nPieces = rv();
  const nAC = rv(), nACp = rv();
  const nSE = rv();
  const nATB = rv(), nPF = rv(), nJ = rv();
  const nKA = rv(), nKB = rv(); // global key tables for encode20 layers
  const nChk = rv();

  function sealTable(arr) {
    const keys = [];
    for (let i = 0; i < 8; i++) keys.push(Math.floor(Math.random() * 256));
    const csv = arr.join(',');
    let hex = '';
    for (let i = 0; i < csv.length; i++) {
      const x = (csv.charCodeAt(i) ^ keys[i % 8]) & 255;
      hex += (x < 16 ? '0' : '') + x.toString(16);
    }
    const a = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    return { enc: multiLayerEncode(hex, a, b), a, b, keys };
  }
  function sealTableChunks(arr, chunkSize) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += chunkSize) chunks.push(sealTable(arr.slice(i, i + chunkSize)));
    return chunks;
  }

  // --- Re-encode AT + frags with encode20 (xor20+hex+xor20+base94) ---
  // Build key pools outside longstrings
  const atEnc20 = [];
  for (let i = 0; i < atReal.length; i++) {
    const ka = makeKey20(), kb = makeKey20();
    const plain = [buildATFragment1, buildATFragment2, buildATFragment3, buildATFragment4][i]();
    atEnc20.push({ enc: encode20(plain, ka, kb), ka, kb, real: true, i });
  }
  const atDecoy20 = [];
  for (let i = 0; i < 3; i++) {
    const ka = makeKey20(), kb = makeKey20();
    atDecoy20.push({ enc: encode20('do local _=0 end', ka, kb), ka, kb, real: false, i });
  }
  const atAll = atEnc20.concat(atDecoy20);
  for (let i = atAll.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [atAll[i], atAll[j]] = [atAll[j], atAll[i]];
  }
  const atRealOrder20 = [];
  for (let ri = 0; ri < 4; ri++) {
    for (let p = 0; p < atAll.length; p++) {
      if (atAll[p].real && atAll[p].i === ri) { atRealOrder20.push(p); break; }
    }
  }

  const fragEnc20 = [];
  {
    let off = 0;
    const total = sourceInput.length;
    for (let fi = 0; fi < fragCount; fi++) {
      const left = fragCount - fi;
      const take = fi === fragCount - 1 ? total - off : Math.max(1, Math.floor((total - off) / left));
      const text = sourceInput.slice(off, off + take);
      off += take;
      const ka = makeKey20(), kb = makeKey20();
      fragEnc20.push({ enc: encode20(text, ka, kb), ka, kb, real: true });
    }
    for (let i = 0; i < decoyFragCount; i++) {
      const ka = makeKey20(), kb = makeKey20();
      const noise = randJunkStrSafe(40 + randInt(0, 80));
      fragEnc20.push({ enc: encode20(noise, ka, kb), ka, kb, real: false });
    }
  }

  const vaultChunks = sealTableChunks(vault, 12 + Math.floor(Math.random() * 10));
  const realVmap = allVmaps[realVmapIdx];
  const vmapChunkSize = 10 + Math.floor(Math.random() * 8);
  const realVmapChunks = sealTableChunks(realVmap, vmapChunkSize);
  const fakeVmapPacks = allVmaps.map((vm, idx) => {
    if (idx === realVmapIdx) return null;
    return sealTableChunks(vm, vmapChunkSize);
  }).filter(Boolean);

  parts.push('return(function()');
  parts.push(generateOuterJunk(randInt(4, 8)));
  parts.push(`local ${nJ}={${junkArray.map((j) => luaLongWrap(j)).join(',')}}`);
  parts.push(generateOuterJunk(randInt(2, 4)));

  // bit xor helper
  parts.push(`local ${nBx}=(bit32 and bit32.bxor) or function(a,b) local r,p=0,1 for _=1,8 do local x,y=a%2,b%2 if x~=y then r=r+p end a=(a-x)/2 b=(b-y)/2 p=p*2 end return r end`);

  // multiLayer decoder (vault/vmap only) — 2-seed form
  parts.push(`local function ${nP}(_1,_2,_3) if type(_1)~="string" or #_1<5 then return "" end local _4,_5={},1 while _5+4<=#_1 do local _6=_1:byte(_5)-33 local _7=_1:byte(_5+1)-33 local _8=_1:byte(_5+2)-33 local _9=_1:byte(_5+3)-33 local _10=_1:byte(_5+4)-33 local _11=_6*78074896+_7*830584+_8*8836+_9*94+_10 _4[#_4+1]=string.char(math.floor(_11/16777216)%256) _4[#_4+1]=string.char(math.floor(_11/65536)%256) _4[#_4+1]=string.char(math.floor(_11/256)%256) _4[#_4+1]=string.char(math.floor(_11)%256) _5=_5+5 end local _12=table.concat(_4) if #_12<4 then return "" end local _13=_12:byte(1)*16777216+_12:byte(2)*65536+_12:byte(3)*256+_12:byte(4) local _14={} for _15=1,_13 do local _b=_12:byte(4+_15) if not _b then break end _14[_15]=string.char(${nBx}(_b,_3%256)) end local _16=table.concat(_14) local _17={} for _18=1,#_16,2 do local _19=_16:byte(_18) local _20=_16:byte(_18+1) if not _20 then break end _17[#_17+1]=(_19<=57 and _19-48 or _19-55)*16+(_20<=57 and _20-48 or _20-55) end local _21={} local _22=_2%256 for _23=1,50 do _22=(97*_22+33)%256 _21[_23]=_22 end local _24={} local _25=0 for _26=1,#_17 do _25=_25+1 if _25>50 then _25=1 end _24[_26]=string.char(${nBx}(_17[_26],_21[_25])) end return table.concat(_24) end`);

  // encode20 decoder: base94 → xor kB → hex unhex → xor kA
  const nD20 = rv();
  parts.push(`local function ${nD20}(s,kA,kB) if type(s)~="string" or #s<5 or type(kA)~="table" or type(kB)~="table" then return "" end local _4,_5={},1 while _5+4<=#s do local _6=s:byte(_5)-33 local _7=s:byte(_5+1)-33 local _8=s:byte(_5+2)-33 local _9=s:byte(_5+3)-33 local _10=s:byte(_5+4)-33 local _11=_6*78074896+_7*830584+_8*8836+_9*94+_10 _4[#_4+1]=string.char(math.floor(_11/16777216)%256) _4[#_4+1]=string.char(math.floor(_11/65536)%256) _4[#_4+1]=string.char(math.floor(_11/256)%256) _4[#_4+1]=string.char(math.floor(_11)%256) _5=_5+5 end local _12=table.concat(_4) if #_12<4 then return "" end local _13=_12:byte(1)*16777216+_12:byte(2)*65536+_12:byte(3)*256+_12:byte(4) local hx={} for i=1,_13 do local b=_12:byte(4+i) if not b then break end local kb=kB[((i-1)%20)+1] or 0 hx[i]=string.char(${nBx}(b,kb%256)) end local hs=table.concat(hx) local raw={} local ri=0 for i=1,#hs,2 do local A,B=hs:byte(i),hs:byte(i+1) if not B then break end local hi=(A<=57 and A-48) or (A-55) local lo=(B<=57 and B-48) or (B-55) local v=hi*16+lo ri=ri+1 local ka=kA[((ri-1)%20)+1] or 0 raw[ri]=string.char(${nBx}(v,ka%256)) end return table.concat(raw) end`);

  parts.push(`local function ${nParse}(s,k) local t={} if type(s)~="string" or #s<2 then return t end local o={} local idx=0 for i=1,#s,2 do local A,B=s:byte(i),s:byte(i+1) if not B then break end local hi=(A<=57 and A-48) or (A-87) local lo=(B<=57 and B-48) or (B-87) local v=hi*16+lo idx=idx+1 local kk=k[((idx-1)%8)+1] or 0 o[idx]=string.char(${nBx}(v,kk%256)) end local ss=table.concat(o) for n in string.gmatch(ss,"[^,]+") do t[#t+1]=tonumber(n) or 0 end return t end`);
  parts.push(generateOuterJunk(2));

  // Vault + VMap: 8-key also as base94 longstring (no {n,n,...} arrays)
  function emitSealedChunk(targetVar, ch, dead) {
    const ks1 = Math.floor(Math.random() * 256), ks2 = Math.floor(Math.random() * 256);
    const keyEnc = multiLayerEncode(ch.keys.join(','), ks1, ks2);
    const tk = rv(), ts = rv(), tks1 = rv(), tks2 = rv();
    const o1 = `(${ks1})`, o2 = `(${ks2})`;
    if (dead) {
      parts.push(`if false then do local ${tk}=${luaLongWrap(keyEnc)} local ${ts}=${luaLongWrap(ch.enc)} local _k={} for n in string.gmatch(${nP}(${tk},${ks1},${ks2}) or "","%-?%d+") do _k[#_k+1]=tonumber(n) end local _p=${nParse}(${nP}(${ts},${ch.a},${ch.b}),_k) end end`);
    } else {
      parts.push(generateOuterJunk(1));
      parts.push(`do local ${tk}=${luaLongWrap(keyEnc)}`);
      parts.push(generateOuterJunk(1));
      parts.push(`local ${ts}=${luaLongWrap(ch.enc)}`);
      parts.push(`local ${tks1}=${ks1} local ${tks2}=${ks2}`);
      parts.push(`local _k={} for n in string.gmatch(${nP}(${tk},${tks1},${tks2}) or "","%-?%d+") do _k[#_k+1]=tonumber(n) end`);
      parts.push(`local _p=${nParse}(${nP}(${ts},${ch.a},${ch.b}),_k) for _i=1,#_p do ${targetVar}[#${targetVar}+1]=_p[_i] end end`);
    }
  }

  parts.push(`local ${nKV}={}`);
  for (let ci = 0; ci < vaultChunks.length; ci++) {
    emitSealedChunk(nKV, vaultChunks[ci], false);
  }
  parts.push(`if type(${nKV})~="table" or #${nKV}<1 then error("",0) end`);
  parts.push(generateOuterJunk(1));

  parts.push(`local ${nVM}={}`);
  for (let ci = 0; ci < realVmapChunks.length; ci++) {
    emitSealedChunk(nVM, realVmapChunks[ci], false);
    if (fakeVmapPacks.length > 0) {
      const fk = fakeVmapPacks[ci % fakeVmapPacks.length];
      const fch = fk[ci % fk.length];
      emitSealedChunk(nVM, fch, true);
    }
  }
  parts.push(`if type(${nVM})~="table" or #${nVM}<1 then error("",0) end`);
  parts.push(generateOuterJunk(2));

  // KEYS: each key = ONE base94 longstring (multiLayer) + 2 opaque seeds — looks like junk
  parts.push(`local ${nKA}={}`);
  parts.push(`local ${nKB}={}`);
  const allKeyItems = [];
  for (let i = 0; i < atAll.length; i++) allKeyItems.push({ idx: i + 1, ka: atAll[i].ka, kb: atAll[i].kb });
  const fragKeyBase = atAll.length;
  for (let i = 0; i < fragEnc20.length; i++) allKeyItems.push({ idx: fragKeyBase + i + 1, ka: fragEnc20[i].ka, kb: fragEnc20[i].kb });

  function opaqueNum(n) {
    n = n & 255;
    const t = Math.floor(Math.random() * 4);
    if (t === 0) return String(n);
    if (t === 1) { const a = Math.floor(Math.random() * n); return `(${a}+${n - a})`; }
    if (t === 2) { const a = n + Math.floor(Math.random() * 40); return `(${a}-${a - n})`; }
    const a = Math.floor(Math.random() * 50); return `((${n + a})-${a})`;
  }

  // meta: {idx, kind:1|2, enc, s1, s2, tmpName}
  const keyEncMeta = [];
  for (const item of allKeyItems) {
    for (const kind of ['A', 'B']) {
      const arr = kind === 'A' ? item.ka : item.kb;
      const csv = arr.join(',');
      const s1 = Math.floor(Math.random() * 256);
      const s2 = Math.floor(Math.random() * 256);
      const enc = multiLayerEncode(csv, s1, s2);
      keyEncMeta.push({ idx: item.idx, kind: kind === 'A' ? 1 : 2, enc, s1, s2, tmp: rv() });
    }
  }
  for (let i = keyEncMeta.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keyEncMeta[i], keyEncMeta[j]] = [keyEncMeta[j], keyEncMeta[i]];
  }

  const nKeyStore = rv();
  parts.push(`local ${nKeyStore}={}`);
  for (let i = 0; i < keyEncMeta.length; i++) {
    const m = keyEncMeta[i];
    parts.push(generateOuterJunk(1));
    // ONE longstring = base94 junk look
    parts.push(`local ${m.tmp}=${luaLongWrap(m.enc)}`);
    parts.push(generateOuterJunk(1));
    // seeds as opaque expressions, not arrays
    const ns1 = rv(), ns2 = rv();
    parts.push(`local ${ns1}=${opaqueNum(m.s1)}`);
    parts.push(generateOuterJunk(1));
    parts.push(`local ${ns2}=${opaqueNum(m.s2)}`);
    // store: longstr, s1, s2, idx, kind
    parts.push(`${nKeyStore}[${i + 1}]={${m.tmp},${ns1},${ns2},${m.idx},${m.kind}}`);
  }

  // Rebuild key tables via multiLayer decode (nP) — no number-array keys in source
  const nReKey = rv();
  parts.push(`local function ${nReKey}()`);
  parts.push(`local function _pn(s) local t={} for n in string.gmatch(s or "","%-?%d+") do t[#t+1]=tonumber(n) end return t end`);
  parts.push(`for i=1,#${nKeyStore} do local e=${nKeyStore}[i]`);
  parts.push(`local csv=${nP}(e[1],e[2],e[3])`);
  parts.push(`local arr=_pn(csv)`);
  parts.push(`if e[5]==1 then ${nKA}[e[4]]=arr else ${nKB}[e[4]]=arr end`);
  parts.push(`end end`);
  parts.push(`${nReKey}()`);
  // decoy: more base94 longstrings, dead
  for (let d = 0; d < 8; d++) {
    const s1 = Math.floor(Math.random() * 256), s2 = Math.floor(Math.random() * 256);
    const enc = multiLayerEncode(randJunkStrSafe(20 + randInt(0, 30)), s1, s2);
    parts.push(`if false then local _=${luaLongWrap(enc)} end`);
  }
  parts.push(generateOuterJunk(2));

  // === HOOK DETECTION (silent return — no payload dump) ===
  // Runs BEFORE any meaningful work. Blocks hookfunction(loadstring).
  parts.push(`do`);
  parts.push(`local _L0=loadstring or load`);
  // Soft hook detect: only hard-fail on clear Lua-closure / hook markers
  // (iscclosure==false alone is NOT reliable — many executors wrap loadstring)
  parts.push(`if type(_L0)=="function" then`);
  parts.push(`if type(islclosure)=="function" and type(debug)=="table" and type(debug.getinfo)=="function" then local ok,r=pcall(islclosure,_L0); local ok2,inf=pcall(debug.getinfo,_L0,"S"); if ok and r==true and ok2 and type(inf)=="table" and inf.what=="Lua" then local ts=tostring(_L0); if type(ts)=="string" and (string.find(ts,"hook",1,true) or string.find(ts,"Hook",1,true)) then return end end end`);
  
  parts.push(`do local ts=tostring(_L0) if type(ts)=="string" and (string.find(ts,"hook",1,true) or string.find(ts,"Hook",1,true)) then return end end`);
  parts.push(`end`);
  parts.push(`end`);
  parts.push(generateOuterJunk(2));

  // === AT DIRECT (no loadstring — cannot be dumped via loadstring hook) ===
  parts.push(`do`);
  // Inline AT fragments as real code
  const atDirect = [buildATFragment1, buildATFragment2, buildATFragment3, buildATFragment4].map(f => f());
  for (let i = 0; i < atDirect.length; i++) {
    parts.push(generateOuterJunk(1));
    parts.push(atDirect[i]);
  }
  parts.push(`end`);
  parts.push(generateOuterJunk(2));

  // Re-check hooks after AT
  parts.push(`do local _L1=loadstring or load if type(_L1)=="function" and type(islclosure)=="function" then local ok,r=pcall(islclosure,_L1) if ok and r==true then return end end if type(debug)=="table" and type(debug.getinfo)=="function" then local ok,inf=pcall(debug.getinfo,_L1,"S") if ok and type(inf)=="table" and inf.what=="Lua" then return end end end`);

  // === DECOY loadstring path (dead) — looks like old pack, never runs ===
  parts.push(`local ${nATB}={}`);
  for (let i = 0; i < atAll.length; i++) {
    parts.push(`${nATB}[${i + 1}]=${luaLongWrap(atAll[i].enc)}`);
  }
  parts.push(`local ${nPF}={}`);
  for (let fi = 0; fi < fragEnc20.length; fi++) {
    parts.push(`${nPF}[${fi + 1}]=${luaLongWrap(fragEnc20[fi].enc)}`);
  }
  // dead branch: fake decode + loadstring (hook dumps junk only if forced)
  parts.push(`if false then`);
  parts.push(`local function ${nGL}() return loadstring or load end`);
  parts.push(`local ${nL}=${nGL}()`);
  parts.push(`local ${nACp}={}`);
  for (let oi = 0; oi < atRealOrder20.length; oi++) {
    const pos = atRealOrder20[oi];
    parts.push(`${nACp}[${oi + 1}]=${nD20}(${nATB}[${pos + 1}],${nKA}[${pos + 1}],${nKB}[${pos + 1}])`);
  }
  parts.push(`local ${nAC}=table.concat(${nACp})`);
  parts.push(`local _af,_ae=${nL}(${nAC})`);
  parts.push(`local ${nPieces}={}`);
  let pieceN = 0;
  for (let fi = 0; fi < fragEnc20.length; fi++) {
    const keyIdx = fragKeyBase + fi + 1;
    if (!fragEnc20[fi].real) continue;
    pieceN++;
    parts.push(`${nPieces}[${pieceN}]=${nD20}(${nPF}[${fi + 1}],${nKA}[${keyIdx}],${nKB}[${keyIdx}])`);
  }
  parts.push(`local ${nSRC}=table.concat(${nPieces})`);
  parts.push(`local ${nFN},${nFE}=${nL}(${nSRC})`);
  parts.push(`if type(${nFN})=="function" then ${nFN}() end`);
  parts.push(`end`);
  parts.push(generateOuterJunk(2));

  // === REAL PAYLOAD: encode20(blob) scattered + opaque tags + no plaintext keys ===
  if (vmSplit && vmSplit.kind === 'split') {
    const blob = String(vmSplit.blob);
    const tags = vmSplit.tags || { sk:'SK', mr:'MR', bc:'BC', ky:'KY', kc:'KC', pr:'PR', n:'N', s:'S', t:'T', f:'F', z:'Z' };
    const slots = vmSplit.slots || { K:1, BC:2, KEYS:3, PROTOS:4, SK:5, MR:6 };

    // Split blob into many small frags + decoys, shuffle
    const blobFrags = [];
    const blobFragN = 4 + Math.floor(Math.random() * 4); // 4..7
    {
      let off = 0;
      for (let fi = 0; fi < blobFragN; fi++) {
        const left = blobFragN - fi;
        const take = fi === blobFragN - 1 ? blob.length - off : Math.max(1, Math.floor((blob.length - off) / left));
        const slice = blob.slice(off, off + take);
        off += take;
        const ka = makeKey20(), kb = makeKey20();
        blobFrags.push({ enc: encode20(slice, ka, kb), ka, kb, real: true, ord: fi });
      }
      // decoy frags
      for (let d = 0; d < 3; d++) {
        const ka = makeKey20(), kb = makeKey20();
        blobFrags.push({ enc: encode20(randJunkStrSafe(30+randInt(0,40)), ka, kb), ka, kb, real: false, ord: -1 });
      }
    }
    // shuffle presentation
    for (let i = blobFrags.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [blobFrags[i], blobFrags[j]] = [blobFrags[j], blobFrags[i]];
    }

    const blobKeyBase = fragKeyBase + fragEnc20.length + 20;
    // Each blob frag: data longstring (encode20) + 2 key longstrings (multiLayer of key csv) + opaque seeds
    const nBMeta = rv();
    parts.push(`local ${nBMeta}={}`);
    function opaqueNum(n) {
      n = n & 255;
      const a = Math.floor(Math.random() * 60);
      if (Math.random() < 0.5) return `(${a}+${(n - a + 256) % 256})%256`;
      return `(${n + a}-${a})`;
    }
    for (let i = 0; i < blobFrags.length; i++) {
      const m = blobFrags[i];
      const te = rv();
      // encrypt key arrays as multiLayer base94 (looks like junk)
      const s1 = Math.floor(Math.random()*256), s2 = Math.floor(Math.random()*256);
      const s3 = Math.floor(Math.random()*256), s4 = Math.floor(Math.random()*256);
      const encKa = multiLayerEncode(m.ka.join(','), s1, s2);
      const encKb = multiLayerEncode(m.kb.join(','), s3, s4);
      const tKa = rv(), tKb = rv();
      const ns1=rv(),ns2=rv(),ns3=rv(),ns4=rv();
      parts.push(generateOuterJunk(1));
      parts.push(`local ${te}=${luaLongWrap(m.enc)}`);
      parts.push(generateOuterJunk(1));
      parts.push(`local ${tKa}=${luaLongWrap(encKa)}`);
      parts.push(generateOuterJunk(1));
      parts.push(`local ${tKb}=${luaLongWrap(encKb)}`);
      parts.push(`local ${ns1}=${opaqueNum(s1)} local ${ns2}=${opaqueNum(s2)}`);
      parts.push(generateOuterJunk(1));
      parts.push(`local ${ns3}=${opaqueNum(s3)} local ${ns4}=${opaqueNum(s4)}`);
      // meta: dataEnc, kaEnc, kbEnc, s1,s2,s3,s4, real, ord
      parts.push(`${nBMeta}[${i+1}]={${te},${tKa},${tKb},${ns1},${ns2},${ns3},${ns4},${m.real?1:0},${m.ord>=0?m.ord:0}}`);
    }

    // Decode: multiLayer → key tables → encode20 decode data
    const nBlob = rv();
    parts.push(`local ${nBlob}=""`);
    parts.push(`do local function _pn(s) local t={} for n in string.gmatch(s or "","%-?%d+") do t[#t+1]=tonumber(n) end return t end`);
    const nPiecesB = rv();
    parts.push(`local ${nPiecesB}={}`);
    parts.push(`for i=1,#${nBMeta} do local e=${nBMeta}[i]`);
    parts.push(`if e[8]==1 then`);
    parts.push(`local ka=_pn(${nP}(e[2],e[4],e[5])) local kb=_pn(${nP}(e[3],e[6],e[7]))`);
    parts.push(`local d=${nD20}(e[1],ka,kb) ${nPiecesB}[e[9]+1]=d`);
    parts.push(`end end`);
    parts.push(generateOuterJunk(1));
    parts.push(`for i=1,#${nPiecesB} do ${nBlob}=${nBlob}..(${nPiecesB}[i] or "") end`);
    parts.push(`end`);
    parts.push(`if type(${nBlob})~="string" or #${nBlob}<8 then error("",0) end`);
    parts.push(generateOuterJunk(2));

    // Parser with opaque tags + numeric slots (no .BC .K visible)
    const nParseVD = rv(), nNums = rv(), nHex = rv();
    const tg = tags;
    const sl = slots;
    parts.push(`local function ${nParseVD}(s)`);
    parts.push(`local VD={}`);
    parts.push(`local function ${nNums}(line) local t={} for n in string.gmatch(line or "","%-?%d+") do t[#t+1]=tonumber(n) end return t end`);
    parts.push(`local function ${nHex}(h) if type(h)~="string" or #h<2 then return "" end local o={} for i=1,#h,2 do local b=tonumber(h:sub(i,i+1),16) if b then o[#o+1]=string.char(b) end end return table.concat(o) end`);
    parts.push(`local lines={} for line in string.gmatch(s,"[^\\r\\n]+") do lines[#lines+1]=line end`);
    parts.push(`local i=1 local tg_sk="${tg.sk} " local tg_mr="${tg.mr} " local tg_bc="${tg.bc} " local tg_ky="${tg.ky} " local tg_kc="${tg.kc} " local tg_pr="${tg.pr}" local tg_n="${tg.n} " local tg_s="${tg.s} " local tg_t="${tg.t}" local tg_f="${tg.f}" local tg_z="${tg.z}"`);
    parts.push(`while i<=#lines do local line=lines[i]`);
    parts.push(`if line:sub(1,#tg_sk)==tg_sk then VD[${sl.SK}]=tonumber(line:sub(#tg_sk+1)) or 0`);
    parts.push(`elseif line:sub(1,#tg_mr)==tg_mr then VD[${sl.MR}]=tonumber(line:sub(#tg_mr+1)) or 20`);
    parts.push(`elseif line:sub(1,#tg_bc)==tg_bc then VD[${sl.BC}]=${nNums}(line:sub(#tg_bc+1))`);
    parts.push(`elseif line:sub(1,#tg_ky)==tg_ky then VD[${sl.KEYS}]=${nNums}(line:sub(#tg_ky+1))`);
    parts.push(`elseif line:sub(1,#tg_kc)==tg_kc then local kc=tonumber(line:sub(#tg_kc+1)) or 0; i=i+1; local ki=0; VD[${sl.K}]=VD[${sl.K}] or {}; while ki<kc and i<=#lines do local L=lines[i]; if L:sub(1,#tg_n)==tg_n then VD[${sl.K}][#VD[${sl.K}]+1]=tonumber(L:sub(#tg_n+1)); ki=ki+1 elseif L==tg_t then VD[${sl.K}][#VD[${sl.K}]+1]=true; ki=ki+1 elseif L==tg_f then VD[${sl.K}][#VD[${sl.K}]+1]=false; ki=ki+1 elseif L==tg_z then VD[${sl.K}][#VD[${sl.K}]+1]=nil; ki=ki+1 elseif L:sub(1,#tg_s)==tg_s then VD[${sl.K}][#VD[${sl.K}]+1]=${nHex}(L:sub(#tg_s+1)); ki=ki+1 end; i=i+1 end; i=i-1`);
    parts.push(`elseif line==tg_pr then`);
    parts.push(`local function parseP(lines,i)`);
    parts.push(`local n=tonumber(lines[i]) or 0; i=i+1`);
    parts.push(`local arr={}`);
    parts.push(`for _pi=1,n do`);
    parts.push(`local L=lines[i] or ""; i=i+1`);
    parts.push(`local segs={}; local st=1`);
    parts.push(`for _s=1,6 do local pos=string.find(L,"|",st,true); if not pos then segs[#segs+1]=string.sub(L,st); st=#L+1; break else segs[#segs+1]=string.sub(L,st,pos-1); st=pos+1 end end`);
    parts.push(`segs[#segs+1]=string.sub(L,st)`);
    parts.push(`local maxR=tonumber(segs[1]) or 8 local nparams=tonumber(segs[2]) or 0 local isVar=(tonumber(segs[3])==1)`);
    parts.push(`local insts=${nNums}(segs[4] or "") local keys=${nNums}(segs[5] or "")`);
    parts.push(`local K={} local cstr=segs[6] or ""`);
    parts.push(`for seg in string.gmatch(cstr,"[^"..string.char(96).."]+") do`);
    parts.push(`if seg:sub(1,#tg_n)==tg_n then K[#K+1]=tonumber(seg:sub(#tg_n+1))`);
    parts.push(`elseif seg==tg_t then K[#K+1]=true`);
    parts.push(`elseif seg==tg_f then K[#K+1]=false`);
    parts.push(`elseif seg==tg_z then K[#K+1]=nil`);
    parts.push(`elseif seg:sub(1,#tg_s)==tg_s then K[#K+1]=${nHex}(seg:sub(#tg_s+1)) end end`);
    parts.push(`local ups={}; for u in string.gmatch(segs[7] or "","[^;]+") do local a,b=string.match(u,"(%d+),(%d+)"); if a then ups[#ups+1]={isLocal=(a=="1"),index=tonumber(b) or 0} end end`);
    parts.push(`local nested={}`);
    parts.push(`local mark=lines[i] or ""`);
    parts.push(`if mark=="@N" then i=i+1; nested,i=parseP(lines,i); if (lines[i] or "")=="@E" then i=i+1 end`);
    parts.push(`elseif mark=="@0" then i=i+1 end`);
    parts.push(`arr[#arr+1]={maxReg=maxR,nparams=nparams,isVararg=isVar,insts=insts,keys=keys,K=K,upvalues=ups,protos=nested}`);
    parts.push(`end`);
    parts.push(`return arr,i end`);
    parts.push(`i=i+1; local protos,ni=parseP(lines,i); VD[${sl.PROTOS}]=protos; i=ni-1`);
    parts.push(`end`);
    parts.push(`i=i+1 end`);
    parts.push(`return VD end`);

    const nVD = rv();
    parts.push(generateOuterJunk(1));
    parts.push(`local ${nVD}=${nParseVD}(${nBlob})`);
    parts.push(`if type(${nVD})~="table" or type(${nVD}[${sl.BC}])~="table" or #${nVD}[${sl.BC}]<1 then error("",0) end`);
    parts.push(`local _VD=${nVD}`);
    parts.push(generateOuterJunk(2));

    // AT already ran; embed interpreter
    parts.push(`do`);
    parts.push(String(vmSplit.interpreter).replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
    parts.push(`end`);
  } else if (vmMode === 'clyde-regvm') {
    // Clyde is a complete multi-line VM script. Embedding raw then flattening to
    // one line breaks `--` comments and internal structure → call nil.
    // Keep body in longstring, load+run after AT (AT already ran above).
    let embedSrc = String(sourceInput).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let eq = '';
    while (embedSrc.indexOf(']' + eq + ']') !== -1) eq += '=';
    const nL = rv(), nF = rv(), nE = rv();
    parts.push(`do`);
    parts.push(`local ${nL}=loadstring or load`);
    parts.push(`local ${nF},${nE}=${nL}([${eq}[${embedSrc}]${eq}],"8x")`);
    parts.push(`if not ${nF} then error("8xms clyde load: "..tostring(${nE}),0) end`);
    parts.push(`${nF}()`);
    parts.push(`end`);
  } else {
    parts.push(`do`);
    const embedSrc = String(sourceInput).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    parts.push(embedSrc);
    parts.push(`end`);
  }
  parts.push(`return`);
  parts.push('end)()');

  // One-line outer shell, but NEVER collapse inside longstrings [=[...]=]
  let code;
  if (vmMode === 'clyde-regvm') {
    const joined = parts.join('\n');
    // Collapse only regions outside long-brackets
    const out = [];
    let i = 0;
    while (i < joined.length) {
      const open = joined.slice(i).match(/^\[(=*)\[/);
      if (open) {
        const eq = open[1];
        const start = i + open[0].length;
        const close = ']' + eq + ']';
        const end = joined.indexOf(close, start);
        if (end === -1) {
          out.push(joined.slice(i));
          break;
        }
        out.push(open[0]);
        out.push(joined.slice(start, end)); // preserve newlines inside
        out.push(close);
        i = end + close.length;
      } else {
        let j = i;
        while (j < joined.length && !joined.slice(j).match(/^\[=*\[/)) j++;
        out.push(joined.slice(i, j).replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' '));
        i = j;
      }
    }
    code = out.join('').trim();
  } else {
    code = parts.join(' ').replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return {
    code,
    meta: {
      inputBytes: new Blob([input]).size,
      outputBytes: new Blob([code]).size,
      fragments: fragCount,
      junkKb: (targetTotal / 1024).toFixed(1),
      vmMode,
      opcodes: (vmMode === 'clyde-regvm') ? 57 : ((vmMode === 'clyde-bc') ? 57 : ((String(vmMode).indexOf('vm') === 0) ? 130 : 12)),
      pack: 'base94-keys+xor20-bc+lura-scatter',
      pipeline: (vmMode === 'clyde-regvm') ? 'luau→ClydeRegVM(Max)→8xmsPack' : ((vmMode === 'clyde-bc') ? 'luau→ClydeBC→8xmsVM→pack' : ((String(vmMode).indexOf('vm') === 0) ? 'luau→VM→pack' : 'luau→fallback→pack')),
    },
  };
}
