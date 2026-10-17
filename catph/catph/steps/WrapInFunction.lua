




local Step = require("catph.step");
local Ast = require("catph.ast");
local Scope = require("catph.scope");

local WrapInFunction = Step:extend();
WrapInFunction.Description = "This Step Wraps the Entire Script into a Function";
WrapInFunction.Name = "Wrap in Function";

WrapInFunction.SettingsDescriptor = {
	Iterations = {
		name = "Iterations",
		description = "The Number Of Iterations",
		type = "number",
		default = 1,
		min = 1,
		max = nil,
	}
}

function WrapInFunction:init(settings)
	
end

function WrapInFunction:apply(ast)
	for i = 1, self.Iterations, 1 do
		local body = ast.body;

		local scope = Scope:new(ast.globalScope);
		body.scope:setParent(scope);

		
		
		local args = {}
		for _=1,13 do
			local id = scope:addVariable()
			args[#args+1] = Ast.VariableExpression(scope, id)
		end
		args[#args+1] = Ast.VarargExpression()

		ast.body = Ast.Block({
			Ast.ReturnStatement({
				Ast.FunctionCallExpression(Ast.FunctionLiteralExpression(args, body), {Ast.VarargExpression()})
			});
		}, scope);
	end
end

return WrapInFunction;