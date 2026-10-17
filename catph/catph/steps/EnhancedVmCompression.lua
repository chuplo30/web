























local Step      = require("catph.step")
local Parser    = require("catph.parser")
local Unparser  = require("catph.unparser")
local Enums     = require("catph.enums")
local Vmcodec   = require("catph.vmcodec")
local logger    = require("logger")

local EnhancedVmCompression = Step:extend()
EnhancedVmCompression.Name = "VM Compression"
EnhancedVmCompression.Description =
    "Compresses and text-encodes the emitted VM program, injecting a compact runtime loader stub. " ..
    "Pure size reduction — no security benefit. Use VM Encryption for security."

EnhancedVmCompression.SettingsDescriptor = {
    Enabled = {
        type = "boolean",
        default = true,
        description = "Master switch. When false the step is a no-op.",
    },
    Algorithm = {
        type = "enum",
        default = "zlib",
        values = { "zlib", "lzma", "none" },
        description = "Compression algorithm. zlib/lzma use the portable built-in LZW codec; none only encodes.",
    },
    Encode = {
        type = "enum",
        default = "b85",
        values = { "b85", "base64" },
        description = "Text encoding used to embed the compressed bytes.",
    },
    Level = {
        type = "number",
        default = 6,
        min = 0,
        max = 9,
        description = "Compression level hint (accepted for API parity; the built-in LZW codec ignores it).",
    },
    MinGain = {
        type = "number",
        default = 0.05,
        min = 0,
        max = 1,
        description = "Minimum size-reduction ratio required to apply compression; otherwise the step is skipped.",
    },
    Mode = {
        type = "enum",
        default = "source",
        values = { "source", "vmimage" },
        description = "source = compress the full emitted program (portable). vmimage = reserved.",
    },
    AlwaysEmbed = {
        type = "boolean",
        default = false,
        description = "When true, embed the (encoded) blob even if MinGain is not met.",
    },
}

local HELPER_PROLOGUE = ""

function EnhancedVmCompression:init(settings) end

local function nativeZlibAvailable()
    local ok = pcall(require, "zlib")
    return ok
end

function EnhancedVmCompression:apply(ast, pipeline)
    if _G.__2zvh_no_compression then
        logger:info("VM Compression: disabled via --compression false.")
        return ast
    end
    if not self.Enabled then
        logger:info("VM Compression: disabled, skipping.")
        return ast
    end

    local luaVersion = pipeline.LuaVersion or Enums.LuaVersion.LuaU

    local unparser = Unparser:new({ LuaVersion = luaVersion })
    local fullSrc  = unparser:unparse(ast)
    local baseline = #fullSrc

    local payloadSrc = HELPER_PROLOGUE .. fullSrc

    local algorithm = self.Algorithm
    if algorithm ~= "none" then
        if nativeZlibAvailable() then
            logger:info(string.format(
                "VM Compression: native zlib detected but using the portable built-in codec for \"%s\".",
                algorithm))
        else
            logger:info(string.format(
                "VM Compression: no native \"%s\" binding; using the portable built-in LZW codec.",
                algorithm))
        end
    end

    if self.Mode == "vmimage" then
        logger:info("VM Compression: \"vmimage\" mode compresses the full program image.")
    end

    local encText   = Vmcodec.encode(payloadSrc, algorithm, self.Encode)
    local chunkName = (self.Mode == "vmimage") and "=(vmimage)" or "=(compressed)"
    local stubSrc   = Vmcodec.buildLoaderSource(encText, algorithm, self.Encode, chunkName)

    local gain = (baseline - #stubSrc) / baseline
    logger:info(string.format(
        "VM Compression: baseline %d B, loader %d B, encoded %d B, reduction %.1f%% (MinGain %.1f%%).",
        baseline, #stubSrc, #encText, gain * 100, self.MinGain * 100))

    if algorithm ~= "none" and gain < self.MinGain and not self.AlwaysEmbed then
        logger:info("VM Compression: reduction below MinGain, leaving AST unmodified.")
        return ast
    end

    local newAst = Parser:new({ LuaVersion = luaVersion }):parse(stubSrc)
    return newAst
end

return EnhancedVmCompression
