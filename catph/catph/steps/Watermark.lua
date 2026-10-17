




local Step = require("catph.step")
local Ast = require("catph.ast")
local Scope = require("catph.scope")
local escape = require("catph.util").escape

local Watermark = Step:extend()
Watermark.Description = "Adds a robust watermark to the script (Catph V2.0.0)"
Watermark.Name = "Watermark2zvh"

Watermark.SettingsDescriptor = {
  Content = {
    name = "Content",
    description = "The Content of the Watermark",
    type = "string",
    default = "Hi2zvh"
  },
  CustomVariable = {
    name = "Custom Variable",
    description = "The Variable that will be used for the Watermark",
    type = "string",
    default = "By2zvh",
  }
}

function Watermark:init(settings)

end

function Watermark:apply(ast)
  local body = ast.body;
  if string.len(self.Content) > 0 then
    local scope, variable = ast.globalScope:resolve(self.CustomVariable);
    local decl = Ast.LocalVariableDeclaration(scope, { variable }, {});
    local set = Ast.AssignmentStatement({
      Ast.AssignmentVariable(ast.globalScope, variable)
    }, {
      Ast.StringExpression(self.Content)
    });
    table.insert(ast.body.statements, 1, decl)
    table.insert(ast.body.statements, 1, set)
  end
end

return Watermark
