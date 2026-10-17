



















local Emit = {}

local function serString(s) return string.format("%q", s) end






local function serBytes(s)
    local out = {}
    for i = 1, #s do out[i] = string.format("\\%03d", string.byte(s, i)) end
    return '"' .. table.concat(out) .. '"'
end

local function serNumber(n)
    if n ~= n then return "(0/0)" end
    if n == math.huge then return "(1/0)" end
    if n == -math.huge then return "(-1/0)" end
    if math.floor(n) == n and math.abs(n) < 2 ^ 53 then
        return string.format("%.0f", n)
    end
    return string.format("%.17g", n)
end




local function numericLiteral(n)
    if n ~= n or n == math.huge or n == -math.huge then return nil end
    if math.floor(n) == n and math.abs(n) < 2 ^ 53 then
        return string.format("%.0f", n)
    end
    return string.format("%.17g", n)
end



local function constCipherKeys(bkey, bstep)
    local ckey = bkey % 256
    local cstep = (bstep % 255) + 1
    local cstep2 = (math.floor(bkey / 256) % 255) + 1
    return ckey, cstep, cstep2
end





local function encryptConstStr(s, pos, ckey, cstep, cstep2)
    local base = (ckey + pos * cstep) % 256
    local out = {}
    for j = 1, #s do
        local key = (base + j * cstep2) % 256
        out[j] = string.char((string.byte(s, j) + key) % 256)
    end
    return table.concat(out)
end




local function serKVMaybeEnc(k, pos, enc, ckey, cstep, cstep2)
    if enc and k.tag == "string" then
        return serBytes(encryptConstStr(k.value, pos, ckey, cstep, cstep2))
    elseif enc and k.tag == "number" then
        local lit = numericLiteral(k.value)
        if lit then
            return serBytes(encryptConstStr(lit, pos, ckey, cstep, cstep2))
        end
    end
    return nil
end


local B85 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^"

