/**
 * WAN reliable commercial pack — prioritizes RUN + commercial look.
 * setmetatable({[n]=...}) + encode20 + binary keys + light AT.
 */
import {
  randInt, multiLayerEncode, encode20, makeKey20, luaLongWrap,
  generateOuterJunk, randJunkStrSafe
} from './encode.js';
import { AT_STAGE_ENVCRACK } from './at-stages.js';

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

function keyBin(arr) {
  let b = '';
  for (let i = 0; i < arr.length; i++) b += String.fromCharCode(arr[i] & 255);
  return b;
}

function opaqueNum(n) {
  n = n & 255;
  const t = Math.floor(Math.random() * 3);
  if (t === 0) return String(n);
  if (t === 1) { const a = Math.floor(Math.random() * (n + 1)); return '(' + a + '+' + (n - a) + ')'; }
  const a = n + 1 + Math.floor(Math.random() * 30); return '(' + a + '-' + (a - n) + ')';
}

function emitDispatchJunk(parts, count) {
  const used = new Set();
  for (let i = 0; i < count; i++) {
    let k = 1 + Math.floor(Math.random() * 240);
    while (used.has(k)) k = 1 + Math.floor(Math.random() * 240);
    used.add(k);
    const kind = Math.floor(Math.random() * 5);
    if (kind === 0) {
      parts.push('[' + k + ']=function(R,F,Y,d,L,O,k)if k then if O<=' + (100 + randInt(0, 50)) + ' then return ' + randInt(1, 160) + ',F,L,k,d else return ' + randInt(1, 160) + ',F,L,O,d end elseif O<=' + (150 + randInt(0, 20)) + ' then return ' + randInt(1, 160) + ',F,L,d else return ' + randInt(1, 160) + ',{1,Y,nil,F},L,O end end,');
    } else if (kind === 1) {
      parts.push('[' + k + ']=function(A,B,C)if A and B and A>B+' + (500 + randInt(0, 500)) + ' then return C end end,');
    } else if (kind === 2) {
      parts.push('[' + k + ']=function(R,F,Y)if F then return 12,Y,R elseif Y then return 40,R,F else return 99,F,Y end end,');
    } else if (kind === 3) {
      parts.push('[' + k + ']=function()local z=' + randInt(1, 80) + ';z=z end,');
    } else {
      parts.push('[' + k + ']=function(o,l)return""end,');
    }
  }
}

function buildLightAT(wantAT) {
  if (!wantAT) return [];
  const stages = [];
  const env = String(AT_STAGE_ENVCRACK || '').trim();
  if (env.length > 10) stages.push(env);
  stages.push([
    'local function __W(m) error("WAN OBFUSCATE chao may ku:> "..tostring(m or ""),0) end',
    'if game==nil then __W("e1") end',
    'if workspace==nil then __W("e2") end',
    'if type(typeof)~="function" then __W("e3") end',
    'do local ok,t=pcall(typeof,game) if not ok or (t~="Instance" and t~="userdata") then __W("e4") end end',
    'do local L=loadstring or load if type(L)=="function" then local ts=tostring(L) if type(ts)=="string" and (string.find(ts,"hook",1,true) or string.find(ts,"Hook",1,true)) then __W("h1") end end end',
  ].join('\n'));
  return stages;
}

