













local Step      = require("catph.step");
local Parser    = require("catph.parser");
local Unparser  = require("catph.unparser");
local Enums     = require("catph.enums");
local Reader    = require("catph.lua51.reader");
local Emit      = require("catph.lua51.emit");
local logger    = require("logger");


local function readFile(path, mode)
    local f = io.open(path, mode)
    if not f then return nil end
    local s = f:read("*a"); f:close()
    return s
end


local function interpSourcePath()
    
    
    
    local candidates = {
        "catph/lua51/interp.lua",
        "./catph/lua51/interp.lua",
        debug and debug.getinfo and (function()
            local info = debug.getinfo(1, "S")
            if info and info.source and info.source:sub(1,1) == "@" then
                local dir = info.source:sub(2):match("(.+[/\\])")
                return dir and (dir .. "../../catph/lua51/interp.lua")
            end
        end)() or nil,
    }
    for _, p in ipairs(candidates) do
        if p then
            local f = io.open(p, "r")
            if f then f:close(); return p end
        end
    end
    return "catph/lua51/interp.lua"  
end



local LuacVM = Step:extend();
LuacVM.Name        = "Lua 5.1 Bytecode VM";
LuacVM.Description = "Compiles to standard Lua 5.1 bytecode (via luac) and emits a custom VM interpreter with XOR-encrypted instruction stream.";

LuacVM.SettingsDescriptor = {
    LuacPath = {
        type    = "string",
        default = "luac",
        description = "Path to the luac (Lua 5.1 compiler) executable.",
    },
    OptLevel = {
        type    = "number",
        default = 2,
        min     = 0,
        max     = 2,
        description = "luac optimisation level (-O flag, 0-2).  2 strips debug info.",
    },
    EncryptCode = {
        type    = "boolean",
        default = true,
        description = "XOR-encrypt the instruction stream with a per-build random key.",
    },
};

function LuacVM:init() end

function LuacVM:apply(ast, pipeline)
    
    
    local unparser = Unparser:new({ LuaVersion = Enums.LuaVersion.Lua51 });
    local source   = unparser:unparse(ast);

    
    local tag     = string.format("%08X", math.random(0, 2^31 - 1));
    local tmpDir  = os.getenv("TMPDIR") or "/tmp";
    local inPath  = tmpDir .. "/_luacvm_src_" .. tag .. ".lua";
    local outPath = tmpDir .. "/_luacvm_bc_"  .. tag .. ".out";

    do
        local f = assert(io.open(inPath, "w"), "LuacVM: cannot write temp source file");
        f:write(source); f:close();
    end

    
    
    
    local flagS = self.OptLevel >= 2 and "-s " or ""
    local cmd   = string.format('"%s" %s-o "%s" "%s" 2>/dev/null', self.LuacPath, flagS, outPath, inPath);
    if package.config:sub(1,1) == "\\" then cmd = '"' .. cmd .. '"' end  
    local ok = os.execute(cmd);

    local blob = readFile(outPath, "rb");
    os.remove(inPath); os.remove(outPath);

    if not ok or (type(ok) == "number" and ok ~= 0) then
        error("LuacVM: luac failed to compile the normalized source")
    end
    if not blob or #blob == 0 then
        error("LuacVM: luac produced no output — is LuacPath set correctly? (tried: " .. self.LuacPath .. ")")
    end

    
    local proto = Reader.parse(blob);

    
    local interpPath = interpSourcePath();
    local interpSrc  = readFile(interpPath, "r");
    if not interpSrc then
        error("LuacVM: cannot read interpreter source from: " .. interpPath)
    end

    
    local xorKey = self.EncryptCode and math.random(1, 2^30 - 1) or 0;
    local code   = Emit.build(proto, interpSrc, xorKey);

    logger:info(string.format(
        "LuacVM: compiled %d bytes of Lua 5.1 bytecode → %d bytes of LuaC-VM output (xk=0x%08X).",
        #blob, #code, xorKey));

    
    
    local newAst = Parser:new({ LuaVersion = Enums.LuaVersion.LuaU }):parse(code);
    return newAst;
end

return LuacVM;
