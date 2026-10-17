












local Step     = require("catph.step")
local Ast      = require("catph.ast")
local visitast = require("catph.visitast")

local AstKind = Ast.AstKind

local OpaquePredicates = Step:extend()
OpaquePredicates.Name        = "OpaquePredicates"
OpaquePredicates.Description = "Wraps if/while conditions with always-true opaque predicates."
OpaquePredicates.SettingsDescriptor = {
    Probability = {
        name        = "Probability",
        description = "Chance (0–1) that any given condition gets wrapped.",
        type        = "number",
        default     = 0.85,
    },
}

function OpaquePredicates:init(settings)
    self.probability = (settings and settings.Probability) or 0.85
end



local function opaqueTrue()
    local n = math.random(2, 99)
    return Ast.GreaterThanOrEqualsExpression(
        Ast.MulExpression(Ast.NumberExpression(n), Ast.NumberExpression(n)),
        Ast.NumberExpression(0)
    )
end


local function opaqueTrue2()
    return Ast.EqualsExpression(
        Ast.StringExpression("string"),
        Ast.StringExpression("string")
    )
end


local function opaqueTrue3()
    local n = math.random(2, 99)
    return Ast.NotEqualsExpression(
        Ast.MulExpression(Ast.NumberExpression(n), Ast.NumberExpression(n)),
        Ast.NumberExpression(0)
    )
end


local function opaqueTrue4()
    local n = math.random(2, 99)
    return Ast.OrExpression(
        Ast.GreaterThanExpression(Ast.NumberExpression(n), Ast.NumberExpression(0)),
        Ast.LessThanOrEqualsExpression(Ast.NumberExpression(n), Ast.NumberExpression(0))
    )
end


local function opaqueTrue5()
    local n = math.random(2, 99)
    return Ast.EqualsExpression(
        Ast.ModExpression(
            Ast.MulExpression(Ast.NumberExpression(n), Ast.NumberExpression(n)),
            Ast.NumberExpression(2)
        ),
        Ast.NumberExpression(n % 2)
    )
end

local PREDICATES = { opaqueTrue, opaqueTrue2, opaqueTrue3, opaqueTrue4, opaqueTrue5 }

function OpaquePredicates:apply(ast, pipeline)
    local prob = self.probability

    visitast(ast, function(node, data)
        
        if node.kind == AstKind.IfStatement then
            if math.random() < prob then
                local pred = PREDICATES[math.random(#PREDICATES)]()
                node.condition = Ast.AndExpression(node.condition, pred)
            end
            
            if node.elseifs then
                for _, elseif_ in ipairs(node.elseifs) do
                    if math.random() < prob then
                        local pred = PREDICATES[math.random(#PREDICATES)]()
                        elseif_.condition = Ast.AndExpression(elseif_.condition, pred)
                    end
                end
            end

        
        elseif node.kind == AstKind.WhileStatement then
            if math.random() < prob then
                local pred = PREDICATES[math.random(#PREDICATES)]()
                node.condition = Ast.AndExpression(node.condition, pred)
            end

        
        elseif node.kind == AstKind.RepeatStatement then
            if math.random() < prob then
                local pred = PREDICATES[math.random(#PREDICATES)]()
                node.condition = Ast.AndExpression(pred, node.condition)
            end
        end
    end, nil)

    return ast
end

return OpaquePredicates
