local Step = require("catph.step")
local Parser = require("catph.parser")
local Enums = require("catph.enums")







local SharedTableAntiTamper = Step:extend()
SharedTableAntiTamper.Name = "SharedTableAntiTamper"
SharedTableAntiTamper.Description = "SharedTable deep-freeze anti-tamper (cloneAndFreeze immutable check + mutation-reject). Executor-only."
SharedTableAntiTamper.SettingsDescriptor = {}

function SharedTableAntiTamper:init(settings) end

function SharedTableAntiTamper:apply(ast, pipeline)
    local rawCode = [[
local neosnappstinks=pcall(function()
	local a=SharedTable.new()
	local b=SharedTable.new()
	a.x=b
	b.y=7
	local c=SharedTable.cloneAndFreeze(a,true)
	b.y=9
	assert(c.x.y==7)
	local z=pcall(function()c.x.y=1 end)
	assert(not z)
end)
print(neosnappstinks and'ud'or'neosnapp reeks like piss')
]]
    
    
    local wrapped = string.format([[
do
    if rawget(_G,"typeof") and rawget(_G,"game") and type(rawget(_G,"game"))~="table" and rawget(_G,"task") and rawget(_G,"Instance") then
        local _ok,_err = pcall(function()
            %s
        end)
        if not _ok then
            error(_err)
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
    if block and block.body and block.body.scope then
        block.body.scope:setParent(ast.body.scope)
    end
    table.insert(ast.body.statements, 1, block)
    return ast
end

return SharedTableAntiTamper
