local Step = require("catph.step")
local Parser = require("catph.parser")
local Enums = require("catph.enums")

local RobloxAntiTamper = Step:extend()
RobloxAntiTamper.Name = "RobloxAntiTamper"
RobloxAntiTamper.Description = "Injects user-provided strong Roblox anti-tamper (task/pcall/metatable/Instance checks) executor-safe."
RobloxAntiTamper.SettingsDescriptor = {}

function RobloxAntiTamper:init(settings) end

function RobloxAntiTamper:apply(ast, pipeline)
    local rawCode = [[
local a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t = false, pcall, xpcall, error, pairs, next, setmetatable, getmetatable, type, tonumber, rawget, rawequal, unpack or table.unpack, math, table, string, coroutine, math.random, {}, 0;
for u, v in e(_G) do
    s[u] = v;
    t = t + 1;
end;
do
    local spawned2 = false;
    task.spawn(function()
        spawned2 = true;
    end);
    if not spawned2 then
        error('cannot resume dead coroutine');
        return;
    end;
end;
do
    local real_pcall = rawget(_G, "pcall");
    if real_pcall ~= nil and not rawequal(real_pcall, pcall) then
        error('cannot resume dead coroutine');
        return;
    end;
    local co = coroutine.wrap(function()
        error("bad");
    end);
    local s, e = pcall(co);
    if s then
        error('cannot resume dead coroutine');
        return;
    end;
    if type(e) ~= 'string' or not string.find(e, "bad", 1, true) then
        error('cannot resume dead coroutine');
        return;
    end;
    local s2, e2 = pcall(co);
    if s2 then
        error('cannot resume dead coroutine');
        return;
    end;
    if type(e2) ~= 'string' or not string.find(e2, "cannot resume dead coroutine", 1, true) then
        error('cannot resume dead coroutine');
        return;
    end;
end;
do
    local triggered = false;
    local tbl = setmetatable({}, {
        __newindex = function(t, key, val)
            triggered = true;
            rawset(t, key, val);
        end
    });
    tbl.x = 1;
    if not triggered then
        error('cannot resume dead coroutine');
        return;
    end;
end;
do
    local blocked = false;
    local tbl = setmetatable({}, {
        __newindex = function()
            blocked = true;
        end
    });
    rawset(tbl, 'x', 1);
    if blocked then
        error('cannot resume dead coroutine');
        return;
    end;
    if rawget(tbl, 'x') ~= 1 then
        error('cannot resume dead coroutine');
        return;
    end;
end;
do
    if syn then
        if not getfenv().http and not getfenv().request then
            error('cannot resume dead coroutine');
            return;
        end;
        if not getfenv().HttpGet then
            error('cannot resume dead coroutine');
            return;
        end;
        if not getfenv().writefile then
            error('cannot resume dead coroutine');
            return;
        end;
        local ok = b(function()
            return debug.getinfo(1, "f").func;
        end);
        if not ok then
            error('cannot resume dead coroutine');
            return;
        end;
        if rawget(_G, "getfenv") == nil then
            error('cannot resume dead coroutine');
            return;
        end;
    elseif not KRNL_LOADED and not SENTINEL_LOADED then

    end;
end;
do
    if not l(b, pcall) then
        error('cannot resume dead coroutine');
        return;
    end;
    if not l(d, error) then
        error('cannot resume dead coroutine');
        return;
    end;
    if not l(e, pairs) then
        error('');
        return;
    end;
    if not l(g, setmetatable) then
        error('');
        return;
    end;
    if not l(h, getmetatable) then
        error('');
        return;
    end;
    if not l(i, type) then
        error('');
        return;
    end;
    if not l(c, xpcall) then
        error('');
        return;
    end;
    if not l(q, coroutine) then
        error('');
        return;
    end;
    if not l(p, string) then
        error('');
        return;
    end;
    if not l(n, math) then
        error('');
        return;
    end;
    if not l(o, table) then
        error('');
        return;
    end;
    if not l(r, math.random) then
        error('');
        return;
    end;
end;
do
    local z = 0;
    for A in f, _G do
        z = z + 1;
        if k(s, A) == nil then
            error('');
            return;
        end;
        if k(_G, A) ~= s[A] then
            error('');
            return;
        end;
    end;
    if z ~= t then
        error('');
        return;
    end;
end;
local spawned = false;
b(function()
    task.spawn({}, {});
    spawned = true;
end);
if spawned then
    error('');
    return;
end;
local u = g({}, {});
local v = h(u);
v.__tostring = function()
    error('');
    return;
end;
v.__index = function()
    error('');
    return;
end;
v.__metatable = {};
b(b, u, u);
b(j, u, u);
do
if rawget(_G,"Instance") then
local w = Instance.new('Part');
local w2 = Instance.new('Part');
local x, y = b(function()
    w.Name = 'SO COOL';
end), w.Name;
if w.Name ~= w2.Name and w2.Name ~= 'Part' then
    error('');
    return;
end;
w:Destroy();
w2:Destroy();
if not x or y ~= 'SO COOL' then
    error('');
    return;
end;
end
end
local function __getfenv()
    local w, x = b(getfenv, 1);
    return not w or i(x) ~= 'table';
end;
local function __setfenv()
    local w = {};
    local x = b(setfenv, 1, w);
    if not x then
        return false;
    end;
    return getfenv(1) ~= w;
end;
if __getfenv() or __setfenv() then
    error("");
end;
]]
    
    local wrapped = string.format([[
do
    if rawget(_G,"task") and rawget(_G,"pcall") and rawget(_G,"coroutine") then
        local _ok,_err = pcall(function()
            %s
        end)
        if not _ok then
            -- if tamper check itself errors due to missing Roblox env, don't crash vanilla Lua
            if rawget(_G,"Instance") then
                error(_err)
            end
        end
    end
end
]], rawCode)

    local ok, parsed = pcall(function()
        return Parser:new({LuaVersion=Enums.LuaVersion.LuaU}):parse(wrapped)
    end)
    if not ok or not parsed then return ast end
    local block = parsed.body.statements[1] 
    if block and block.body and block.body.scope then
        block.body.scope:setParent(ast.body.scope)
        
    end
    table.insert(ast.body.statements, 1, block)
    return ast
end

return RobloxAntiTamper