export function obfuscate(input, opts = {}) {
  input = stripLuauTypes(stripLuaComments(String(input || '')));
  if (!input || !input.trim()) throw new Error('Input is empty');
  const debug = !!(opts && opts.debug);
  const log = debug ? (m) => console.log('[WAN] ' + m) : () => {};
  const wantAT = !(opts && opts.noAT);

  const atStages = buildLightAT(wantAT);
  let secret = '';
  for (let i = 0; i < atStages.length; i++) {
    secret += 'do\n' + atStages[i] + '\nend\n';
  }
  secret += input;
  log('secret bytes ' + secret.length + ' atStages=' + atStages.length);

  const fragN = 3 + randInt(0, 3);
  const frags = [];
  let off = 0;
  for (let fi = 0; fi < fragN; fi++) {
    const left = fragN - fi;
    const take = fi === fragN - 1 ? secret.length - off : Math.max(1, Math.floor((secret.length - off) / left));
    const slice = secret.slice(off, off + take);
    off += take;
    const ka = makeKey20(), kb = makeKey20();
    frags.push({ enc: encode20(slice, ka, kb), ka, kb, real: true, ord: fi });
  }
  for (let d = 0; d < 4; d++) {
    const ka = makeKey20(), kb = makeKey20();
    frags.push({ enc: encode20(randJunkStrSafe(25 + randInt(0, 40)), ka, kb), ka, kb, real: false, ord: -1 });
  }
  for (let i = frags.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [frags[i], frags[j]] = [frags[j], frags[i]];
  }

  const parts = [];
  const nBx = rv(), nD20 = rv(), nStore = rv();
  const nL = rv(), nSrc = rv(), nFn = rv(), nEr = rv(), nP = rv();
  const entryKey = 40 + randInt(0, 160);
  const methodName = ['rH', 'qK', 'xM', 'pJ', 'zV', 'nQ'][randInt(0, 5)];

  parts.push('return setmetatable({');
  emitDispatchJunk(parts, 12 + randInt(0, 10));
  parts.push('[' + entryKey + ']=function(...)');
  parts.push(generateOuterJunk(3 + randInt(0, 3)));

  parts.push('local ' + nBx + '=(bit32 and bit32.bxor) or function(a,b)local r,p=0,1 for _=1,8 do local x,y=a%2,b%2 if x~=y then r=r+p end a=(a-x)/2 b=(b-y)/2 p=p*2 end return r end');

  parts.push('local function ' + nD20 + '(s,kA,kB) if type(s)~="string" or #s<5 or type(kA)~="table" or type(kB)~="table" then return "" end local _4,_5={},1 while _5+4<=#s do local _6=s:byte(_5)-33 local _7=s:byte(_5+1)-33 local _8=s:byte(_5+2)-33 local _9=s:byte(_5+3)-33 local _10=s:byte(_5+4)-33 local _11=_6*78074896+_7*830584+_8*8836+_9*94+_10 _4[#_4+1]=string.char(math.floor(_11/16777216)%256) _4[#_4+1]=string.char(math.floor(_11/65536)%256) _4[#_4+1]=string.char(math.floor(_11/256)%256) _4[#_4+1]=string.char(math.floor(_11)%256) _5=_5+5 end local _12=table.concat(_4) if #_12<4 then return "" end local _13=_12:byte(1)*16777216+_12:byte(2)*65536+_12:byte(3)*256+_12:byte(4) local hx={} for i=1,_13 do local b=_12:byte(4+i) if not b then break end local kb=kB[((i-1)%20)+1] or 0 hx[i]=string.char(' + nBx + '(b,kb%256)) end local hs=table.concat(hx) local raw={} local ri=0 for i=1,#hs,2 do local A,B=hs:byte(i),hs:byte(i+1) if not B then break end local hi=(A<=57 and A-48) or (A-55) local lo=(B<=57 and B-48) or (B-55) local v=hi*16+lo ri=ri+1 local ka=kA[((ri-1)%20)+1] or 0 raw[ri]=string.char(' + nBx + '(v,ka%256)) end return table.concat(raw) end');

  parts.push(generateOuterJunk(2));
  parts.push('local ' + nStore + '={}');

  for (let i = 0; i < frags.length; i++) {
    const f = frags[i];
    const nE = rv(), nKA = rv(), nKB = rv(), ns1 = rv(), ns2 = rv(), ns3 = rv(), ns4 = rv();
    const s1 = randInt(0, 255), s2 = randInt(0, 255), s3 = randInt(0, 255), s4 = randInt(0, 255);
    const encKa = multiLayerEncode(keyBin(f.ka), s1, s2);
    const encKb = multiLayerEncode(keyBin(f.kb), s3, s4);
    parts.push(generateOuterJunk(1));
    parts.push('local ' + nE + '=' + luaLongWrap(f.enc));
    parts.push(generateOuterJunk(1));
    parts.push('local ' + nKA + '=' + luaLongWrap(encKa));
    parts.push('local ' + ns1 + '=' + opaqueNum(s1) + ' local ' + ns2 + '=' + opaqueNum(s2));
    parts.push(generateOuterJunk(1));
    parts.push('local ' + nKB + '=' + luaLongWrap(encKb));
    parts.push('local ' + ns3 + '=' + opaqueNum(s3) + ' local ' + ns4 + '=' + opaqueNum(s4));
    parts.push(nStore + '[' + (i + 1) + ']={' + nE + ',' + nKA + ',' + ns1 + ',' + ns2 + ',' + nKB + ',' + ns3 + ',' + ns4 + ',' + (f.real ? 1 : 0) + ',' + f.ord + '}');
  }

  parts.push('local function ' + nP + '(_1,_2,_3) if type(_1)~="string" or #_1<5 then return "" end local _4,_5={},1 while _5+4<=#_1 do local _6=_1:byte(_5)-33 local _7=_1:byte(_5+1)-33 local _8=_1:byte(_5+2)-33 local _9=_1:byte(_5+3)-33 local _10=_1:byte(_5+4)-33 local _11=_6*78074896+_7*830584+_8*8836+_9*94+_10 _4[#_4+1]=string.char(math.floor(_11/16777216)%256) _4[#_4+1]=string.char(math.floor(_11/65536)%256) _4[#_4+1]=string.char(math.floor(_11/256)%256) _4[#_4+1]=string.char(math.floor(_11)%256) _5=_5+5 end local _12=table.concat(_4) if #_12<4 then return "" end local _13=_12:byte(1)*16777216+_12:byte(2)*65536+_12:byte(3)*256+_12:byte(4) local _14={} for _15=1,_13 do local _b=_12:byte(4+_15) if not _b then break end _14[_15]=string.char(' + nBx + '(_b,_3%256)) end local _16=table.concat(_14) local _17={} for _18=1,#_16,2 do local _19=_16:byte(_18) local _20=_16:byte(_18+1) if not _20 then break end _17[#_17+1]=(_19<=57 and _19-48 or _19-55)*16+(_20<=57 and _20-48 or _20-55) end local _21={} local _22=_2%256 for _23=1,50 do _22=(97*_22+33)%256 _21[_23]=_22 end local _24={} local _25=0 for _26=1,#_17 do _25=_25+1 if _25>50 then _25=1 end _24[_26]=string.char(' + nBx + '(_17[_26],_21[_25])) end return table.concat(_24) end');

  parts.push('do local _L0=loadstring or load if type(_L0)=="function" then local ts=tostring(_L0) if type(ts)=="string" and (string.find(ts,"hook",1,true) or string.find(ts,"Hook",1,true)) then error("WAN OBFUSCATE chao may ku:>",0) end end end');

  parts.push('local ' + nSrc + '=""');
  parts.push('do local order={}');
  parts.push('for i=1,#' + nStore + ' do local e=' + nStore + '[i] if e[8]==1 then order[e[9]+1]=e end end');
  parts.push('for oi=1,#order do local e=order[oi]');
  parts.push('local binA=' + nP + '(e[2],e[3],e[4]) local binB=' + nP + '(e[5],e[6],e[7])');
  parts.push('local kA={} for i=1,#binA do kA[i]=binA:byte(i) end');
  parts.push('local kB={} for i=1,#binB do kB[i]=binB:byte(i) end');
  parts.push('local piece=' + nD20 + '(e[1],kA,kB)');
  parts.push('if type(piece)~="string" then error("WAN OBFUSCATE chao may ku:>",0) end');
  parts.push(nSrc + '=' + nSrc + '..piece');
  parts.push('end end');

  parts.push(generateOuterJunk(2));
  parts.push('local ' + nL + '=(loadstring or load)');
  parts.push('if type(' + nL + ')~="function" then error("WAN OBFUSCATE chao may ku:>",0) end');
  parts.push('local ' + nFn + ',' + nEr + '=' + nL + '(' + nSrc + ',"wan")');
  parts.push('if type(' + nFn + ')~="function" then error("WAN OBFUSCATE chao may ku:> "..tostring(' + nEr + '),0) end');
  parts.push('return ' + nFn + '(...)');

  parts.push('end,');
  emitDispatchJunk(parts, 4 + randInt(0, 4));
  parts.push('[' + (12 + randInt(0, 5)) + ']=string.match,');
  parts.push('[' + (100 + randInt(0, 20)) + ']=buffer and buffer.readu16 or function()return 0 end,');
  parts.push('[' + (110 + randInt(0, 20)) + ']=buffer and buffer.writef64 or function()end,');

  parts.push('},{__call=function(t,...) local f=t[' + entryKey + '] if type(f)~="function" then error("WAN OBFUSCATE chao may ku:>",0) end return f(...) end');
  parts.push(',[' + (200 + randInt(0, 20)) + ']=function()end');
  parts.push('})()');

  let code = parts.join('\n');
  code = toOneLinePreserveLongstrings(code);

  log('out ' + code.length + ' entry=' + entryKey + ' method=:' + methodName);

  return {
    code,
    meta: {
      inputBytes: secret.length,
      outputBytes: code.length,
      fragments: fragN,
      atStages: atStages.length,
      vmMode: 'reliable-encode20',
      pack: 'setmetatable+[n]+encode20-binKeys',
      pipeline: 'luau→encode20→commercial-pack',
      method: methodName,
      entryKey,
    },
  };
}
