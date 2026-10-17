
local Step     = require("catph.step")
local Ast      = require("catph.ast")
local visitast = require("catph.visitast")

local AstKind = Ast.AstKind

local AntiDumpConstants = Step:extend()
AntiDumpConstants.Name        = "AntiDumpConstants"
AntiDumpConstants.Description = "Strong anti-dump: launders numbers+strings via string.char (executor-safe)."

AntiDumpConstants.SettingsDescriptor = {
    Probability = { name="Probability", description="Chance 0-1", type="number", default=0.90, min=0, max=1 },
    MaxValue = { name="MaxValue", description="Max int", type="number", default=2147483647, min=0 },
    ProtectStrings = { name="ProtectStrings", description="Protect strings via string.char", type="boolean", default=true },
}

function AntiDumpConstants:init(settings)
    self.probability = (settings and settings.Probability) or 0.90
    self.maxValue    = (settings and settings.MaxValue) or 2147483647
    self.protectStrings = settings and settings.ProtectStrings
    if self.protectStrings == nil then self.protectStrings = true end
end

local function numNode(v) return Ast.NumberExpression(v) end

local function zeroProduct(val)
    local A = math.random(100, 0xFFFF)
    local B = math.random(1, 0xFFFF)
    local C = math.random(2, 0xFF)
    return Ast.AddExpression(Ast.MulExpression(Ast.MulExpression(Ast.AddExpression(numNode(A), numNode(B)), numNode(C)), numNode(0)), numNode(val))
end
local function addSubSplit(val)
    local K = math.random(1, 0xFFFF)
    return Ast.SubExpression(Ast.AddExpression(numNode(val), numNode(K)), numNode(K))
end
local SMALL_PRIMES = {2,3,5,7,11,13}
local function mulOnlySplit(val)
    if val == 0 then return addSubSplit(0) end
    if val % 1 ~= 0 or math.abs(val) > 2^40 then return addSubSplit(val) end
    for _,M in ipairs(SMALL_PRIMES) do
        local A = val / M
        if A % 1 == 0 and A ~= 0 then
            return Ast.MulExpression(numNode(A), numNode(M))
        end
    end
    return addSubSplit(val)
end
local function xorLike(val)
    local K = math.random(1,255)
    return Ast.AddExpression(Ast.SubExpression(numNode(val), numNode(K)), numNode(K))
end

function AntiDumpConstants:launder(val)
    local c = math.random(1,4)
    if c==1 then return zeroProduct(val)
    elseif c==2 then return addSubSplit(val)
    elseif c==3 then return mulOnlySplit(val)
    else return xorLike(val) end
end

function AntiDumpConstants:protectString(str, scope, globalScope)
    if #str==0 or #str>70 then return nil end
    
    local strId = globalScope.variablesLookup["string"]
    if not strId then
        
        globalScope:hasVariable("string")
        strId = globalScope.variablesLookup["string"]
    end
    
    if scope ~= globalScope and not scope.isGlobal then
        scope:addReferenceToHigherScope(globalScope, strId)
    else
        globalScope:addReference(strId)
    end
    local CHUNK=10
    local parts={}
    for i=1,#str,CHUNK do
        local chunk=str:sub(i, math.min(i+CHUNK-1,#str))
        local bytes={}
        for j=1,#chunk do
            local b=string.byte(chunk,j)
            bytes[j]=numNode(b)
        end
        local call = Ast.FunctionCallExpression(
            Ast.IndexExpression(Ast.VariableExpression(globalScope, strId), Ast.StringExpression("char")),
            bytes
        )
        
        parts[#parts+1]=call
    end
    local function foldConcat(lo, hi)
        if lo == hi then return parts[lo] end
        local mid = math.floor((lo + hi) / 2)
        return Ast.StrCatExpression(foldConcat(lo, mid), foldConcat(mid + 1, hi))
    end
    if #parts == 0 then return nil end
    return foldConcat(1, #parts)
end

function AntiDumpConstants:apply(ast, pipeline)
    local prob=self.probability
    local maxVal=self.maxValue
    local globalScope=ast.globalScope or ast.body.scope
    
    if not globalScope.isGlobal then
        local s = ast.body.scope
        while s and not s.isGlobal do s=s.parentScope end
        if s then globalScope=s end
    end
    visitast(ast, function(node)
        if node.kind==AstKind.LocalVariableDeclaration then
            local n = math.min(#(node.ids or {}), #(node.expressions or {}))
            for i = 1, n do
                local expr = node.expressions[i]
                if expr and (expr.kind==AstKind.StringExpression or expr.kind==AstKind.LongStringExpression)
                    and (node.scope:getReferences(node.ids[i]) or 0)==0 then
                    node.expressions[i] = Ast.NilExpression()
                end
            end
        end
        return nil
    end, nil)
    visitast(ast, nil, function(node, data)
        if node.kind==AstKind.NumberExpression then
            local v=node.value
            if type(v)~="number" or v~=math.floor(v) or v<0 or v>maxVal then return nil end
            if math.random()>prob then return nil end
            return self:launder(v)
        end
        if self.protectStrings and node.kind==AstKind.StringExpression then
            if math.random()>prob then return nil end
            local s=node.value
            if type(s)~="string" or #s==0 or #s>70 then return nil end
            if s=="char" or s=="string" then return nil end
            local sc = data and data.scope or ast.body.scope
            local prot=self:protectString(s, sc, globalScope)
            if prot then return prot end
        end
    end)
    return ast
end

return AntiDumpConstants
