












unpack = unpack or table.unpack;

local Step = require("catph.step");
local Ast = require("catph.ast");
local Scope = require("catph.scope");
local visitast = require("catph.visitast");
local util     = require("catph.util")

local AstKind = Ast.AstKind;

local NumbersToExpressions = Step:extend();
NumbersToExpressions.Description = "Converts number literals to Luraph-style hex obfuscated expressions (Catph V1.0.0)";
NumbersToExpressions.Name = "Numbers To Expressions";

NumbersToExpressions.SettingsDescriptor = {
    Treshold = {
        type = "number",
        default = 1,
        min = 0,
        max = 1,
    },
    InternalTreshold = {
        type = "number",
        default = 0.15,
        min = 0,
        max = 0.8,
    }
}

function NumbersToExpressions:init(settings)
    self.ExpressionGenerators = {
        
        function(val, depth)
            local val2 = math.random(-2^16, 2^16);
            local diff = val - val2;
            if tonumber(tostring(diff)) + tonumber(tostring(val2)) ~= val then
                return false;
            end
            return Ast.AddExpression(self:CreateNumberExpression(val2, depth), self:CreateNumberExpression(diff, depth), false);
        end,
        
        function(val, depth)
            local val2 = math.random(-2^16, 2^16);
            local diff = val + val2;
            if tonumber(tostring(diff)) - tonumber(tostring(val2)) ~= val then
                return false;
            end
            return Ast.SubExpression(self:CreateNumberExpression(diff, depth), self:CreateNumberExpression(val2, depth), false);
        end,
        
        function(val, depth)
            if val ~= val or val == 0 or val % 1 ~= 0 then return false end
            local absVal = math.abs(val);
            if absVal > 2^44 then return false end
            local factors = {2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16};
            util.shuffle(factors);
            for _, B in ipairs(factors) do
                local A = absVal / B;
                if A % 1 == 0 and A ~= 0 then
                    if val < 0 then A = -A end
                    return Ast.MulExpression(
                        self:CreateNumberExpression(A, depth),
                        self:CreateNumberExpression(B, depth),
                        false
                    );
                end
            end
            return false;
        end,
        
        function(val, depth)
            local k = math.random(-2^16, 2^16);
            local sum = val + k;
            if tonumber(tostring(sum)) - tonumber(tostring(k)) ~= val then
                return false;
            end
            return Ast.SubExpression(self:CreateNumberExpression(sum, depth), self:CreateNumberExpression(k, depth), false);
        end,
        
        
        
        function(val, depth)
            if depth > 0 then return false end
            local A = math.random(100, 0xFFFF)
            local B = math.random(2, 10)   
            local C = math.random(1, 0xFFFF)
            
            local powExpr = Ast.PowExpression(Ast.NumberExpression(A), Ast.NumberExpression(B))
            local addC    = Ast.AddExpression(powExpr, Ast.NumberExpression(C))
            local mulZero = Ast.MulExpression(addC, Ast.NumberExpression(0))
            return Ast.AddExpression(mulZero, Ast.NumberExpression(val))
        end,
    }
end

function NumbersToExpressions:CreateNumberExpression(val, depth)
    if depth > 0 and math.random() >= self.InternalTreshold or depth > 12 then
        return Ast.NumberExpression(val)
    end

    local generators = util.shuffle({unpack(self.ExpressionGenerators)});
    for i, generator in ipairs(generators) do
        local node = generator(val, depth + 1);
        if node then
            return node;
        end
    end

    return Ast.NumberExpression(val)
end

function NumbersToExpressions:apply(ast)
    visitast(ast, nil, function(node, data)
        if node.kind == AstKind.NumberExpression then
            if math.random() <= self.Treshold then
                return self:CreateNumberExpression(node.value, 0);
            end
        end
    end)
end

return NumbersToExpressions;
