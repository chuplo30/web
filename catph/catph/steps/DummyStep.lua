local Step = require("catph.step");
local Ast = require("catph.ast");
local Scope = require("catph.scope");
local visitast = require("catph.visitast");
local util = require("catph.util");
local RandomStrings = require("catph.randomStrings");

local AstKind = Ast.AstKind;

local DummyStep = Step:extend();
DummyStep.Description = "Injects semantics-preserving noise into the AST to resist fingerprinting.";
DummyStep.Name = "DummyStep";

DummyStep.SettingsDescriptor = {
    Intensity = {
        name = "Intensity",
        description = "Probability (0..1) that a block gets noise injected",
        type = "number",
        default = 0.3,
        min = 0,
        max = 1,
    },
}

function DummyStep:init(settings)
end

function DummyStep:generateNoop(scope)
    local kind = math.random(1, 10);
    if kind == 1 then
        local innerScope = Scope:new(scope);
        return Ast.DoStatement(Ast.Block({}, innerScope));
    elseif kind == 2 then
        local innerScope = Scope:new(scope);
        local dummyVar = innerScope:addVariable();
        return Ast.DoStatement(Ast.Block({
            Ast.LocalVariableDeclaration(innerScope, {dummyVar}, {
                Ast.NumberExpression(math.random(0, 2^20))
            });
        }, innerScope));
    elseif kind == 3 then
        local innerScope = Scope:new(scope);
        local dummyVar = innerScope:addVariable();
        return Ast.DoStatement(Ast.Block({
            Ast.LocalVariableDeclaration(innerScope, {dummyVar}, {
                Ast.BooleanExpression(math.random() > 0.5)
            });
        }, innerScope));
    elseif kind == 4 then
        local innerScope = Scope:new(scope);
        local condScope = Scope:new(innerScope);
        return Ast.DoStatement(Ast.Block({
            Ast.IfStatement(
                Ast.BooleanExpression(false),
                Ast.Block({}, condScope),
                {}, nil
            );
        }, innerScope));
    elseif kind == 5 then
        local innerScope = Scope:new(scope);
        local dummyVar1 = innerScope:addVariable();
        local dummyVar2 = innerScope:addVariable();
        return Ast.DoStatement(Ast.Block({
            Ast.LocalVariableDeclaration(innerScope, {dummyVar1, dummyVar2}, {
                Ast.NilExpression(),
                Ast.NilExpression(),
            });
        }, innerScope));
    elseif kind == 6 then
        local innerScope = Scope:new(scope);
        local dummyVar = innerScope:addVariable();
        local condScope = Scope:new(innerScope);
        local a = math.random(1, 2^14);
        return Ast.DoStatement(Ast.Block({
            Ast.LocalVariableDeclaration(innerScope, {dummyVar}, {
                Ast.NumberExpression(math.random(0, 2^20))
            });
            Ast.IfStatement(
                Ast.LessThanExpression(
                    Ast.VariableExpression(innerScope, dummyVar),
                    Ast.NumberExpression(0)
                ),
                Ast.Block({
                    Ast.AssignmentStatement(
                        {Ast.AssignmentVariable(innerScope, dummyVar)},
                        {Ast.NumberExpression(a)}
                    )
                }, condScope),
                {}, nil
            );
        }, innerScope));
    elseif kind == 7 then
        local innerScope = Scope:new(scope);
        local dummyVar = innerScope:addVariable();
        return Ast.DoStatement(Ast.Block({
            Ast.LocalVariableDeclaration(innerScope, {dummyVar}, {
                Ast.StringExpression(RandomStrings.randomString(math.random(4, 12)))
            });
        }, innerScope));
    elseif kind == 8 then
        local innerScope = Scope:new(scope);
        local dummyVar = innerScope:addVariable();
        return Ast.DoStatement(Ast.Block({
            Ast.LocalVariableDeclaration(innerScope, {dummyVar}, {
                Ast.TableConstructorExpression({
                    Ast.TableEntry(Ast.NumberExpression(math.random(0, 2^16))),
                    Ast.TableEntry(Ast.BooleanExpression(math.random() > 0.5)),
                })
            });
        }, innerScope));
    elseif kind == 9 then
        local innerScope = Scope:new(scope);
        local dummyVar1 = innerScope:addVariable();
        local dummyVar2 = innerScope:addVariable();
        return Ast.DoStatement(Ast.Block({
            Ast.LocalVariableDeclaration(innerScope, {dummyVar1}, {
                Ast.NumberExpression(math.random(1, 2^16))
            });
            Ast.LocalVariableDeclaration(innerScope, {dummyVar2}, {
                Ast.AddExpression(
                    Ast.VariableExpression(innerScope, dummyVar1),
                    Ast.NumberExpression(math.random(1, 2^10))
                )
            });
        }, innerScope));
    else
        local innerScope = Scope:new(scope);
        local condScope = Scope:new(innerScope);
        local n = math.random(2, 100);
        return Ast.DoStatement(Ast.Block({
            Ast.IfStatement(
                Ast.GreaterThanExpression(
                    Ast.NumberExpression(0),
                    Ast.MulExpression(Ast.NumberExpression(n), Ast.NumberExpression(n))
                ),
                Ast.Block({
                    Ast.AssignmentStatement(
                        {Ast.AssignmentVariable(innerScope, innerScope:addVariable())},
                        {Ast.StringExpression(RandomStrings.randomString(math.random(6, 14)))}
                    )
                }, condScope),
                {}, nil
            );
        }, innerScope));
    end
end

function DummyStep:apply(ast, pipeline)
    visitast(ast, nil, function(node, data)
        if node.kind == AstKind.Block and node.statements and #node.statements > 0 then
            if math.random() <= self.Intensity then
                local nNoops = math.random(1, 2);
                for i = 1, nNoops do
                    local maxPos = #node.statements + 1;
                    local lastKind = node.statements[#node.statements] and node.statements[#node.statements].kind;
                    if lastKind == AstKind.ReturnStatement or
                       lastKind == AstKind.BreakStatement or
                       lastKind == AstKind.ContinueStatement then
                        maxPos = #node.statements;
                    end
                    if maxPos >= 1 then
                        local pos = math.random(1, maxPos);
                        local noop = self:generateNoop(node.scope);
                        table.insert(node.statements, pos, noop);
                    end
                end
            end
        end
    end);

    return ast;
end

return DummyStep;
