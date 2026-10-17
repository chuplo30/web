



local ISA = require("catph.customvm.isa")
local OP = ISA.OP

local Serializer = {}

local B85 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^"
local b85map = {}
for i = 1, #B85 do b85map[string.byte(B85, i)] = i - 1 end

local floor = math.floor
local schar = string.char
local sbyte = string.byte

local FLAG_STREAM   = 2
local FLAG_ENCSTR   = 4
local HEADER_LEN    = 8


local function derivePerm(nonce)
    local s = nonce % 2147483647; if s == 0 then s = 1 end
    local ids = {}
    for i = 0, 255 do ids[i + 1] = i end
    for i = 256, 2, -1 do
        s = (s * 16807) % 2147483647
        local j = (s % i) + 1
        ids[i], ids[j] = ids[j], ids[i]
    end
    local perm, inv = {}, {}
    for c = 0, 255 do
        local scrambled = ids[c + 1]
        perm[c] = scrambled
        inv[scrambled] = c
    end
    return perm, inv
end


local MAXOP = 200





local function kdf(nonce, domain)
    
    
    local h = nonce % 2147483647
    if h == 0 then h = 1 end
    for i = 1, #domain do
        local db = string.byte(domain, i)
        
        h = (h * 48271 + db * 16807) % 2147483647
        if h == 0 then h = 1 end
        
        h = (h * 16807 + db * 48271 + i * 31337) % 2147483647
        if h == 0 then h = 1 end
    end
    
    h = (h * 16807 + 7) % 2147483647
    h = (h * 48271 + 13) % 2147483647
    return h
end

