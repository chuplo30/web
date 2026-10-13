/**
 * Lua/Luau source emitter for the lifted Luau bytecode VM.
 * The emitted runtime executes the lifted official bytecode semantics through
 * a per-build polymorphic opcode stream. Unsupported experimental class
 * behavior is represented conservatively as tables; normal Luau table,
 * function, metamethod, numeric, and builtin behavior is delegated to the
 * host Luau runtime.
 */

import { AD_OP, E_OP, AUX_OP } from "../protection/vm-polymorph.js";

function luaString(s) {
  const b = Buffer.from(String(s), "utf8");
  let out = '"';
  for (const x of b) {
    if (x === 34) out += '\\"';
    else if (x === 92) out += '\\\\';
    else if (x === 10) out += '\\n';
    else if (x === 13) out += '\\r';
    else if (x === 9) out += '\\t';
    else if (x >= 32 && x <= 126) out += String.fromCharCode(x);
    else out += `\\${String(x).padStart(3,"0")}`;
  }
  return out + '"';
}

function luaNumber(x) {
  if (typeof x === "bigint") return `tonumber(${luaString(String(x))})`;
  if (typeof x === "number") {
    if (!Number.isFinite(x)) return x > 0 ? "math.huge" : "-math.huge";
    if (Number.isNaN(x)) return "0/0";
    if (Object.is(x,-0)) return "-0.0";
    return String(x);
  }
  return luaString(String(x));
}

function luaLiteral(v) {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "string") return luaString(v);
  if (typeof v === "number" || typeof v === "bigint") return luaNumber(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `{${v.map(luaLiteral).join(",")}}`;
  if (typeof v === "object") {
    const parts=[];
    for (const [k,val] of Object.entries(v)) {
      const key=/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `[${luaString(k)}]`;
      parts.push(`${key}=${luaLiteral(val)}`);
    }
    return `{${parts.join(",")}}`;
  }
  return "nil";
}

