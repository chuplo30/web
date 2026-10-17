local Step     = require("catph.step")
local Ast      = require("catph.ast")
local Parser   = require("catph.parser")

local ChecksumChunk = Step:extend()
ChecksumChunk.Name = "ChecksumChunk"
ChecksumChunk.Description = "Injects a self-verifying checksum block at the end of the output chunk."
ChecksumChunk.SettingsDescriptor = {}

local function exprs(v)
    local p = 7
    while true do
        local idx = math.floor(p + v % 11)
        local q = idx * 3 + 5
        local s = v - p * q
        if s >= 0 and s < 10000000 then
            return string.format("(%d*%d+%d)", p, q, s)
        end
        p = p + 3
    end
end

local function charExpr(s)
    local bytes = {}
    for i = 1, #s do
        bytes[#bytes+1] = tostring(string.byte(s, i))
    end
    return "string.char(" .. table.concat(bytes, ",") .. ")"
end

local function modPow2(x)
    local m = 4294967296
    return x - math.floor(x / m) * m
end

local MASK = 0x55AA55AA

function ChecksumChunk:init(settings)
end

function ChecksumChunk:apply(ast, pipeline)
    if pipeline.PrettyPrint then
        return ast
    end

    local vals = {}
    for i = 1, 6 do
        vals[i] = math.random(0x1000000, 0xFFFFFFF)
    end

    local function mod32(x) return x % 4294967296 end

    local sum = 0
    local weights = { 31, 131, 821, 2719, 9419, 30449 }
    for i = 1, 6 do
        sum = mod32(sum + mod32(vals[i] * weights[i]))
    end

    local payload = modPow2((sum - MASK) + 4294967296)

    local expected = modPow2(MASK + payload)

    local lines = {
        "do",
        "    local c_1 = " .. exprs(vals[1]),
        "    local c_2 = " .. exprs(vals[2]),
        "    local c_3 = " .. exprs(vals[3]),
        "    local c_4 = " .. exprs(vals[4]),
        "    local c_5 = " .. exprs(vals[5]),
        "    local c_6 = " .. exprs(vals[6]),
        "    local _acc = 0",
        "    _acc = (_acc + c_1 * 31) % 4294967296",
        "    _acc = (_acc + c_2 * 131) % 4294967296",
        "    _acc = (_acc + c_3 * 821) % 4294967296",
        "    _acc = (_acc + c_4 * 2719) % 4294967296",
        "    _acc = (_acc + c_5 * 9419) % 4294967296",
        "    _acc = (_acc + c_6 * 30449) % 4294967296",
        "    if _acc ~= " .. tostring(expected) .. " then error(" .. charExpr("\194\180\194\191\194\180 Catph is looking at you") .. ", 0) end",
        "end",
    }
    local code = table.concat(lines, "\n")

    local parser = Parser:new({ LuaVersion = "LuaU" })
    local parsed = parser:parse(code)

    local checksumBlock = Ast.DoStatement(parsed.body)
    checksumBlock.__catphChecksum = true

    table.insert(ast.body.statements, 1, checksumBlock)

    return ast
end

return ChecksumChunk