








local Step = require("catph.step")
local Ast = require("catph.ast")
local visitast = require("catph.visitast")

local AstKind = Ast.AstKind

local AutoDevirt = Step:extend()
AutoDevirt.Name = "AutoDevirt"
AutoDevirt.Description = "Selectively devirtualizes simple loop bodies for near-native performance."

AutoDevirt.SettingsDescriptor = {}

function AutoDevirt:init(settings) end


local function isSimpleExpr(node)
    if not node then return false end
    local k = node.kind
    if k == AstKind.NumberExpression or k == AstKind.StringExpression
        or k == AstKind.BooleanExpression or k == AstKind.NilExpression
        or k == AstKind.VariableExpression or k == AstKind.VarargExpression then
        return true
    end
    if k == AstKind.AddExpression or k == AstKind.SubExpression
        or k == AstKind.MulExpression or k == AstKind.DivExpression
        or k == AstKind.ModExpression or k == AstKind.PowExpression
        or k == AstKind.IDivExpression then
        return isSimpleExpr(node.lhs) and isSimpleExpr(node.rhs)
    end
    if k == AstKind.StrCatExpression then
        return isSimpleExpr(node.lhs) and isSimpleExpr(node.rhs)
    end
    if k == AstKind.NegateExpression or k == AstKind.NotExpression
        or k == AstKind.LenExpression then
        return isSimpleExpr(node.rhs)
    end
    if k == AstKind.IndexExpression then
        return isSimpleExpr(node.base) and isSimpleExpr(node.index)
    end
    
    if k == AstKind.EqualsExpression or k == AstKind.NotEqualsExpression
        or k == AstKind.LessThanExpression or k == AstKind.LessThanOrEqualsExpression
        or k == AstKind.GreaterThanExpression or k == AstKind.GreaterThanOrEqualsExpression then
        return isSimpleExpr(node.lhs) and isSimpleExpr(node.rhs)
    end
    if k == AstKind.AndExpression or k == AstKind.OrExpression then
        return isSimpleExpr(node.lhs) and isSimpleExpr(node.rhs)
    end
    return false
end


local function isSimpleStatement(stat)
    if not stat then return false end
    local k = stat.kind
    if k == AstKind.NopStatement then return true end
    if k == AstKind.AssignmentStatement then
        for _, expr in ipairs(stat.rhs or {}) do
            if not isSimpleExpr(expr) then return false end
        end
        return true
    end
    
    if k == AstKind.CompoundAddStatement or k == AstKind.CompoundSubStatement
        or k == AstKind.CompoundMulStatement or k == AstKind.CompoundDivStatement
        or k == AstKind.CompoundModStatement or k == AstKind.CompoundPowStatement
        or k == AstKind.CompoundConcatStatement or k == AstKind.CompoundIDivStatement then
        return isSimpleExpr(stat.rhs)
    end
    
    if k == AstKind.LocalVariableDeclaration then
        for _, expr in ipairs(stat.expressions or {}) do
            if not isSimpleExpr(expr) then return false end
        end
        return true
    end
    return false
end


local function isSimpleLoopBody(body)
    if not body or not body.statements then return false end
    local stmts = body.statements
    
    if #stmts > 6 then return false end
    if #stmts == 0 then return false end
    for _, stat in ipairs(stmts) do
        if not isSimpleStatement(stat) then return false end
    end
    return true
end

function AutoDevirt:apply(ast, pipeline)
    
    
    visitast(ast, nil, function(node, data)
        if node.kind == AstKind.ForStatement then
            if isSimpleLoopBody(node.body) then
                node.__nativeBody = true
            end
        end
        if node.kind == AstKind.ForInStatement then
            if isSimpleLoopBody(node.body) then
                node.__nativeBody = true
            end
        end
    end)
    return ast
end

return AutoDevirt
