














local Step     = require("catph.step")
local Ast      = require("catph.ast")
local Scope    = require("catph.scope")
local visitast = require("catph.visitast")

local AstKind = Ast.AstKind

local HelperTable = Step:extend()
HelperTable.Name        = "HelperTable"
HelperTable.Description = "Moves global built-in references into a helper table and replaces accesses with indexed lookups."
HelperTable.SettingsDescriptor = {}

function HelperTable:init(settings)
end

function HelperTable:apply(ast, pipeline)
    local globalScope = ast.globalScope

    
    
    local writtenGlobals = {}
    local readGlobals    = {}   

    visitast(ast, function(node, data)
        if node.kind == AstKind.AssignmentStatement then
            for _, lhs in ipairs(node.lhs) do
                if lhs.kind == AstKind.AssignmentVariable and lhs.scope == globalScope then
                    writtenGlobals[lhs.id] = true
                end
            end
        end
        if node.kind == AstKind.VariableExpression and node.scope == globalScope then
            readGlobals[node.id] = true
        end
    end, nil)

    
    for id in pairs(writtenGlobals) do readGlobals[id] = nil end

    
    for id in pairs(readGlobals) do
        local name = globalScope:getVariableName(id) or ""
        if name:sub(1, 1) == "_" then
            readGlobals[id] = nil
        end
    end

    if next(readGlobals) == nil then return ast end

    
    local orderedIds = {}
    local idToIndex  = {}
    for id in pairs(readGlobals) do
        table.insert(orderedIds, id)
    end
    
    table.sort(orderedIds, function(a, b)
        return (globalScope:getVariableName(a) or "") < (globalScope:getVariableName(b) or "")
    end)
    for i, id in ipairs(orderedIds) do
        idToIndex[id] = i
    end

    
    local mainBlock  = ast.body
    local mainScope  = mainBlock.scope
    local helperId   = mainScope:addVariable()

    
    
    local entries    = {}
    local skipNodes  = {}
    for _, id in ipairs(orderedIds) do
        local entryNode = Ast.VariableExpression(globalScope, id)
        skipNodes[entryNode] = true
        table.insert(entries, Ast.TableEntry(entryNode))
    end

    local helperDecl = Ast.LocalVariableDeclaration(
        mainScope,
        { helperId },
        { Ast.TableConstructorExpression(entries) }
    )

    
    table.insert(mainBlock.statements, 1, helperDecl)

    
    
    visitast(ast, nil, function(node, data)
        if node.kind == AstKind.VariableExpression
            and node.scope == globalScope
            and idToIndex[node.id]
            and not skipNodes[node]
        then
            local idx = idToIndex[node.id]
            
            globalScope:removeReference(node.id)
            
            
            
            if not data.scope.isGlobal then
                data.scope:addReferenceToHigherScope(mainScope, helperId)
            end
            local helperRef = Ast.VariableExpression(mainScope, helperId)
            return Ast.IndexExpression(helperRef, Ast.NumberExpression(idx))
        end
    end)

    return ast
end

return HelperTable
