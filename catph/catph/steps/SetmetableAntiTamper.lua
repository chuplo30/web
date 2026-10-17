local Step = require("catph.step")
local Parser = require("catph.parser")
local Enums = require("catph.enums")
local Ast = require("catph.ast")
local Scope = require("catph.scope")


local SetmetableAntiTamper = Step:extend()
SetmetableAntiTamper.Name = "SetmetableAntiTamper"
SetmetableAntiTamper.Description = "SharedTable clone/increment/isFrozen probe anti-tamper. Decoy errors only, never freezes. Executor-only."
SetmetableAntiTamper.SettingsDescriptor = {}

function SetmetableAntiTamper:init(settings) end

function SetmetableAntiTamper:apply(ast, pipeline)
    local rawCode = [[
local ok, r = pcall(function()
    local n = SharedTable.new({v = 7})
    local x = SharedTable.new({n = n, a = 10})

    local s = SharedTable.clone(x)
    local d = SharedTable.clone(x, true)

    s.n.v = 91

    local old = SharedTable.increment(x, "a", 5)

    local f = SharedTable.cloneAndFreeze(x, true)

    return x.n.v == 91
        and d.n.v == 7
        and old == 10
        and x.a == 15
        and SharedTable.isFrozen(f)
        and SharedTable.isFrozen(f.n)
end)
error(ok and r and "SetmetableUN" or "setmetable got crash", 0)
]]

    local wrapped = string.format([[
do
    local _stt_g = _G
    if getfenv then
        local _stt_ok, _stt_e = pcall(getfenv, 1)
        if _stt_ok and type(_stt_e) == "table" and rawget(_stt_e, "SharedTable") then _stt_g = _stt_e end
    end
    if rawget(_stt_g,"SharedTable") and rawget(_stt_g,"typeof") and rawget(_stt_g,"game") and type(rawget(_stt_g,"game"))~="table" then
        local _stt_ok,_stt_tag = pcall(function()
            %s
        end)
        if not _stt_ok and _stt_tag ~= "SetmetableUN" then
            local _stt_silent = true
            if _stt_silent then
                _stt_tag = nil
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

return SetmetableAntiTamper
