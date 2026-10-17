local Step = require("catph.step")
local Parser = require("catph.parser")
local Enums = require("catph.enums")

local HexPrelude = Step:extend()
HexPrelude.Name = "HexPrelude"
HexPrelude.Description = "Native anti-tamper gate prepended BEFORE payload (no loadstring: nothing plaintext to log; strings encrypted + names minified by later steps; per-build randomized)."
HexPrelude.SettingsDescriptor = {
    Source = {
        type = "string";
        default = "";
        description = "Custom gate source (plain code). Empty = built-in check (randomized per build).";
    };
}

function HexPrelude:init() end

local HEADER = [[
local _flag = false
local _pcall = pcall
local _eq = rawequal or function(a, b) return a == b end
]]

local B_GETFENV = [[
if type(getfenv) == "function" then
    local _okA, _eA = _pcall(getfenv, 1)
    local _okB, _eB = _pcall(getfenv, 1)
    if _okA and _okB then
        if type(_eA) ~= "table" or type(_eB) ~= "table" then _flag = true
        elseif not _eq(_eA, _eB) then _flag = true
        elseif _eA.rawget ~= nil and not _eq(_eA.rawget, rawget) then _flag = true end
    end
end
]]

local B_PROXY = [[
if not _flag and type(newproxy) == "function" and type(getmetatable) == "function" then
    local _ok, _bad = _pcall(function()
        local _ok1, _u1 = _pcall(newproxy, true)
        local _ok2, _u2 = _pcall(newproxy, true)
        if (not _ok1) or (not _ok2) then return false end
        if type(_u1) ~= "userdata" or type(_u2) ~= "userdata" then return true end
        local _m1 = getmetatable(_u1)
        local _m2 = getmetatable(_u2)
        if type(_m1) ~= "table" or type(_m2) ~= "table" then return true end
        if _eq(_m1, _m2) then return true end
        _m1.__metatable = "L"
        if getmetatable(_u1) ~= "L" then return true end
        return false
    end)
    if (not _ok) or _bad then _flag = true end
end
]]

local B_META = [[
if not _flag then
    local _ok, _bad = _pcall(function()
        local _hits = 0
        local _pr = setmetatable({}, {
            __index = function(t, k) _hits = _hits + 1 return 7 end,
            __newindex = function(t, k, v) _hits = _hits + 10 rawset(t, k, v) end,
        })
        if _pr.foo ~= 7 then return true end
        if _hits ~= 1 then return true end
        if rawget(_pr, "bar") ~= nil then return true end
        if _hits ~= 1 then return true end
        rawset(_pr, "z", 1)
        if _hits ~= 1 then return true end
        _pr.z = 2
        if _hits ~= 1 then return true end
        _pr.nk = 5
        if _hits ~= 11 then return true end
        if rawget(_pr, "nk") ~= 5 then return true end
        return false
    end)
    if (not _ok) or _bad then _flag = true end
end
]]

local B_DEBUG = [[
if not _flag and type(debug) == "table" and type(debug.info) == "function" then
    local _ok, _bad = _pcall(function()
        local _okP, _srcP = _pcall(debug.info, pcall, "s")
        if _okP and type(_srcP) == "string" and _srcP ~= "[C]" then return true end
        local _probe = function() end
        local _okL, _srcL = _pcall(debug.info, _probe, "s")
        if _okL and type(_srcL) == "string" and _srcL == "[C]" then return true end
        return false
    end)
    if (not _ok) or _bad then _flag = true end
end
]]

local B_TIMING = [[
if not _flag then
    local _clk = (type(os) == "table" and os.clock) or tick or time
    if type(_clk) == "function" then
        local _ok, _bad = _pcall(function()
            local _N = __TN__
            local _plain = { k = 1 }
            local _meta = setmetatable({}, { __index = function(t, k) return 1 end })
            local _s = 0
            local _t0 = _clk()
            for _i = 1, _N do _s = _s + rawget(_plain, "k") end
            local _tRaw = _clk() - _t0
            local _t1 = _clk()
            for _i = 1, _N do _s = _s + _meta.k end
            local _tMeta = _clk() - _t1
            if _s ~= _N * 2 then return true end
            if _tMeta > _tRaw * __TMULT__ + __TFLOOR__ then return true end
            return false
        end)
        if (not _ok) or _bad then _flag = true end
    end
end
]]

