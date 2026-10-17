-- tools/verify_prelude.lua : fake Roblox env for build verification under luau.exe.
-- Marriage of mocks proven in testing: payload must decode+dispatch; the FIRST
-- game:GetService / task.spawn touch prints VERIFY MARKER and aborts (PASS).
-- Uses the REAL buffer library (fidelity with executor). Do NOT use for release.
local function mkInst()
    return setmetatable({ __inst = true }, { __index = function(t, k)
        return function() return nil end
    end })
end

local camera = mkInst()
camera.GetPartsObscuringTarget = function() return {} end

workspace = mkInst()
workspace.CurrentCamera = camera

local P = mkInst()
P.GetPlayers = function() return {} end
P.LocalPlayer = mkInst()

local G = mkInst()
G.Players = P
G.GetService = function(_, n) return mkInst() end
G.PlaceId = 0
G.JobId = "verify"

game = G
Players = P

local function enumItem() return { __enum = true } end
Enum = setmetatable({}, { __index = function(t, k)
    local sub = setmetatable({}, { __index = function(_, kk) return { __enum = true, Name = kk, Value = 0 } end })
    rawset(t, k, sub)
    return sub
end })

task = { wait = function() end, spawn = function() end, defer = function() end, delay = function() end }
wait = function() end
spawn = function() end
Instance = { new = function() return mkInst() end, fromExisting = function() return mkInst() end }
Vector3 = { new = function() return { Magnitude = 0 } end }
CFrame = { new = function() return {} end }
TweenInfo = { new = function() return {} end }

local _realTypeof = typeof
typeof = function(v)
    local t = type(v)
    if t == "table" then
        if rawget(v, "__inst") then return "Instance" end
        if rawget(v, "__enum") then return "EnumItem" end
    end
    return _realTypeof(v)
end

-- NEG: plain mocks, no markers (trap beats prove denial).

