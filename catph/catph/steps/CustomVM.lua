




local Step      = require("catph.step")
local Ast       = require("catph.ast")
local Parser    = require("catph.parser")
local Unparser  = require("catph.unparser")
local Enums     = require("catph.enums")
local Compiler  = require("catph.customvm.compiler")
local CvmEmit   = require("catph.customvm.emit")
local logger    = require("logger")

local CustomVM = Step:extend()
CustomVM.Name = "CustomVM"
CustomVM.Description = "Compiles AST to custom bytecode with per-build encryption and emits a self-contained VM interpreter."

CustomVM.SettingsDescriptor = {
    Renumber = {
        type = "boolean",
        default = true,
        description = "Per-build opcode permutation (defeats static analysis of the bytecode format).",
    },
    StreamCipher = {
        type = "boolean",
        default = true,
        description = "Position-dependent additive cipher over the serialized proto region.",
    },
    EncryptStrings = {
        type = "boolean",
        default = true,
        description = "Per-string cipher with per-string salt derived from a build nonce.",
    },
    Nonce = {
        type = "number",
        default = 0,
        description = "Fixed nonce for reproducible builds. 0 means random per build.",
    },
    Flatten = {
        type = "boolean",
        default = true,
        description = "Enable bytecode-level control flow flattening.",
    },
    MicroOps = {
        type = "boolean",
        default = true,
        description = "Split arithmetic ops into multi-instruction sequences.",
    },
    FlattenIntensity = {
        type = "enum",
        default = "high",
        values = { "low", "medium", "high", "max" },
        description = "CFF intensity: low (1 dispatcher, no fakes), medium, high, max (4 dispatchers, 7 fake blocks).",
    },
    FlattenMinBlocks = {
        type = "number",
        default = 3,
        min = 2,
        max = 20,
        description = "Minimum basic blocks required to apply CFF (smaller functions are skipped).",
    },
    FlattenChance = {
        type = "number",
        default = 1.0,
        min = 0,
        max = 1,
        description = "Probability (0-1) that each eligible function gets flattened.",
    },
    JunkLevel = {
        type = "number",
        default = 2,
        min = 0,
        max = 3,
        description = "Dead-code junk density inside the runtime VM: 0=none, 1=light, 2=normal, 3=heavy.",
    },
    Compress = {
        type = "boolean",
        default = true,
        description = "LZ-compress + B85-encode the VM source before embedding. Set false to skip compression.",
    },
    EnableFfiLibrary = {
        type = "boolean",
        default = false,
        description = "Load LuaJIT ffi library inside the runtime VM for LuaJIT platforms. Disabled by default.",
    },
    HardcodeGlobals = {
        type = "boolean",
        default = false,
        description = "Hardcode the globals table (_G) instead of getfenv() to improve global semantics on non-ENV platforms.",
    },
    StaticEnvironment = {
        type = "boolean",
        default = false,
        description = "Disable getfenv/setfenv usage in the emitted VM. Requires HardcodeGlobals = true for correct semantics.",
    },
    VmCompression = {
        type = "boolean",
        default = false,
        description = "Compress and load the VM via load/loadstring to significantly lower file size (alias for Compress).",
    },
    OptLevel = {
        type = "number",
        default = 1,
        min = 0,
        max = 2,
        description = "Optimization level: 0=none, 1=basic micro-ops, 2=additionally inlines constant local/upvalue registers.",
    },
    RandomizedHandlers = {
        type = "boolean",
        default = true,
        description = "Use an indirect randomized dispatch table (DISP[op] -> handler) instead of a deterministic BST dispatch.",
    },
    CoroutineRequired = {
        type = "boolean",
        default = true,
        description = "Require the coroutine library and run each VM invocation inside a coroutine (coroutine.wrap).",
    },
    Bit32Helper = {
        type = "boolean",
        default = true,
        description = "Inject a bit32 helper layer and route dispatch arithmetic through it.",
    },
    InstructionFlood = {
        type = "number",
        default = 0,
        min = 0,
        description = "Runtime-generated junk loop executed inside the bootstrapper. Adds tens of millions of executed Lua instructions without growing the output file. 0 disables.",
    },
    StackDepth = {
        type = "number",
        default = 9000,
        min = 0,
        description = "Depth of the non-tail recursion canary injected at VM start. Safe on native Luau/Lua 5.1 (under the 20000-frame stack limit) but overflows pure-Lua interpreters (FiOne/Yueliang) that consume multiple host frames per executed call. 0 disables.",
    },
    ReturnFunction = {
        type = "boolean",
        default = true,
        description = "Wrap the emitted chunk so it evaluates to a function: `return function(...) ... end` (chunk returns a callable).",
    },
    ParallelScatter = {
        type = "number",
        default = 0,
        min = 0,
        max = 8,
        description = "Spawn N Actor LocalScript decoys (Parallel Luau, task.desynchronize) that mirror the env probes + flood on secondary threads, and desynchronize the main VM invocation where supported. Blinds env loggers hooked only to the main thread. 0 disables. Fully guarded: falls back to single-thread on executors without Actor support.",
    },
}

