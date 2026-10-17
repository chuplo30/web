












local floor  = math.floor
local random = math.random

local Emit = {}



local _NX = {}   
for _a = 0, 15 do
    for _b = 0, 15 do
        local r, a2, b2, m = 0, _a, _b, 1
        for _ = 1, 4 do
            local ab, bb = a2 % 2, b2 % 2
            if ab ~= bb then r = r + m end
            a2 = (a2 - ab) / 2; b2 = (b2 - bb) / 2; m = m * 2
        end
        _NX[_a * 16 + _b] = r
    end
end

local function xor32(a, b)
    if a == b then return 0 end
    local r, m = 0, 1
    for _ = 1, 8 do          
        local an, bn = a % 16, b % 16
        r = r + _NX[an * 16 + bn] * m
        a = (a - an) / 16; b = (b - bn) / 16; m = m * 16
    end
    return r
end


local B85 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^"


local function encodeWords(words, xorKey)
    local out = {}
    for _, v in ipairs(words) do
        local w = (xorKey ~= 0) and xor32(v, xorKey) or v
        
        local c5 = w % 85; w = floor(w / 85)
        local c4 = w % 85; w = floor(w / 85)
        local c3 = w % 85; w = floor(w / 85)
        local c2 = w % 85; w = floor(w / 85)
        local c1 = w % 85
        out[#out+1] = B85:sub(c1+1,c1+1) .. B85:sub(c2+1,c2+1) .. B85:sub(c3+1,c3+1)
                   .. B85:sub(c4+1,c4+1) .. B85:sub(c5+1,c5+1)
    end
    return table.concat(out)
end


local function escapeStr(s)
    if s == nil then return "nil" end
    local t = {}
    for i = 1, #s do
        local b = string.byte(s, i)
        if     b == 10 then t[#t+1] = "\\n"
        elseif b == 13 then t[#t+1] = "\\r"
        elseif b ==  0 then t[#t+1] = "\\0"
        elseif b == 34 then t[#t+1] = "\\\""
        elseif b == 92 then t[#t+1] = "\\\\"
        else                t[#t+1] = string.char(b) end
    end
    return '"' .. table.concat(t) .. '"'
end


local function serConst(k)
    if     k.tag == "nil" then
        return "nil"
    elseif k.tag == "bool" then
        return k.value and "true" or "false"
    elseif k.tag == "number" then
        local v = k.value
        if v ~= v then return "(0/0)"          
        elseif v ==  math.huge then return  "math.huge"
        elseif v == -math.huge then return "-math.huge"
        elseif v == floor(v) and v >= -2^53 and v <= 2^53 then
            return string.format("%d", v)
        else
            return string.format("%.17g", v)
        end
    elseif k.tag == "string" then
        return escapeStr(k.value)
    end
    error("emit: unknown constant tag: " .. tostring(k.tag))
end





local function serProto(proto, xorKey)
    local codeB85 = encodeWords(proto.code, xorKey)

    local kParts = {}
    for _, k in ipairs(proto.k) do
        kParts[#kParts+1] = serConst(k)
    end

    local cpParts = {}
    for _, cp in ipairs(proto.protos) do
        cpParts[#cpParts+1] = serProto(cp, xorKey)
    end

    return "{"
        .. tostring(proto.maxstacksize) .. ","
        .. tostring(proto.numparams)    .. ","
        .. tostring(proto.nups)         .. ","
        .. tostring(proto.is_vararg)    .. ","
        .. escapeStr(codeB85)           .. ","
        .. "{" .. table.concat(kParts,  ",") .. "},"
        .. "{" .. table.concat(cpParts, ",") .. "}"
        .. "}"
end








function Emit.build(proto, interpSrc, xorKey)
    xorKey = xorKey or 0

    local protosLit = serProto(proto, xorKey)
    local xkLit     = string.format("0x%08X", xorKey)

    
    return "-- RieX LuaC VM\nreturn (function()\n"
        .. interpSrc
        .. "\nreturn makeVM({"
        .. protosLit
        .. "},1,"
        .. xkLit
        .. ")\nend)()\n"
end

return Emit
