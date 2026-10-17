local Step = require("catph.step");
local vm = require("catph.2zvhVM.main");

local _2zvhVM = Step:extend();
_2zvhVM.Description = "This Step will actually Compile your script into a fully-custom (not a half custom like other lua obfuscators) Bytecode Format and emit a vm for executing it.";
_2zvhVM.Name = "VM";

_2zvhVM.SettingsDescriptor = {
}

function _2zvhVM:init(settings)
	
end

function _2zvhVM:apply(ast)
	local vm = vm:new();
    return vm:build(ast);
end

return _2zvhVM;