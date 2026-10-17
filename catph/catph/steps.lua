




local function safeRequire(mod)
    local ok, result = pcall(require, mod)
    if ok then return result end
    return nil
end

return {
MacroExpand           = require("catph.steps.MacroExpand");
WrapInFunction        = require("catph.steps.WrapInFunction");
SplitStrings          = require("catph.steps.SplitStrings");
Vmify                 = require("catph.steps.Vmify");
ConstantArray         = safeRequire("catph.steps.ConstantArray");
ProxifyLocals         = safeRequire("catph.steps.ProxifyLocals");
AntiTamper            = safeRequire("catph.steps.AntiTamper");
EncryptStrings        = safeRequire("catph.steps.EncryptStrings");
NumbersToExpressions  = require("catph.steps.NumbersToExpressions");
AddVararg             = safeRequire("catph.steps.AddVararg");
WatermarkCheck        = require("catph.steps.WatermarkCheck");
DummyStep             = require("catph.steps.DummyStep");
LuauBytecode          = safeRequire("catph.steps.LuauBytecode");
EnhancedVmCompression = safeRequire("catph.steps.EnhancedVmCompression");

["VM Compression"]    = safeRequire("catph.steps.EnhancedVmCompression");

VmEncryption          = safeRequire("catph.steps.VmEncryption");
["VM Encryption"]     = safeRequire("catph.steps.VmEncryption");
ControlFlowFlattening = require("catph.steps.ControlFlowFlattening");
CustomVM              = safeRequire("catph.steps.CustomVM");
IronBrew2VM           = safeRequire("catph.steps.IronBrew2VM");
LuacVM                = safeRequire("catph.steps.LuacVM");
ReturnTable           = require("catph.steps.ReturnTable");
SADOX_INLINE          = safeRequire("catph.steps.SadoxInline");
OpaquePredicates      = require("catph.steps.OpaquePredicates");
DeadCode              = require("catph.steps.DeadCode");
HelperTable           = require("catph.steps.HelperTable");
VariableSplitting     = require("catph.steps.VariableSplitting");
StringXOR             = require("catph.steps.StringXOR");
CatphEncurl           = require("catph.steps.CatphEncurl");
AntiDumpConstants     = require("catph.steps.AntiDumpConstants");
LuraphMetatable       = safeRequire("catph.steps.LuraphMetatable");
MemeString            = safeRequire("catph.steps.MemeString");
RobloxAntiTamper      = safeRequire("catph.steps.RobloxAntiTamper");
GoofyAntiTamper       = safeRequire("catph.steps.GoofyAntiTamper");
EnvLoggerBypass       = safeRequire("catph.steps.EnvLoggerBypass");
EnvLoggerCheck        = safeRequire("catph.steps.EnvLoggerCheck");
MetaAntiTamper        = safeRequire("catph.steps.MetaAntiTamper");
AntiTamperEngine      = safeRequire("catph.steps.AntiTamperEngine");
TamperGuard           = safeRequire("catph.steps.TamperGuard");
ChecksumChunk         = safeRequire("catph.steps.ChecksumChunk");
TerrainAntiTamper     = safeRequire("catph.steps.TerrainAntiTamper");
SharedTableAntiTamper = safeRequire("catph.steps.SharedTableAntiTamper");
SetmetableAntiTamper = safeRequire("catph.steps.SetmetableAntiTamper");
WrapMainLogic         = safeRequire("catph.steps.WrapMainLogic");
WrapNoGate            = safeRequire("catph.steps.WrapNoGate");
RATAntiTamper         = safeRequire("catph.steps.RATAntiTamper");
HexPrelude            = safeRequire("catph.steps.HexPrelude");
FuncInline            = safeRequire("catph.steps.FuncInline");
ConstScatter          = safeRequire("catph.steps.ConstScatter");
SplitFunctions        = safeRequire("catph.steps.SplitFunctions");
}
