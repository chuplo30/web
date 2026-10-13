/**
 * 8xms register VM for Clyde bytecode only.
 * - No Clyde banner / generateRegVM
 * - Bytecode + constants XOR-scrambled (not plaintext in source)
 * - Upvalues as real Lua tables (not JSON [[ ]] which is a longstring)
 * - One-line safe (no -- comments)
 */
function rv() {
  return '_' + Math.random().toString(36).slice(2, 10);
}

function xorKeyStream(n, seed) {
  const keys = [];
  let s = seed & 255;
  for (let i = 0; i < n; i++) {
    s = (97 * s + 33) % 256;
    keys.push(s);
  }
  return keys;
}

/** Serialize upvalues as Lua: {{1,0},{0,2}} */
function serUps(ups) {
  if (!ups || !ups.length) return '{}';
  const parts = [];
  for (const u of ups) {
    if (Array.isArray(u)) {
      const a = u[0] ? 1 : 0;
      const b = Number(u[1]) || 0;
      parts.push(`{${a},${b}}`);
    } else if (u && typeof u === 'object') {
      const a = (u.isLocal || u[0]) ? 1 : 0;
      const b = Number(u.index != null ? u.index : u[1]) || 0;
      parts.push(`{${a},${b}}`);
    }
  }
  return '{' + parts.join(',') + '}';
}

/**
 * Flatten chunk tree to encrypted number arrays + string pool.
 * Strings stored as byte arrays XOR'd so they never appear as plaintext Lua strings.
 */
function packChunkTree(chunk, seed) {
  const strPool = []; // plaintext strings collected, emitted as xor byte tables
  const strMap = new Map();

  function addStr(s) {
    s = String(s);
    if (strMap.has(s)) return strMap.get(s);
    const id = strPool.length;
    strPool.push(s);
    strMap.set(s, id);
    return id;
  }

  function packOne(ch) {
    const Kmeta = []; // list of {t:'n'|'s'|'b'|'z', v}
    for (const c of ch.K || []) {
      if (c === null || c === undefined) Kmeta.push({ t: 0, v: 0 });
      else if (typeof c === 'boolean') Kmeta.push({ t: 1, v: c ? 1 : 0 });
      else if (typeof c === 'number') Kmeta.push({ t: 2, v: c });
      else if (typeof c === 'string') Kmeta.push({ t: 3, v: addStr(c) });
      else Kmeta.push({ t: 0, v: 0 });
    }
    const code = (ch.code || []).slice();
    const protos = (ch.protos || []).map(packOne);
    const ups = ch.upvalues || [];
    return {
      Kmeta,
      code,
      nP: ch.nParams | 0,
      mR: ch.maxRegs | 0,
      va: ch.isVararg ? 1 : 0,
      ups,
      P: protos,
    };
  }

  const root = packOne(chunk);
  // Build flat number blob for code+meta to XOR
  // Format for each proto: we'll emit Lua that rebuilds after XOR decode of code arrays
  return { root, strPool, seed: seed & 255 };
}

function emitXorArray(nums, seed, name) {
  // emit: local name={xor'd nums}; then decode loop
  const ks = xorKeyStream(nums.length, seed);
  const enc = nums.map((n, i) => (Number(n) ^ ks[i]) >>> 0);
  return { enc, seed };
}

/**
 * @param {object} chunk Clyde regCompile result
 * @returns {string} Lua runner (one-line safe)
 */
