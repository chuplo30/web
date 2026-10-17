










local Step      = require("catph.step")
local Parser    = require("catph.parser")
local Enums     = require("catph.enums")
local Compiler  = require("catph.customvm.compiler")
local ISA       = require("catph.customvm.isa")
local logger    = require("logger")

local OP = ISA.OP

local IronBrew2VM = Step:extend()
IronBrew2VM.Name = "IronBrew2VM"
IronBrew2VM.Description = "IronBrew2-style VM: XOR-encrypted binary bytecode, virtual opcode shuffle, mutation dispatcher."

function IronBrew2VM:init() end

IronBrew2VM.SettingsDescriptor = {
    XorKey = {
        type    = "number",
        default = 0,
        description = "Fixed XOR key 1-254 (0 = random per build).",
    },
    Mutate = {
        type    = "boolean",
        default = true,
        description = "Pick random handler variant per opcode each build (mutation).",
    },
}



local floor  = math.floor
local schar  = string.char
local sbyte  = string.byte
local sfmt   = string.format

local function shuffle(t)
    for i = #t, 2, -1 do
        local j = math.random(1, i)
        t[i], t[j] = t[j], t[i]
    end
    return t
end

local _AZ = {}
for c in ("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"):gmatch(".") do
    _AZ[#_AZ+1] = c
end

local function rname(used)
    local name
    repeat
        local len = math.random(2, 5)
        local t   = { "_" }
        for _ = 1, len do t[#t+1] = _AZ[math.random(1, #_AZ)] end
        name = table.concat(t)
    until not used[name]
    used[name] = true
    return name
end


local function escapeBin(s)
    local t = {}
    for i = 1, #s do
        t[i] = "\\" .. sbyte(s, i)
    end
    return table.concat(t)
end



local CT_NIL    = 0
local CT_BOOL   = 1
local CT_NUMBER = 2
local CT_STRING = 3

local function writeI32(buf, v, xk)
    v = v % (2^32)
    buf[#buf+1] = schar( (v               % 256) ~ xk )
    buf[#buf+1] = schar( (floor(v/256)    % 256) ~ xk )
    buf[#buf+1] = schar( (floor(v/65536)  % 256) ~ xk )
    buf[#buf+1] = schar( (floor(v/16777216)%256) ~ xk )
end

local function writeU8(buf, v, xk)
    buf[#buf+1] = schar( (v % 256) ~ xk )
end

local function writeF64(buf, v, xk)
    local raw
    if string.pack then
        raw = string.pack("<d", v)
    else
        
        raw = "\0\0\0\0\0\0\0\0"
    end
    for i = 1, 8 do
        buf[#buf+1] = schar( sbyte(raw, i) ~ xk )
    end
end

local function writeStr(buf, s, xk)
    
    writeI32(buf, #s, 0)
    for i = 1, #s do
        buf[#buf+1] = schar( sbyte(s, i) ~ xk )
    end
end



local function serProto(proto, buf, xk, opVmap)
    writeU8(buf, proto.numparams or 0, xk)
    writeU8(buf, proto.isvararg and 1 or 0, xk)

    local k = proto.k or {}
    writeI32(buf, #k, xk)
    for _, v in ipairs(k) do
        local tv = type(v)
        if v == nil or tv == "nil" then
            writeU8(buf, CT_NIL, xk)
        elseif tv == "boolean" then
            writeU8(buf, CT_BOOL, xk)
            writeU8(buf, v and 1 or 0, xk)
        elseif tv == "number" then
            writeU8(buf, CT_NUMBER, xk)
            writeF64(buf, v, xk)
        else
            writeU8(buf, CT_STRING, xk)
            writeStr(buf, tostring(v), xk)
        end
    end

    local code = proto.code or {}
    writeI32(buf, #code, xk)
    for _, ins in ipairs(code) do
        local vop = opVmap[ins.op] or ins.op
        writeU8(buf, vop % 256, xk)
        writeU8(buf, (ins.a or 0) % 256, xk)
        
        local bv = ins.b or 0
        if bv < 0 then bv = bv + 65536 end
        writeU8(buf, bv % 256, xk)
        writeU8(buf, floor(bv / 256) % 256, xk)
        writeU8(buf, (ins.c or 0) % 256, xk)
        
        local kv = ins.k or 0
        writeU8(buf, kv % 256, xk)
        writeU8(buf, floor(kv / 256) % 256, xk)
    end

    local ups = proto.upvals or {}
    writeU8(buf, #ups % 256, xk)

    local subs = proto.protos or {}
    writeI32(buf, #subs, xk)
    for _, sub in ipairs(subs) do
        serProto(sub, buf, xk, opVmap)
    end
end



local function buildOpMaps()
    local reals = {}
    for _, v in pairs(OP) do reals[#reals+1] = v end
    local pool  = {}
    for i, v in ipairs(reals) do pool[i] = v end
    shuffle(pool)
    local vmap = {}  
    local inv  = {}  
    for i, real in ipairs(reals) do
        vmap[real] = pool[i]
        inv[pool[i]] = real
    end
    return vmap, inv
end






local function makeHandlers(invMap, R, K, IP, Top, VA, NVA, Env, Ups, A, B, C, KI, mutate)
    

    local function pick(...)
        local vs = {...}
        if mutate then return vs[math.random(1, #vs)]
        else return vs[1] end
    end

    local handlers = {}  

    local function h(realOp, ...)
        local virt = invMap[realOp]
        if not virt then return end
        handlers[virt] = pick(...)
    end

    
    h(OP.LOADK,
        sfmt("%s[%s]=%s[%s]", R,A, K,KI),
        sfmt("local _v=%s[%s];%s[%s]=_v", K,KI, R,A))

    
    h(OP.LOADNIL,
        sfmt("%s[%s]=nil", R,A))

    
    h(OP.LOADB,
        sfmt("%s[%s]=%s~=0", R,A, B),
        sfmt("if %s~=0 then %s[%s]=true else %s[%s]=false end", B,R,A,R,A))

    
    h(OP.LOADN,
        sfmt("%s[%s]=%s", R,A, B),
        sfmt("local _n=%s;%s[%s]=_n", B, R,A))

    
    h(OP.MOVE,
        sfmt("%s[%s]=%s[%s]", R,A, R,B),
        sfmt("local _m=%s[%s];%s[%s]=_m", R,B, R,A))

    
    h(OP.GETGLOBAL,
        sfmt("%s[%s]=%s[%s[%s]]", R,A, Env,K,KI),
        sfmt("local _k=%s[%s];%s[%s]=%s[_k]", K,KI, R,A, Env))

    
    h(OP.SETGLOBAL,
        sfmt("%s[%s[%s]]=%s[%s]", Env,K,KI, R,A),
        sfmt("local _k=%s[%s];%s[_k]=%s[%s]", K,KI, Env, R,A))

    
    h(OP.GETUPVAL,
        sfmt("%s[%s]=%s[%s+1]", R,A, Ups,B))

    
    h(OP.SETUPVAL,
        sfmt("%s[%s+1]=%s[%s]", Ups,B, R,A))

    
    h(OP.GETTABLE,
        sfmt("%s[%s]=%s[%s][%s[%s]]", R,A, R,B, R,C),
        sfmt("local _t=%s[%s];%s[%s]=_t[%s[%s]]", R,B, R,A, R,C))

    
    h(OP.SETTABLE,
        sfmt("%s[%s][%s[%s]]=%s[%s]", R,B, R,C, R,A),
        sfmt("local _t=%s[%s];_t[%s[%s]]=%s[%s]", R,B, R,C, R,A))

    
    h(OP.GETTABLEKS,
        sfmt("%s[%s]=%s[%s][%s[%s]]", R,A, R,B, K,KI),
        sfmt("local _k=%s[%s];%s[%s]=%s[%s][_k]", K,KI, R,A, R,B))

    
    h(OP.SETTABLEKS,
        sfmt("%s[%s][%s[%s]]=%s[%s]", R,B, K,KI, R,A),
        sfmt("local _k=%s[%s];%s[%s][_k]=%s[%s]", K,KI, R,B, R,A))

    
    h(OP.GETTABLEN,
        sfmt("%s[%s]=%s[%s][%s]", R,A, R,B, C))

    
    h(OP.SETTABLEN,
        sfmt("%s[%s][%s]=%s[%s]", R,B, C, R,A))

    
    h(OP.ADD,
        sfmt("%s[%s]=%s[%s]+%s[%s]", R,A, R,B, R,C),
        sfmt("local _x,_y=%s[%s],%s[%s];%s[%s]=_x+_y", R,B, R,C, R,A))
    h(OP.SUB,
        sfmt("%s[%s]=%s[%s]-%s[%s]", R,A, R,B, R,C),
        sfmt("local _x=%s[%s];%s[%s]=_x-%s[%s]", R,B, R,A, R,C))
    h(OP.MUL,
        sfmt("%s[%s]=%s[%s]*%s[%s]", R,A, R,B, R,C),
        sfmt("local _x=%s[%s];%s[%s]=_x*%s[%s]", R,B, R,A, R,C))
    h(OP.DIV,
        sfmt("%s[%s]=%s[%s]/%s[%s]", R,A, R,B, R,C))
    h(OP.MOD,
        sfmt("%s[%s]=%s[%s]%%%s[%s]", R,A, R,B, R,C))
    h(OP.POW,
        sfmt("%s[%s]=%s[%s]^%s[%s]", R,A, R,B, R,C))
    h(OP.IDIV,
        sfmt("%s[%s]=math.floor(%s[%s]/%s[%s])", R,A, R,B, R,C),
        sfmt("local _q=%s[%s]/%s[%s];%s[%s]=math.floor(_q)", R,B, R,C, R,A))

    
    h(OP.ADDMOVE,
        sfmt("%s[%s]=%s[%s]+%s[%s]", R,A, R,B, R,C))
    h(OP.MOVE_ADD,
        sfmt("%s[%s]=%s[%s]+%s[%s]", R,A, R,B, R,C))
    h(OP.GETTKS_MOVE,
        sfmt("%s[%s]=%s[%s][%s[%s]]", R,A, R,B, K,KI))
    h(OP.LOADK_MOVE,
        sfmt("%s[%s]=%s[%s]", R,A, K,KI))

    
    h(OP.NOT,
        sfmt("%s[%s]=not %s[%s]", R,A, R,B),
        sfmt("if %s[%s] then %s[%s]=false else %s[%s]=true end", R,B, R,A, R,A))
    h(OP.MINUS,
        sfmt("%s[%s]=-%s[%s]", R,A, R,B),
        sfmt("local _v=%s[%s];%s[%s]=-_v", R,B, R,A))
    h(OP.LENGTH,
        sfmt("%s[%s]=#%s[%s]", R,A, R,B),
        sfmt("local _s=%s[%s];%s[%s]=#_s", R,B, R,A))

    
    h(OP.CONCAT,
        sfmt("local _s=%s[%s];for _i=%s+1,%s do _s=_s..%s[_i] end;%s[%s]=_s", R,B, B,C, R, R,A),
        sfmt("do local _r={};for _i=%s,%s do _r[#_r+1]=%s[_i] end;%s[%s]=table.concat(_r) end", B,C, R, R,A))

    
    h(OP.NEWTABLE,
        sfmt("%s[%s]={}", R,A))

    
    h(OP.SETLIST,
        sfmt("local _t=%s[%s];for _i=0,%s-1 do _t[%s+_i]=%s[%s+_i] end", R,A, B, C, R,A))

    
    h(OP.JUMP,      sfmt("%s=%s+%s", IP,IP, B))
    h(OP.JUMPBACK,  sfmt("%s=%s+%s", IP,IP, B))
    h(OP.JUMPIF,
        sfmt("if %s[%s] then %s=%s+%s end", R,A, IP,IP, B))
    h(OP.JUMPIFNOT,
        sfmt("if not %s[%s] then %s=%s+%s end", R,A, IP,IP, B))
    h(OP.JUMPIFEQ,
        sfmt("if %s[%s]==%s[%s] then %s=%s+%s end", R,A, R,C, IP,IP, B))
    h(OP.JUMPIFLE,
        sfmt("if %s[%s]<=%s[%s] then %s=%s+%s end", R,A, R,C, IP,IP, B))
    h(OP.JUMPIFLT,
        sfmt("if %s[%s]<%s[%s] then %s=%s+%s end", R,A, R,C, IP,IP, B))
    h(OP.JUMPIFNOTEQ,
        sfmt("if %s[%s]~=%s[%s] then %s=%s+%s end", R,A, R,C, IP,IP, B))
    h(OP.JUMPIFNOTLE,
        sfmt("if %s[%s]>%s[%s] then %s=%s+%s end", R,A, R,C, IP,IP, B))
    h(OP.JUMPIFNOTLT,
        sfmt("if %s[%s]>=%s[%s] then %s=%s+%s end", R,A, R,C, IP,IP, B))

    
    h(OP.FORNPREP,
        sfmt(
            "if (%s[%s]>0 and %s[%s+2]>%s[%s+1]) or"..
            "(%s[%s]<0 and %s[%s+2]<%s[%s+1]) then %s=%s+%s end",
            R,A, R,A, R,A,
            R,A, R,A, R,A,
            IP,IP, B))
    h(OP.FORNLOOP,
        sfmt(
            "%s[%s+1]=%s[%s+1]+%s[%s];"..
            "if (%s[%s]>0 and %s[%s+1]<=%s[%s+2]) or"..
            "(%s[%s]<0 and %s[%s+1]>=%s[%s+2]) then"..
            " %s[%s]=%s[%s+1];%s=%s+%s end",
            R,A, R,A, R,A,
            R,A, R,A, R,A,
            R,A, R,A, R,A,
            R,A, R,A, IP,IP, B))

    
    h(OP.FORGLOOP,
        sfmt(
            "local _r={%s[%s](%s[%s+1],%s[%s+2])};"..
            "if _r[1]==nil then %s=%s+%s "..
            "else for _i=1,%s do %s[%s+2+_i]=_r[_i] end end",
            R,A, R,A, R,A,
            IP,IP, B,
            C, R,A))

    
    h(OP.CALL,
        sfmt(
            "do local _fn=%s[%s];local _args={};"..
            "local _nb=%s-1;"..
            "if _nb<0 then for _i=%s+1,%s do _args[#_args+1]=%s[_i] end "..
            "else for _i=1,_nb do _args[#_args+1]=%s[%s+_i] end end;"..
            "local _ret={_fn(table.unpack(_args))};"..
            "local _nc=%s-1;"..
            "if _nc<0 then %s=%s+#_ret-1;for _i=1,#_ret do %s[%s+_i-1]=_ret[_i] end "..
            "else for _i=1,_nc do %s[%s+_i-1]=_ret[_i] end end end",
            R,A, B, A,Top, R,  R,A,
            C, Top,A, R,A,  R,A))

    
    h(OP.NAMECALL,
        sfmt(
            "do local _obj=%s[%s];local _mt=_obj[%s[%s]];"..
            "local _args={_obj};local _nb=%s-1;"..
            "for _i=1,_nb do _args[#_args+1]=%s[%s+_i] end;"..
            "local _ret={_mt(table.unpack(_args))};"..
            "local _nc=%s-1;"..
            "if _nc<0 then %s=%s+#_ret-1;for _i=1,#_ret do %s[%s+_i-1]=_ret[_i] end "..
            "else for _i=1,_nc do %s[%s+_i-1]=_ret[_i] end end end",
            R,A, K,KI,
            B, R,A,
            C, Top,A, R,A,  R,A))

    
    h(OP.RETURN,
        sfmt(
            "do local _nb=%s-1;"..
            "if _nb<0 then local _r={};for _i=%s,%s do _r[#_r+1]=%s[_i] end;return table.unpack(_r) "..
            "elseif _nb==0 then return "..
            "else local _r={};for _i=%s,%s+_nb-1 do _r[#_r+1]=%s[_i] end;return table.unpack(_r) end end",
            B, A,Top,R,  A,A,R))

    
    h(OP.NEWCLOSURE,
        sfmt(
            "do local _sub=Protos[%s+1];"..
            "local _ups={};"..
            "for _ui=1,#(_sub.upvals or {}) do "..
            "  local _uv=_sub.upvals[_ui];"..
            "  if _uv and _uv.kind=='local' then _ups[_ui]=%s[_uv.index] "..
            "  elseif _uv then _ups[_ui]=%s[_uv.index] end "..
            "end;"..
            "%s[%s]=IBWrap(_sub,%s,_ups) end",
            KI, R, Ups,  R,A, Env))

    
    h(OP.CLOSEUPVALS, "")

    
    h(OP.GETVARARGS,
        sfmt(
            "do local _w=%s-1;"..
            "if _w<0 then for _i=1,#%s do %s[%s+_i-1]=%s[_i] end;%s=%s+#%s-1 "..
            "else for _i=1,_w do %s[%s+_i-1]=%s[_i] end end end",
            B, VA, R,A, VA, Top,A, VA,
            R,A, VA))

    return handlers
end



local function buildBST(entries)
    if #entries == 0 then return "" end
    table.sort(entries, function(a, b) return a.op < b.op end)
    if #entries == 1 then
        return sfmt("if Op==%d then\n%s\nend", entries[1].op, entries[1].code)
    end
    local mid   = floor(#entries / 2) + 1
    local left  = {}
    local right = {}
    for i, e in ipairs(entries) do
        if     i < mid then left[#left+1]   = e
        elseif i > mid then right[#right+1] = e end
    end
    local pivot = entries[mid]
    local parts = {}
    parts[#parts+1] = sfmt("if Op<%d then", pivot.op)
    local lc = buildBST(left)
    if lc ~= "" then parts[#parts+1] = lc end
    parts[#parts+1] = sfmt("elseif Op==%d then", pivot.op)
    parts[#parts+1] = pivot.code
    if #right > 0 then
        parts[#parts+1] = "else"
        parts[#parts+1] = buildBST(right)
    end
    parts[#parts+1] = "end"
    return table.concat(parts, "\n")
end



local function generateVMSource(proto, xorKey, opVmap, invMap, mutate)
    local used = {}

    
    
    local R   = "Stk"        ; used["Stk"]         = true
    local K   = "Const"      ; used["Const"]        = true
    local IP  = "InstrPoint" ; used["InstrPoint"]   = true
    local Top = "Top"        ; used["Top"]           = true
    local VA  = "Vararg"     ; used["Vararg"]        = true
    local NVA = "Varargsz"   ; used["Varargsz"]      = true
    local Env = "Env"        ; used["Env"]           = true
    local Ups = "Lupvals"    ; used["Lupvals"]       = true
    used["Instr"] = true; used["Protos"] = true
    used["IBWrap"] = true; used["Op"] = true

    
    local vA  = "A";  used["A"]  = true
    local vB  = "B";  used["B"]  = true
    local vC  = "C";  used["C"]  = true
    local vKI = "KI"; used["KI"] = true

    
    local handlers = makeHandlers(invMap, R, K, IP, Top, VA, NVA, Env, Ups,
                                  vA, vB, vC, vKI, mutate)

    
    local entries = {}
    for virt, code in pairs(handlers) do
        if code and code ~= "" then
            entries[#entries+1] = { op = virt, code = code }
        end
    end
    local dispatch = buildBST(entries)

    
    local vBS   = rname(used)   
    local vXK   = rname(used)   
    local vPos  = rname(used)   
    local vRB   = rname(used)   
    local vRI   = rname(used)   
    local vRD   = rname(used)   
    local vRS   = rname(used)   
    local vDeser = rname(used)  
    local vWrap  = rname(used)  
    local vIns   = rname(used)  

    
    local buf = {}
    serProto(proto, buf, xorKey, opVmap)
    local rawStr = table.concat(buf)
    local encoded = escapeBin(rawStr)

    
    local o = {}
    local function emit(s) o[#o+1] = s end

    
    local vXOR = rname(used)
    emit(sfmt([[
 local %s=((type(bit32)=="table" and type(bit32.bxor)=="function" and bit32.bxor) or
           (type(bit)=="table" and type(bit.bxor)=="function" and bit.bxor) or function(_a,_b)
    local _p,_c=1,0
    while _a>0 and _b>0 do
        local _ra,_rb=_a%%2,_b%%2
        if _ra~=_rb then _c=_c+_p end
        _a,_b,_p=(_a-_ra)/2,(_b-_rb)/2,_p*2
    end
    if _a<_b then _a=_b end
    while _a>0 do
        local _ra=_a%%2
        if _ra>0 then _c=_c+_p end
        _a,_p=(_a-_ra)/2,_p*2
    end
    return _c
 end)]], vXOR))

    
    emit(sfmt('local %s="%s"', vBS, encoded))
    emit(sfmt('local %s=%d', vXK, xorKey))
    emit(sfmt('local %s=1', vPos))
    emit('local _Byte,_Sub,_Char,_Unpack,_Floor=string.byte,string.sub,string.char,table.unpack or unpack,math.floor')

    
    emit(sfmt([[
local function %s()
    local _b=_Byte(%s,%s,%s)
    %s=%s+1
    return %s(_b,%s)
end]], vRB, vBS, vPos, vPos, vPos, vPos, vXOR, vXK))

    
    emit(sfmt([[
local function %s()
    local _a,_b,_c,_d=_Byte(%s,%s,%s+3)
    %s=%s+4
    return %s(_d,%s)*16777216+%s(_c,%s)*65536+%s(_b,%s)*256+%s(_a,%s)
end]], vRI, vBS, vPos, vPos, vPos, vPos,
      vXOR,vXK, vXOR,vXK, vXOR,vXK, vXOR,vXK))

    
    emit(sfmt([[
local function %s()
    local _b1,_b2,_b3,_b4,_b5,_b6,_b7,_b8=_Byte(%s,%s,%s+7)
    %s=%s+8
    _b1=%s(_b1,%s);_b2=%s(_b2,%s);_b3=%s(_b3,%s);_b4=%s(_b4,%s)
    _b5=%s(_b5,%s);_b6=%s(_b6,%s);_b7=%s(_b7,%s);_b8=%s(_b8,%s)
    local _sign=_b8>=128 and -1 or 1
    local _exp=(_b8%%128)*16+_Floor(_b7/16)
    local _frac=(_b7%%16)*281474976710656+_b6*1099511627776+_b5*4294967296
               +_b4*16777216+_b3*65536+_b2*256+_b1
    if _exp==0 then return _sign*_frac*(2^(-1074))
    elseif _exp==2047 then return (_frac==0) and (_sign*(1/0)) or (0/0)
    else return _sign*(1+(_frac/(2^52)))*(2^(_exp-1023)) end
end]], vRD, vBS, vPos, vPos, vPos, vPos,
       vXOR,vXK, vXOR,vXK, vXOR,vXK, vXOR,vXK,
       vXOR,vXK, vXOR,vXK, vXOR,vXK, vXOR,vXK))

    
    emit(sfmt([[
local function %s()
    local _a,_b,_c,_d=_Byte(%s,%s,%s+3)
    %s=%s+4
    local _len=_d*16777216+_c*65536+_b*256+_a
    if _len==0 then return '' end
    local _t={}
    for _i=1,_len do
        local _cv=%s(_Byte(%s,%s,%s),%s)
        %s=%s+1
        _t[_i]=_Char(_cv)
    end
    return table.concat(_t)
end]], vRS, vBS, vPos, vPos, vPos, vPos,
      vXOR, vBS, vPos, vPos, vXK, vPos, vPos))

    
    emit(sfmt([[
local function %s()
    local _np=%s()
    local _va=%s()
    local _nk=%s()
    local _k={}
    for _ki=1,_nk do
        local _ty=%s()
        if _ty==0 then _k[_ki]=nil
        elseif _ty==1 then _k[_ki]=%s()~=0
        elseif _ty==2 then _k[_ki]=%s()
        else _k[_ki]=%s() end
    end
    local _nc=%s()
    local _code={}
    for _ci=1,_nc do
        local _op=%s()
        local _a=%s()
        local _bl=%s()
        local _bh=%s()
        local _bv=_bl+_bh*256
        if _bv>=32768 then _bv=_bv-65536 end
        local _c=%s()
        local _kl=%s()
        local _kh=%s()
        _code[_ci]={op=_op,a=_a,b=_bv,c=_c,k=_kl+_kh*256}
    end
    local _nup=%s()
    local _up={}
    for _ui=1,_nup do _up[_ui]={kind='upval',index=_ui} end
    local _nsub=%s()
    local _subs={}
    for _si=1,_nsub do _subs[_si]=%s() end
    return {numparams=_np,isvararg=_va~=0,k=_k,code=_code,upvals=_up,protos=_subs}
end
]], vDeser, vRB, vRB, vRI,
    vRB, vRB, vRD, vRS,
    vRI, vRB, vRB, vRB, vRB, vRB, vRB, vRB,
    vRB, vRI, vDeser))

    
    emit("local IBWrap")

    
    emit(sfmt([[
IBWrap = function(Proto, _Env, _Ups)
    local Instr  = Proto.code
    local Const  = Proto.k
    local Protos = Proto.protos
    local Params = Proto.numparams

    return function(...)
        local Stk      = {}
        local Top      = -1
        local Vararg   = {}
        local Varargsz = 0
        local Lupvals  = _Ups or {}
        local Env      = _Env

        local InstrPoint = 1
        local _Args = {...}
        local _PC   = select('#',...) - 1

        for _Idx=0,_PC do
            if _Idx >= Params then
                Varargsz = Varargsz + 1
                Vararg[Varargsz] = _Args[_Idx+1]
            else
                Stk[_Idx] = _Args[_Idx+1]
            end
        end

        local %s

        while true do
            %s = Instr[InstrPoint]
            InstrPoint = InstrPoint + 1
            local Op = %s.op
            local A  = %s.a
            local B  = %s.b
            local C  = %s.c
            local KI = %s.k
%s
        end
    end
end
]], vIns, vIns, vIns, vIns, vIns, vIns, vIns, dispatch))

    
    emit(sfmt([[
IBWrap(%s(),(getfenv and getfenv(0)) or _ENV,{})()
]], vDeser))

    return table.concat(o, "\n")
end



function IronBrew2VM:apply(ast, pipeline)
    local xorKey = self.XorKey
    if xorKey == 0 then xorKey = math.random(1, 254) end
    xorKey = xorKey % 256

    logger:info("IronBrew2VM: compiling AST to custom bytecode ...")
    local proto = Compiler.compile(ast)

    logger:info("IronBrew2VM: generating XOR key=" .. xorKey .. " and opcode shuffle ...")
    local opVmap, invMap = buildOpMaps()

    logger:info("IronBrew2VM: serialising encrypted bytecode ...")
    local code = generateVMSource(proto, xorKey, opVmap, invMap, self.Mutate)

    logger:info(sfmt("IronBrew2VM: emitted %d bytes of IronBrew2-style VM.", #code))

    local newAst = Parser:new({ LuaVersion = Enums.LuaVersion.LuaU }):parse(code)
    return newAst
end

return IronBrew2VM
