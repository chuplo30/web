

package.path = "./?.lua;" .. package.path
local Reader = require("catph.luauc.reader")

local Remap = require("catph.luauc.remap")

local infile, outfile = arg[1], arg[2]
local data = assert(io.open(infile, "rb")):read("*a")
math.randomseed(os.time() + (tonumber((tostring({}):match("0x(%x+)")) or 0) or 0))
local bc = Reader.parse(data)
Remap.apply(bc) 
Remap.encryptCode(bc) 
bc.b85 = true 

local buf = {}
local function w(s) buf[#buf + 1] = s end

local function serString(s) return string.format("%q", s) end
local function serNumber(n)
    if n ~= n then return "(0/0)" end
    if n == math.huge then return "(1/0)" end
    if n == -math.huge then return "(-1/0)" end
    if math.floor(n) == n and math.abs(n) < 2 ^ 53 then
        return string.format("%d", n)
    end
    return string.format("%.17g", n)
end

local function serConst(k)
    if k.tag == "nil" then return "{tag='nil'}"
    elseif k.tag == "boolean" then return "{tag='boolean',value=" .. tostring(k.value) .. "}"
    elseif k.tag == "number" then return "{tag='number',value=" .. serNumber(k.value) .. "}"
    elseif k.tag == "string" then return "{tag='string',value=" .. serString(k.value) .. "}"
    elseif k.tag == "import" then return "{tag='import',value=" .. serNumber(k.value) .. "}"
    elseif k.tag == "closure" then return "{tag='closure',proto=" .. k.proto .. "}"
    elseif k.tag == "table" then return "{tag='table',keys={" .. table.concat(k.keys, ",") .. "}}"
    elseif k.tag == "table_wc" then
        local parts = {}
        for _, e in ipairs(k.entries) do parts[#parts + 1] = "{key=" .. e.key .. ",const=" .. e.const .. "}" end
        return "{tag='table_wc',entries={" .. table.concat(parts, ",") .. "}}"
    elseif k.tag == "class_shape" then return "{tag='class_shape'}"
    elseif k.tag == "vector" then
        return string.format("{tag='vector',x=%s,y=%s,z=%s,w=%s}", serNumber(k.x), serNumber(k.y), serNumber(k.z), serNumber(k.w))
    end
    error("serConst: unknown tag " .. tostring(k.tag))
end

w("local bc = {mainid=" .. bc.mainid .. ",")
if bc.opmap then
    local parts = {}
    for k, v in pairs(bc.opmap) do parts[#parts + 1] = "[" .. k .. "]=" .. v end
    w("opmap={" .. table.concat(parts, ",") .. "},")
end
w("protos={")
for _, p in ipairs(bc.protos) do
    w("{maxstacksize=" .. p.maxstacksize .. ",numparams=" .. p.numparams
        .. ",nups=" .. p.nups .. ",is_vararg=" .. p.is_vararg .. ",")
    w("code={" .. table.concat(p.code, ",") .. "},")
    w("k={")
    for _, k in ipairs(p.k) do w(serConst(k) .. ",") end
    w("},")
    w("p={" .. table.concat(p.p, ",") .. "},")
    w("},")
end
w("}}\n")

local bcLiteral = table.concat(buf)

local interpSrc = assert(io.open("catph/luauc/interp.lua", "r")):read("*a")

local out = {}
out[#out + 1] = bcLiteral
out[#out + 1] = "local makeInterp = (function()\n" .. interpSrc .. "\nend)()\n"
out[#out + 1] = "local entry = makeInterp()\n"
out[#out + 1] = "return entry(bc, _G, ...)\n"

local f = assert(io.open(outfile, "w"))
f:write(table.concat(out))
f:close()
print("emitted " .. outfile)