export function emit8xmsRegVM(chunk) {
  const seed = (Math.random() * 255) | 0;
  const packed = packChunkTree(chunk, seed);

  const nEnv = rv(), nRun = rv(), nRK = rv(), nIp = rv(), nTop = rv();
  const nOp = rv(), nA = rv(), nB = rv(), nC = rv(), nI = rv();
  const nUnpack = rv(), nVar = rv(), nDec = rv(), nBuild = rv();
  const nSK = rv(), nSP = rv(), nRoot = rv(), nBX = rv();
  const nOk = rv(), nRes = rv();

  // Encrypt all code arrays in tree + string bytes
  function collectCodes(node, list) {
    list.push(node.code || []);
    for (const p of node.P || []) collectCodes(p, list);
  }
  const codeList = [];
  collectCodes(packed.root, codeList);

  // Encrypt strings as byte arrays
  const strEnc = packed.strPool.map((s) => {
    const bytes = [];
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 255);
    const ks = xorKeyStream(bytes.length, (seed + 17 + bytes.length) & 255);
    const enc = bytes.map((b, i) => b ^ ks[i]);
    return { enc, len: bytes.length, s0: (seed + 17 + bytes.length) & 255 };
  });

  // Encrypt each code array with different seed offset
  const codeEnc = codeList.map((code, idx) => {
    const s0 = (seed + 31 + idx * 13) & 255;
    const ks = xorKeyStream(code.length, s0);
    return { enc: code.map((n, i) => (Number(n) ^ ks[i]) >>> 0), s0, n: code.length };
  });

  // Emit Kmeta structure without plaintext strings (only type tags + number/str-index)
  function serNode(node, codeIdxBox) {
    const ci = codeIdxBox.i++;
    const km = (node.Kmeta || []).map((m) => `{${m.t},${typeof m.v === 'number' ? m.v : 0}}`).join(',');
    const ups = serUps(node.ups);
    const protos = (node.P || []).map((p) => serNode(p, codeIdxBox)).join(',');
    return `{km={${km}},ci=${ci},nP=${node.nP},mR=${node.mR},va=${node.va},ups=${ups},P={${protos}}}`;
  }
  const codeIdxBox = { i: 0 };
  const treeLua = serNode(packed.root, codeIdxBox);

  const L = [];

  // bit xor
  L.push(`local ${nBX}=(bit32 and bit32.bxor)or function(a,b)local r,p=0,1 for _=1,8 do local x,y=a%2,b%2 if x~=y then r=r+p end a=(a-x)/2 b=(b-y)/2 p=p*2 end return r end`);

  // Decode helper: xor stream
  L.push(`local function ${nDec}(arr,s0)local o={}local s=s0%256 for i=1,#arr do s=(97*s+33)%256 o[i]=${nBX}(arr[i],s) end return o end`);

  // String pool (encrypted bytes)
  L.push(`local ${nSP}={}`);
  for (let i = 0; i < strEnc.length; i++) {
    const se = strEnc[i];
    L.push(`${nSP}[${i + 1}]={e={${se.enc.join(',')}},s0=${se.s0}}`);
  }
  L.push(`local function ${nSK}(i)local e=${nSP}[i] if not e then return "" end local b=${nDec}(e.e,e.s0)local t={} for j=1,#b do t[j]=string.char(b[j]%256) end return table.concat(t) end`);

  // Code arrays encrypted
  L.push(`local ${nRoot}={}`);
  for (let i = 0; i < codeEnc.length; i++) {
    const ce = codeEnc[i];
    L.push(`${nRoot}[${i + 1}]={e={${ce.enc.join(',')}},s0=${ce.s0}}`);
  }

  // Build runtime chunk from tree + decrypted code + string pool
  L.push(`local function ${nBuild}(node)`);
  L.push(`local code=${nDec}(${nRoot}[node.ci+1].e,${nRoot}[node.ci+1].s0)`);
  L.push(`local K={} for i=1,#(node.km or {}) do local m=node.km[i] local t=m[1] local v=m[2] if t==0 then K[i]=nil elseif t==1 then K[i]=(v~=0) elseif t==2 then K[i]=v elseif t==3 then K[i]=${nSK}(v+1) else K[i]=nil end end`);
  L.push(`local P={} for i=1,#(node.P or {}) do P[i]=${nBuild}(node.P[i]) end`);
  L.push(`return {K=K,code=code,nP=node.nP or 0,mR=node.mR or 8,va=node.va or 0,ups=node.ups or {},P=P}`);
  L.push(`end`);

  L.push(`local _TREE=${treeLua}`);
  L.push(`local _CH=${nBuild}(_TREE)`);

  // Roblox-safe env: prefer real globals
  L.push(`local ${nEnv}=_G`);
  L.push(`if type(getfenv)=="function" then local ok,e=pcall(getfenv,0) if ok and type(e)=="table" and e.game~=nil then ${nEnv}=e end end`);
  L.push(`if type(${nEnv})~="table" then ${nEnv}=_G end`);
  // Ensure game/workspace visible
  L.push(`if ${nEnv}.game==nil and type(game)~="nil" then ${nEnv}=setmetatable({},{__index=function(_,k) return rawget(_G,k) or (k=="game" and game) or (k=="workspace" and workspace) or nil end}) end`);

  L.push(`local ${nUnpack}=table.unpack or unpack`);
  L.push(`local function ${nRK}(R,K,x) if x>=256 then return K[x-255] end return R[x+1] end`);

  L.push(`local function ${nRun}(ch,uv,env,...)`);
  L.push(`local R={} local K=ch.K local code=ch.code local P=ch.P or {} local ${nIp}=0 local ${nTop}=0 local ${nVar}={...} local nparams=ch.nP or 0`);
  L.push(`for i=1,nparams do R[i]=${nVar}[i] end`);
  L.push(`if ch.va~=0 then for i=nparams+1,#${nVar} do R[i]=${nVar}[i] end end`);
  L.push(`while true do`);
  L.push(`local base=${nIp}*4 local ${nOp}=code[base+1] if ${nOp}==nil then break end`);
  L.push(`local ${nA}=code[base+2] or 0 local ${nB}=code[base+3] or 0 local ${nC}=code[base+4] or 0`);
  L.push(`if ${nOp}==0 then`);
  L.push(`elseif ${nOp}==1 then R[${nA}+1]=K[${nB}+1]`);
  L.push(`elseif ${nOp}==2 then for ${nI}=${nA},${nA}+${nB} do R[${nI}+1]=nil end`);
  L.push(`elseif ${nOp}==3 then R[${nA}+1]=(${nB}~=0) if ${nC}~=0 then ${nIp}=${nIp}+1 end`);
  L.push(`elseif ${nOp}==4 then R[${nA}+1]=R[${nB}+1]`);
  L.push(`elseif ${nOp}==5 then do local n=K[${nB}+1] R[${nA}+1]=env[n] if R[${nA}+1]==nil and type(_G)=="table" then R[${nA}+1]=_G[n] end local _gn=string.char(103,97,109,101) local _wn=string.char(119,111,114,107,115,112,97,99,101) if R[${nA}+1]==nil and n==_gn then R[${nA}+1]=game end if R[${nA}+1]==nil and n==_wn then R[${nA}+1]=workspace end end`);
  L.push(`elseif ${nOp}==6 then env[K[${nB}+1]]=R[${nA}+1]`);
  L.push(`elseif ${nOp}==7 then do local t=R[${nB}+1] local k=${nRK}(R,K,${nC}) if t~=nil and k~=nil then R[${nA}+1]=t[k] else R[${nA}+1]=nil end end`);
  L.push(`elseif ${nOp}==8 then do local t=R[${nA}+1] if t~=nil then t[${nRK}(R,K,${nB})]=${nRK}(R,K,${nC}) end end`);
  L.push(`elseif ${nOp}==9 then R[${nA}+1]={}`);
  L.push(`elseif ${nOp}==10 then R[${nA}+1]=${nRK}(R,K,${nB})+${nRK}(R,K,${nC})`);
  L.push(`elseif ${nOp}==11 then R[${nA}+1]=${nRK}(R,K,${nB})-${nRK}(R,K,${nC})`);
  L.push(`elseif ${nOp}==12 then R[${nA}+1]=${nRK}(R,K,${nB})*${nRK}(R,K,${nC})`);
  L.push(`elseif ${nOp}==13 then R[${nA}+1]=${nRK}(R,K,${nB})/${nRK}(R,K,${nC})`);
  L.push(`elseif ${nOp}==14 then R[${nA}+1]=${nRK}(R,K,${nB})%${nRK}(R,K,${nC})`);
  L.push(`elseif ${nOp}==15 then R[${nA}+1]=${nRK}(R,K,${nB})^${nRK}(R,K,${nC})`);
  L.push(`elseif ${nOp}==16 then R[${nA}+1]=math.floor(${nRK}(R,K,${nB})/${nRK}(R,K,${nC}))`);
  L.push(`elseif ${nOp}==17 then R[${nA}+1]=-R[${nB}+1]`);
  L.push(`elseif ${nOp}==18 then R[${nA}+1]=not R[${nB}+1]`);
  L.push(`elseif ${nOp}==19 then R[${nA}+1]=#R[${nB}+1]`);
  L.push(`elseif ${nOp}==20 then do local s=tostring(R[${nB}+1] or "") for ${nI}=${nB}+1,${nC} do s=s..tostring(R[${nI}+1] or "") end R[${nA}+1]=s end`);
  L.push(`elseif ${nOp}==21 then ${nIp}=${nIp}+${nB}`);
  L.push(`elseif ${nOp}==22 then if (${nRK}(R,K,${nB})==${nRK}(R,K,${nC}))~=(${nA}~=0) then ${nIp}=${nIp}+1 end`);
  L.push(`elseif ${nOp}==23 then if (${nRK}(R,K,${nB})<${nRK}(R,K,${nC}))~=(${nA}~=0) then ${nIp}=${nIp}+1 end`);
  L.push(`elseif ${nOp}==24 then if (${nRK}(R,K,${nB})<=${nRK}(R,K,${nC}))~=(${nA}~=0) then ${nIp}=${nIp}+1 end`);
  L.push(`elseif ${nOp}==25 then if (not R[${nA}+1])==(${nC}~=0) then ${nIp}=${nIp}+1 end`);
  L.push(`elseif ${nOp}==26 then do local v=R[${nB}+1] R[${nA}+1]=v if (not v)==(${nC}~=0) then ${nIp}=${nIp}+1 end end`);
  // CALL — no pcall wrapper for yield-safe Roblox APIs; guard nil
  L.push(`elseif ${nOp}==27 then do local fn=R[${nA}+1] local nargs if ${nB}==0 then nargs=math.max(0,${nTop}-(${nA}+1)) else nargs=${nB}-1 end if nargs<0 then nargs=0 end local args={} for ${nI}=1,nargs do args[${nI}]=R[${nA}+1+${nI}] end local rr={} if type(fn)=="function" then rr={fn(${nUnpack}(args,1,nargs))} elseif type(fn)=="table" and type(fn.__p)=="function" then rr={fn.__p(fn,args)} end if ${nC}==0 then for ${nI}=1,#rr do R[${nA}+${nI}]=rr[${nI}] end ${nTop}=${nA}+math.max(0,#rr) elseif ${nC}==1 then ${nTop}=${nA} else for ${nI}=1,${nC}-1 do R[${nA}+${nI}]=rr[${nI}] end end end`);
  L.push(`elseif ${nOp}==28 then do local fn=R[${nA}+1] local nargs if ${nB}==0 then nargs=math.max(0,${nTop}-(${nA}+1)) else nargs=${nB}-1 end if nargs<0 then nargs=0 end local args={} for ${nI}=1,nargs do args[${nI}]=R[${nA}+1+${nI}] end if type(fn)=="function" then return fn(${nUnpack}(args,1,nargs)) end return end`);
  L.push(`elseif ${nOp}==29 then do local nval=${nB} if nval==0 then nval=math.max(0,${nTop}-${nA}+1) elseif nval>=1 then nval=nval-1 end if nval<=0 then return end return ${nUnpack}(R,${nA}+1,${nA}+nval) end`);
  L.push(`elseif ${nOp}==30 then do R[${nA}+1]=(tonumber(R[${nA}+1])or 0)-(tonumber(R[${nA}+3])or 0) ${nIp}=${nIp}+${nB} end`);
  L.push(`elseif ${nOp}==31 then do local s=tonumber(R[${nA}+3])or 1 R[${nA}+1]=(tonumber(R[${nA}+1])or 0)+s local lim=tonumber(R[${nA}+2])or 0 local cont=(s>=0 and R[${nA}+1]<=lim)or(s<0 and R[${nA}+1]>=lim) if cont then R[${nA}+4]=R[${nA}+1] ${nIp}=${nIp}+${nB} end end`);
  L.push(`elseif ${nOp}==32 then do if R[${nA}+2]~=nil then R[${nA}+1]=R[${nA}+2] else ${nIp}=${nIp}+${nB} end end`);
  L.push(`elseif ${nOp}==33 then do local t=R[${nA}+1] local n=${nB} if n==0 then n=${nTop}-${nA} end local base=${nC}-1 if type(t)=="table" then for ${nI}=1,n do t[base+${nI}]=R[${nA}+${nI}] end end end`);
  // CLOSURE — ups as {isLocal,index}
  L.push(`elseif ${nOp}==34 then do local pr=P[${nB}+1] local uvs={} if pr then for ${nI}=1,#(pr.ups or {}) do local u=pr.ups[${nI}] if type(u)=="table" then if (u[1]or 0)~=0 then uvs[${nI}]={r=R,i=(u[2] or 0)} else uvs[${nI}]=(uv or {})[((u[2] or 0)+1)] end else uvs[${nI}]=(uv or {})[${nI}] end end R[${nA}+1]=function(...) return ${nRun}(pr,uvs,env,...) end else R[${nA}+1]=function() end end end`);
  L.push(`elseif ${nOp}==35 then do local n=${nB} if n==0 then for ${nI}=1,#${nVar} do R[${nA}+${nI}]=${nVar}[${nI}] end else R[${nA}+1]=${nVar}[1] end end`);
  L.push(`elseif ${nOp}==36 then do local obj=R[${nB}+1] R[${nA}+2]=obj local k=${nRK}(R,K,${nC}) if obj~=nil and k~=nil then R[${nA}+1]=obj[k] else R[${nA}+1]=nil end end`);
  L.push(`elseif ${nOp}==37 then do local u=(uv or {})[${nB}+1] if type(u)=="table" and u.r then R[${nA}+1]=u.r[(u.i or 0)+1] else R[${nA}+1]=u end end`);
  L.push(`elseif ${nOp}==38 then do local u=(uv or {})[${nB}+1] if type(u)=="table" and u.r then u.r[(u.i or 0)+1]=R[${nA}+1] end end`);
  L.push(`elseif ${nOp}==39 then`);
  L.push(`elseif ${nOp}==40 then do local fn=R[${nA}+1] if type(fn)=="function" then local ${nOk},${nRes}=pcall(fn) R[${nA}+1]=${nOk} R[${nA}+2]=${nRes} else R[${nA}+1]=false R[${nA}+2]="nil" end end`);
  L.push(`elseif ${nOp}==43 then do local ex=code[base+5] or 0 R[${nA}+1]=K[ex+1] ${nIp}=${nIp}+1 end`);
  L.push(`else`);
  L.push(`end`);
  L.push(`${nIp}=${nIp}+1`);
  L.push(`end end`);

  L.push(`${nRun}(_CH,{},${nEnv})`);

  return L.join(' ');
}
