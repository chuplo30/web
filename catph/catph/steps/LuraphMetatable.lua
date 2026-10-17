local Step = require("catph.step")
local Ast = require("catph.ast")
local Parser = require("catph.parser")
local Enums = require("catph.enums")
local visitast = require("catph.visitast")

local LuraphMetatable = Step:extend()
LuraphMetatable.Name = "LuraphMetatable"
LuraphMetatable.Description = "Injects Luraph v15.0 style metatable protection (__index/__newindex/__metatable lock) for executor."
LuraphMetatable.SettingsDescriptor = {
    LockGlobals = {
        name = "LockGlobals",
        description = "Lock global env metatable like Luraph v15",
        type = "boolean",
        default = true,
    },
}

function LuraphMetatable:init(settings) end

local function buildCode()
    
    
    local code = [[
do
    local _env = getfenv and getfenv() or _G
    local _proxy_mt = {}
    _proxy_mt.__index = function(_, k)
        local v = rawget(_env, k)
        return v
    end
    _proxy_mt.__newindex = function(_, k, v)
        rawset(_env, k, v)
    end
    _proxy_mt.__metatable = "The metatable is locked (Luraph v15.0 - Catph)"
    _proxy_mt.__call = function(_, ...)
        return "LuraphV15"
    end
    _proxy_mt.__eq = function(a,b) return rawequal(a,b) end
    local _lph_proxy = setmetatable({}, _proxy_mt)
    -- decoy newproxy like Luraph
    local _np = nil
    if newproxy then
        local ok, p = pcall(newproxy, true)
        if ok and p then
            local mt = getmetatable(p)
            if mt then
                mt.__metatable = "locked"
                mt.__index = mt.__index or function() return nil end
            end
            _np = p
        end
    end
    _np = _np or {}
    -- try to lock global env metatable (executor safe: pcall)
    pcall(function()
        if getmetatable(_env) == nil then
            setmetatable(_env, {__index = _lph_proxy, __metatable = "locked", __newindex = function(t,k,v) rawset(t,k,v) end})
        end
    end)
    -- hide proxy via debug when available
    pcall(function()
        if debug and debug.setmetatable then
            -- no-op decoy
        end
    end)
    _lph_proxy = _lph_proxy; _np = _np
end
]]
    return code
end

function LuraphMetatable:apply(ast, pipeline)
    local code = buildCode()
    local ok, newAst = pcall(function()
        return Parser:new({ LuaVersion = Enums.LuaVersion.LuaU }):parse(code)
    end)
    if not ok or not newAst or not newAst.body then return ast end
    
    local block = ast.body
    for i = #newAst.body.statements, 1, -1 do
        local stmt = newAst.body.statements[i]
        
        if stmt.body and stmt.body.scope then
            stmt.body.scope:setParent(block.scope)
        end
        table.insert(block.statements, 1, stmt)
    end
    return ast
end

return LuraphMetatable
