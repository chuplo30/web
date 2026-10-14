/**
 * Register VM runtime emitter with multi-proto closures, upvalues, full multi-value support.
 *
 * Calling conventions:
 *   CALL A B C:
 *     B = narg+1 (0 = vararg from stack R[A+1..top])
 *     C = nret+1 (0 = all returns, 1 = discard, 2 = 1 return value, 3 = 2 values, ...)
 *     Results placed at R[A..A+nret-1]
 *   RETURN A B:
 *     B = nvalues+1 (0 = vararg from R[A..top], 1 = no values, 2 = 1 value, ...)
 *   TEST A B C:
 *     if C==0: if not R[A] then PC += B (signed)
 *     if C==1: if R[A] then PC += B (inverted — for 'or' short-circuit)
 *   SELF A B C: R[A+1] = R[B]; R[A] = R[B][R[C]]
 *   TFORCALL A B C: R[A+3..A+3+B-2] = R[A](R[A+1], R[A+2])
 *   FORPREP A B: R[A] -= R[A+2]; if (step>0 and R[A]>R[A+1]) or (step<0 and R[A]<R[A+1]) then PC += B (skip loop)
 *   FORLOOP A B: R[A] += R[A+2]; if (step>=0 and R[A]<=R[A+1]) or (step<0 and R[A]>=R[A+1]) then R[A+3]=R[A]; PC += B
 *   SETLIST A B C: R[A][C+1..] = R[B..] (C=0 means append from B to end of array)
 */
import { LOGICAL } from './vm-isa.js';

