








local Reader = {}


local K_NIL, K_BOOLEAN, K_NUMBER, K_STRING, K_IMPORT, K_TABLE, K_CLOSURE, K_VECTOR =
    0, 1, 2, 3, 4, 5, 6, 7





local function cursor(data)
    return { data = data, pos = 1, len = #data }
end

local function u8(c)
    local b = string.byte(c.data, c.pos)
    if not b then error("luauc.reader: unexpected end of stream at " .. c.pos) end
    c.pos = c.pos + 1
    return b
end


local function varint(c)
    local result = 0
    local shift = 1 
    while true do
        local b = u8(c)
        result = result + (b % 128) * shift
        if b < 128 then break end
        shift = shift * 128
    end
    return result
end

local function u32(c)
    local b0, b1, b2, b3 = string.byte(c.data, c.pos, c.pos + 3)
    c.pos = c.pos + 4
    return b0 + b1 * 256 + b2 * 65536 + b3 * 16777216
end

local function i32(c)
    local v = u32(c)
    if v >= 2147483648 then v = v - 4294967296 end
    return v
end


local function decodeDouble(c)
    local b1, b2, b3, b4, b5, b6, b7, b8 = string.byte(c.data, c.pos, c.pos + 7)
    c.pos = c.pos + 8
    local sign = (b8 >= 128) and -1 or 1
    local exp = (b8 % 128) * 16 + math.floor(b7 / 16)
    local mant = (b7 % 16) * 2 ^ 48 + b6 * 2 ^ 40 + b5 * 2 ^ 32
        + b4 * 2 ^ 24 + b3 * 2 ^ 16 + b2 * 2 ^ 8 + b1
    if exp == 0 then
        if mant == 0 then return sign * 0.0 end
        return sign * mant * 2 ^ -1074
    elseif exp == 2047 then
        if mant == 0 then return sign * math.huge end
        return 0 / 0
    end
    return sign * (1 + mant / 2 ^ 52) * 2 ^ (exp - 1023)
end

local function decodeFloat(c)
    local b1, b2, b3, b4 = string.byte(c.data, c.pos, c.pos + 3)
    c.pos = c.pos + 4
    local sign = (b4 >= 128) and -1 or 1
    local exp = (b4 % 128) * 2 + math.floor(b3 / 128)
    local mant = (b3 % 128) * 2 ^ 16 + b2 * 2 ^ 8 + b1
    if exp == 0 then
        if mant == 0 then return sign * 0.0 end
        return sign * mant * 2 ^ -149
    elseif exp == 255 then
        if mant == 0 then return sign * math.huge end
        return 0 / 0
    end
    return sign * (1 + mant / 2 ^ 23) * 2 ^ (exp - 127)
end





local function readStringRef(c, strings)
    local id = varint(c)
    if id == 0 then return nil end
    return strings[id]
end

local function readConstant(c, strings)
    local tag = u8(c)
    if tag == K_NIL then
        return { tag = "nil" }
    elseif tag == K_BOOLEAN then
        return { tag = "boolean", value = u8(c) ~= 0 }
    elseif tag == K_NUMBER then
        return { tag = "number", value = decodeDouble(c) }
    elseif tag == K_STRING then
        return { tag = "string", id = (function() local p = c.pos; local v = varint(c); return v end)(), value = nil }
    elseif tag == K_IMPORT then
        return { tag = "import", value = u32(c) }
    elseif tag == K_TABLE then
        local n = varint(c)
        local keys = {}
        for i = 1, n do keys[i] = varint(c) end
        return { tag = "table", keys = keys }
    elseif tag == K_CLOSURE then
        return { tag = "closure", proto = varint(c) }
    elseif tag == K_VECTOR then
        return { tag = "vector", x = decodeFloat(c), y = decodeFloat(c), z = decodeFloat(c), w = decodeFloat(c) }
    elseif tag == 8 then 
        local n = varint(c)
        local entries = {}
        for i = 1, n do
            local key = varint(c)
            local const = i32(c)
            entries[i] = { key = key, const = const }
        end
        return { tag = "table_wc", entries = entries }
    elseif tag == 9 then 
        varint(c) 
        local nprops = varint(c)
        local nmethods = varint(c)
        for i = 1, nprops + nmethods do varint(c) end
        return { tag = "class_shape" }
    elseif tag == 10 then 
        local neg = u8(c)
        local mag = varint(c)
        return { tag = "number", value = (neg ~= 0) and -mag or mag }
    else
        error(string.format("luauc.reader: unsupported constant tag %d at %d", tag, c.pos))
    end
end

local function readProto(c, strings, version)
    local p = {}
    p.maxstacksize = u8(c)
    p.numparams = u8(c)
    p.nups = u8(c)
    p.is_vararg = u8(c)
    if version >= 4 then
        p.flags = u8(c)
        local typesize = varint(c)
        if typesize > 0 then
            p.typeinfo = string.sub(c.data, c.pos, c.pos + typesize - 1)
            c.pos = c.pos + typesize
        end
    end

    local sizecode = varint(c)
    p.code = {}
    for i = 1, sizecode do p.code[i] = u32(c) end

    local sizek = varint(c)
    p.k = {}
    for i = 1, sizek do p.k[i] = readConstant(c, strings) end

    local sizep = varint(c)
    p.p = {}
    for i = 1, sizep do p.p[i] = varint(c) end

    p.linedefined = varint(c)
    p.debugname = readStringRef(c, strings)

    p.lineinfo = nil
    if u8(c) ~= 0 then
        
        local linegaplog2 = u8(c)
        local intervals = math.floor((sizecode - 1) / (2 ^ linegaplog2)) + 1
        local absoffset = sizecode 
        c.pos = c.pos + sizecode               
        
        c.pos = c.pos + ((4 - (c.pos - 1) % 4) % 4)
        c.pos = c.pos + intervals * 4          
        p.hasLineInfo = true
    end

    if u8(c) ~= 0 then
        
        local nlocals = varint(c)
        for i = 1, nlocals do
            varint(c)               
            varint(c)               
            varint(c)               
            u8(c)                   
        end
        local nupvals = varint(c)
        for i = 1, nupvals do varint(c) end 
        p.hasDebugInfo = true
    end

    if version >= 11 then
        local feedbackvecsize = varint(c)
        for i = 1, feedbackvecsize do
            u8(c)        
            varint(c)    
        end
        p.feedbackvecsize = feedbackvecsize
    end

    return p
end


local function resolveStrings(proto, strings)
    for _, k in ipairs(proto.k) do
        if k.tag == "string" then k.value = strings[k.id] end
    end
end

function Reader.parse(data)
    local c = cursor(data)
    local bc = {}
    bc.version = u8(c)
    if bc.version == 0 then
        error("luauc.reader: blob is a compilation error: " .. string.sub(c.data, c.pos))
    end
    bc.typesversion = (bc.version >= 4) and u8(c) or 0

    local stringCount = varint(c)
    bc.strings = {}
    for i = 1, stringCount do
        local len = varint(c)
        bc.strings[i] = string.sub(c.data, c.pos, c.pos + len - 1)
        c.pos = c.pos + len
    end

    
    if bc.typesversion == 3 then
        local index = u8(c)
        while index ~= 0 do
            varint(c) 
            index = u8(c)
        end
    end

    local protoCount = varint(c)
    bc.protos = {}
    for i = 1, protoCount do
        bc.protos[i] = readProto(c, bc.strings, bc.version)
        resolveStrings(bc.protos[i], bc.strings)
    end

    bc.mainid = varint(c)
    bc.consumed = c.pos - 1
    bc.total = c.len
    return bc
end

return Reader