local TAIL = [[
if _flag then
    error("Tamper detected", 0)
end
if _flag then
    local _sn = 0
    while true do
        _sn = _sn + 1
        _pcall(function()
            local _gg = game
            if _gg == nil and type(_G) == "table" then _gg = rawget(_G, "game") end
            if type(_gg) == "table" or type(_gg) == "userdata" then
                local _names = { __SVCS__ }
                local _m = _gg.GetService
                if type(_m) == "function" then
                    local _s = _m(_gg, _names[(_sn % 6) + 1])
                    if _s ~= nil then
                        local _gc = _s.GetChildren
                        if type(_gc) == "function" then _gc(_s) end
                    end
                end
            end
        end)
        if _sn % __WAITEVERY__ == 0 then
            _pcall(function()
                if type(task) == "table" and type(task.wait) == "function" then task.wait(0.05) end
            end)
        end
        if _sn % __BEATEVERY__ == 0 then
            _pcall(function()
                local _bl = "replicating snapshot __HEART__ " .. string.rep("0123456789abcdef", 250)
                if io and io.stderr then io.stderr:write(_bl .. "\n") else print(_bl) end
            end)
        end
    end
end
]]

local function randAlnum(n, lower)
    local ab = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    local r = {}
    for i = 1, n do local k = math.random(1, #ab) r[i] = ab:sub(k, k) end
    local s = table.concat(r)
    if lower then s = s:lower() end
    return s
end

function HexPrelude:apply(ast, pipeline)
    local src = self.Source or ""
    if src == "" then
        local blocks = { B_GETFENV, B_PROXY, B_META, B_DEBUG, B_TIMING }
        for i = #blocks, 2, -1 do
            local j = math.random(1, i)
            blocks[i], blocks[j] = blocks[j], blocks[i]
        end
        local timing = B_TIMING:gsub("__TN__", tostring(math.random(1500, 2500)))
            :gsub("__TMULT__", tostring(math.random(12, 30)))
            :gsub("__TFLOOR__", string.format("%.2f", math.random(3, 10) / 100))
        for i, b in ipairs(blocks) do
            if b == B_TIMING then blocks[i] = timing break end
        end
        local svcs = { "\"Players\"", "\"Workspace\"", "\"ReplicatedStorage\"", "\"Lighting\"", "\"SoundService\"", "\"HttpService\"" }
        for i = #svcs, 2, -1 do
            local j = math.random(1, i)
            svcs[i], svcs[j] = svcs[j], svcs[i]
        end
        local tail = TAIL:gsub("__HEART__", randAlnum(6, true))
            :gsub("__SVCS__", table.concat(svcs, ", "))
            :gsub("__WAITEVERY__", tostring(math.random(150, 300)))
            :gsub("__BEATEVERY__", tostring(math.random(1500, 3000)))
        src = "do\n" .. HEADER .. table.concat(blocks, "\n") .. "\n" .. tail .. "end"
    end
    local ok, parsed = pcall(function()
        return Parser:new({ LuaVersion = Enums.LuaVersion.LuaU }):parse(src)
    end)
    if not ok or not parsed then return ast end
    if parsed.body.scope then
        parsed.body.scope:setParent(ast.body.scope)
    end
    local stmts = parsed.body.statements
    if not stmts or #stmts == 0 then return ast end
    for i = #stmts, 1, -1 do
        stmts[i].__catphAntiTamper = true
        table.insert(ast.body.statements, 1, stmts[i])
    end
    return ast
end

return HexPrelude