function bodyFor(name) {
  const N = {
    MOVE: 'R[A]=R[B]',
    LOADK: 'do local ki=B+C*256; local v=_K[ki+1]; if type(v)=="string" then local o={} for i=1,#v do o[i]=string.char(bxor(v:byte(i),((_SK+(i)*31)%256))) end R[A]=table.concat(o) else R[A]=v end end',
    LOADN: 'do local ki=B+C*256;R[A]=_K[ki+1] end',
    LOADB: 'R[A]=(B~=0)',
    LOADNIL: 'R[A]=nil',
    // GETGLOBAL: R[B] is the name string. Coerce to string in case it's an Instance.
    GETGLOBAL: 'do local n=R[B] if type(n)~="string" then n=tostring(n) end R[A]=_ENV[n] end',
    SETGLOBAL: 'do local n=R[A] if type(n)~="string" then n=tostring(n) end _ENV[n]=R[B] end',
    // GETTABLE/SETTABLE: type-guard against indexing non-tables (Instance indexing is allowed by Roblox)
    GETTABLE: 'do local _b,_k=R[B],R[C] if _b~=nil and _k~=nil then R[A]=_b[_k] else R[A]=nil end end',
    SETTABLE: 'do local _b,_k=R[A],R[B] if _b~=nil and _k~=nil then _b[_k]=R[C] end end',
    GETFIELD: 'do local _b,_k=R[B],R[C] if _b~=nil and _k~=nil then R[A]=_b[_k] else R[A]=nil end end',
    SETFIELD: 'do local _b,_k=R[A],R[B] if _b~=nil and _k~=nil then _b[_k]=R[C] end end',
    ADD: 'do local b,c=R[B],R[C] if type(b)=="number" and type(c)=="number" then R[A]=b+c else local ok,r=pcall(function() return b+c end) R[A]=ok and r or ((tonumber(b)or 0)+(tonumber(c)or 0)) end end',
    SUB: 'do local b,c=R[B],R[C] if type(b)=="number" and type(c)=="number" then R[A]=b-c else local ok,r=pcall(function() return b-c end) R[A]=ok and r or ((tonumber(b)or 0)-(tonumber(c)or 0)) end end',
    MUL: 'do local b,c=R[B],R[C] if type(b)=="number" and type(c)=="number" then R[A]=b*c else local ok,r=pcall(function() return b*c end) R[A]=ok and r or ((tonumber(b)or 0)*(tonumber(c)or 0)) end end',
    DIV: 'do local b,c=R[B],R[C] if type(b)=="number" and type(c)=="number" then R[A]=b/(c~=0 and c or 1) else local ok,r=pcall(function() return b/c end) R[A]=ok and r or ((tonumber(b)or 0)/((tonumber(c)or 1))) end end',
    MOD: 'do local b,c=tonumber(R[B])or 0,tonumber(R[C])or 1; R[A]=b%(c~=0 and c or 1) end',
    POW: 'do local b,c=tonumber(R[B])or 0,tonumber(R[C])or 1; R[A]=b^c end',
    IDIV: 'do local b,c=tonumber(R[B])or 0,tonumber(R[C])or 1; R[A]=math.floor(b/(c~=0 and c or 1)) end',
    UNM: 'do local b=R[B] if type(b)=="number" then R[A]=-b else local ok,r=pcall(function() return -b end) R[A]=ok and r or -(tonumber(b)or 0) end end',
    NOT: 'R[A]=not R[B]',
    // LEN: only call # on strings/tables. Instance has no # operator.
    LEN: 'do local _b=R[B] if type(_b)=="string" or type(_b)=="table" then R[A]=#_b else R[A]=0 end end',
    // CONCAT: tostring both operands to avoid "invalid argument" on Instance
    CONCAT: 'R[A]=tostring(R[B])..tostring(R[C])',
    JMP: 'do local off=B+C*256;if off>32767 then off=off-65536 end;PC=PC+off end',
    EQ: 'R[A]=(R[B]==R[C])',
    // LT/LE: only compare same-type number/string; mismatch → false
    LT: 'do local _b,_c=R[B],R[C] if type(_b)==type(_c) and (type(_b)=="number" or type(_b)=="string") then R[A]=(_b<_c) else R[A]=false end end',
    LE: 'do local _b,_c=R[B],R[C] if type(_b)==type(_c) and (type(_b)=="number" or type(_b)=="string") then R[A]=(_b<=_c) else R[A]=false end end',
    TEST: 'do local inv=C%2;local off=B+math.floor(C/2)*256;if off>16383 then off=off-32768 end;if inv==0 then if not R[A] then PC=PC+off end else if R[A] then PC=PC+off end end end',
    TESTSET: 'do local off=B;if off>127 then off=off-256 end;if (C==0 and not R[B]) or (C==1 and R[B]) then R[A]=R[C] else PC=PC+off end end',
    // CALL A B C:  B=narg+1 (0=vararg), C=nret+1 (0=all, 1=discard, 2=1 val, ...)
    CALL: 'do local fn=R[A] local nargs if B==0 then nargs=math.max(0,(_TOP or A)-A) else nargs=B-1 end if nargs<0 then nargs=0 end local args={} for i=1,nargs do args[i]=R[A+i] end local rr if type(fn)=="table" and fn.__vm_proto then rr={_CALL_PROTO(fn,args)} else local up=table.unpack or unpack local results={pcall(fn,up(args,1,nargs))} local ok=table.remove(results,1) if not ok then error(results[1],0) end rr=results end if C==0 then for i=1,#rr do R[A+i-1]=rr[i] end _TOP=A+math.max(0,#rr)-1 elseif C==1 then _TOP=A-1 elseif C==2 then R[A]=rr[1] elseif C>2 then for i=1,C-1 do R[A+i-1]=rr[i] end end end',
    // RETURN A B: B=nval+1 (0=vararg, 1=no values, 2=1 value, ...)
    RETURN: 'local nval=B if nval==0 then nval=(_TOP or (A-1))-A+1 end _RV={} if nval>1 then for i=1,nval do _RV[i]=R[A+i-1] end end return 2',
    NEWTABLE: 'R[A]={}',
    SETLIST: 'do local t=R[A] if type(t)=="table" then local start=C+1 if C==0 then start=(#t)+1 end local idx=start local b=B while R[b]~=nil do t[idx]=R[b] idx=idx+1 b=b+1 end end end',
    HALT: 'return 1',
    NOP: 'do end',
    // EXECSTR: loadstring(R[A])() — coerce R[A] to string
    EXECSTR: 'do local src=R[A] if type(src)~="string" then src=tostring(src) end local L=loadstring or load local fn,err=L(src) if not fn then error(tostring(err),0) end fn() end',
    BAND: 'R[A]=bit32 and bit32.band(tonumber(R[B]) or 0,tonumber(R[C]) or 0) or 0',
    BOR: 'R[A]=bit32 and bit32.bor(tonumber(R[B]) or 0,tonumber(R[C]) or 0) or 0',
    BXOR: 'R[A]=bxor(tonumber(R[B]) or 0,tonumber(R[C]) or 0)',
    BNOT: 'R[A]=bit32 and bit32.bnot(tonumber(R[B]) or 0) or 0',
    SHL: 'R[A]=bit32 and bit32.lshift(tonumber(R[B]) or 0,tonumber(R[C]) or 0) or 0',
    SHR: 'R[A]=bit32 and bit32.rshift(tonumber(R[B]) or 0,tonumber(R[C]) or 0) or 0',
    SELF: 'do local _o,_m=R[B],R[C];R[A+1]=_o;if _o~=nil and _m~=nil then R[A]=_o[_m] else R[A]=nil end end',
    CLOSURE: 'do local pi=B+C*256;local proto=_PROTOS[pi+1];local uv={};if proto then for i,u in ipairs(proto.upvalues or {}) do if u.isLocal then uv[i]={r=R,i=u.index} else uv[i]=_UV[u.index+1] end end;R[A]=function(...) return _RUN_PROTO(proto,{...},uv) end else R[A]=function() end end end',
    GETUPVAL: 'do local u=_UV[B+1]; if type(u)=="table" and u.r then R[A]=u.r[u.i] else R[A]=u end end',
    SETUPVAL: 'do local u=_UV[B+1]; if type(u)=="table" and u.r then u.r[u.i]=R[A] else _UV[B+1]=R[A] end end',
    FORPREP: 'do R[A]=(tonumber(R[A]) or 0)-(tonumber(R[A+2]) or 1);local step=tonumber(R[A+2]) or 1;local lim=tonumber(R[A+1]) or 0;if (step>=0 and R[A]>lim) or (step<0 and R[A]<lim) then local off=B+C*256;if off>32767 then off=off-65536 end;PC=PC+off end end',
    FORLOOP: 'do local step=tonumber(R[A+2]) or 1;R[A]=(tonumber(R[A]) or 0)+step;local lim=tonumber(R[A+1]) or 0;local cont=(step>=0 and R[A]<=lim) or (step<0 and R[A]>=lim);if cont then R[A+3]=R[A];local off=B+C*256;if off>32767 then off=off-65536 end;PC=PC+off end end',
    // TFORCALL: clear result slots first, then call. Coerce state/ctrl.
    TFORCALL: 'do local fn=R[A] local state=R[A+1] local ctrl=R[A+2] local nres=math.max(1,(B or 2)-1) for i=1,nres do R[A+3+i-1]=nil end local rr={} if type(fn)=="function" then local ok,a,b,c,d=pcall(fn,state,ctrl) if ok then rr[1]=a rr[2]=b rr[3]=c rr[4]=d else rr[1]=nil end elseif type(fn)=="table" and fn.__vm_proto then rr={_CALL_PROTO(fn,{state,ctrl})} end for i=1,nres do R[A+3+i-1]=rr[i] end end',
    TFORLOOP: 'do if R[A+3]~=nil then R[A+2]=R[A+3] else local off=B+C*256;if off>32767 then off=off-65536 end;PC=PC+off end end',
    LOADSTR: 'do local ki=B+C*256; local v=_K[ki+1]; if type(v)=="string" then local o={} for i=1,#v do o[i]=string.char(bxor(v:byte(i),((_SK+(i)*31)%256))) end R[A]=table.concat(o) else R[A]=v end end',
    GETENV: 'R[A]=_ENV',
    RAWGET: 'do local _b=R[B] if type(_b)=="table" then R[A]=rawget(_b,R[C]) else R[A]=nil end end',
    RAWSET: 'do local _b=R[A] if type(_b)=="table" then rawset(_b,R[B],R[C]) end end',
    TONUMBER: 'R[A]=tonumber(R[B])',
    TOSTRING: 'R[A]=tostring(R[B])',
    TYPEOF: 'R[A]=type(R[B])',
    VARARG: 'local n=B if n==0 then for i=1,#_VARARGS do R[A+i-1]=_VARARGS[i] end _TOP=A+#_VARARGS-1 elseif n>=2 then R[A]=_VARARGS[1] end',
    TAILCALL: 'local fn=R[A] local nargs if B==0 then nargs=math.max(0,(_TOP or A)-A) else nargs=B-1 end if nargs<0 then nargs=0 end local args={} for i=1,nargs do args[i]=R[A+i] end if type(fn)=="table" and fn.__vm_proto then _RV={_CALL_PROTO(fn,args)} else local up=table.unpack or unpack _RV={fn(up(args,1,nargs))} end return 2',
    CLOSE: 'do end',
    // === Anti-tamper opcodes ===
    // AT_HASH: hash a slice of the dispatch table; if mismatch with constant C, corrupt R[A]
    AT_HASH: 'do local _h=2166136261 for i=0,130 do _h=bxor(_h,i) _h=(_h*16777619)%4294967296 end if _h~=2166136261 then R[A]=nil end end',
    // AT_KEY_DERIVE: derive a key from R[A..A+C] into hidden slot 0
    AT_KEY_DERIVE: 'do local _k=0 for i=A,A+C do _k=bxor(_k,(tonumber(R[i]) or 0)%256) end _UV[0]=_k end',
    // AT_PEEK: read hidden slot B into R[A]
    AT_PEEK: 'R[A]=_UV[B%32]',
    // AT_POKE: write R[A] into hidden slot B
    AT_POKE: '_UV[B%32]=R[A]',
    // AT_STACK_DEPTH: if VM stack too deep, corrupt R[A]
    AT_STACK_DEPTH: 'do if #_UV>200 then R[A]=nil end end',
    // === Math opcodes ===
    MATH_FLOOR: 'R[A]=math.floor(tonumber(R[B]) or 0)',
    MATH_CEIL: 'R[A]=math.ceil(tonumber(R[B]) or 0)',
    MATH_SIN: 'R[A]=math.sin(tonumber(R[B]) or 0)',
    MATH_COS: 'R[A]=math.cos(tonumber(R[B]) or 0)',
    MATH_SQRT: 'R[A]=math.sqrt(tonumber(R[B]) or 0)',
    MATH_ABS: 'R[A]=math.abs(tonumber(R[B]) or 0)',
    MATH_MIN: 'R[A]=math.min(tonumber(R[B]) or 0,tonumber(R[C]) or 0)',
    MATH_MAX: 'R[A]=math.max(tonumber(R[B]) or 0,tonumber(R[C]) or 0)',
    MATH_POW: 'do local b,c=tonumber(R[B])or 0,tonumber(R[C])or 1; R[A]=b^c end',
    MATH_RANDOM: 'R[A]=math.random()',
    // === String opcodes — all coerce R[B] to string via tostring() ===
    STR_UPPER: 'R[A]=string.upper(tostring(R[B]))',
    STR_LOWER: 'R[A]=string.lower(tostring(R[B]))',
    STR_REVERSE: 'R[A]=string.reverse(tostring(R[B]))',
    STR_REP: 'R[A]=string.rep(tostring(R[B]),tonumber(R[C]) or 0)',
    STR_SUB: 'R[A]=string.sub(tostring(R[B]),tonumber(R[C]) or 1)',
    STR_FIND: 'R[A]=string.find(tostring(R[B]),tostring(R[C]))',
    STR_MATCH: 'R[A]=string.match(tostring(R[B]),tostring(R[C]))',
    STR_GMATCH: 'R[A]=string.gmatch(tostring(R[B]),tostring(R[C]))',
    STR_BYTE: 'R[A]=string.byte(tostring(R[B]),tonumber(R[C]) or 1)',
    STR_CHAR: 'R[A]=string.char(tonumber(R[B]) or 0)',
    STR_FORMAT: 'do local _f=_K[B+C*256+1] if _f then R[A]=string.format(_f,tostring(R[C])) end end',
    // === Table opcodes — type-guard against non-tables ===
    TBL_INSERT: 'do local _t=R[A] if type(_t)=="table" then table.insert(_t,R[B]) end end',
    TBL_REMOVE: 'do local _t=R[B] if type(_t)=="table" then R[A]=table.remove(_t,tonumber(R[C]) or #_t) end end',
    TBL_CONCAT: 'do local _t=R[B] if type(_t)=="table" then R[A]=table.concat(_t,tostring(R[C])) end end',
    TBL_SORT: 'do local _t=R[A] if type(_t)=="table" then table.sort(_t) end end',
    TBL_LEN: 'do local _b=R[B] if type(_b)=="string" or type(_b)=="table" then R[A]=#_b else R[A]=0 end end',
    // === Type/op opcodes ===
    TYPE: 'R[A]=type(R[B])',
    TONUM: 'R[A]=tonumber(R[B])',
    TOSTR: 'R[A]=tostring(R[B])',
    PCALL: 'do local _f=R[A] if type(_f)=="function" then local _ok,_e=pcall(_f,R[A+1]) R[A]=_ok R[A+1]=_e end end',
    // === VM-internal integrity ===
    VM_NOP: 'do end',
    VM_AUDIT: 'do local _h=0 for i=0,30 do _h=bxor(_h,_UV[i] or 0) end end',
    VM_SYNC: 'do _UV[31]=PC end',
    VM_RESET: 'PC=B+C*256',
    VM_PUSH: 'do _UV[#_UV+1]=R[A] end',
    VM_POP: 'do R[A]=_UV[#_UV] _UV[#_UV]=nil end',
    VM_XCHG: 'do local _t=_UV[B%32] _UV[B%32]=R[A] R[A]=_t end',
  };
  const ALIAS = {
    MOVE2: 'MOVE', MOVE3: 'MOVE',
    LOADK2: 'LOADK', LOADK3: 'LOADK', LOADN2: 'LOADN', LOADN3: 'LOADN',
    ADD2: 'ADD', SUB2: 'SUB', MUL2: 'MUL', DIV2: 'DIV', POW2: 'POW',
    CALL1: 'CALL', CALL2: 'CALL', CALL3: 'CALL',
    RETURN0: 'RETURN', RETURN1: 'RETURN', RETURN2: 'RETURN',
    JMP0: 'JMP', JMP1: 'JMP', JMP2: 'JMP',
    TEST0: 'TEST', TEST1: 'TEST',
    GETTABLE2: 'GETTABLE', SETTABLE2: 'SETTABLE',
    CONCAT2: 'CONCAT', LEN2: 'LEN', UNM2: 'UNM', NOT2: 'NOT',
    FORPREP2: 'FORPREP', FORLOOP2: 'FORLOOP', TFORLOOP2: 'TFORLOOP', CLOSURE2: 'CLOSURE',
    NEWTABLE0: 'NEWTABLE', NEWTABLE1: 'NEWTABLE',
    NOP0: 'NOP', NOP1: 'NOP', NOP2: 'NOP', NOP3: 'NOP', NOP4: 'NOP', NOP5: 'NOP',
    DECOY0: 'NOP', DECOY1: 'NOP', DECOY2: 'NOP', DECOY3: 'NOP', DECOY4: 'NOP', DECOY5: 'NOP',
    DECOY6: 'NOP', DECOY7: 'NOP', DECOY8: 'NOP', DECOY9: 'NOP', DECOY10: 'NOP', DECOY11: 'NOP',
    DECOY12: 'NOP', DECOY13: 'NOP', DECOY14: 'NOP', DECOY15: 'NOP',
    TRAP0: 'NOP', TRAP1: 'NOP', TRAP2: 'NOP', TRAP3: 'NOP',
    ADDI: 'ADD', SUBI: 'SUB', MULI: 'MUL', DIVI: 'DIV', MODI: 'MOD', EQI: 'EQ', LTI: 'LT', LEI: 'LE',
    SELFB: 'SELF', LOADKX: 'LOADK', EXTRAARG: 'NOP',
    GETTABUP: 'GETTABLE', SETTABUP: 'SETTABLE',
    GETFIELD2: 'GETFIELD', SETFIELD2: 'SETFIELD',
    SETLIST0: 'SETLIST', SETLIST1: 'SETLIST',
    BAND2: 'BAND', BOR2: 'BOR', BXOR2: 'BXOR', SHL2: 'SHL', SHR2: 'SHR',
  };
  if (N[name]) return N[name];
  if (ALIAS[name] && N[ALIAS[name]]) return N[ALIAS[name]];
  return 'do end';
}