export function emitLuauVMRuntime(program, {entry = true, returnResults = false} = {}) {
  if (!program || !program.isa || !Array.isArray(program.functions)) throw new Error("invalid full VM program");
  const tags=program.isa.tags || {};
  const physical=program.isa.order.map(op=>{
    const p=program.isa.operandPerm[op] || ["a","b","c"];
    const fmt=AD_OP.has(op)?2:(E_OP.has(op)?3:1);
    return [tags[op]||0,program.isa.keys[program.isa.enc[op]]>>>0,program.isa.masks[op]>>>0,p.indexOf("a")+1,p.indexOf("b")+1,p.indexOf("c")+1,fmt,AUX_OP.has(op)?1:0];
  });
  const protectedData={isa:{streamKey:program.isa.streamKey,auxKey:program.isa.auxKey,physical},functions:program.functions,mainFunction:program.mainFunction??0};
  const data = luaLiteral(protectedData);
  let runtime = String.raw`
local _8xms = ${data}
do
  local ISA = _8xms.isa
  local FNS = _8xms.functions
  local MAIN = _8xms.mainFunction
  local unpack = table.unpack
  local pack = table.pack
  local G = _G
  local floor = math.floor
  local ALPH="0123456789ABCDEF"

  local function bx(w) return w % 256 end
  local function b1(w) return floor(w/256)%256 end
  local function b2(w) return floor(w/65536)%256 end
  local function b3(w) return floor(w/16777216)%256 end
  local function signed16(x) if x>=32768 then return x-65536 else return x end end
  local function signed24(x) if x>=8388608 then return x-16777216 else return x end end
  local function decWord(w, pc, fkey)
    w = bit32.bxor(w, ((fkey or 0) + pc * 0x9e3779b9) % 4294967296)
    w = bit32.bxor(w, (ISA.streamKey + pc * 0x9e3779b9) % 4294967296)
    local phys=bx(w)
    local rec=ISA.physical[phys+1]
    if not rec then error("8XMS: corrupt opcode") end
    local tag=rec[1]; local k=rec[2] or 0; local mask=rec[3] or 0
    local raw={a=b1(w),b=b2(w),c=b3(w)}
    local vals={}
    if rec[7]==2 then
      vals.a=bit32.bxor(raw.a, mask%256)
    elseif rec[7]==3 then
      vals.a=0
    else
      local function put(idx,v) if idx==1 then vals.a=v elseif idx==2 then vals.b=v else vals.c=v end end
      put(rec[4],bit32.bxor(raw.a, mask%256))
      put(rec[5],bit32.bxor(raw.b, floor(mask/256)%256))
      put(rec[6],bit32.bxor(raw.c, floor(mask/65536)%256))
    end
    local out={tag=tag,op=tag,a=vals.a or 0,b=vals.b or 0,c=vals.c or 0,d=signed16(floor(w/65536)%65536),e=signed24(floor(w/256)%16777216),aux=rec[8]~=0}
    return out, phys
  end
  local function extra(stream, pc, phys, fkey)
    local rec=ISA.physical[phys+1]
    if rec and rec[8]~=0 then
      local k=rec[2] or 0
      local v=stream[pc+2] or 0
      v=bit32.bxor(v, ((fkey or 0) + (pc+1) * 0x9e3779b9) % 4294967296)
      return bit32.bxor(v, k, ISA.auxKey or 0)
    end
    return 0
  end
  local function truth(v) return v~=nil and v~=false end
  local function imul(a,b)
    local al=a%65536; local ah=floor(a/65536); local bl=b%65536; local bh=floor(b/65536)
    return (al*bl + ((al*bh+ah*bl)%65536)*65536)%4294967296
  end
  local function guardCode(proto)
    local h=2166136261
    for i=1,#proto.code do h=bit32.bxor(h,proto.code[i]); h=imul(h,16777619) end
    return h%4294967296
  end
  local function stateMix(a,b)
    local x=bit32.bxor(a,b)
    x=imul(bit32.bxor(x,0x9e3779b9),0x85ebca6b)
    x=bit32.bxor(x,floor(x/65536))
    x=imul(x,0xc2b2ae35)
    x=bit32.bxor(x,floor(x/8192))
    return x%4294967296
  end
  local function stateEncode(token,epoch,proto)
    return bit32.bxor(token,bit32.bxor(proto.state.stateMask or 0,imul(epoch or 0,proto.state.epochMul or 1)))
  end
  local function stateDecode(proto,encoded,epoch)
    local raw=bit32.bxor(encoded,bit32.bxor(proto.state.stateMask or 0,imul(epoch or 0,proto.state.epochMul or 1)))
    local buckets=proto.state.buckets
    local bucket=buckets[(bit32.band(raw,255))+1]
    if not bucket then error("8XMS: runtime fault",0) end
    for i=1,#bucket do
      local r=bucket[i]
      if r[1]==raw then
        if r[3]~=stateMix(proto.state.stateKey or 0,stateMix(raw,r[2] or 0)) then error("8XMS: bytecode integrity failure",0) end
        return r[2],r[4] or 0,raw
      end
    end
    error("8XMS: runtime fault",0)
  end
  local function getConst(proto, i)
    local c=proto.constants[i+1]
    if not c then return nil end
    if c.type=="nil" then return nil
    elseif c.type=="boolean" or c.type=="number" or c.type=="string" or c.type=="integer" then return c.value
    elseif c.type=="xpack94" then
      if c._v then return c._v end
      local A="!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_"..string.char(96).."abcdefghijklmnopqrstuvwxyz{|}~"
      local MAP={}
      for i=1,#A do MAP[string.sub(A,i,i)]=i-1 end
      local out={}
      for _,part in ipairs(c.parts) do
        local raw={}; local q=1; local produced=0
        while q<=#part.data and produced<part.n do
          local a=MAP[string.sub(part.data,q)] or 0
          local b=MAP[string.sub(part.data,q+1)] or 0
          local d=MAP[string.sub(part.data,q+2)] or 0
          local e=MAP[string.sub(part.data,q+3)] or 0
          local n=a*94*94*94+b*94*94+d*94+e
          local vals={math.floor(n/65536)%256,math.floor(n/256)%256,n%256}
          for j=1,3 do
            if produced>=part.n then break end
            local kb=math.floor(((part.k or 0)+((part.o or 0)+produced)*0x9e3779b9))%4294967296%256
            raw[#raw+1]=string.char(bit32.bxor(vals[j],kb)); produced=produced+1
          end
          q=q+4
        end
        out[#out+1]=table.concat(raw)
      end
      c._v=table.concat(out); return c._v
    elseif c.type=="vector" then
      if vector and vector.create then return vector.create(c.value[1],c.value[2],c.value[3]) end
      return {c.value[1],c.value[2],c.value[3],c.value[4]}
    elseif c.type=="vectord" then
      if vector and vector.create then return vector.create(c.value[1],c.value[2],c.value[3]) end
      return {c.value[1],c.value[2],c.value[3],c.value[4]}
    elseif c.type=="closure" then return c
    elseif c.type=="table" or c.type=="table-with-constants" then return c
    elseif c.type=="class-shape" then return c
    else return c.value end
  end
  local function materializeConst(proto, i)
    local c=proto.constants[i+1]
    if not c then return nil end
    if c.type=="table" then
      local t={}
      for n=1,#c.keys do t[n]=getConst(proto,c.keys[n]) end
      return t
    elseif c.type=="table-with-constants" then
      local t={}
      for n=1,#c.pairs do local p=c.pairs[n]; t[getConst(proto,p.key)]=getConst(proto,p.value) end
      return t
    elseif c.type=="class-shape" then return c end
    return getConst(proto,i)
  end
  local function deref(x)
    if type(x)=="table" and x.__8xms_ref then return x.r[x.i] end
    if type(x)=="table" and x.__8xms_box then return x.value end
    return x
  end
  local function setref(x,v)
    if type(x)=="table" and x.__8xms_ref then x.r[x.i]=v else return v end
    return v
  end
  local runProto
  local CLOSURES=setmetatable({}, {__mode="k"})
  local DUP_CACHE=setmetatable({}, {__mode="k"})
  local function closure(proto, uv)
    local f
    f=function(...) local a=pack(...); return runProto(proto,uv or {},a) end
    CLOSURES[f]={proto=proto,uv=uv or {}}
    return f
  end
  local function invoke(fn,args,ctx)
    local meta=CLOSURES[fn]
    if meta then return pack(runProto(meta.proto,meta.uv,args)) end
    if type(fn)~="function" then
      error("8XMS: runtime fault",0)
    end
    return pack(fn(unpack(args,1,args.n)))
  end

  local function captureValue(proto, uv, typ, src, R)
    if typ==0 then return deref(R[src+1]) end
    if typ==1 then return {__8xms_ref=true,r=R,i=src+1} end
    if typ==2 then return uv[src+1] end
    if typ==3 then
      local u=uv[src+1]
      if type(u)=="table" and (u.__8xms_ref or u.__8xms_box) then return u end
      return {__8xms_box=true,value=deref(u)}
    end
    return deref(R[src+1])
  end
  local function finishCapture(v)
    if type(v)=="table" and v.__8xms_box then return v.value end
    return deref(v)
  end

  runProto = function(proto, uv, args)
    local R={}
    local nargs=args.n or 0
    for i=0,math.max(proto.numparams or 0,nargs)-1 do R[i+1]=args[i+1] end
    local varargs={n=0}
    if proto.isvararg then
      local n=math.max(0,nargs-(proto.numparams or 0))
      varargs.n=n
      for i=1,n do varargs[i]=args[(proto.numparams or 0)+i] end
    end
    local TOP=math.max(nargs,proto.numparams or 0)
    local code=proto.code
    if proto.guard and guardCode(proto)~=proto.guard then error("8XMS: bytecode integrity failure",0) end
    local stateInfo=proto.state
    if not stateInfo or not stateInfo.buckets then error("8XMS: runtime fault",0) end
    local epoch=0
    local state=stateEncode(stateInfo.entryToken or 0,epoch,proto)
    while true do
      local pc,blockId=stateDecode(proto,state,epoch)
      local ins,phys=decWord(code[pc+1],pc,proto.key)
      local op=ins.tag
      local auxv=extra(code,pc,phys,proto.key)
      local nextpc=pc+1

      if op=="LU_FUSE_LOADK_RETURN" then
        R[ins.a+1]=materializeConst(proto,ins.d); local sp=pc+1; local ri,rp=decWord(code[sp+1],sp,proto.key); local nret=(ri.b==0) and (TOP-ins.a) or (ri.b-1); local out={n=nret}; for j=1,nret do out[j]=R[ins.a+j] end; return unpack(out,1,nret)
      elseif op=="LU_FUSE_MOVE_RETURN" then
        R[ins.a+1]=R[ins.b+1]; local sp=pc+1; local ri,rp=decWord(code[sp+1],sp,proto.key); local nret=(ri.b==0) and (TOP-ins.a) or (ri.b-1); local out={n=nret}; for j=1,nret do out[j]=R[ins.a+j] end; return unpack(out,1,nret)
      elseif op=="LU_FUSE_GETGLOBAL_CALL" or op=="LU_FUSE_GETTABLEKS_CALL" then
        if op=="LU_FUSE_GETGLOBAL_CALL" then local k=getConst(proto,auxv); R[ins.a+1]=G[k] else local k=getConst(proto,auxv); R[ins.a+1]=R[ins.b+1][k] end
        local sp=pc+2; local ci,cp=decWord(code[sp+1],sp,proto.key); local narg=(ci.b==0) and (TOP-ins.a-1) or (ci.b-1); local args2={n=math.max(0,narg)}; for j=1,args2.n do args2[j]=R[ins.a+j] end; local res=invoke(R[ins.a+1],args2,"pc="..pc..",op="..tostring(op)); local nres=res.n or 0; if ci.c==0 then TOP=ins.a+nres; for j=1,nres do R[ins.a+j]=res[j] end else local want=ci.c-1; TOP=math.max(TOP,ins.a+want); for j=1,want do R[ins.a+j]=res[j] end end; nextpc=sp+(ci.aux and 2 or 1)
      elseif op=="LU_NOP" or op=="LU_BREAK" or op=="LU_COVERAGE" or op=="LU_NATIVECALL" or op=="LU_PREPVARARGS" or op=="LU_FASTCALL" or op=="LU_FASTCALL1" or op=="LU_FASTCALL2" or op=="LU_FASTCALL2K" or op=="LU_FASTCALL3" then
      elseif op=="LU_LOADNIL" then R[ins.a+1]=nil
      elseif op=="LU_LOADB" then R[ins.a+1]=(ins.b~=0); if ins.c~=0 then nextpc=pc+1+ins.c end
      elseif op=="LU_LOADN" then R[ins.a+1]=ins.d
      elseif op=="LU_LOADK" then R[ins.a+1]=materializeConst(proto,ins.d)
      elseif op=="LU_LOADKX" then R[ins.a+1]=materializeConst(proto,auxv)
      elseif op=="LU_MOVE" then R[ins.a+1]=R[ins.b+1]
      elseif op=="LU_GETGLOBAL" then local k=getConst(proto,auxv); R[ins.a+1]=G[k] end
      elseif op=="LU_SETGLOBAL" then local k=getConst(proto,auxv); G[k]=R[ins.a+1] end
      elseif op=="LU_GETUPVAL" then R[ins.a+1]=deref(uv[ins.b+1])
      elseif op=="LU_SETUPVAL" then setref(uv[ins.b+1],R[ins.a+1])
      elseif op=="LU_CLOSEUPVALS" then
      elseif op=="LU_GETIMPORT" then
        local path={}; local q=auxv; local n=floor(q/1073741824); q=q%1073741824
        for i=1,n do path[i]=q%1024; q=floor(q/1024) end
        local root=getConst(proto,ins.d); local v=G
        if type(root)=="string" then v=G[root] end
        for i=1,n do local key=getConst(proto,path[i]); if key~=nil then v=v[key] end end
        R[ins.a+1]=v
      elseif op=="LU_GETTABLE" then R[ins.a+1]=R[ins.b+1][R[ins.c+1]]
      elseif op=="LU_SETTABLE" then R[ins.b+1][R[ins.c+1]]=R[ins.a+1]
      elseif op=="LU_GETTABLEKS" or op=="LU_GETUDATAKS" then local k=getConst(proto,auxv); R[ins.a+1]=R[ins.b+1][k] end
      elseif op=="LU_SETTABLEKS" or op=="LU_SETUDATAKS" then local k=getConst(proto,auxv); R[ins.b+1][k]=R[ins.a+1] end
      elseif op=="LU_GETTABLEN" then R[ins.a+1]=R[ins.b+1][ins.c+1]
      elseif op=="LU_SETTABLEN" then R[ins.b+1][ins.c+1]=R[ins.a+1]
      elseif op=="LU_NAMECALL" or op=="LU_NAMECALLUDATA" then
        local k=getConst(proto,auxv); R[ins.a+2]=R[ins.b+1]; R[ins.a+1]=R[ins.b+1][k]
      elseif op=="LU_ADD" then R[ins.a+1]=R[ins.b+1]+R[ins.c+1]
      elseif op=="LU_SUB" then R[ins.a+1]=R[ins.b+1]-R[ins.c+1]
      elseif op=="LU_MUL" then R[ins.a+1]=R[ins.b+1]*R[ins.c+1]
      elseif op=="LU_DIV" then R[ins.a+1]=R[ins.b+1]/R[ins.c+1]
      elseif op=="LU_MOD" then R[ins.a+1]=R[ins.b+1]%R[ins.c+1]
      elseif op=="LU_POW" then R[ins.a+1]=R[ins.b+1]^R[ins.c+1]
      elseif op=="LU_IDIV" then R[ins.a+1]=R[ins.b+1]//R[ins.c+1]
      elseif op=="LU_ADDK" then R[ins.a+1]=R[ins.b+1]+getConst(proto,ins.c)
      elseif op=="LU_SUBK" then R[ins.a+1]=R[ins.b+1]-getConst(proto,ins.c)
      elseif op=="LU_MULK" then R[ins.a+1]=R[ins.b+1]*getConst(proto,ins.c)
      elseif op=="LU_DIVK" then R[ins.a+1]=R[ins.b+1]/getConst(proto,ins.c)
      elseif op=="LU_MODK" then R[ins.a+1]=R[ins.b+1]%getConst(proto,ins.c)
      elseif op=="LU_POWK" then R[ins.a+1]=R[ins.b+1]^getConst(proto,ins.c)
      elseif op=="LU_IDIVK" then R[ins.a+1]=R[ins.b+1]//getConst(proto,ins.c)
      elseif op=="LU_SUBRK" then R[ins.a+1]=getConst(proto,ins.b)-R[ins.c+1]
      elseif op=="LU_DIVRK" then R[ins.a+1]=getConst(proto,ins.b)/R[ins.c+1]
      elseif op=="LU_AND" then local a=R[ins.b+1]; R[ins.a+1]=truth(a) and R[ins.c+1] or a
      elseif op=="LU_OR" then local a=R[ins.b+1]; R[ins.a+1]=truth(a) and a or R[ins.c+1]
      elseif op=="LU_ANDK" then local a=R[ins.b+1]; R[ins.a+1]=truth(a) and getConst(proto,ins.c) or a
      elseif op=="LU_ORK" then local a=R[ins.b+1]; R[ins.a+1]=truth(a) and a or getConst(proto,ins.c)
      elseif op=="LU_BAND" then R[ins.a+1]=bit32.band(R[ins.b+1],R[ins.c+1])
      elseif op=="LU_BOR" then R[ins.a+1]=bit32.bor(R[ins.b+1],R[ins.c+1])
      elseif op=="LU_BXOR" then R[ins.a+1]=bit32.bxor(R[ins.b+1],R[ins.c+1])
      elseif op=="LU_BNOT" then R[ins.a+1]=bit32.bnot(R[ins.b+1])
      elseif op=="LU_SHL" then R[ins.a+1]=bit32.lshift(R[ins.b+1],R[ins.c+1])
      elseif op=="LU_SHR" then R[ins.a+1]=bit32.rshift(R[ins.b+1],R[ins.c+1])
      elseif op=="LU_NOT" then R[ins.a+1]=not truth(R[ins.b+1])
      elseif op=="LU_MINUS" then R[ins.a+1]=-R[ins.b+1]
      elseif op=="LU_LENGTH" then R[ins.a+1]=#R[ins.b+1]
      elseif op=="LU_CONCAT" then local v=R[ins.b+1]; for i=ins.b+1,ins.c do if i~=ins.b+1 then v=v..R[i+1] end end; R[ins.a+1]=v end
      elseif op=="LU_NEWTABLE" or op=="LU_NEWCLASS" then R[ins.a+1]={}; if op=="LU_NEWCLASS" and ins.b~=255 then setmetatable(R[ins.a+1],{__index=R[ins.b+1]}) end end
      elseif op=="LU_NEWCLASSMEMBER" then local k=getConst(proto,auxv); local c=R[ins.a+1]; c[k]=R[ins.c+1] end
      elseif op=="LU_DUPTABLE" then R[ins.a+1]=materializeConst(proto,ins.d)
      elseif op=="LU_SETLIST" then local count=(ins.c==0) and (TOP-ins.b) or (ins.c-1); for j=1,count do R[ins.a+1][auxv+j]=R[ins.b+j] end end
      elseif op=="LU_NEWCLOSURE" or op=="LU_DUPCLOSURE" then
        local pidx=(op=="LU_NEWCLOSURE") and ins.d or ((getConst(proto,ins.d) or {}).protoIndex)
        local childId=(op=="LU_NEWCLOSURE") and (proto.children[pidx+1] or pidx) or pidx; local child=FNS[childId+1]
        local uvs={}; local q=pc+1
        while q < #code do
          local ci,cp=decWord(code[q+1],q,proto.key)
          if ci.op~="LU_CAPTURE" then break end
          uvs[#uvs+1]=captureValue(proto,uv,ci.a,ci.b,R)
          q=q+1
        end
        local hasCaps=(q>pc+1)
        if op=="LU_DUPCLOSURE" and (child.numupvalues or 0)==0 and not hasCaps then
          local cached=DUP_CACHE[child]
          if not cached then cached=closure(child,{}); DUP_CACHE[child]=cached end
          R[ins.a+1]=cached
        else
          R[ins.a+1]=closure(child,uvs)
        end
        pc=q; nextpc=pc
      elseif op=="LU_CAPTURE" then
      elseif op=="LU_CALL" or op=="LU_CALLFB" then
        local narg=(ins.b==0) and (TOP-ins.a-1) or (ins.b-1)
        local args2={n=math.max(0,narg)}; for j=1,args2.n do args2[j]=R[ins.a+j] end
        local res=invoke(R[ins.a+1],args2,"pc="..pc..",op="..tostring(op))
        local nres=res.n or 0
        if ins.c==0 then TOP=ins.a+nres; for j=1,nres do R[ins.a+j]=res[j] end else local want=ins.c-1; TOP=math.max(TOP,ins.a+want); for j=1,want do R[ins.a+j]=res[j] end end
      elseif op=="LU_RETURN" then
        local nret=(ins.b==0) and (TOP-ins.a) or (ins.b-1); local out={n=nret}; for j=1,nret do out[j]=R[ins.a+j] end; return unpack(out,1,nret)
      elseif op=="LU_GETVARARGS" then local n=(ins.b==0) and varargs.n or (ins.b-1); TOP=ins.a+n; for j=1,n do R[ins.a+j]=varargs[j] end end
      elseif op=="LU_JUMP" or op=="LU_JUMPBACK" then nextpc=pc+1+ins.d
      elseif op=="LU_JUMPX" then nextpc=pc+1+ins.e
      elseif op=="LU_JUMPIF" then if truth(R[ins.a+1]) then nextpc=pc+1+ins.d end
      elseif op=="LU_JUMPIFNOT" then if not truth(R[ins.a+1]) then nextpc=pc+1+ins.d end
      elseif op=="LU_JUMPIFEQ" or op=="LU_JUMPIFLE" or op=="LU_JUMPIFLT" or op=="LU_JUMPIFNOTEQ" or op=="LU_JUMPIFNOTLE" or op=="LU_JUMPIFNOTLT" then
        local rb=b1(auxv); local l=R[ins.a+1]; local r=R[rb+1]; local yes=false
        if op=="LU_JUMPIFEQ" then yes=(l==r) elseif op=="LU_JUMPIFLE" then yes=(l<=r) elseif op=="LU_JUMPIFLT" then yes=(l<r) elseif op=="LU_JUMPIFNOTEQ" then yes=(l~=r) elseif op=="LU_JUMPIFNOTLE" then yes=not(l<=r) else yes=not(l<r) end
        if yes then nextpc=pc+1+ins.d+1 end
      elseif op=="LU_JUMPXEQKNIL" then local yes=(R[ins.a+1]==nil); if bit32.band(auxv,0x80000000)~=0 then yes=not yes end; if yes then nextpc=pc+1+ins.d+1 end
      elseif op=="LU_JUMPXEQKB" then local yes=(R[ins.a+1]==(bit32.band(auxv,1)~=0)); if bit32.band(auxv,0x80000000)~=0 then yes=not yes end; if yes then nextpc=pc+1+ins.d+1 end
      elseif op=="LU_JUMPXEQKN" or op=="LU_JUMPXEQKS" then local yes=(R[ins.a+1]==getConst(proto,bit32.band(auxv,0xffffff))); if bit32.band(auxv,0x80000000)~=0 then yes=not yes end; if yes then nextpc=pc+1+ins.d+1 end
      elseif op=="LU_FORNPREP" then
        local init=R[ins.a+3] or 0; local limit=R[ins.a+1] or 0; local step=R[ins.a+2] or 1
        if (step>0 and init>limit) or (step<0 and init<limit) then nextpc=pc+1+ins.d else R[ins.a+3]=init end
      elseif op=="LU_FORNLOOP" then
        local idx=(R[ins.a+3] or 0)+(R[ins.a+2] or 1); local limit=R[ins.a+1] or 0; local step=R[ins.a+2] or 1
        if (step>0 and idx<=limit) or (step<0 and idx>=limit) then R[ins.a+3]=idx; nextpc=pc+1+ins.d end
      elseif op=="LU_FORGPREP" or op=="LU_FORGPREP_INEXT" or op=="LU_FORGPREP_NEXT" then nextpc=pc+1+ins.d
      elseif op=="LU_FORGLOOP" then
        local gen=R[ins.a+1]; local state=R[ins.a+2]; local index=R[ins.a+3]; local res=invoke(gen,{n=2,[1]=state,[2]=index},"pc="..pc..",op="..tostring(op));
        local first=res[1]; if first==nil then else R[ins.a+3]=first; local nvars=bit32.band(auxv,255); for j=1,nvars do R[ins.a+3+j]=res[j] end; nextpc=pc+1+ins.d+1 end
      elseif op=="LU_CMPPROTO" then local f=R[ins.a+1]; local meta=CLOSURES[f]; local yes=(meta and meta.proto==FNS[(auxv or 0)+1]); if not yes then nextpc=pc+1+ins.d+1 end
      else error("8XMS: unsupported lifted opcode "..tostring(op)) end
      if nextpc==pc then
        -- no-op self transition is valid, especially for stateful loops
      end
      local nextToken=(proto.state.pcState and proto.state.pcState[nextpc+1]) or 0
      if nextToken==0 then error("8XMS: runtime fault",0) end
      epoch=(epoch+1)%4294967296
      state=stateEncode(nextToken,epoch,proto)
    end
  end

  local entry=FNS[MAIN+1]
  local main=closure(entry,{})
  local result=invoke(main,{n=0})
  ${entry ? (returnResults ? 'return unpack(result,1,result.n)' : 'return') : ''}
end
`;
  for(const [name,tag] of Object.entries(tags)) runtime=runtime.replaceAll(`"${name}"`,String(tag));
  runtime=runtime.replaceAll('ISA.order','ISA.order_legacy_disabled');
  if(runtime.includes('LU_')) throw new Error('internal VM emitter failed to hide logical opcode names');
  return runtime.replace(/\n\s*\n/g,'\n').trim();
}
