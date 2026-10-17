











local Step     = require("catph.step")
local Ast      = require("catph.ast")
local Scope    = require("catph.scope")
local visitast = require("catph.visitast")

local AstKind = Ast.AstKind

local StringXOR = Step:extend()
StringXOR.Name        = "StringXOR"
StringXOR.Description = "Encodes string literals with a byte-rotation cipher and decodes them at runtime."
StringXOR.SettingsDescriptor = {
    Probability = {
        name        = "Probability",
        description = "Chance (0–1) that any given string literal gets encoded.",
        type        = "number",
        default     = 0.9,
    },
}

function StringXOR:init(settings)
    self.probability = (settings and settings.Probability) or 0.9
end


local function encodeString(s, key)
    local out = {}
    for i = 1, #s do
        out[i] = string.char((s:byte(i) + key) % 256)
    end
    return table.concat(out)
end

function StringXOR:apply(ast, pipeline)
    local prob        = self.probability
    local mainBlock   = ast.body
    local mainScope   = mainBlock.scope
    local globalScope = ast.globalScope

    visitast(ast, function(node, data)
        if node.kind == AstKind.LocalVariableDeclaration then
            local scope = node.scope
            local n = math.min(#(node.ids or {}), #(node.expressions or {}))
            for i = 1, n do
                local expr = node.expressions[i]
                if expr and (expr.kind == AstKind.StringExpression or expr.kind == AstKind.LongStringExpression)
                    and (scope:getReferences(node.ids[i]) or 0) == 0 then
                    node.expressions[i] = Ast.NilExpression()
                end
            end
        end
        return nil
    end, nil)

    if not globalScope:hasVariable("string") then return ast end
    local stringGlobalId = globalScope.variablesLookup["string"]

    
    local skipNode = {}
    visitast(ast, function(node, data)
        if node.kind == AstKind.KeyedTableEntry then
            if node.key and (node.key.kind == AstKind.StringExpression
                          or node.key.kind == AstKind.LongStringExpression) then
                skipNode[node.key] = true
            end
        end
    end, nil)

    
    local decoderId = mainScope:addVariable()

    
    local anyEncoded = false

    visitast(ast, nil, function(node, data)
        if (node.kind == AstKind.StringExpression or node.kind == AstKind.LongStringExpression)
            and not skipNode[node]
            and node.value ~= nil
            and #node.value > 0
            and math.random() < prob
        then
            local key     = math.random(1, 127)
            local encoded = encodeString(node.value, key)
            anyEncoded    = true

            
            local fnRef  = Ast.VariableExpression(mainScope, decoderId)
            local encArg = Ast.StringExpression(encoded)
            local keyArg = Ast.NumberExpression(key)
            return Ast.FunctionCallExpression(fnRef, { encArg, keyArg })
        end
    end)

    if not anyEncoded then
        mainScope:removeVariable(decoderId)
        return ast
    end

    
    
    
    
    
    

    
    local outerScope = Scope:new(mainScope)
    local sId = outerScope:addVariable()
    local kId = outerScope:addVariable()

    
    local innerScope = Scope:new(outerScope)
    local cId = innerScope:addVariable()

    
    local cRef      = Ast.VariableExpression(innerScope, cId)
    local cByteExpr = Ast.PassSelfFunctionCallExpression(cRef, "byte", {})

    
    innerScope:addReferenceToHigherScope(outerScope, kId)
    local kRef = Ast.VariableExpression(outerScope, kId)

    
    local subExpr = Ast.SubExpression(cByteExpr, kRef)
    local modExpr = Ast.ModExpression(subExpr, Ast.NumberExpression(256))

    
    local stringRef  = Ast.VariableExpression(globalScope, stringGlobalId)
    local charField  = Ast.IndexExpression(stringRef, Ast.StringExpression("char"))
    local charCall   = Ast.FunctionCallExpression(charField, { modExpr })

    
    local innerReturn = Ast.ReturnStatement({ charCall })
    local innerBody   = Ast.Block({ innerReturn }, innerScope)
    
    local innerFn     = Ast.FunctionLiteralExpression(
        { Ast.VariableExpression(innerScope, cId) },
        innerBody
    )

    
    local sRef      = Ast.VariableExpression(outerScope, sId)
    local gsubExpr  = Ast.PassSelfFunctionCallExpression(
        sRef, "gsub", { Ast.StringExpression("."), innerFn }
    )

    
    
    
    local rId     = outerScope:addVariable()
    local rDecl   = Ast.LocalVariableDeclaration(outerScope, { rId }, { gsubExpr })
    local rRef    = Ast.VariableExpression(outerScope, rId)
    local outerReturn = Ast.ReturnStatement({ rRef })
    local outerBody   = Ast.Block({ rDecl, outerReturn }, outerScope)
    local outerFn     = Ast.FunctionLiteralExpression(
        { Ast.VariableExpression(outerScope, sId), Ast.VariableExpression(outerScope, kId) },
        outerBody
    )

    
    local decoderDecl = Ast.LocalVariableDeclaration(
        mainScope, { decoderId }, { outerFn }
    )

    table.insert(mainBlock.statements, 1, decoderDecl)

    return ast
end

return StringXOR
