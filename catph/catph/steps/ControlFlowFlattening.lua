local Step     = require("catph.step")
local Ast      = require("catph.ast")
local Scope    = require("catph.scope")
local visitast = require("catph.visitast")
local AstKind  = Ast.AstKind

local HOT_CALLERS = {

    Connect         = true,
    connect         = true,

    spawn           = true,
    defer           = true,
    delay           = true,

    ["task.spawn"]  = true,
    ["task.defer"]  = true,
    ["task.delay"]  = true,

    wrap            = true,
    create          = true,

    pcall           = true,
    xpcall          = true,

    newcclosure     = true,
    hookfunction    = true,
}

local function randState()

    return math.random(0x1000, 0x7FFFFF)
end

local function makeStateAssign(stateScope, stateId, value)

    local A = math.random(1, math.max(1, math.floor(value / 2)))
    local B = value - A
    return Ast.AssignmentStatement(
        { Ast.AssignmentVariable(stateScope, stateId) },
        { Ast.AddExpression(
            Ast.NumberExpression(A),
            Ast.NumberExpression(B)
          )
        }
    )
end

local function buildFlatLoop(groups, stateScope, stateId, exitState)
    local elseifs = {}
    for i = 2, #groups do
        local g = groups[i]
        local stmts = {}
        for _, s in ipairs(g.stmts) do stmts[#stmts + 1] = s end

        if not g.isTerminal then
            local nextState = (i < #groups) and groups[i + 1].state or exitState
            stmts[#stmts + 1] = makeStateAssign(stateScope, stateId, nextState)
        end
        local blkScope = Scope:new(stateScope)
        table.insert(elseifs, {
            condition = Ast.EqualsExpression(
                Ast.VariableExpression(stateScope, stateId),
                Ast.NumberExpression(g.state)
            ),
            body = Ast.Block(stmts, blkScope),
        })
    end

    local g1 = groups[1]
    local stmts1 = {}
    for _, s in ipairs(g1.stmts) do stmts1[#stmts1 + 1] = s end
    if not g1.isTerminal then
        local nextState1 = (#groups > 1) and groups[2].state or exitState
        stmts1[#stmts1 + 1] = makeStateAssign(stateScope, stateId, nextState1)
    end
    local blkScope1 = Scope:new(stateScope)
    local ifStat = Ast.IfStatement(
        Ast.EqualsExpression(
            Ast.VariableExpression(stateScope, stateId),
            Ast.NumberExpression(g1.state)
        ),
        Ast.Block(stmts1, blkScope1),
        elseifs,
        nil
    )

    local loopScope = Scope:new(stateScope)
    local loopBody  = Ast.Block({ ifStat }, loopScope)
    return Ast.WhileStatement(
        loopBody,
        Ast.NotEqualsExpression(
            Ast.VariableExpression(stateScope, stateId),
            Ast.NumberExpression(exitState)
        ),
        stateScope
    )
end

local CFF = Step:extend()
CFF.Name        = "ControlFlowFlattening"
CFF.Description = "Catsx on top nigga skibidi dom dom yes yes"

CFF.SettingsDescriptor = {
    MinStatements = {
        type        = "number",
        default     = 4,
        min         = 2,
        max         = 100,
        description = "min number flat shit",
    },
    Probability = {
        type        = "number",
        default     = 1.0,
        min         = 0,
        max         = 1,
        description = "Probability flatten yaamate",
    },
}

function CFF:init(settings) end

local function isHotPathArg(node, parentNode)
    if not parentNode then return false end

    if parentNode.kind == AstKind.FunctionCallExpression or
       parentNode.kind == AstKind.FunctionCallStatement then
        local isArg = false
        if parentNode.args then
            for _, a in ipairs(parentNode.args) do
                if a == node then isArg = true; break end
            end
        end
        if not isArg then return false end

        local base = parentNode.base
        if not base then return false end

        if base.kind == AstKind.VariableExpression then
            local name = base.scope and base.scope:getVariableName(base.id)
            if name and HOT_CALLERS[name] then return true end
        end

        if base.kind == AstKind.IndexExpression then
            local idx = base.index
            if idx and idx.kind == AstKind.StringExpression then
                if HOT_CALLERS[idx.value] then return true end
            end
        end
    end

    local psKind = parentNode.kind
    if psKind == "PassSelfFunctionCallStatement" or
       psKind == "PassSelfFunctionCallExpression" then
        local isArg = false
        if parentNode.args then
            for _, a in ipairs(parentNode.args) do
                if a == node then isArg = true; break end
            end
        end
        if not isArg then return false end

        local methodName = parentNode.passSelfFunctionName
        if methodName and HOT_CALLERS[methodName] then return true end

    end

    return false
end

local function splitIntoGroups(stmts)
    local groups = {}
    for i = 1, #stmts do
        local sk = stmts[i].kind
        local isExit = sk == AstKind.ReturnStatement or
                       sk == AstKind.BreakStatement  or
                       sk == AstKind.ContinueStatement
        groups[#groups + 1] = {
            state      = randState(),
            stmts      = { stmts[i] },
            isTerminal = isExit,
        }
    end
    return groups
end

function CFF:apply(ast, pipeline)

    local parentStack = {}

    visitast(ast, function(node, data)

        parentStack[#parentStack + 1] = node
    end, function(node, data)

        parentStack[#parentStack] = nil

        local body
        if node.kind == AstKind.FunctionLiteralExpression then
            body = node.body
        elseif node.kind == AstKind.LocalFunctionDeclaration or
               node.kind == AstKind.FunctionDeclaration then
            body = node.body
        else
            return
        end

        if math.random() > self.Probability then return end

        if node.kind == AstKind.FunctionLiteralExpression then
            local parent = parentStack[#parentStack]
            if isHotPathArg(node, parent) then return end
        end
        if not body or not body.statements then return end
        local stmts = body.statements

        if #stmts < self.MinStatements then return end

        for _, s in ipairs(stmts) do
            if s.kind == AstKind.WhileStatement then return end
        end

        local fnScope = body.scope

        local hoistedIds = {}
        local splitStmts = {}

        for _, stmt in ipairs(stmts) do
            if stmt.kind == AstKind.LocalVariableDeclaration then
                for _, id in ipairs(stmt.ids) do
                    hoistedIds[#hoistedIds + 1] = id
                end
                if stmt.expressions and #stmt.expressions > 0 then
                    local lhs = {}
                    for _, id in ipairs(stmt.ids) do
                        lhs[#lhs + 1] = Ast.AssignmentVariable(fnScope, id)
                    end
                    splitStmts[#splitStmts + 1] = Ast.AssignmentStatement(lhs, stmt.expressions)
                end
            else
                splitStmts[#splitStmts + 1] = stmt
            end
        end

        if #splitStmts < 2 then return end

        local groups = splitIntoGroups(splitStmts)
        if #groups < 2 then return end

        local seen = {}
        for _, g in ipairs(groups) do
            while seen[g.state] do g.state = randState() end
            seen[g.state] = true
        end

        local EXIT_STATE = 0

        local _suffixes = {"_fs","_st","_pc","_sw","_dp","_rt","_vm","_cx","_bx","_nc"}
        local _sfx = _suffixes[math.random(1, #_suffixes)]
        local stateId    = fnScope:addVariable(_sfx .. tostring(math.random(100,999)))
        local entryState = groups[1].state
        local stateDecl  = Ast.LocalVariableDeclaration(
            fnScope, { stateId }, { Ast.NumberExpression(entryState) }
        )

        local hoistDecl = nil
        if #hoistedIds > 0 then
            hoistDecl = Ast.LocalVariableDeclaration(fnScope, hoistedIds, {})
        end

        local whileLoop = buildFlatLoop(groups, fnScope, stateId, EXIT_STATE)

        if hoistDecl then
            body.statements = { hoistDecl, stateDecl, whileLoop }
        else
            body.statements = { stateDecl, whileLoop }
        end
    end)

    return ast
end

return CFF