local function encodeCode(words)
    local bytes = {}
    for i = 1, #words do
        local w = words[i]
        bytes[#bytes + 1] = w % 256
        bytes[#bytes + 1] = math.floor(w / 256) % 256
        bytes[#bytes + 1] = math.floor(w / 65536) % 256
        bytes[#bytes + 1] = math.floor(w / 16777216) % 256
    end
    local out = {}
    local n = #bytes
    local i = 1
    while i <= n do
        local b1 = bytes[i] or 0
        local b2 = bytes[i + 1] or 0
        local b3 = bytes[i + 2] or 0
        local b4 = bytes[i + 3] or 0
        local v = ((b1 * 256 + b2) * 256 + b3) * 256 + b4
        local c5 = v % 85; v = (v - c5) / 85
        local c4 = v % 85; v = (v - c4) / 85
        local c3 = v % 85; v = (v - c3) / 85
        local c2 = v % 85; v = (v - c2) / 85
        local c1 = v % 85
        local group = n - i + 1; if group > 4 then group = 4 end
        local digits = { c1, c2, c3, c4, c5 }
        for k = 1, group + 1 do out[#out + 1] = string.sub(B85, digits[k] + 1, digits[k] + 1) end
        i = i + 4
    end
    return table.concat(out)
end


local TAG_NIL     = 0
local TAG_BOOL    = 1
local TAG_NUMBER  = 2
local TAG_STRING  = 3
local TAG_IMPORT  = 4
local TAG_TABLE   = 5
local TAG_CLOSURE = 6
local TAG_VECTOR  = 7
local TAG_TABLE_WC= 8

local function tagOf(k)
    if k.tag == "nil"      then return TAG_NIL
    elseif k.tag == "boolean" then return TAG_BOOL
    elseif k.tag == "number"  then return TAG_NUMBER
    elseif k.tag == "string"  then return TAG_STRING
    elseif k.tag == "import"  then return TAG_IMPORT
    elseif k.tag == "table"   then return TAG_TABLE
    elseif k.tag == "closure" then return TAG_CLOSURE
    elseif k.tag == "vector"  then return TAG_VECTOR
    elseif k.tag == "table_wc" then return TAG_TABLE_WC
    else error("emit: unknown tag " .. tostring(k.tag)) end
end



local function serKV(k)
    if k.tag == "nil"     then return "nil"
    elseif k.tag == "boolean" then return tostring(k.value)
    elseif k.tag == "number"  then return serNumber(k.value)
    elseif k.tag == "string"  then return serString(k.value)
    elseif k.tag == "import"  then return serNumber(k.value)
    elseif k.tag == "closure" then return tostring(k.proto)
    
    else return "nil" end
end



local function serKRaw(k)
    if k.tag == "table" then
        return "{5,{" .. table.concat(k.keys, ",") .. "}}"
    elseif k.tag == "table_wc" then
        local parts = {}
        for _, e in ipairs(k.entries) do parts[#parts + 1] = "{" .. e.key .. "," .. e.const .. "}" end
        return "{8,{" .. table.concat(parts, ",") .. "}}"
    elseif k.tag == "vector" then
        return "{7," .. serNumber(k.x) .. "," .. serNumber(k.y) .. "," .. serNumber(k.z) .. "," .. serNumber(k.w) .. "}"
    end
    return nil
end



function Emit.serializeBC(bc, koff)
    koff = koff or 0
    
    
    
    
    local enc = bc.bkey ~= nil
    local ckey, cstep, cstep2
    if enc then ckey, cstep, cstep2 = constCipherKeys(bc.bkey, bc.bstep) end
    local buf = {}
    local function w(s) buf[#buf + 1] = s end
    w("{" .. bc.mainid .. ",{")
    for _, p in ipairs(bc.protos) do
        w("{" .. p.maxstacksize .. "," .. p.numparams .. "," .. p.nups .. "," .. p.is_vararg .. ",")
        
        if bc.b85 then
            w(serString(encodeCode(p.code)) .. ",")
        else
            w("{" .. table.concat(p.code, ",") .. "},")
        end
        
        w("{")
        for _ = 1, koff do w("nil,") end
        for ci, k in ipairs(p.k) do
            local s = serKVMaybeEnc(k, koff + ci, enc, ckey, cstep, cstep2)
            w((s or serKV(k)) .. ",")
        end
        w("},")
        
        w("{" .. table.concat(p.p, ",") .. "},")
        
        w("{")
        for _ = 1, koff do w("0,") end
        for _, k in ipairs(p.k) do w(tagOf(k) .. ",") end
        w("},")
        
        w("{")
        local hasRaw = false
        for i, k in ipairs(p.k) do
            local raw = serKRaw(k)
            if raw then
                w("[" .. (i + koff) .. "]=" .. raw .. ",")
                hasRaw = true
            end
        end
        w("}},")
    end
    w("},")
    if bc.nonce then
        w(string.format("%.0f", bc.nonce))
    else
        if bc.opmap then
            local parts = {}
            for k, v in pairs(bc.opmap) do parts[#parts + 1] = "[" .. k .. "]=" .. v end
            w("{" .. table.concat(parts, ",") .. "},")
        else
            w("nil,")
        end
        w((bc.bkey and string.format("%.0f", bc.bkey) or "nil") .. ",")
        w((bc.bstep and string.format("%.0f", bc.bstep) or "nil"))
    end
    w("}")
    return table.concat(buf)
end







function Emit.build(bc, interpSrc, bootstrapEnv, koff)
    local out = {}
    out[#out + 1] = "local bc = " .. Emit.serializeBC(bc, koff) .. "\n"
    out[#out + 1] = "local makeInterp = (function()\n" .. interpSrc .. "\nend)()\n"
    
    
    local envExpr = bootstrapEnv or "(getfenv and getfenv() or _G)"
    out[#out + 1] = "return (makeInterp())(bc, " .. envExpr .. ", ...)\n"
    return table.concat(out)
end

return Emit
