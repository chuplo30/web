/**
 * WAN pack — commercial setmetatable + 220+ op (Hercules-style dispatch) + encode20 + bulk junk + 2 AT payloads.
 * Payload runs via 1x loadstring after decode (stable). Size target 100KB+.
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

function stripLuauTypes(src) {
  src = String(src || '');
  src = src.replace(/\)\s*:\s*[A-Za-z_][\w\.]*(?:\s*\|\s*[A-Za-z_][\w\.]*)*/g, ')');
  src = src.replace(/([,\(\s])([A-Za-z_][\w]*)\s*:\s*\{[^}]*\}/g, '$1$2');
  src = src.replace(/([,\(\s])([A-Za-z_][\w]*)\s*:\s*[A-Za-z_][\w\.]*(?:\s*\|\s*[A-Za-z_][\w\.]*)*/g, '$1$2');
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

function keyHex(arr) {
  let h = '';
  for (let i = 0; i < arr.length; i++) h += (arr[i] & 255).toString(16).padStart(2, '0');
  return h;
}

function opaqueNum(n) {
  n = n & 255;
  const t = Math.floor(Math.random() * 3);
  if (t === 0) return String(n);
  if (t === 1) { const a = Math.floor(Math.random() * (n + 1)); return '(' + a + '+' + (n - a) + ')'; }
  const a = n + 1 + Math.floor(Math.random() * 30); return '(' + a + '-' + (a - n) + ')';
}

function emitOpcodeTable(parts, count, usedIn) {
  const used = usedIn || new Set();
  for (let i = 0; i < count; i++) {
    let k = 1 + Math.floor(Math.random() * 2000);
    while (used.has(k)) k = 1 + Math.floor(Math.random() * 2000);
    used.add(k);
    const kind = i % 10;
    if (kind === 0) {
      parts.push('[' + k + ']=function(R,F,Y,d,L,O,k,v,y,K,c)if k then if O<=' + (100 + randInt(0, 50)) + ' then return ' + randInt(1, 160) + ',F,L,v,c,d,1+y else return ' + randInt(1, 160) + ',F,L,k,c,d,y end elseif O<=' + (145 + randInt(0, 20)) + ' then return ' + randInt(1, 160) + ',F,L,v,c,d,k elseif O<=' + (150 + randInt(0, 20)) + ' then return ' + randInt(1, 160) + ',F,L+4,v,c,Y,y else return ' + randInt(1, 160) + ',{1-v,Y+0,nil,F,v},L,O,k,d,y end end,');
    } else if (kind === 1) {
      parts.push('[' + k + ']=function(R,F,Y,d,L,O,k)if k<=1 then if k<=0 then return ' + randInt(1, 160) + ',d,F,L else return ' + randInt(1, 160) + ',d,F,L,O end elseif k<=2 then return ' + randInt(1, 160) + ',d,F,L+1,O elseif k<=3 then return ' + randInt(1, 160) + ',d,F,L+4,O else return ' + randInt(1, 160) + ',1+L,F,L,O end end,');
    } else if (kind === 2) {
      parts.push('[' + k + ']=function(R,F,Y,d,L,O,k,v)if k<=' + randInt(20, 40) + ' then return ' + randInt(1, 40) + ',Y,L elseif k<=' + randInt(41, 60) + ' then return ' + randInt(1, 40) + ',Y,L else return ' + randInt(1, 40) + ',Y,L end end,');
    } else if (kind === 3) {
      parts.push('[' + k + ']=function(A,B,C)if A and B and A>B+' + (500 + randInt(0, 800)) + ' then return C end end,');
    } else if (kind === 4) {
      parts.push('[' + k + ']=function(R,F,Y)if F then return 12,Y,R elseif Y then return 40,R,F else return 99,F,Y end end,');
    } else if (kind === 5) {
      parts.push('[' + k + ']=function()local z=' + randInt(1, 200) + ';z=z*' + randInt(1, 9) + '%256 end,');
    } else if (kind === 6) {
      parts.push('[' + k + ']=function(o,l)return""end,');
    } else if (kind === 7) {
      parts.push('[' + k + ']=function(a,b,c)local t=(a or 0)+(b or 0);if t>' + randInt(100, 999) + ' then return c end return t%256 end,');
    } else if (kind === 8) {
      // Hercules-like MOVE/LOADK style decoy
      parts.push('[' + k + ']=function(X,Inst,z)if Inst then X[Inst.A or 0]=X[Inst.B or 0] end return z end,');
    } else if (kind === 9) {
      parts.push('[' + k + ']=function(X,Inst)if Inst and Inst.A then X[Inst.A]=(Inst.D~=nil and Inst.D) or X[Inst.B or 0] end end,');
    } else {
      parts.push('[' + k + ']=function(Env,Inst,X)if Inst and Inst.D then Env[Inst.D]=X and X[Inst.A or 0] end end,');
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



/** Lightweight local rename — NEVER touches string / longstring contents. */
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
    'Parent','Name','ClassName','Heartbeat','RenderStepped','Stepped','Changed','Enabled','Disabled','Value'
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

function buildAT(wantAT) {
  if (!wantAT) return [];
  const stages = [];
  // 1) soft loadstring-hook surface (IY-safe)
  const soft = String(AT_STAGE_SOFT_HOOK || '').trim();
  if (soft.length > 5) stages.push(soft);
  // 2) envcrack
  const env = String(AT_STAGE_ENVCRACK || '').trim();
  if (env.length > 10) stages.push(env);
  // 3) strong integrity suite (payload cuối)
  const strong = String(AT_STAGE_STRONG || '').trim();
  if (strong.length > 50) stages.push(strong);
  return stages;
}



export function obfuscate(input, opts = {}) {
  // stripLuauTypes DISABLED — was eating obj:Method calls (game:GetService → game())
  input = stripLuaComments(String(input || ''));
  // renameLocals disabled
  if (!input || !input.trim()) throw new Error('Input is empty');
  const debug = !!(opts && opts.debug);
  const log = debug ? (m) => console.log('[WAN] ' + m) : () => {};
  const wantAT = !(opts && opts.noAT);

  const atStages = buildAT(wantAT);
  let secret = '';
  for (let i = 0; i < atStages.length; i++) {
    secret += 'do\n' + atStages[i] + '\nend\n';
  }
  secret += input;
  log('secret bytes ' + secret.length + ' atStages=' + atStages.length);

  // --- Reliable pack: 1 real frag + decoy noise, keys as plain number tables (no multiLayer key path) ---
  const ka = makeKey20(), kb = makeKey20();
  const enc = encode20(secret, ka, kb);

  const decoys = [];
  const decoyN = 24 + randInt(0, 12);
  for (let d = 0; d < decoyN; d++) {
    const dka = makeKey20(), dkb = makeKey20();
    decoys.push({
      enc: encode20(randJunkStrSafe(80 + randInt(0, 160)), dka, dkb),
      ka: dka, kb: dkb
    });
  }

  const parts = [];
  const nBx = rv(), nD20 = rv(), nSrc = rv(), nFn = rv(), nEr = rv(), nL = rv();
  const entryKey = 100 + randInt(0, 1900);
  const methodName = ['rH', 'qK', 'xM', 'pJ', 'zV', 'nQ', 'sW', 'tB'][randInt(0, 7)];

  parts.push('return setmetatable({');
  const usedKeys = new Set();
  usedKeys.add(entryKey);
  emitOpcodeTable(parts, 220 + randInt(0, 40), usedKeys);
  log('opcode handlers ~' + usedKeys.size);

  parts.push('[' + entryKey + ']=function(...)');
  parts.push(generateOuterJunk(6 + randInt(0, 6)));

  // outer longstring noise
  for (let j = 0; j < 6 + randInt(0, 4); j++) {
    parts.push('do local _j' + j + '=' + luaLongWrap(randJunkStrSafe(60 + randInt(0, 100))) + ' end');
  }

  parts.push('local ' + nBx + '=(bit32 and bit32.bxor) or function(a,b)local r,p=0,1 for _=1,8 do local x,y=a%2,b%2 if x~=y then r=r+p end a=(a-x)/2 b=(b-y)/2 p=p*2 end return r end');

  // decoder encode20: s + kA table + kB table
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

  // real payload longstring + key tables (plain, scattered among decoys)
  const nE = rv(), nKA = rv(), nKB = rv();
  parts.push('local ' + nE + '=' + luaLongWrap(enc));
  parts.push('local ' + nKA + '={' + ka.join(',') + '}');
  parts.push('local ' + nKB + '={' + kb.join(',') + '}');

  // decoy longstrings + fake keys (never used)
  for (let d = 0; d < decoys.length; d++) {
    const de = rv(), dka = rv(), dkb = rv();
    parts.push('do local ' + de + '=' + luaLongWrap(decoys[d].enc));
    parts.push('local ' + dka + '={' + decoys[d].ka.join(',') + '}');
    parts.push('local ' + dkb + '={' + decoys[d].kb.join(',') + '} end');
    if (d % 3 === 0) parts.push(generateOuterJunk(1));
  }

  parts.push(generateOuterJunk(3));
  parts.push('local ' + nSrc + '=' + nD20 + '(' + nE + ',' + nKA + ',' + nKB + ')');
  parts.push('if type(' + nSrc + ')~="string" or #' + nSrc + '<1 then error("WAN OBFUSCATE chao may ku:>",0) end');
  parts.push('local ' + nL + '=(loadstring or load)');
  parts.push('if type(' + nL + ')~="function" then error("WAN OBFUSCATE chao may ku:>",0) end');
  parts.push('local ' + nFn + ',' + nEr + '=' + nL + '(' + nSrc + ',"wan")');
  parts.push('if type(' + nFn + ')~="function" then error("WAN OBFUSCATE chao may ku:> "..tostring(' + nEr + '),0) end');
  parts.push(nFn + '(...)');
  parts.push('end,');

  emitOpcodeTable(parts, 40 + randInt(0, 20), usedKeys);

  parts.push('},{__call=function(t,...) local f=t[' + entryKey + '] if type(f)~="function" then error("WAN OBFUSCATE chao may ku:>",0) end return f(...) end');
  parts.push(',[' + (200 + randInt(0, 50)) + ']=function()end');
  parts.push('})()');

  let code = parts.join('\n');
  code = toOneLinePreserveLongstrings(code);

  log('out ' + code.length + ' entry=' + entryKey + ' method=:' + methodName);
  return {
    code,
    meta: {
      inputBytes: secret.length,
      outputBytes: code.length,
      fragments: 1,
      decoys: decoyN,
      atStages: atStages.length,
      opcodes: usedKeys.size,
      vmMode: 'commercial-encode20-reliable',
      pack: 'setmetatable+encode20+1frag+plainKeys',
      pipeline: 'luau→AT→encode20→commercial-pack',
      method: methodName,
      entryKey
    }
  };
}
