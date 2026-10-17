local Step = require("catph.step")
local Ast = require("catph.ast")
local Scope = require("catph.scope")
local AstKind = require("catph.ast").AstKind




















local SplitFunctions = Step:extend()
SplitFunctions.Name = "SplitFunctions"
SplitFunctions.Description = "Splits program into many nested chunks (safe-only, semantics-preserving) and injects hundreds of real stub functions so output contains hundreds of functions."
SplitFunctions.SettingsDescriptor = {
    TargetFunctions = { type = "number", default = 200, min = 1 },
    Junk = { type = "boolean", default = true },
    RealSplit = { type = "boolean", default = true },
}

function SplitFunctions:init(settings)
    self.target = self.TargetFunctions or 200
    self.enableJunk = self.Junk ~= false
    self.enableRealSplit = self.RealSplit == true
end




local function isScope(n)
    return type(n) == "table" and n.variablesLookup ~= nil
end



local function statReads(stat, scopes)
    local reads = {}
    local visited = {}
    local function walk(n)
        if type(n) ~= "table" or visited[n] then return end
        visited[n] = true
        if isScope(n) then return end
        if n.kind == AstKind.VariableExpression and n.scope and scopes[n.scope] and type(n.id) == "number" then
            reads[n.id] = true
        end
        for _, v in pairs(n) do
            if type(v) == "table" then walk(v) end
        end
    end
    walk(stat)
    return reads
end


local function statDeclares(stat)
    local decls = {}
    local visited = {}
    local function walk(n)
        if type(n) ~= "table" or visited[n] then return end
        visited[n] = true
        if isScope(n) then return end
        if n.kind == AstKind.LocalVariableDeclaration and n.ids then
            for _, v in ipairs(n.ids) do
                if type(v) == "number" then decls[v] = true end
            end
        end
        for _, v in pairs(n) do
            if type(v) == "table" then walk(v) end
        end
    end
    walk(stat)
    return decls
end



local function indexScopes(node, scopes)
    local visited = {}
    local function walk(n)
        if type(n) ~= "table" or visited[n] then return end
        visited[n] = true
        if isScope(n) then
            scopes[n] = true
            return
        end
        if n.scope then scopes[n.scope] = true end
        for _, v in pairs(n) do
            if type(v) == "table" then walk(v) end
        end
    end
    walk(node)
end

function SplitFunctions:apply(ast, pipeline)
    local top = ast.body

    
    local mainFunc
    for _, s in ipairs(top.statements) do
        if s and s.kind == AstKind.LocalFunctionDeclaration then
            mainFunc = s
            break
        end
    end
    local mb = mainFunc and mainFunc.body
    local body = mb or top
    local stmts = body.statements or {}
    local result = {}

    
    
    
    if self.enableRealSplit and mb and #stmts >= 2 then
        local unsafe = false
        for _, s in ipairs(stmts) do
            if s and (s.kind == AstKind.ReturnStatement
                   or s.kind == AstKind.BreakStatement
                   or s.kind == AstKind.ContinueStatement) then
                unsafe = true
                break
            end
        end

        if not unsafe then
            local scopes = {}
            indexScopes(ast, scopes)

            
            
            
            local finalChunks = {}
            local cur = {}
            local live = {}
            for _, stat in ipairs(stmts) do
                local decls = statDeclares(stat)
                local reads = statReads(stat, scopes)
                local crosses = false
                for id in pairs(reads) do
                    if live[id] then crosses = true break end
                end
                if crosses then
                    cur[#cur + 1] = stat
                else
                    if #cur > 0 then finalChunks[#finalChunks + 1] = cur; cur = {} end
                    cur[#cur + 1] = stat
                end
                for id in pairs(decls) do live[id] = true end
            end
            if #cur > 0 then finalChunks[#finalChunks + 1] = cur end

            if #finalChunks >= 2 then
                local M = body.scope
                local function buildChain(level, scopeHere)
                    local slice = finalChunks[level]
                    local stmtsCopy = {}
                    for _, st in ipairs(slice) do stmtsCopy[#stmtsCopy + 1] = st end
                    if level < #finalChunks then
                        local innerScope = Scope:new(scopeHere)
                        local innerDecl, innerCall = buildChain(level + 1, innerScope)
                        stmtsCopy[#stmtsCopy + 1] = innerDecl
                        stmtsCopy[#stmtsCopy + 1] = innerCall
                        local fnId = scopeHere:addVariable()
                        local decl = Ast.LocalFunctionDeclaration(
                            scopeHere, fnId, { Ast.VarargExpression() },
                            Ast.Block(stmtsCopy, innerScope))
                        local call = Ast.FunctionCallStatement(
                            Ast.VariableExpression(scopeHere, fnId), {})
                        return decl, call
                    else
                        local fnId = scopeHere:addVariable()
                        local decl = Ast.LocalFunctionDeclaration(
                            scopeHere, fnId, { Ast.VarargExpression() },
                            Ast.Block(stmtsCopy, scopeHere))
                        local call = Ast.FunctionCallStatement(
                            Ast.VariableExpression(scopeHere, fnId), {})
                        return decl, call
                    end
                end

                local rootScope = Scope:new(M)
                local rootDecl, rootCall = buildChain(1, rootScope)
                result[#result + 1] = rootDecl
                result[#result + 1] = rootCall
            else
                for _, s in ipairs(stmts) do result[#result + 1] = s end
            end
        else
            for _, s in ipairs(stmts) do result[#result + 1] = s end
        end
    else
        for _, s in ipairs(stmts) do result[#result + 1] = s end
    end

    
    
    
    
    if self.enableJunk then
        local junkScopeRoot = mainFunc and top.scope or top.scope
        local junkCount
        if mainFunc then
            
            junkCount = 0
        else
            junkCount = 0
        end
        local target = self.target
        local toAdd = math.max(0, target)
        
        local added = 0
        local rs = mb and mb.scope or top.scope
        local seed = 1000
        for j = 1, toAdd do
            
            
            
            
            seed = seed + 1
            local bodyStmts = {
                Ast.ReturnStatement({ Ast.NumberExpression(42) }),
            }
            local fnId = rs:addVariable()
            local decl = Ast.LocalFunctionDeclaration(rs, fnId, { Ast.VarargExpression() }, Ast.Block(bodyStmts, Scope:new(rs)))
            result[#result + 1] = decl
            added = added + 1
        end
        junkCount = added
    end

    body.statements = result
    return ast
end

return SplitFunctions
