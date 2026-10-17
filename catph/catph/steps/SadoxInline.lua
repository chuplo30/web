



















local Step     = require("catph.step")
local Ast      = require("catph.ast")
local visitast = require("catph.visitast")

local AstKind = Ast.AstKind

local SadoxInline = Step:extend()
SadoxInline.Name        = "SADOX_INLINE"
SadoxInline.Description = "Inlines local variables that are assigned a constant literal once and never reassigned."
SadoxInline.SettingsDescriptor = {}

function SadoxInline:init(settings)
end


local INLINABLE_KINDS = {
    [AstKind.NumberExpression]     = true,
    [AstKind.StringExpression]     = true,
    [AstKind.LongStringExpression] = true,
    [AstKind.BooleanExpression]    = true,
    [AstKind.NilExpression]        = true,
}



local function cloneConstant(node)
    if node.kind == AstKind.NumberExpression then
        return Ast.NumberExpression(node.value)
    elseif node.kind == AstKind.StringExpression then
        return Ast.StringExpression(node.value)
    elseif node.kind == AstKind.LongStringExpression then
        return Ast.LongStringExpression(node.value, node.level)
    elseif node.kind == AstKind.BooleanExpression then
        return Ast.BooleanExpression(node.value)
    elseif node.kind == AstKind.NilExpression then
        return Ast.NilExpression()
    end
end

local compoundKinds = {
    [AstKind.CompoundAddStatement]    = true,
    [AstKind.CompoundSubStatement]    = true,
    [AstKind.CompoundMulStatement]    = true,
    [AstKind.CompoundDivStatement]    = true,
    [AstKind.CompoundPowStatement]    = true,
    [AstKind.CompoundModStatement]    = true,
    [AstKind.CompoundConcatStatement] = true,
    [AstKind.CompoundIDivStatement]   = true,
}

function SadoxInline:apply(ast, pipeline)
    
    
    local candidates = {}
    
    local written = {}

    local function markWritten(scope, id)
        written[scope] = written[scope] or {}
        written[scope][id] = true
    end

    local function markWrittenExpr(expr)
        if expr and expr.kind == AstKind.AssignmentVariable then
            markWritten(expr.scope, expr.id)
        end
    end

    visitast(ast, function(node, data)
        if node.kind == AstKind.AssignmentStatement then
            for _, lhs in ipairs(node.lhs) do
                markWrittenExpr(lhs)
            end
        elseif compoundKinds[node.kind] then
            markWrittenExpr(node.lhs)
        elseif node.kind == AstKind.FunctionDeclaration then
            
            
            
            markWritten(node.scope, node.id)
        elseif node.kind == AstKind.LocalVariableDeclaration then
            if #node.ids == #node.expressions then
                for i, id in ipairs(node.ids) do
                    local valueNode = node.expressions[i]
                    if valueNode and INLINABLE_KINDS[valueNode.kind] then
                        candidates[node.scope] = candidates[node.scope] or {}
                        candidates[node.scope][id] = {
                            declStat = node,
                            index    = i,
                            value    = valueNode,
                        }
                    end
                end
            end
        end
    end, nil)

    for scope, ids in pairs(written) do
        if candidates[scope] then
            for id in pairs(ids) do
                candidates[scope][id] = nil
            end
        end
    end

    if next(candidates) == nil then
        return ast
    end

    
    
    local touchedDecls = {}

    visitast(ast, nil, function(node, data)
        if node.kind == AstKind.VariableExpression then
            local scopeCandidates = candidates[node.scope]
            local candidate = scopeCandidates and scopeCandidates[node.id]
            
            if candidate and node ~= candidate.value then
                
                
                
                
                
                
                
                
                
                data.scope:removeReferenceToHigherScope(node.scope, node.id)
                touchedDecls[candidate.declStat] = touchedDecls[candidate.declStat]
                    or { declStat = candidate.declStat, removed = {} }
                touchedDecls[candidate.declStat].removed[candidate.index] = true
                return cloneConstant(candidate.value)
            end
        end
    end)

    
    
    for declStat, info in pairs(touchedDecls) do
        local scope = declStat.scope
        local keepIds, keepExprs = {}, {}
        for i, id in ipairs(declStat.ids) do
            local wasInlined       = info.removed[i]
            local stillReferenced  = scope:getReferences(id) > 0
            if wasInlined and not stillReferenced then
                scope:removeVariable(id)
            else
                table.insert(keepIds, id)
                table.insert(keepExprs, declStat.expressions[i])
            end
        end
        declStat.ids         = keepIds
        declStat.expressions = keepExprs
    end

    
    visitast(ast, nil, function(node, data)
        if node.kind == AstKind.LocalVariableDeclaration and #node.ids == 0 then
            return Ast.NopStatement()
        end
    end)

    return ast
end

return SadoxInline
