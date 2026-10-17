local Step = require("catph.step")
local Ast = require("catph.ast")
local Scope = require("catph.scope")
local Parser = require("catph.parser")
local Enums = require("catph.enums")











local WrapMainLogic = Step:extend()
WrapMainLogic.Name = "WrapNoGate"
WrapMainLogic.Description = "Same as WrapMainLogic but always calls main (test gate-bypass)."
WrapMainLogic.SettingsDescriptor = {}

function WrapMainLogic:init(settings) end



local function globalRef(scope, name)
    local existing = scope.variablesLookup[name]
    if existing ~= nil then
        return existing
    end
    return scope:addVariable(name)
end

function WrapMainLogic:apply(ast, pipeline)
    local body = ast.body
    local statements = body.statements

    
    local prelude = {}
    while statements[1] and statements[1].__catphAntiTamper do
        prelude[#prelude + 1] = table.remove(statements, 1)
    end
    local mainStatements = statements

    
    local topScope = Scope:new(ast.globalScope)

    
    
    for _, block in ipairs(prelude) do
        if block.body and block.body.scope then
            block.body.scope:setParent(topScope)
        end
    end

    
    
    
    local mainFuncScope = Scope:new(topScope)
    body.scope:setParent(mainFuncScope)

    local mainId = topScope:addVariable()

    
    
    local args = { Ast.VarargExpression() }

    local mainFunc = Ast.LocalFunctionDeclaration(topScope, mainId, args, body)

    
    
    local gs = ast.globalScope
    local typeofVar = Ast.VariableExpression(gs, globalRef(gs, "typeof"))
    local gameVar = Ast.VariableExpression(gs, globalRef(gs, "game"))
    local gateCond = Ast.BooleanExpression(true)

    local callMain = Ast.FunctionCallStatement(
        Ast.VariableExpression(topScope, mainId),
        {}
    )
    local gateIf = Ast.IfStatement(
        gateCond,
        Ast.Block({ callMain }, Scope:new(topScope)),
        {},
        nil
    )

    
    local newStatements = {}
    for _, s in ipairs(prelude) do
        newStatements[#newStatements + 1] = s
    end
    newStatements[#newStatements + 1] = mainFunc
    newStatements[#newStatements + 1] = gateIf

    ast.body = Ast.Block(newStatements, topScope)

    return ast
end

return WrapMainLogic
