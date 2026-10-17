local Step      = require("catph.step")
local Ast       = require("catph.ast")
local visitast  = require("catph.visitast")
local Parser    = require("catph.parser")
local Unparser  = require("catph.unparser")
local logger    = require("logger")

local AstKind   = Ast.AstKind

















local FuncInline = Step:extend()
FuncInline.Name = "FuncInline"
FuncInline.Description = "Inlines FUS_INLINE-tagged zero-arg pure functions (single return, no upvalues). Executor-safe."
FuncInline.SettingsDescriptor = {}

function FuncInline:init(settings)
    settings = settings or {}
    self.Enabled = settings.Enabled ~= false
end


local function deepCopyExpr(expr, luaVersion)
    local unp = Unparser:new({ LuaVersion = luaVersion })
    local src = "return " .. unp:unparseExpression(expr)
    local ok, parsed = pcall(function()
        return Parser:new({ LuaVersion = luaVersion }):parse(src)
    end)
    if not ok or not parsed then return nil end
    local ret = parsed.body.statements[1]
    if not ret or ret.kind ~= AstKind.ReturnStatement then return nil end
    return ret.expressions[1]
end

function FuncInline:apply(ast, pipeline)
    if not self.Enabled then return ast end
    local lv = pipeline.LuaVersion

    
    local inlineLocs = {}
    visitast(ast, nil, function(node)
        if node.kind == AstKind.LocalVariableDeclaration then
            local ids = node.ids
            local exs = node.expressions
            for i, id in ipairs(ids) do
                local ex = exs[i]
                if ex and ex.kind == AstKind.FunctionLiteralExpression and ex.__fus_inline then
                    local hasParams = ex.params and #ex.params > 0
                    local hasVararg = ex.hasVararg
                    if not hasParams and not hasVararg and ex.body then
                        local sts = ex.body.statements
                        if #sts == 1 and sts[1].kind == AstKind.ReturnStatement then
                            local r = sts[1]
                            if r.expressions and #r.expressions == 1 then
                                inlineLocs[id] = r.expressions[1]
                            end
                        end
                    end
                end
            end
        end
    end)
    if not next(inlineLocs) then return ast end

    
    local replaced = false
    visitast(ast, nil, function(node)
        if node.kind ~= AstKind.FunctionCallExpression then return nil end
        local base = node.base
        if not base or base.kind ~= AstKind.VariableExpression then return nil end
        local bodyExpr = inlineLocs[base.id]
        if not bodyExpr then return nil end
        local args = node.args or {}
        if #args ~= 0 then return nil end
        local copy = deepCopyExpr(bodyExpr, lv)
        if not copy then return nil end
        replaced = true
        return copy
    end)

    if replaced then
        logger:info("FuncInline: inlined zero-arg pure functions at call sites.")
    end
    return ast
end

return FuncInline