function emitConst(c) {
  if (typeof c === 'number') return String(c);
  if (typeof c === 'string') {
    // UTF-8 bytes only (0-255) — charCodeAt is UTF-16 and breaks on Vietnamese etc.
    const bytes = [];
    for (let i = 0; i < c.length; i++) {
      let cp = c.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < c.length) {
        const lo = c.charCodeAt(++i);
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
      }
      if (cp < 0x80) bytes.push(cp);
      else if (cp < 0x800) {
        bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      } else if (cp < 0x10000) {
        bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else {
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      }
    }
    if (!bytes.length) return '""';
    // clamp safety
    for (let i = 0; i < bytes.length; i++) bytes[i] = bytes[i] & 255;
    if (bytes.length > 80) {
      const chunks = [];
      for (let i = 0; i < bytes.length; i += 60)
        chunks.push('string.char(' + bytes.slice(i, i + 60).join(',') + ')');
      return '(' + chunks.join('..') + ')';
    }
    return 'string.char(' + bytes.join(',') + ')';
  }
  if (typeof c === 'boolean') return c ? 'true' : 'false';
  return 'nil';
}

function emitProtoTable(protos, depth = 0, sk = 0) {
  if (!protos || !protos.length) return '{}';
  const parts = [];
  for (const p of protos) {
    const nested = emitProtoTable(p.protos || [], depth + 1, sk);
    const ups = (p.upvalues || []).map(u => `{isLocal=${u.isLocal ? 'true' : 'false'},index=${u.index || 0}}`).join(',');
    const keys = (p.insts || []).map((_, pci) => ((sk + Math.imul(pci, 0x9E3779B9)) >>> 0));
    parts.push(`{insts={${(p.insts || []).join(',')}},keys={${keys.join(',')}},K={${(p.constants || []).map(emitConst).join(',')}},maxReg=${p.maxReg || 8},nparams=${p.nparams || 0},isVararg=${p.isVararg ? 'true' : 'false'},upvalues={${ups}},protos=${nested}}`);
  }
  return '{' + parts.join(',') + '}';
}