function CustomVM:init(settings) end

function CustomVM:apply(ast, pipeline)
    
    logger:info("CustomVM: extracting anti-tamper prelude (runs as plain Lua BEFORE the VM) ...")
    local body = ast.body
    local preludeStmts = {}
    while body.statements[1] and body.statements[1].__catphAntiTamper do
        preludeStmts[#preludeStmts + 1] = table.remove(body.statements, 1)
    end

    logger:info("CustomVM: compiling AST to custom bytecode ...")
    local proto = Compiler.compile(ast)

    
    local opts = {
        renumber          = self.Renumber,
        streamCipher      = self.StreamCipher,
        encryptStrings    = self.EncryptStrings,
        flatten           = self.Flatten,
        flattenIntensity  = self.FlattenIntensity,
        flattenMinBlocks  = self.FlattenMinBlocks,
        flattenChance     = self.FlattenChance,
        microOps          = self.MicroOps,
        junkLevel         = self.JunkLevel,
        compress          = self.Compress or self.VmCompression,
        enableFfi         = self.EnableFfiLibrary,
        hardcodeGlobals   = self.HardcodeGlobals,
        staticEnvironment = self.StaticEnvironment,
        optLevel          = self.OptLevel or 1,
        randomizedHandlers = self.RandomizedHandlers ~= false,
        coroutineRequired  = self.CoroutineRequired ~= false,
        bit32Helper        = self.Bit32Helper ~= false,
        instructionFlood   = self.InstructionFlood or 0,
        stackDepth        = (self.StackDepth == nil) and 9000 or self.StackDepth,
        returnFunction    = self.ReturnFunction ~= false,
        parallelScatter   = math.floor(tonumber(self.ParallelScatter) or 0),
    }
    if self.Nonce > 0 then
        opts.nonce = self.Nonce
    end

    
    logger:info("CustomVM: emitting encrypted payload + runtime VM ...")
    local code = CvmEmit.build(proto, opts)

    if #preludeStmts > 0 then
        logger:info(string.format("CustomVM: prepending %d anti-tamper statement(s) before the VM.", #preludeStmts))
        local preludeAst = Ast.TopNode(Ast.Block(preludeStmts, body.scope), ast.globalScope)
        local preludeCode = Unparser:new({ LuaVersion = Enums.LuaVersion.LuaU }):unparse(preludeAst)
        code = preludeCode .. "\n" .. code
    end

    logger:info(string.format("CustomVM: emitted %d bytes of self-contained VM code.", #code))

    
    local newAst = Parser:new({ LuaVersion = Enums.LuaVersion.LuaU }):parse(code)
    return newAst
end

return CustomVM
