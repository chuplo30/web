local Step      = require("catph.step")
local Ast       = require("catph.ast")
local visitast  = require("catph.visitast")
local logger    = require("logger")

local AstKind   = Ast.AstKind














local ConstScatter = Step:extend()
ConstScatter.Name = "ConstScatter"
ConstScatter.Description = "Splits integer literals into opaque a+b sums (constant pool randomization). Executor-safe."
ConstScatter.SettingsDescriptor = {}

function ConstScatter:init(settings)
    settings = settings or {}
    self.Probability = settings.Probability or 0.25
    self.MinValue    = settings.MinValue or 2
    self.Enabled     = settings.Enabled ~= false
end

local function integerAddSplit(n)
    if not n or n < 2 then return nil end
    local a = math.random(1, n - 1)
    local b = n - a
    return a, b
end

function ConstScatter:apply(ast, pipeline)
    if not self.Enabled or self.Probability <= 0 then return ast end

    visitast(ast, nil, function(node, data)
        if node.kind ~= AstKind.NumberExpression then return end
        local v = node.value
        if type(v) ~= "number" then return end
        if math.floor(v) ~= v then return end
        if 0 <= v and v < self.MinValue then return end
        if math.random() > self.Probability then return end
        local n = math.abs(v)
        local a = math.random(1, n - 1)
        local b = n - a
        local sumExpr
        if v < 0 then
            
            sumExpr = Ast.AddExpression(Ast.NumberExpression(-a), Ast.NumberExpression(-b))
        else
            sumExpr = Ast.AddExpression(Ast.NumberExpression(a), Ast.NumberExpression(b))
        end
        sumExpr.scope = data.scope
        return sumExpr
    end)

    return ast
end

return ConstScatter