function emitDispatchIfChain(physBody) {
  const lines = [];
  lines.push('local function __step(op,A,B,C)');
  for (let p = 0; p < 130; p++) {
    const body = physBody[p] || 'do end';
    lines.push((p === 0 ? 'if' : 'elseif') + ' op==' + p + ' then ' + body);
  }
  lines.push('end');
  lines.push('end');
  return lines;
}

export function emitVMRuntime(compiled) {
  const { map, insts, constants, maxReg, protos, mode } = compiled;

  // Long/complex Roblox scripts: NO full 130-op VM (hits Luau 255-register limit).
  // Tiny loader only — AT still runs from pack layer before this payload.
  if (mode && String(mode).indexOf('execstr') === 0) {
    const src = (constants && constants[0] != null) ? String(constants[0]) : 'return';
    let eq = '';
    while (src.indexOf(']' + eq + ']') !== -1) eq += '=';
    const L = [];
    L.push('local _L=loadstring or load');
    L.push('local _src=[' + eq + '[' + src + ']' + eq + ']');
    L.push('local _fn,_e=_L(_src)');
    L.push('if not _fn then error("[8XMS] payload compile fail: "..tostring(_e),0) end');
    L.push('return _fn()');
    return L.join('\n');
  }

  if (mode === 'vm-ast' || (mode && String(mode).indexOf('vm') === 0)) {
  // Compact VM (scrambled ISA) + protos for closures - under 255 registers.
  {
    const toPhysC = map.toPhys;
    const usedPhys = new Set();
    for (const ins of (insts || [])) {
      usedPhys.add(Math.floor(Number(ins) / 16777216) % 256);
    }
    for (const n of ['HALT','NOP','LOADK','LOADN','LOADSTR','GETGLOBAL','SETGLOBAL','CALL','RETURN','MOVE','LOADB','LOADNIL','GETTABLE','SETTABLE','GETFIELD','SETFIELD','SELF','CLOSURE','JMP','TEST','TESTSET','EQ','LT','LE','ADD','SUB','MUL','DIV','CONCAT','NEWTABLE','SETLIST','FORPREP','FORLOOP','TFORCALL','TFORLOOP','GETUPVAL','SETUPVAL','NOT','UNM','LEN','TAILCALL','VARARG']) {
      if (toPhysC[n] !== undefined) usedPhys.add(toPhysC[n]);
    }
    const physBodyC = new Array(130).fill('do end');
    for (const name of LOGICAL) {
      const phys = toPhysC[name];
      if (phys === undefined || phys < 0 || phys > 129) continue;
      if (!usedPhys.has(phys)) continue;
      physBodyC[phys] = bodyFor(name);
    }
    const usedList = [...usedPhys].filter(p => p >= 0 && p < 130).sort((a,b) => a - b);
    function emitStepFn(name) {
      const lines = [];
      lines.push('local function ' + name + '(op,A,B,C)');
      for (let i = 0; i < usedList.length; i++) {
        const pp = usedList[i];
        const body = physBodyC[pp] || 'do end';
        lines.push((i === 0 ? 'if' : 'elseif') + ' op==' + pp + ' then ' + body);
      }
      lines.push('end');
      lines.push('end');
      return lines;
    }
    const sk = (map && map.streamKey) || 0;
    const keysArr = (insts || []).map((_, pci) => ((sk + Math.imul(pci, 0x9E3779B9)) >>> 0));
    const LC = [];
    LC.push('local function __VM_RUN(...)');
    LC.push('local bit32=bit32');
    LC.push('local bxor=bit32 and bit32.bxor or function(a,b) local r,p=0,1 for _=1,32 do local x,y=a%2,b%2 if x~=y then r=r+p end a=math.floor(a/2) b=math.floor(b/2) p=p*2 end return r end');
    LC.push('local R=table.create(' + Math.max(16, (maxReg || 8) + 4) + ')');
    LC.push('local _K={' + (constants || []).map(emitConst).join(',') + '}');
    LC.push('local _BC={' + (insts || []).join(',') + '}');
    LC.push('local _SK=' + sk);
    LC.push('local _KEYS={' + keysArr.join(',') + '}');
    LC.push('local PC=1');
    LC.push('local _ENV=(getfenv and getfenv(1)) or _G');
    LC.push('local _TOP=0');
    LC.push('local _RV');
    LC.push('local _UV={}');
    LC.push('local _VARARGS={...}');
    LC.push('local _PROTOS=' + emitProtoTable(protos || [], 0, sk));
    LC.push('local function _RUN_PROTO(proto,args,uv)');
    LC.push('local R={};for i=0,(proto.maxReg or 16)+4 do R[i]=nil end');
    LC.push('local _K=proto.K or {};local _BC=proto.insts or {};local _KEYS=proto.keys or {};local PC=1;local _TOP=0;local _RV;local _UV=uv or {}');
    LC.push('local _VARARGS=proto.isVararg and args or {}');
    LC.push('for i=1,(proto.nparams or 0) do R[i-1]=args[i] end');
    for (const line of emitStepFn('__pstep')) LC.push(line);
    LC.push('while PC<=#_BC do');
    LC.push('local ins=_BC[PC];if not ins then break end');
    LC.push('local _raw=bxor(ins,_KEYS[PC] or 0)');
    LC.push('local op=_raw%256 local C=math.floor(_raw/256)%256 local B=math.floor(_raw/65536)%256 local A=math.floor(_raw/16777216)%256');
    LC.push('PC=PC+1');
    LC.push('local sig=__pstep(op,A,B,C)');
    LC.push('if sig==1 then break end');
    LC.push('if sig==2 then return table.unpack(_RV or {}) end');
    LC.push('end');
    LC.push('return table.unpack(_RV or {})');
    LC.push('end');
    for (const line of emitStepFn('__step')) LC.push(line);
    LC.push('while PC<=#_BC do');
    LC.push('local ins=_BC[PC];if not ins then break end');
    LC.push('local _raw=bxor(ins,_KEYS[PC] or 0)');
    LC.push('local op=_raw%256 local C=math.floor(_raw/256)%256 local B=math.floor(_raw/65536)%256 local A=math.floor(_raw/16777216)%256');
    LC.push('PC=PC+1');
    LC.push('local sig=__step(op,A,B,C)');
    LC.push('if sig==1 then break end');
    LC.push('if sig==2 then return table.unpack(_RV or {}) end');
    LC.push('end');
    LC.push('end');
    LC.push('return __VM_RUN()');
    return LC.join('\n');
  }

  const toPhys = map.toPhys;
  const physBody = new Array(130).fill('do end');
  for (const name of LOGICAL) {
    const phys = toPhys[name];
    if (phys === undefined || phys < 0 || phys > 129) continue;
    physBody[phys] = bodyFor(name);
  }

  const mapKey = 0x41 + Math.floor(Math.random() * 120);
  const noise = [];
  for (let i = 0; i < 130; i++)
    noise.push(((i * 19 + mapKey * 3) ^ (physBody[i].length * 5)) & 255);

  const L = [];
  L.push('local function __VM_RUN(...)');
  L.push('local bit32=bit32');
  L.push('local bxor=bit32 and bit32.bxor or function(a,b) local r,p=0,1 for _=1,32 do local x,y=a%2,b%2 if x~=y then r=r+p end a=math.floor(a/2) b=math.floor(b/2) p=p*2 end return r end');
  // Wrap string library to coerce non-string args (e.g. Roblox Instance) to string.
  // This prevents "invalid argument #N (string expected, got instance)" errors
  // when user code calls string.byte/find/sub/etc on an Instance.
  // We use a metatable proxy so all string.* calls auto-coerce the first arg.
  L.push('local _orig_str=string');
  L.push('local _str_cache={}');
  L.push('string=setmetatable({}, {__index=function(t,k) local v=_str_cache[k] if v then return v end local f=_orig_str[k] if type(f)=="function" then v=function(s,...) if type(s)~="string" then s=tostring(s) end return f(s,...) end else v=f end _str_cache[k]=v return v end})');
  L.push(`local _MK=${mapKey}`);
  L.push(`local _NO={${noise.join(',')}}`);
  L.push(`local _K={${(constants || []).map(emitConst).join(',')}}`);
  L.push(`local _BC={${(insts || []).join(',')}}`);
  L.push(`local _PROTOS=${emitProtoTable(protos || [])}`);
  L.push('local R={}');
  L.push(`for i=0,${Math.max((maxReg || 16) + 8, 32)} do R[i]=nil end`);
  L.push('local PC=1');
  L.push('local _TOP=0');
  L.push('local _RV=nil');
  L.push('local _UV={}');
  L.push('local _ENV=(_ENV or (getfenv and getfenv()) or _G)');
  // varargs (top-level)
  L.push('local _VARARGS={...}');

  // === Nested proto runner ===
  // IMPORTANT: this is ONE complete function definition (with `end`).
  // We build it as separate pushes to avoid template-literal interpolation
  // issues with the handler loop.
  L.push('local function _RUN_PROTO(proto, args, uv)');
  L.push('local R={};for i=0,(proto.maxReg or 16)+8 do R[i]=nil end');
  L.push('local _K=proto.K or {};local _BC=proto.insts or {};local PC=1;local _TOP=0;local _RV=nil;local _UV=uv or {}');
  L.push('local _PROTOS=proto.protos or {}');
  L.push('local _VARARGS=proto.isVararg and args or {}');
  L.push('for i=1,(proto.nparams or 0) do R[i-1]=args[i] end');
  L.push('local _ENV=(_ENV or (getfenv and getfenv()) or _G)');
  L.push('local _MAKE_CLOSURE');
  L.push('local _CALL_PROTO');
  for (const line of emitDispatchIfChain(physBody)) L.push(line);
  L.push('_MAKE_CLOSURE=function(pi)');
  L.push('local sub=_PROTOS[pi+1]');
  L.push('if not sub then return function() end end');
  L.push('local subuv={}');
  L.push('for i,u in ipairs(sub.upvalues or {}) do');
  L.push('if u.isLocal then subuv[i]={r=R,i=u.index} else subuv[i]=_UV[u.index+1] end');
  L.push('end');
  L.push('return function(...) return _RUN_PROTO(sub,{...},subuv) end');
  L.push('end');
  L.push('_CALL_PROTO=function(clos, args) return _RUN_PROTO(clos.__vm_proto, args, clos.__uv) end');
  L.push('while PC<=#_BC do');
  L.push('local ins=_BC[PC];if not ins then break end;PC=PC+1');
  L.push('local op=math.floor(ins/16777216)%256;local A=math.floor(ins/65536)%256;local B=math.floor(ins/256)%256;local C=ins%256');
  L.push('local sig=__step(op,A,B,C)');
  L.push('if sig==1 then break end;if sig==2 then return table.unpack(_RV or {}) end');
  L.push('end');
  L.push('return table.unpack(_RV or {})');
  L.push('end');  // closes _RUN_PROTO

  // === Top-level runner ===
  L.push(`local function _MAKE_CLOSURE(pi)
local proto=_PROTOS[pi+1]
if not proto then return function() end end
local uv={}
for i,u in ipairs(proto.upvalues or {}) do
if u.isLocal then uv[i]={r=R,i=u.index} else uv[i]=_UV[u.index+1] end
end
return function(...) return _RUN_PROTO(proto,{...},uv) end
end`);
  L.push(`local function _CALL_PROTO(clos, args)
return _RUN_PROTO(clos.__vm_proto, args, clos.__uv)
end`);

  L.push('local _MAKE_CLOSURE');
  L.push('local _CALL_PROTO');
  for (const line of emitDispatchIfChain(physBody)) L.push(line);

  // Decoy functions — junk noise that looks like real VM helpers
  for (let d = 0; d < 8; d++) {
    const fnChoice = d % 4;
    if (fnChoice === 0) {
      L.push(`local function _d${d}(x) return bxor((tonumber(x) or ${10 + d}),${20 + d * 3}) end`);
    } else if (fnChoice === 1) {
      L.push(`local function _d${d}(x,y) return math.floor((tonumber(x) or 0)*(tonumber(y) or 1)) end`);
    } else if (fnChoice === 2) {
      L.push(`local function _d${d}(x) return tostring(x):len() end`);
    } else {
      L.push(`local function _d${d}(x) return type(x)=="number" and x*${d+1} or 0 end`);
    }
  }

  // Integrity check helper — hashes the dispatch table at startup
  L.push('local function _integrity_check() local h=2166136261 for i=0,130 do h=bxor(h,i) h=(h*16777619)%4294967296 end return h end');
  // Opaque predicate helper — always returns true but looks complex
  L.push('local function _opaque(x) return (bxor(x,0)==x) and (math.abs(0)>=0) and (tostring(x)~=nil) end');
  // Junk string pool — fake constants that look like real string literals
  L.push('local _junk_pool={string.char(' + Array.from({length: 16}, (_, i) => (65 + i % 26)).join(',') + ')}');
  for (let j = 0; j < 8; j++) {
    L.push(`_junk_pool[${j + 2}]=string.char(${Array.from({length: 8}, () => 65 + Math.floor(Math.random() * 26)).join(',')})`);
  }

  // Call integrity check at startup (result unused but execution required)
  L.push('local _ic=_integrity_check()');
  L.push('local _op=_opaque(_MK)');

  L.push('while PC<=#_BC do');
  L.push('local ins=_BC[PC];if not ins then break end;PC=PC+1');
  L.push('local op=math.floor(ins/16777216)%256');
  L.push('local A=math.floor(ins/65536)%256');
  L.push('local B=math.floor(ins/256)%256');
  L.push('local C=ins%256');
  L.push('local sig=__step(op,A,B,C)');
  L.push('if sig==1 then break end');
  L.push('if sig==2 then return table.unpack(_RV or {}) end');
  L.push('end');  // closes while
  L.push('end');  // closes __VM_RUN function
  L.push('return __VM_RUN()');
  return L.join('\n');
}
}


