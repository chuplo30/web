local Step = require("catph.step")
local Parser = require("catph.parser")
local Enums = require("catph.enums")
local Ast = require("catph.ast")
local Scope = require("catph.scope")

local EnvLoggerCheck = Step:extend()
EnvLoggerCheck.Name = "EnvLoggerCheck"
EnvLoggerCheck.Description = "Env-logger detector: bare-vs-_G consistency + __index/__newindex integrity + access-timing ratio + C-closure identity + getfenv stability + newproxy tuple. Silent decoy return on hit, never freezes. Executor-safe."
EnvLoggerCheck.SettingsDescriptor = {
    Strict = {
        type = "boolean";
        default = false;
        description = "true = error() when a logger is detected. false = silent return (logger gets nothing).";
    };
    Spam = {
        type = "boolean";
        default = false;
        description = "true = trap logger in endless junk loop (error() alone gets logged-and-passed).";
    };
}

function EnvLoggerCheck:init()
    -- Strict da duoc Step:new() gan tu Settings; khong ghi de o day.
end

local CHECK_CODE = [[
do
    -- Capture tran (duong logger phai di qua) truoc, chi dung _G de doi chieu.
    local _rawget = rawget
    local _rawset = rawset
    local _rawequal = rawequal
    local _type = type
    local _pcall = pcall
    local _setmetatable = setmetatable
    local _error = error
    local _debug = debug
    local _game = game
    local _task = task
    local _pairs = pairs
    local _next = next
    local _tostring = tostring
    local _STRICT = __ENVLOGGER_STRICT__
    local _SPAM = __ENVLOGGER_SPAM__
    local _flag = false

    local function _eq(a, b)
        if _type(_rawequal) == "function" then
            local _ok, _r = _pcall(_rawequal, a, b)
            if _ok then return _r end
        end
        return a == b
    end

    local _canRun = _type(_rawget) == "function"
        and _type(_rawset) == "function"
        and _type(_type) == "function"
        and _type(_pcall) == "function"
        and _type(_setmetatable) == "function"

    -- 1) Nhat quan global: logger hook global tran nhung quen _G (hoac nguoc lai) -> lech.
    if _canRun and not _flag then
        local _ok, _bad = _pcall(function()
            if _type(_G) ~= "table" then return false end
            if _rawget(_G, "rawget") ~= nil and not _eq(_rawget(_G, "rawget"), _rawget) then return true end
            if _rawget(_G, "rawset") ~= nil and not _eq(_rawget(_G, "rawset"), _rawset) then return true end
            if _rawget(_G, "type") ~= nil and not _eq(_rawget(_G, "type"), _type) then return true end
            if _rawget(_G, "pcall") ~= nil and not _eq(_rawget(_G, "pcall"), _pcall) then return true end
            if _rawget(_G, "setmetatable") ~= nil and not _eq(_rawget(_G, "setmetatable"), _setmetatable) then return true end
            if _rawget(_G, "pairs") ~= nil and _pairs ~= nil and not _eq(_rawget(_G, "pairs"), _pairs) then return true end
            if _rawget(_G, "next") ~= nil and _next ~= nil and not _eq(_rawget(_G, "next"), _next) then return true end
            if _rawget(_G, "tostring") ~= nil and _tostring ~= nil and not _eq(_rawget(_G, "tostring"), _tostring) then return true end
            local _gDbg = _rawget(_G, "debug")
            if _gDbg ~= nil and _debug ~= nil and not _eq(_gDbg, _debug) then return true end
            local _gGame = _rawget(_G, "game")
            if _gGame ~= nil and _game ~= nil and not _eq(_gGame, _game) then return true end
            local _gTask = _rawget(_G, "task")
            if _gTask ~= nil and _task ~= nil and not _eq(_gTask, _task) then return true end
            return false
        end)
        if (not _ok) or _bad then _flag = true end
    end

    -- 2) Metatable integrity: Spy Env / hook __index/__newindex lam lech hit-count.
    if _canRun and not _flag then
        local _ok, _bad = _pcall(function()
            local _hits = 0
            local _pr = _setmetatable({}, {
                __index = function(t, k) _hits = _hits + 1 return 7 end,
                __newindex = function(t, k, v) _hits = _hits + 10 _rawset(t, k, v) end,
            })
            if _pr.foo ~= 7 then return true end
            if _hits ~= 1 then return true end
            if _rawget(_pr, "bar") ~= nil then return true end
            if _hits ~= 1 then return true end
            _rawset(_pr, "z", 1)
            if _hits ~= 1 then return true end
            _pr.z = 2
            if _hits ~= 1 then return true end
            _pr.nk = 5
            if _hits ~= 11 then return true end
            if _rawget(_pr, "nk") ~= 5 then return true end
            return false
        end)
        if (not _ok) or _bad then _flag = true end
    end

    -- 3) Timing ratio: moi lan log (__index) cua logger ton kem gap nhieu lan rawget.
    if _canRun and not _flag then
        local _os = _G and _rawget(_G, "os") or nil
        local _clock = nil
        if _type(_os) == "table" then _clock = _rawget(_os, "clock") end
        if _type(_clock) ~= "function" then _clock = tick end
        if _type(_clock) ~= "function" then _clock = time end
        if _type(_clock) == "function" then
            local _ok, _bad = _pcall(function()
                local _N = 2000
                local _plain = { k = 1 }
                local _meta = _setmetatable({}, { __index = function(t, k) return 1 end })
                local _s = 0
                local _t0 = _clock()
                for _i = 1, _N do _s = _s + _rawget(_plain, "k") end
                local _tRaw = _clock() - _t0
                local _t1 = _clock()
                for _i = 1, _N do _s = _s + _meta.k end
                local _tMeta = _clock() - _t1
                if _s ~= _N * 2 then return true end
                if _tMeta > _tRaw * 25 + 0.05 then return true end
                return false
            end)
            if (not _ok) or _bad then _flag = true end
        end
    end

    -- 4) System-function identity: ham C bi boc (Lua closure) lo qua debug.info ~= "[C]".
    if _canRun and not _flag then
        local _info = nil
        if _type(_debug) == "table" then _info = _rawget(_debug, "info") end
        if _type(_info) ~= "function" and _type(_G) == "table" then
            local _gDbg = _rawget(_G, "debug")
            if _type(_gDbg) == "table" then _info = _rawget(_gDbg, "info") end
        end
        if _type(_info) == "function" then
            local _ok, _bad = _pcall(function()
                local _okP, _srcP = _pcall(_info, _pcall, "s")
                if _okP and _type(_srcP) == "string" and _srcP ~= "[C]" then return true end
                local _okR, _srcR = _pcall(_info, _rawget, "s")
                if _okR and _type(_srcR) == "string" and _srcR ~= "[C]" then return true end
                local _probe = function() end
                local _okL, _srcL = _pcall(_info, _probe, "s")
                if _okL and _type(_srcL) == "string" and _srcL == "[C]" then return true end
                return false
            end)
            if (not _ok) or _bad then _flag = true end
        end
    end

    -- 5) getfenv stability: Spy Env dung moi lan goi thi 2 lan goi tra ve 2 bang khac nhau.
    if _canRun and not _flag then
        local _getfenv = getfenv
        if _type(_getfenv) == "function" then
            local _ok, _bad = _pcall(function()
                local _okA, _eA = _pcall(_getfenv, 1)
                local _okB, _eB = _pcall(_getfenv, 1)
                if _okA and _okB then
                    if _type(_eA) ~= "table" or _type(_eB) ~= "table" then return true end
                    if not _eq(_eA, _eB) then return true end
                    local _eRaw = _eA.rawget
                    if _eRaw ~= nil and not _eq(_eRaw, _rawget) then return true end
                    return false
                end
                return false
            end)
            if (not _ok) or _bad then _flag = true end
        end
    end

    -- 6) newproxy tuple: moi newproxy(true) phai co metatable rieng + khoa __metatable duoc.
    if _canRun and not _flag then
        local _newproxy = newproxy
        local _getmetatable = getmetatable
        if _type(_newproxy) == "function" and _type(_getmetatable) == "function" then
            local _ok, _bad = _pcall(function()
                local _ok1, _u1 = _pcall(_newproxy, true)
                local _ok2, _u2 = _pcall(_newproxy, true)
                if (not _ok1) or (not _ok2) then return false end
                if _type(_u1) ~= "userdata" or _type(_u2) ~= "userdata" then return true end
                local _m1 = _getmetatable(_u1)
                local _m2 = _getmetatable(_u2)
                if _type(_m1) ~= "table" or _type(_m2) ~= "table" then return true end
                if _eq(_m1, _m2) then return true end
                _m1.__metatable = "L"
                if _getmetatable(_u1) ~= "L" then return true end
                return false
            end)
            if (not _ok) or _bad then _flag = true end
        end
    end

    if _flag then
        -- error truoc: logger thuong thi chet ngay. Logger neuter error (pass
        -- qua roi di tiep) se roi xuong spam trap phia duoi.
        if (_STRICT or _SPAM) and _type(_error) == "function" then
            _error("EnvLogger detected", 0)
        end
        -- Spam trap: logger gap error van pass (chi log roi di tiep) -> nhot no
        -- vao vong lap rac vo han, khong bao gio vao payload that.
        if _SPAM then
            local _sn = 0
            while true do
                _sn = _sn + 1
                _pcall(function()
                    local _gg = _game
                    if _gg == nil and _type(_G) == "table" then _gg = _rawget(_G, "game") end
                    if _type(_gg) == "table" or _type(_gg) == "userdata" then
                        local _names = { "Players", "Workspace", "ReplicatedStorage", "Lighting", "SoundService", "HttpService", "TeleportService", "MarketplaceService" }
                        local _m = _gg.GetService
                        if _type(_m) == "function" then
                            local _s = _m(_gg, _names[(_sn % 8) + 1])
                            if _s ~= nil then
                                local _gc = _s.GetChildren
                                if _type(_gc) == "function" then
                                    local _ch = _gc(_s)
                                    if _type(_ch) == "table" then
                                        local _acc = 0
                                        for _ci = 1, #_ch do
                                            local _e = _ch[_ci]
                                            if _e ~= nil then
                                                local _nn = _e.Name
                                                if _type(_nn) == "string" then _acc = _acc + #_nn end
                                            end
                                        end
                                        if _acc < 0 then _pcall(_m, _gg, _names[1]) end
                                    end
                                end
                            end
                        end
                    end
                end)
                if _sn % 500 == 0 then
                    _pcall(function()
                        local _tt = _task
                        if _tt == nil and _type(_G) == "table" then
                            local _gt = _rawget(_G, "task")
                            if _type(_gt) == "table" then _tt = _gt end
                        end
                        if _type(_tt) == "table" and _type(_tt.wait) == "function" then
                            _tt.wait(0.03)
                        end
                    end)
                end
            end
        end
        -- Duong khac (decoy): cho logger log toan rac, khong bao gio vao payload that.
        _pcall(function()
            local _gg = _game
            if _gg == nil and _type(_G) == "table" then _gg = _rawget(_G, "game") end
            if _type(_gg) == "table" or _type(_gg) == "userdata" then
                local _names = { "Players", "Workspace", "ReplicatedStorage", "Lighting", "SoundService", "HttpService", "TeleportService", "MarketplaceService" }
                for _di = 1, 8 do
                    _pcall(function()
                        local _m = _gg.GetService
                        if _type(_m) == "function" then
                            local _s = _m(_gg, _names[_di])
                            if _s ~= nil then
                                local _cn = _s.ClassName
                                if _cn == nil then _cn = _s.Name end
                                local _ch = _s.GetChildren
                                if _type(_ch) == "function" then _ch(_s) end
                            end
                        end
                    end)
                end
            end
            local _tt = _task
            if _tt == nil and _type(_G) == "table" then
                local _gTask = _rawget(_G, "task")
                if _type(_gTask) == "table" then _tt = _gTask end
            end
            if _type(_tt) == "table" then
                local _w = _tt.wait
                local _sp = _tt.spawn
                if _w ~= nil and _sp ~= nil then
                    _pcall(_sp, function() end)
                end
            end
        end)
        return nil
    end
end
]]

function EnvLoggerCheck:apply(ast, pipeline)
    local strict = self.Strict and "true" or "false"
    local spam = self.Spam and "true" or "false"
    local code = CHECK_CODE:gsub("__ENVLOGGER_STRICT__", strict):gsub("__ENVLOGGER_SPAM__", spam)

    local ok, parsed = pcall(function()
        return Parser:new({ LuaVersion = Enums.LuaVersion.LuaU }):parse(code)
    end)
    if not ok or not parsed then return ast end
    local block = parsed.body.statements[1]
    if not block then return ast end
    block.__catphAntiTamper = true

    local origBody = ast.body
    local outerScope = Scope:new(ast.globalScope)
    if block.body and block.body.scope then
        block.body.scope:setParent(outerScope)
    end
    origBody.scope:setParent(outerScope)

    table.insert(origBody.statements, 1, block)

    local closure = Ast.FunctionLiteralExpression({ Ast.VarargExpression() }, origBody)
    ast.body = Ast.Block({
        Ast.ReturnStatement({
            Ast.FunctionCallExpression(closure, { Ast.VarargExpression() })
        })
    }, outerScope)

    return ast
end

return EnvLoggerCheck
