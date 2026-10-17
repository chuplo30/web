













local Step     = require("catph.step")
local Ast      = require("catph.ast")
local Scope    = require("catph.scope")
local visitast = require("catph.visitast")

local AstKind = Ast.AstKind

local VariableSplitting = Step:extend()
VariableSplitting.Name        = "VariableSplitting"
VariableSplitting.Description = "Splits numeric local variables into two locals that sum/combine to the original value."
VariableSplitting.SettingsDescriptor = {
    Probability = {
        name        = "Probability",
        description = "Chance (0–1) that any eligible local gets split.",
        type        = "number",
        default     = 0.7,
    },
}

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

function VariableSplitting:init(settings)
    self.probability = (settings and settings.Probability) or 0.7
end

function VariableSplitting:apply(ast, pipeline)
    local prob = self.probability

    
    
    local candidates = {}
    local written    = {}

    local function markWritten(scope, id)
        written[scope] = written[scope] or {}
        written[scope][id] = true
    end

    visitast(ast, function(node, data)
        if node.kind == AstKind.AssignmentStatement then
            for _, lhs in ipairs(node.lhs) do
                if lhs.kind == AstKind.AssignmentVariable then
                    markWritten(lhs.scope, lhs.id)
                end
            end
        elseif compoundKinds[node.kind] then
            if node.lhs and node.lhs.kind == AstKind.AssignmentVariable then
                markWritten(node.lhs.scope, node.lhs.id)
            end
        elseif node.kind == AstKind.FunctionDeclaration then
            markWritten(node.scope, node.id)
        elseif node.kind == AstKind.LocalVariableDeclaration then
            if #node.ids == #node.expressions then
                for i, id in ipairs(node.ids) do
                    local expr = node.expressions[i]
                    if expr and expr.kind == AstKind.NumberExpression then
                        candidates[node.scope] = candidates[node.scope] or {}
                        candidates[node.scope][id] = {
                            declStat = node,
                            index    = i,
                            value    = expr.value,
                        }
                    end
                end
            end
        end
    end, nil)

    
    for scope, ids in pairs(written) do
        if candidates[scope] then
            for id in pairs(ids) do candidates[scope][id] = nil end
        end
    end

    
    for scope, ids in pairs(candidates) do
        for id in pairs(ids) do
            if math.random() >= prob then candidates[scope][id] = nil end
        end
    end

    if next(candidates) == nil then return ast end

    
    
    local splitInfo = {}

    for scope, ids in pairs(candidates) do
        splitInfo[scope] = {}
        for id, cand in pairs(ids) do
            local n  = cand.value
            
            local valB = math.random(-50, 50)
            local valA = n - valB

            local idA = scope:addVariable()
            local idB = scope:addVariable()

            splitInfo[scope][id] = {
                declStat = cand.declStat,
                index    = cand.index,
                idA      = idA,
                idB      = idB,
                valA     = valA,
                valB     = valB,
            }
        end
    end

    
    visitast(ast, nil, function(node, data)
        
        if node.kind == AstKind.LocalVariableDeclaration then
            local scopeSplit = splitInfo[node.scope]
            if not scopeSplit then return end

            local newIds, newExprs = {}, {}
            local changed = false

            for i, id in ipairs(node.ids) do
                local info = scopeSplit[id]
                if info then
                    changed = true
                    
                    table.insert(newIds,   info.idA)
                    table.insert(newIds,   info.idB)
                    table.insert(newExprs, Ast.NumberExpression(info.valA))
                    table.insert(newExprs, Ast.NumberExpression(info.valB))
                    
                    node.scope:removeVariable(id)
                else
                    table.insert(newIds,   id)
                    table.insert(newExprs, node.expressions[i])
                end
            end

            if changed then
                node.ids         = newIds
                node.expressions = newExprs
            end

        
        elseif node.kind == AstKind.VariableExpression then
            local scopeSplit = splitInfo[node.scope]
            local info = scopeSplit and scopeSplit[node.id]
            if info then
                
                
                
                data.scope:removeReferenceToHigherScope(node.scope, node.id)
                local exprA = Ast.VariableExpression(node.scope, info.idA)
                local exprB = Ast.VariableExpression(node.scope, info.idB)
                return Ast.AddExpression(exprA, exprB)
            end
        end
    end)

    return ast
end

return VariableSplitting