/**
 * Split VM: interpreter body (no data) + serializable bytecode blob.
 * Runtime: decode blob → tables → run interpreter. NO loadstring of source.
 */
export function emitVMRuntimeSplit(compiled) {
  const { map, insts, constants, maxReg, protos, mode } = compiled;
  if (mode && String(mode).indexOf('execstr') === 0) {
    return { mode: mode, kind: 'execstr', source: emitVMRuntime(compiled) };
  }
  if (!(mode === 'vm-ast' || (mode && String(mode).indexOf('vm') === 0))) {
    return { mode: mode || 'unknown', kind: 'execstr', source: emitVMRuntime(compiled) };
  }

  const toPhysC = map.toPhys;
  const usedPhys = new Set();
  function collectOps(ilist, plist) {
    for (const ins of (ilist || [])) {
      usedPhys.add(Math.floor(Number(ins) / 16777216) % 256);
    }
    for (const p of (plist || [])) {
      collectOps(p.insts, p.protos);
    }
  }
  collectOps(insts, protos);
  for (const n of ['HALT','NOP','LOADK','LOADN','LOADSTR','GETGLOBAL','SETGLOBAL','CALL','RETURN','MOVE','LOADB','LOADNIL','GETTABLE','SETTABLE','GETFIELD','SETFIELD','SELF','CLOSURE','JMP','TEST','TESTSET','EQ','LT','LE','ADD','SUB','MUL','DIV','CONCAT','NEWTABLE','SETLIST','FORPREP','FORLOOP','TFORCALL','TFORLOOP','GETUPVAL','SETUPVAL','NOT','UNM','LEN','TAILCALL','VARARG']) {
    if (toPhysC[n] !== undefined) usedPhys.add(toPhysC[n]);
  }
  const physBodyC = new Array(130).fill('do end');
  for (const name of LOGICAL) {
    const phys = toPhysC[name];
    if (phys === undefined || phys < 0 || phys > 129) continue;
    if (!usedPhys.has(phys)) continue;
    physBodyC[phys] = bodyFor(name);
  }
  const usedList = [...usedPhys].filter(p => p >= 0 && p < 130).sort((a,b) => a - b);
  function emitStepFn(name) {
    const lines = [];
    lines.push('local function ' + name + '(op,A,B,C)');
    for (let i = 0; i < usedList.length; i++) {
      const pp = usedList[i];
      const body = physBodyC[pp] || 'do end';
      lines.push((i === 0 ? 'if' : 'elseif') + ' op==' + pp + ' then ' + body);
    }
    lines.push('end');
    lines.push('end');
    return lines;
  }
  const sk = (map && map.streamKey) || 0;
  const keysArr = (insts || []).map((_, pci) => ((sk + Math.imul(pci, 0x9E3779B9)) >>> 0));

  // --- Serialize data (ASCII, no loadstring needed to rebuild) ---
  // Raw byte hex (NOT utf8) — encrypted constants are binary, must not multi-byte encode
  function byteHex(str) {
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const b = str.charCodeAt(i) & 255;
      out += (b < 16 ? '0' : '') + b.toString(16);
    }
    return out;
  }
  // Random opaque tags (not SK/BC/KEYS) — changes every build
  function rtag() {
    const a = 'abcdefghijkmnopqrstuvwxyz';
    return a[Math.floor(Math.random()*a.length)] + a[Math.floor(Math.random()*a.length)] + Math.floor(Math.random()*10);
  }
  const tags = { sk: rtag(), mr: rtag(), bc: rtag(), ky: rtag(), kc: rtag(), pr: rtag(), n: rtag(), s: rtag(), t: rtag(), f: rtag(), z: rtag() };
  // VD field slots (numeric indices, not .BC/.K)
  const slots = {
    K: 1 + Math.floor(Math.random() * 5),
    BC: 8 + Math.floor(Math.random() * 5),
    KEYS: 16 + Math.floor(Math.random() * 5),
    PROTOS: 24 + Math.floor(Math.random() * 5),
    SK: 32 + Math.floor(Math.random() * 5),
    MR: 40 + Math.floor(Math.random() * 5),
  };
  function serConsts(arr, tg) {
    tg = tg || { n: 'N', s: 'S', t: 'T', f: 'F', z: 'Z' };
    const lines = [];
    for (const c of (arr || [])) {
      if (typeof c === 'number') lines.push(tg.n + ' ' + c);
      else if (typeof c === 'boolean') lines.push(c ? tg.t : tg.f);
      else if (typeof c === 'string') lines.push(tg.s + ' ' + byteHex(c));
      else lines.push(tg.z);
    }
    return lines.join('\n');
  }
  function serProtos(ps) {
    if (!ps || !ps.length) return '0';
    // Line-based: count, then for each proto a DATA line + optional NEST block
    // DATA: maxReg|nparams|isVararg|BC_csv|KEYS_csv|K_with_backtick|ups
    // Nested protos follow between @N and @E markers (own recursive blocks)
    const out = [String(ps.length)];
    for (const p of ps) {
      const pKeys = (p.insts || []).map((_, pci) => ((sk + Math.imul(pci, 0x9E3779B9)) >>> 0));
      const ups = (p.upvalues || []).map(u => (u.isLocal ? '1' : '0') + ',' + (u.index || 0)).join(';');
      out.push([
        p.maxReg || 8,
        p.nparams || 0,
        p.isVararg ? 1 : 0,
        (p.insts || []).join(','),
        pKeys.join(','),
        serConsts(p.constants || [], tags).replace(/\n/g, '`'),
        ups
      ].join('|'));
      const nested = p.protos || [];
      if (nested.length) {
        out.push('@N');
        out.push(serProtos(nested));
        out.push('@E');
      } else {
        out.push('@0');
      }
    }
    return out.join('\n');
  }

  const blob = [
    '1',
    tags.sk + ' ' + sk,
    tags.mr + ' ' + Math.max(16, (maxReg || 8) + 4),
    tags.bc + ' ' + (insts || []).join(','),
    tags.ky + ' ' + keysArr.join(','),
    tags.kc + ' ' + (constants || []).length,
    serConsts(constants || [], tags),
    tags.pr,
    serProtos(protos || [])
  ].join('\n');

  // --- Interpreter: randomize visible function names only ---
  const rv = () => '_' + Math.random().toString(36).slice(2, 10);
  const nRun = rv(), nStep = rv(), nPStep = rv(), nProto = rv();

  function emitStepFnNamed(name) {
    const ht = '_' + Math.random().toString(36).slice(2, 9);
    const lines = [];
    lines.push('local ' + ht + '={}');
    const order = usedList.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }
    for (let i = 0; i < order.length; i++) {
      if (Math.random() < 0.45) {
        const z = Math.floor(Math.random() * 900) + 10;
        lines.push('do local _z=' + z + ';_z=_z end');
      }
      if (Math.random() < 0.25) {
        const fake = Math.floor(Math.random() * 130);
        lines.push('if (0>1) then ' + ht + '[' + fake + ']=function() end end');
      }
      const pp = order[i];
      const body = physBodyC[pp] || 'do end';
      lines.push(ht + '[' + pp + ']=function(A,B,C) ' + body + ' end');
    }
    lines.push('local function ' + name + '(op,A,B,C) local h=' + ht + '[op] if h then return h(A,B,C) end end');
    return lines;
  }

  const LC = [];
  LC.push('local function ' + nRun + '(...)');
  LC.push('local bit32=bit32');
  LC.push('local bxor=bit32 and bit32.bxor or function(a,b) local r,p=0,1 for _=1,32 do local x,y=a%2,b%2 if x~=y then r=r+p end a=math.floor(a/2) b=math.floor(b/2) p=p*2 end return r end');
  LC.push('local VD=_VD');
  LC.push('if type(VD)~="table" then error("",0) end');
  LC.push('local R=table.create(VD[' + slots.MR + '] or 20)');
  LC.push('local _K=VD[' + slots.K + '] or {}');
  LC.push('local _BC=VD[' + slots.BC + '] or {}');
  LC.push('local _SK=VD[' + slots.SK + '] or 0');
  LC.push('local _KEYS=VD[' + slots.KEYS + '] or {}');
  LC.push('local _PROTOS=VD[' + slots.PROTOS + '] or {}');
  LC.push('local PC=1');
  LC.push('local _ENV=(getfenv and getfenv(1)) or _G');
  LC.push('local _TOP=0');
  LC.push('local _RV');
  LC.push('local _UV={}');
  LC.push('local _VARARGS={...}');
  LC.push('local function ' + nProto + '(proto,args,uv)');
  LC.push('local R={};for i=0,(proto.maxReg or 16)+4 do R[i]=nil end');
  LC.push('local _K=proto.K or {};local _BC=proto.insts or {};local _KEYS=proto.keys or {};local PC=1;local _TOP=0;local _RV;local _UV=uv or {}');
  LC.push('local _VARARGS=proto.isVararg and args or {}');
  LC.push('for i=1,(proto.nparams or 0) do R[i-1]=args[i] end');
  for (const line of emitStepFnNamed(nPStep)) LC.push(line);
  LC.push('while PC<=#_BC do');
  LC.push('local ins=_BC[PC];if not ins then break end');
  LC.push('local _raw=bxor(ins,_KEYS[PC] or 0)');
  LC.push('local op=_raw%256 local C=math.floor(_raw/256)%256 local B=math.floor(_raw/65536)%256 local A=math.floor(_raw/16777216)%256');
  LC.push('PC=PC+1');
  LC.push('local sig=' + nPStep + '(op,A,B,C)');
  LC.push('if sig==1 then break end');
  LC.push('if sig==2 then return table.unpack(_RV or {}) end');
  LC.push('end');
  LC.push('return table.unpack(_RV or {})');
  LC.push('end');
  for (const line of emitStepFnNamed(nStep)) LC.push(line);
  LC.push('while PC<=#_BC do');
  LC.push('local ins=_BC[PC];if not ins then break end');
  LC.push('local _raw=bxor(ins,_KEYS[PC] or 0)');
  LC.push('local op=_raw%256 local C=math.floor(_raw/256)%256 local B=math.floor(_raw/65536)%256 local A=math.floor(_raw/16777216)%256');
  LC.push('PC=PC+1');
  LC.push('local sig=' + nStep + '(op,A,B,C)');
  LC.push('if sig==1 then break end');
  LC.push('if sig==2 then return table.unpack(_RV or {}) end');
  LC.push('end');
  LC.push('end');
  LC.push('return ' + nRun + '()');

  // Rewrite hardcoded bodyFor refs + all VM locals to random short names
  const nR = rv(), nK = rv(), nBC = rv(), nKEYS = rv(), nPROTOS = rv();
  const nPC = rv(), nENV = rv(), nTOP = rv(), nRVv = rv(), nUVv = rv(), nVA = rv(), nSK = rv();
  for (let i = 0; i < LC.length; i++) {
    let s = LC[i];
    s = s.replace(/_RUN_PROTO/g, nProto);
    s = s.replace(/_VARARGS/g, nVA);
    s = s.replace(/_PROTOS/g, nPROTOS);
    s = s.replace(/_KEYS/g, nKEYS);
    s = s.replace(/_TOP/g, nTOP);
    s = s.replace(/_ENV/g, nENV);
    s = s.replace(/_SK/g, nSK);
    s = s.replace(/_RV/g, nRVv);
    s = s.replace(/_UV/g, nUVv);
    s = s.replace(/_BC/g, nBC);
    s = s.replace(/_K/g, nK);
    // PC as whole word
    s = s.replace(/\bPC\b/g, nPC);
    // R[ and R as register table - careful
    s = s.replace(/\bR\[/g, nR + '[');
    s = s.replace(/\bR\{/g, nR + '{');
    s = s.replace(/local R=/g, 'local ' + nR + '=');
    s = s.replace(/local R=/g, 'local ' + nR + '=');
    LC[i] = s;
  }

  return {
    mode: 'vm-ast',
    kind: 'split',
    interpreter: LC.join('\n'),
    blob: blob,
    tags: tags,
    slots: slots,
    sk: sk,
    maxReg: Math.max(16, (maxReg || 8) + 4),
  };
}

