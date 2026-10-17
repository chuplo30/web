local Step = require("catph.step")
local Ast = require("catph.ast")
local Parser = require("catph.parser")

local ANTI_TAMPER_CODE = [[
local function fail()
    error("Expected ')' (to close '(' at column 2301), got '...' ")
    while true do end
end

local addrs = {}
for i = 1, math.random(4, 8) do
    local t = {}
    local addr = string.sub(tostring(t), 8, 15)
    if addrs[addr] then fail() end
    addrs[addr] = true
end
]]

local AntiTamperEngine = Step:extend()
AntiTamperEngine.Name = "AntiTamperEngine"
AntiTamperEngine.Description = "Injects a table-address deduplication anti-tamper block at the start of the output."
AntiTamperEngine.SettingsDescriptor = {
    Code = { type = "string", default = ANTI_TAMPER_CODE };
}

function AntiTamperEngine:init()
    self.code = self.Code or ANTI_TAMPER_CODE
end

function AntiTamperEngine:apply(ast, pipeline)
    local parser = Parser:new({ LuaVersion = "LuaU" })
    local antiAst = parser:parse(self.code)

    
    
    local antiBlock = Ast.DoStatement(antiAst.body)
    antiBlock.__catphAntiTamper = true

    
    local newStmts = { antiBlock }
    for _, s in ipairs(ast.body.statements) do
        newStmts[#newStmts + 1] = s
    end
    ast.body.statements = newStmts

    return ast
end

return AntiTamperEngine