local function deriveAliases(nonce)
    local s = kdf(nonce, "aliases"); if s == 0 then s = 1 end
    local pool = {}
    for i = 0, 255 do pool[i + 1] = i end
    for i = 256, 2, -1 do
        s = (s * 16807) % 2147483647
        local j = (s % i) + 1
        pool[i], pool[j] = pool[j], pool[i]
    end
    local aliasesOf, byteToCanon = {}, {}
    for c = 0, MAXOP do aliasesOf[c] = {} end
    local pi = 1
    for c = 0, MAXOP do
        
        
        local b = pool[pi]; pi = pi + 1
        aliasesOf[c][#aliasesOf[c] + 1] = b
        byteToCanon[b] = c
    end
    while pi <= 256 do
        s = (s * 16807) % 2147483647
        local c = s % (MAXOP + 1)
        local b = pool[pi]; pi = pi + 1
        aliasesOf[c][#aliasesOf[c] + 1] = b
        byteToCanon[b] = c
    end
    return aliasesOf, byteToCanon
end

local function deriveStreamKeys(nonce)
    local h = kdf(nonce, "stream")
    local base = h % 256
    h = (h * 48271 + 1) % 2147483647
    local step = (h % 255) + 1
    return base, step
end

local function deriveStringKeys(nonce)
    local h = kdf(nonce, "strings")
    local k1 = h % 256
    h = (h * 65521 + 1) % 2147483647
    local k2 = (h % 255) + 1
    return k1, k2
end

local function deriveRekeyParams(nonce)
    local h = kdf(nonce, "rekey")
    local seed = h % 256
    h = (h * 48271 + 1) % 2147483647
    local step = (h % 128) * 2 + 1  
    return seed, step
end

local function deriveBlindKey(nonce)
    local h = kdf(nonce, "blind")
    
    return (h % 65535) + 1
end

local function deriveRekeyParams(nonce)
    local t = (nonce * 65521 + 7919) % 2147483647
    t = (t * 65521) % 2147483647; local seed = t % 256
    t = (t * 65521) % 2147483647; local step = (t % 128) * 2 + 1  
    return seed, step
end


local function bxor8(a, b)
    local r, p = 0, 1
    for _ = 1, 8 do
        local ab, bb = a % 2, b % 2
        if ab ~= bb then r = r + p end
        a = (a - ab) / 2; b = (b - bb) / 2; p = p * 2
    end
    return r
end



local function keystreamSeed(salt, enc)
    return (salt * 65521 + enc.sk1 * 40503 + enc.sk2 * 997 + 12345) % 2147483647
end

local function keystreamNext(state)
    return (state * 48271) % 2147483647
end

local function newWriter() return { b = {}, n = 0 } end
local function w8(W, byte) W.n = W.n + 1; W.b[W.n] = byte % 256 end

local function wVarU(W, x)
    x = floor(x)
    repeat
        local byte = x % 128
        x = floor(x / 128)
        if x > 0 then byte = byte + 128 end
        w8(W, byte)
    until x == 0
end

local function wVarI(W, x)
    x = floor(x)
    wVarU(W, x >= 0 and (x * 2) or (-x * 2 - 1))
end

local function newReader(bytes) return { b = bytes, i = 1 } end
local function r8(R) local v = R.b[R.i]; R.i = R.i + 1; return v end

local function rVarU(R)
    local x, shift = 0, 1
    while true do
        local byte = r8(R)
        x = x + (byte % 128) * shift
        if byte < 128 then break end
        shift = shift * 128
    end
    return x
end

local function rVarI(R)
    local zz = rVarU(R)
    if zz % 2 == 0 then return zz / 2 else return -(zz + 1) / 2 end
end



local function b85encode(bytes)
    local out, oi = {}, 0
    for i = 1, #bytes, 4 do
        local v = ((bytes[i] * 256 + bytes[i + 1]) * 256 + bytes[i + 2]) * 256 + bytes[i + 3]
        local c5 = v % 85; v = (v - c5) / 85
        local c4 = v % 85; v = (v - c4) / 85
        local c3 = v % 85; v = (v - c3) / 85
        local c2 = v % 85; v = (v - c2) / 85
        local c1 = v % 85
        oi = oi + 1
        out[oi] = B85:sub(c1 + 1, c1 + 1) .. B85:sub(c2 + 1, c2 + 1) .. B85:sub(c3 + 1, c3 + 1)
            .. B85:sub(c4 + 1, c4 + 1) .. B85:sub(c5 + 1, c5 + 1)
    end
    return table.concat(out)
end

local function b85decode(s)
    local bytes, bi = {}, 0
    for i = 1, #s, 5 do
        local v = (((b85map[sbyte(s, i)] * 85 + b85map[sbyte(s, i + 1)]) * 85
            + b85map[sbyte(s, i + 2)]) * 85 + b85map[sbyte(s, i + 3)]) * 85 + b85map[sbyte(s, i + 4)]
        bytes[bi + 1] = floor(v / 16777216) % 256
        bytes[bi + 2] = floor(v / 65536) % 256
        bytes[bi + 3] = floor(v / 256) % 256
        bytes[bi + 4] = v % 256
        bi = bi + 4
    end
    return bytes
end



local function numericLiteral(n)
    if floor(n) == n and math.abs(n) < 2 ^ 53 then
        return string.format("%.0f", n)
    end
    return string.format("%.17g", n)
end

local function writeConst(W, v, enc)
    local t = type(v)
    if v == nil then w8(W, 0)
    elseif v == false then w8(W, 1)
    elseif v == true then w8(W, 2)
    elseif t == "number" then
        if v ~= v then w8(W, 5); w8(W, 2)
        elseif v == math.huge then w8(W, 5); w8(W, 0)
        elseif v == -math.huge then w8(W, 5); w8(W, 1)
        else
            w8(W, 3)
            local s = numericLiteral(v)
            if enc.encStrings then
                local salt = math.random(0, 255)
                w8(W, salt)
                wVarU(W, #s)
                local st = keystreamSeed(salt, enc)
                for j = 1, #s do
                    st = keystreamNext(st)
                    w8(W, (sbyte(s, j) + (st % 256)) % 256)
                end
            else
                wVarU(W, #s)
                for i = 1, #s do w8(W, sbyte(s, i)) end
            end
        end
    elseif t == "string" then
        w8(W, 4)
        if enc.encStrings then
            local salt = math.random(0, 255)
            w8(W, salt)
            wVarU(W, #v)
            local st = keystreamSeed(salt, enc)
            for j = 1, #v do
                st = keystreamNext(st)
                w8(W, (sbyte(v, j) + (st % 256)) % 256)
            end
        else
            wVarU(W, #v)
            for j = 1, #v do w8(W, sbyte(v, j)) end
        end
    else
        error("customvm serializer: unsupported constant type " .. t)
    end
end

local function readConst(R, enc)
    local tag = r8(R)
    if tag == 0 then return nil
    elseif tag == 1 then return false
    elseif tag == 2 then return true
    elseif tag == 3 then
        if enc.encStrings then
            local salt = r8(R)
            local len = rVarU(R)
            local t = {}
            local st = keystreamSeed(salt, enc)
            for j = 1, len do
                st = keystreamNext(st)
                t[j] = schar((r8(R) - (st % 256)) % 256)
            end
            return tonumber(table.concat(t))
        else
            local len = rVarU(R)
            local t = {}
            for i = 1, len do t[i] = schar(r8(R)) end
            return tonumber(table.concat(t))
        end
    elseif tag == 4 then
        if enc.encStrings then
            local salt = r8(R)
            local len = rVarU(R)
            local t = {}
            local st = keystreamSeed(salt, enc)
            for j = 1, len do
                st = keystreamNext(st)
                t[j] = schar((r8(R) - (st % 256)) % 256)
            end
            return table.concat(t)
        else
            local len = rVarU(R)
            local t = {}
            for i = 1, len do t[i] = schar(r8(R)) end
            return table.concat(t)
        end
    elseif tag == 5 then
        local s = r8(R)
        if s == 0 then return math.huge elseif s == 1 then return -math.huge else return 0 / 0 end
    end
    error("customvm serializer: bad constant tag " .. tostring(tag))
end



local K_REF_K = {
    [OP.LOADK]=true, [OP.GETGLOBAL]=true, [OP.SETGLOBAL]=true,
    [OP.GETTABLEKS]=true, [OP.SETTABLEKS]=true, [OP.NAMECALL]=true,
    [OP.LOADK2]=true, [OP.LOADK3]=true,
    [OP.GETGLOBAL2]=true, [OP.GETGLOBAL3]=true, [OP.GETGLOBAL4]=true,
    [OP.SETGLOBAL2]=true, [OP.SETGLOBAL3]=true,
    [OP.GETTABLEKS2]=true, [OP.SETTABLEKS2]=true,
    [OP.NAMECALL2]=true, [OP.NAMECALL3]=true,
    [OP.GETGLOB_CALL]=true, [OP.LOADK_CALL]=true,
    [OP.GETGLOB_MOVE]=true, [OP.MOVE_SETGLOB]=true,
}
local K_REF_C = {
    [OP.GETTKS_MOVE]=true, [OP.LOADK_MOVE]=true,
}

local function protoUsedConsts(code)
    local used = {}
    for i = 1, #code do
        local ins = code[i]
        if ins then
            if K_REF_K[ins.op] and ins.k then used[ins.k] = true end
            if K_REF_C[ins.op] and ins.c and ins.c > 0 then used[ins.c] = true end
        end
    end
    return used
end

local function writeProto(W, p, enc)
    wVarU(W, p.numparams or 0)
    w8(W, p.isvararg and 1 or 0)
    wVarU(W, p.maxstack or 0)

    local used = protoUsedConsts(p.code)
    wVarU(W, #p.k)
    for i = 1, #p.k do
        local v = p.k[i]
        if type(v) == "string" and not used[i] then v = nil end
        writeConst(W, v, enc)
    end

    wVarU(W, #p.code)
    local rkMask = enc.rkSeed or 0
    local rkStep = enc.rkStep or 1
    for i = 1, #p.code do
        local ins = p.code[i]
        local opByte
        if enc.aliasesOf then
            local al = enc.aliasesOf[ins.op]
            opByte = al[math.random(1, #al)]   
        else
            opByte = ins.op
        end
        
        opByte = bxor8(opByte, rkMask)
        rkMask = bxor8(rkMask, rkStep)
        w8(W, opByte)
        local fields = { ins.a or 0, ins.b or 0, ins.c or 0, ins.k or 0 }
        
        if ins.op == OP.LOADN and enc.blindKey then
            fields[2] = fields[2] + enc.blindKey
        end
        local fo = enc.fieldOrder and enc.fieldOrder[ins.op] or {1,2,3,4}
        wVarI(W, fields[fo[1]])
        wVarI(W, fields[fo[2]])
        wVarI(W, fields[fo[3]])
        wVarI(W, fields[fo[4]])
        if ins.op == OP.NEWCLOSURE or ins.op == OP.NEWCLOSURE2 then
            local caps = ins.captures
            wVarU(W, #caps)
            for j = 1, #caps do
                w8(W, caps[j].type)
                wVarI(W, caps[j].idx)
            end
        end
    end

    wVarU(W, #p.protos)
    for i = 1, #p.protos do writeProto(W, p.protos[i], enc) end
end

local function readProto(R, enc)
    local p = {}
    p.numparams = rVarU(R)
    p.isvararg = r8(R) == 1
    p.maxstack = rVarU(R)

    local nk = rVarU(R)
    p.k = {}
    for i = 1, nk do p.k[i] = readConst(R, enc) end

    local nc = rVarU(R)
    p.code = {}
    local rkMask = enc.rkSeed or 0
    local rkStep = enc.rkStep or 1
    for i = 1, nc do
        local raw = r8(R)
        
        raw = bxor8(raw, rkMask)
        rkMask = bxor8(rkMask, rkStep)
        local op = enc.byteToCanon and enc.byteToCanon[raw] or raw
        local v1, v2, v3, v4 = rVarI(R), rVarI(R), rVarI(R), rVarI(R)
        local fo = enc.fieldOrder and enc.fieldOrder[op]
        local fields = {0, 0, 0, 0}
        if fo then
            fields[fo[1]] = v1; fields[fo[2]] = v2; fields[fo[3]] = v3; fields[fo[4]] = v4
        else
            fields[1], fields[2], fields[3], fields[4] = v1, v2, v3, v4
        end
        local ins = { op = op, a = fields[1], b = fields[2], c = fields[3], k = fields[4] }
        if op == OP.NEWCLOSURE or op == OP.NEWCLOSURE2 then
            local ncap = rVarU(R)
            local caps = {}
            for j = 1, ncap do caps[j] = { type = r8(R), idx = rVarI(R) } end
            ins.captures = caps
        end
        p.code[i] = ins
    end

    local np = rVarU(R)
    p.protos = {}
    for i = 1, np do p.protos[i] = readProto(R, enc) end
    return p
end


local function deriveFieldOrder(nonce)
    local s = kdf(nonce, "fieldorder")
    local order = {}
    for op = 0, MAXOP do
        local perm = {1, 2, 3, 4}
        for i = 4, 2, -1 do
            s = (s * 16807) % 2147483647
            local j = (s % i) + 1
            perm[i], perm[j] = perm[j], perm[i]
        end
        order[op] = perm
    end
    return order
end

function Serializer.serialize(proto, opts)
    opts = opts or {}
    local nonce = opts.nonce or math.random(1, 2147483646)
    local stream   = opts.streamCipher ~= false
    local encStr   = opts.encryptStrings ~= false

    local enc = { encStrings = encStr }
    
    
    if encStr then enc.sk1, enc.sk2 = deriveStringKeys(nonce) end
    enc.blindKey = deriveBlindKey(nonce)
    enc.rkSeed, enc.rkStep = deriveRekeyParams(nonce)
    local Wp = newWriter()
    writeProto(Wp, proto, enc)

    if stream then
        local base, step = deriveStreamKeys(nonce)
        local function bxor(a, b)
            local r, p = 0, 1
            for _ = 1, 8 do
                local ab, bb = a % 2, b % 2
                if ab ~= bb then r = r + p end
                a = (a - ab) / 2; b = (b - bb) / 2; p = p * 2
            end
            return r
        end
        local key = base
        for i = 1, Wp.n do
            Wp.b[i] = bxor(Wp.b[i], key)
            key = (key + step) % 256
        end
    end

    local flags = (stream and FLAG_STREAM or 0)
        + (encStr and FLAG_ENCSTR or 0)

    local W = newWriter()
    w8(W, 0x43); w8(W, 0x56); w8(W, 0x01); w8(W, flags)
    w8(W, nonce % 256); w8(W, floor(nonce / 256) % 256)
    w8(W, floor(nonce / 65536) % 256); w8(W, floor(nonce / 16777216) % 256)
    for i = 1, Wp.n do w8(W, Wp.b[i]) end

    local L = W.n
    local final = {}
    final[1] = L % 256
    final[2] = floor(L / 256) % 256
    final[3] = floor(L / 65536) % 256
    final[4] = floor(L / 16777216) % 256
    for i = 1, L do final[4 + i] = W.b[i] end
    while #final % 4 ~= 0 do final[#final + 1] = 0 end
    return b85encode(final)
end

function Serializer.deserialize(str)
    local bytes = b85decode(str)
    local L = bytes[1] + bytes[2] * 256 + bytes[3] * 65536 + bytes[4] * 16777216
    local payload = {}
    for i = 1, L do payload[i] = bytes[4 + i] end

    assert(payload[1] == 0x43 and payload[2] == 0x56, "customvm serializer: bad magic")
    local flags = payload[4]
    local nonce = payload[5] + payload[6] * 256 + payload[7] * 65536 + payload[8] * 16777216

    local stream   = floor(flags / 2) % 2 >= 1
    local encStr   = floor(flags / 4) % 2 >= 1

    if stream then
        local base, step = deriveStreamKeys(nonce)
        local function bxor(a, b)
            local r, p = 0, 1
            for _ = 1, 8 do
                local ab, bb = a % 2, b % 2
                if ab ~= bb then r = r + p end
                a = (a - ab) / 2; b = (b - bb) / 2; p = p * 2
            end
            return r
        end
        local key = base
        for i = HEADER_LEN + 1, L do
            payload[i] = bxor(payload[i], key)
            key = (key + step) % 256
        end
    end

    local enc = { encStrings = encStr }
    
    if encStr then enc.sk1, enc.sk2 = deriveStringKeys(nonce) end
    enc.rkSeed, enc.rkStep = deriveRekeyParams(nonce)

    local R = newReader(payload)
    R.i = HEADER_LEN + 1
    return readProto(R, enc)
end

Serializer.deriveAliases = deriveAliases
Serializer.deriveFieldOrder = deriveFieldOrder
Serializer.deriveRekeyParams = deriveRekeyParams
Serializer.deriveBlindKey = deriveBlindKey
Serializer.deriveStreamKeys = deriveStreamKeys
Serializer.kdf = kdf

return Serializer
