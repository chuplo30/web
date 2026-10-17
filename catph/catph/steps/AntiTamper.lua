


















local Step     = require("catph.step")
local Ast      = require("catph.ast")
local Enums    = require("catph.enums")
local Parser   = require("catph.parser")
local logger   = require("logger")

local AntiTamper = Step:extend()
AntiTamper.Name = "Anti Tamper"

AntiTamper.SettingsDescriptor = {}

function AntiTamper:init(settings)
end







local function xorKeyEncode(s, key)
    local t = {}
    for i = 1, #s do
        local ki = (key * ((i % 11) + 1) + i * 7 + (key % 31)) % 256
        t[i] = (string.byte(s, i) + ki) % 256
    end
    return t
end

local function bytesLiteral(t)
    return "{" .. table.concat(t, ",") .. "}"
end

local function emitDecoder(decodeVar, encodedBytes, key)
    return string.format(
        "local %s=(function()local _t=%s;local _k=%d;local _r={};" ..
        "for _i=1,#_t do " ..
        "local _ki=(_k*((_i%%11)+1)+_i*7+(_k%%31))%%256;" ..
        "_r[_i]=string.char((_t[_i]-_ki+512)%%256)" ..
        "end;return table.concat(_r)end)()",
        decodeVar, bytesLiteral(encodedBytes), key
    )
end

function AntiTamper:apply(ast, pipeline)
    if pipeline.PrettyPrint then
        logger:warn(string.format("\"%s\" cannot be used with PrettyPrint, ignoring.", self.Name))
        return ast
    end

    
    local keyMarker = math.random(1, 200)
    local keyErr    = math.random(1, 200)
    local keyEPfx   = math.random(1, 200)

    
    local encMarker = xorKeyEncode("Catph:1: Expected ')' (to close '(' at column 23013), got '...'", keyMarker)
    local encErr    = xorKeyEncode("Catph:attempt to index a nil value / invalid upvalue index", keyErr)
    local encEPfx   = xorKeyEncode("Catph:1: Expected ')' (to close '(' at column 23013), got '...'", keyEPfx)

    local decMarkerStmt = emitDecoder("_AT1_MARKER", encMarker, keyMarker)
    local decErrStmt    = emitDecoder("_errMsg",     encErr,    keyErr)
    local decEPfxStmt   = emitDecoder("_eMsgPfx",   encEPfx,   keyEPfx)

    
    
    local code = string.format([[
do
    local _sx_type        = type
    local _sx_pcall       = pcall
    local _sx_error       = error
    local _sx_find        = string.find
    local _sx_tostring    = tostring
    local _sx_math_random = math.random
    local _sx_unpack      = table.unpack or unpack
    local _sx_char        = string.char
    local _sx_byte        = string.byte
    local _sx_concat      = table.concat

    local function _sx_crash()
        -- Pure CPU spin. Never grows memory: the old `_t = {_t}` nested-table
        -- growth OOM'd / stack-overflowed on some executors and was reported
        -- as "attempt to ... a nil value", confusing clean tamper-blocking with
        -- a VM bug. A bounded spin still denies the dumper without misreporting.
        local _k = 0
        while true do _k = _k + 1 end
    end

    -- LAYER 1: Roblox environment + pcall marker probe
    %s
    local function _at1_probe(fn)
        local _ok, _e = _sx_pcall(fn)
        if _sx_type(_e) ~= "string" then return false end
        return _sx_find(_e, _AT1_MARKER, 1, true) ~= nil
    end
    local function _at1_check()
        if _sx_type(game) ~= "userdata" then return false end
        if _sx_type(Enum) ~= "userdata" then return false end
        for _ii = 1, 7 do
            if not _at1_probe(function() _sx_error(_AT1_MARKER) end) then
                return false
            end
        end
        return true
    end
    if not _at1_check() then _sx_crash() end

    -- LAYER 2: pcall integrity accumulator
    do
        %s
        local _valid = true
        local _len   = 100
        local _acc1  = 0
        local _acc2  = 0
        local _n     = _sx_math_random(3, 65)
        if _n < 3 or _n > 65 then _sx_crash() end

        %s
        for _i = 1, _len do
            local _n2  = _i %% 256
            local _pos = _i %% _len + 1
            local _se  = (_i %% 2 == 0)
            local _em  = _eMsgPfx .. _sx_tostring(_i)
            local _ok, _r1, _r2 = _sx_pcall(function()
                if _se then _sx_error(_em, 0) end
                return _n2, _pos
            end)
            if _se then
                _valid = _valid and _ok == false and _r1 == _em
            else
                _valid = _valid and _ok == true
                _acc1  = (_acc1 + (_r1 or 0)) %% 256
                _acc2  = (_acc2 + _n2) %% 256
            end
        end

        _valid = _valid and (_acc1 == _acc2)
        if not _valid then
            _sx_error(_errMsg, 0)
        end
    end

    -- LAYER 3: NaN constant integrity (naive dumpers replace NaN with 0)
    local _nan = 0/0
    if _nan == _nan then _sx_crash() end

    -- LAYER 4: Luau platform checks (runs only when Luau APIs are present)
    do
        local _ok_gi, _gi = _sx_pcall(function() return getfenv and getfenv(0) or _G end)
        local _gg = (_ok_gi and _gi) or _G

        if debug and debug.info then
            local _ok_di, _rs = _sx_pcall(debug.info, _sx_pcall, "s")
            if _ok_di and _rs ~= "[C]" then _sx_crash() end
        end

        if _sx_type(task) == "table" and _sx_type(game) == "userdata" then
            local _ok_gs, _ws = _sx_pcall(function()
                return game:GetService("Workspace")
            end)
            if not _ok_gs or _sx_type(_ws) ~= "userdata" then _sx_crash() end
        end

        if _sx_type(require) == "function" and pcall then
            local _ok_fp, _fp = pcall(function()
                return debug and debug.info and debug.info(print, "s") or "[C]"
            end)
            if _ok_fp and _fp ~= "[C]" then _sx_crash() end
        end
    end
end
]], decMarkerStmt, decErrStmt, decEPfxStmt)

    local parsed = Parser:new({LuaVersion = Enums.LuaVersion.LuaU}):parse(code)
    local doStat = parsed.body.statements[1]
    doStat.body.scope:setParent(ast.body.scope)
    table.insert(ast.body.statements, 1, doStat)

    return ast
end

return AntiTamper
