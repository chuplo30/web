
local function findLuauCompile()
    local candidates = {
        "luau-compile",
        "/usr/local/bin/luau-compile",
        "/usr/bin/luau-compile",
    }
    for _, p in ipairs(candidates) do
        local f = io.open(p, "r")
        if f then f:close(); return p end
        if os.execute(string.format('"%s" --help > /dev/null 2>&1', p)) == 0 then
            return p
        end
    end
    return nil
end

local luauCompilePath = findLuauCompile()


local function cvmOuter(junkLevel, flatIntensity, flatChance, extraOpts)
    local s = {
        StreamCipher     = true;
        EncryptStrings   = true;
        Flatten          = true;
        FlattenIntensity = flatIntensity or "high";
        FlattenMinBlocks = 3;
        FlattenChance    = flatChance or 0.9;
        MicroOps         = true;
        JunkLevel        = junkLevel or 2;
        Compress         = true;
    }
    if extraOpts then
        for k, v in pairs(extraOpts) do s[k] = v end
    end
    return { Name = "CustomVM"; Settings = s; }
end




local function luauBytecodeStep(optLevel, vmStyle)
    return {
        Name = "LuauBytecode";
        Settings = {
            CompilerPath      = luauCompilePath or "luau-compile";
            OptLevel          = optLevel or 2;
            Remap             = true;
            EncryptBytecode   = true;
            B85               = true;
            PolymorphicVM     = true;
            VMStyle           = vmStyle or "random";
            VMRegisterRemap   = true;
            VMConstRemap      = true;
            VMContainerSchema = "random";
        };
    }
end

return {
    
    
    
    
    
    
    
    
    ["customvm_light"] = (function()
        local steps = {
            { Name = "MacroExpand"; Settings = {}; };
            { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
            { Name = "LuraphMetatable"; Settings = {}; };
            { Name = "EnvLoggerBypass"; Settings = {}; };
            { Name = "MemeString"; Settings = { Intensity = 0.3; }; };
            { Name = "HelperTable"; Settings = {}; };
            { Name = "StringXOR";   Settings = { Probability = 0.4; }; };
            { Name = "OpaquePredicates"; Settings = { Probability = 0.3; }; };
        }

        if luauCompilePath then
            steps[#steps+1] = luauBytecodeStep(2, "random")
        end

        steps[#steps+1] = cvmOuter(1, "medium", 0.8, {
            EnableFfiLibrary  = false;
            StaticEnvironment = false;
            HardcodeGlobals   = false;
            VmCompression     = true;
            OptLevel          = 2;
        })

        steps[#steps+1] = { Name = "EncryptStrings"; Settings = { EncryptNumbers = false; }; }
        steps[#steps+1] = { Name = "DummyStep";      Settings = { Intensity = 0.3; }; }
        steps[#steps+1] = { Name = "ConstantArray";  Settings = {
            Encoding     = "b85";
            Rotate       = true;
            Shuffle      = true;
            StringsOnly  = true;
            Treshold     = 1;
            MaxStringLen = 256;
        }; }

        return {
            LuaVersion    = "LuaU";
            VarNamePrefix = "";
            NameGenerator = "shortrand";
            PrettyPrint   = false;
            Seed          = 0;
            Steps         = steps;
        }
    end)();

    ["customvm"] = (function()
        local steps = {
            { Name = "MacroExpand"; Settings = {}; };
            { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
            { Name = "LuraphMetatable"; Settings = {}; };
            { Name = "EnvLoggerBypass"; Settings = {}; };
            { Name = "MemeString"; Settings = { Intensity = 0.4; }; };
            { Name = "AntiDumpConstants"; Settings = { Probability=0.60, ProtectStrings=false }; };
            { Name = "AntiTamper"; Settings = {}; };
            { Name = "RobloxAntiTamper"; Settings = {}; };
            { Name = "StringXOR";   Settings = { Probability = 0.5; }; };
            { Name = "OpaquePredicates"; Settings = { Probability = 0.4; }; };
        }

        
        if luauCompilePath then
            steps[#steps+1] = luauBytecodeStep(2, "random")
        end

        
        
        steps[#steps+1] = cvmOuter(1, "medium", 0.8, {
            EnableFfiLibrary  = false;
            StaticEnvironment = false;
            HardcodeGlobals   = false;
            VmCompression     = true;
            OptLevel          = 2;
        })

        steps[#steps+1] = { Name = "EncryptStrings"; Settings = { EncryptNumbers = false; }; }
        steps[#steps+1] = { Name = "DummyStep";      Settings = { Intensity = 0.2; }; }
        steps[#steps+1] = { Name = "ConstantArray";  Settings = {
            Encoding     = "b85";
            Rotate       = true;
            Shuffle      = true;
            StringsOnly  = true;
            Treshold     = 1;
            MaxStringLen = 256;
        }; }

        return {
            LuaVersion    = "LuaU";
            VarNamePrefix = "";
            NameGenerator = "shortrand";
            PrettyPrint   = false;
            Seed          = 0;
            Steps         = steps;
        }
    end)();

    
    ["customvm_max"] = (function()
        local steps = {
            { Name = "MacroExpand"; Settings = {}; };
            { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
            { Name = "LuraphMetatable"; Settings = {}; };
            { Name = "EnvLoggerBypass"; Settings = {}; };
            { Name = "MemeString"; Settings = { Intensity = 0.8; }; };
            { Name = "AntiDumpConstants"; Settings = { Probability=0.85, ProtectStrings=true }; };
            { Name = "AntiTamper"; Settings = {}; };
            { Name = "RobloxAntiTamper"; Settings = {}; };
            { Name = "GoofyAntiTamper"; Settings = {}; };
            { Name = "StringXOR";   Settings = { Probability = 0.85; }; };
            { Name = "OpaquePredicates"; Settings = { Probability = 0.7; }; };
        }
        if luauCompilePath then
            steps[#steps+1] = luauBytecodeStep(2, "random")
        end
        steps[#steps+1] = cvmOuter(3, "max", 0.95, {
            EnableFfiLibrary  = false;
            StaticEnvironment = false;
            HardcodeGlobals   = false;
            VmCompression     = true;
            OptLevel          = 2;
        })
        steps[#steps+1] = { Name = "EncryptStrings"; Settings = { EncryptNumbers = false; }; }
        steps[#steps+1] = { Name = "DummyStep";      Settings = { Intensity = 0.6; }; }
        steps[#steps+1] = { Name = "ConstantArray";  Settings = {
            Encoding     = "b85";
            Rotate       = true;
            Shuffle      = true;
            StringsOnly  = false;
            Treshold     = 1;
            MaxStringLen = 512;
        }; }
        return {
            LuaVersion    = "LuaU";
            VarNamePrefix = "";
            NameGenerator = "shortrand";
            PrettyPrint   = false;
            Seed          = 0;
            Steps         = steps;
        }
    end)();

    
    ["customvm_executor"] = (function()
        local steps = {
            { Name = "MacroExpand"; Settings = {}; };
            { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
            { Name = "LuraphMetatable"; Settings = {}; };
            { Name = "EnvLoggerBypass"; Settings = {}; };
            { Name = "MemeString"; Settings = { Intensity = 0.2; }; };
            { Name = "AntiDumpConstants"; Settings = { Probability=0.40, ProtectStrings=true }; };
            { Name = "AntiTamper"; Settings = {}; };
            { Name = "RobloxAntiTamper"; Settings = {}; };
            
            { Name = "StringXOR";   Settings = { Probability = 0.3; }; };
            { Name = "OpaquePredicates"; Settings = { Probability = 0.2; }; };
        }
        if luauCompilePath then
            steps[#steps+1] = luauBytecodeStep(2, "random")
        end
        
        steps[#steps+1] = cvmOuter(0, "low", 0.3, {
            EnableFfiLibrary  = false;
            StaticEnvironment = false;
            HardcodeGlobals   = false;
            VmCompression     = false;
            OptLevel          = 1;
        })
        steps[#steps+1] = { Name = "EncryptStrings"; Settings = { EncryptNumbers = false; }; }
        steps[#steps+1] = { Name = "DummyStep";      Settings = { Intensity = 0.2; }; }
        steps[#steps+1] = { Name = "ConstantArray";  Settings = {
            Encoding     = "b85";
            Rotate       = true;
            Shuffle      = true;
            StringsOnly  = true;
            Treshold     = 1;
            MaxStringLen = 256;
        }; }
        return {
            LuaVersion    = "LuaU";
            VarNamePrefix = "";
            NameGenerator = "shortrand";
            PrettyPrint   = false;
            Seed          = 0;
            Steps         = steps;
        }
    end)();

    
    
    
    
    
    
    ["pro"] = (function()
        local steps = {
            { Name = "MacroExpand"; Settings = {}; };
            { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
            { Name = "FuncInline"; Settings = {}; };
            { Name = "LuraphMetatable"; Settings = {}; };
            { Name = "EnvLoggerBypass"; Settings = {}; };
            { Name = "AntiDumpConstants"; Settings = { Probability=0.30, ProtectStrings=false }; };
            { Name = "TamperGuard"; Settings = { Strict = false; }; };
            { Name = "WrapMainLogic"; Settings = {}; };
{ Name = "SplitFunctions"; Settings = { TargetFunctions = 200; RealSplit = false; Junk = true; }; };
            { Name = "StringXOR";   Settings = { Probability = 0.3; }; };
            { Name = "OpaquePredicates"; Settings = { Probability = 0.6; }; };
        }
        if luauCompilePath then
            steps[#steps+1] = luauBytecodeStep(2, "random")
        end
        
        
steps[#steps+1] = cvmOuter(0, "low", 0, {
            EnableFfiLibrary    = false;
            StaticEnvironment   = false;
            HardcodeGlobals     = false;
            VmCompression       = false;
            Compress            = false;
            OptLevel            = 1;
            CoroutineRequired   = false;
            Bit32Helper         = false;
            RandomizedHandlers  = false;
            Flatten             = false;
            MicroOps            = false;
            StreamCipher        = false;
        })
        steps[#steps+1] = { Name = "EncryptStrings"; Settings = { EncryptNumbers = true; }; }
        steps[#steps+1] = { Name = "ConstantArray";  Settings = {
            Encoding     = "b85";
            Rotate       = true;
            Shuffle      = true;
            StringsOnly  = true;
            Treshold     = 1;
            MaxStringLen = 200;
        }; }
        steps[#steps+1] = { Name = "ChecksumChunk"; Settings = {}; }
        
        return {
            LuaVersion    = "LuaU";
            VarNamePrefix = "";
            NameGenerator = "shortrand";
            PrettyPrint   = false;
            Seed          = 0;
            Steps         = steps;
        }
    end)();

["profull"] = (function()
        local steps = {
            { Name = "MacroExpand"; Settings = {}; };
            { Name = "FuncInline"; Settings = {}; };
            { Name = "LuraphMetatable"; Settings = {}; };
            { Name = "EnvLoggerBypass"; Settings = {}; };
            { Name = "MemeString"; Settings = { Intensity = 0.4; }; };
            { Name = "OpaquePredicates"; Settings = { Probability = 0.4; }; };
            { Name = "NumbersToExpressions"; Settings = { Treshold = 0.6; }; };
            { Name = "AntiDumpConstants"; Settings = { Probability=0.60, ProtectStrings=true }; };
            { Name = "AntiTamperEngine"; Settings = {}; };
            { Name = "WrapMainLogic"; Settings = {}; };
            { Name = "SplitFunctions"; Settings = { TargetFunctions = 200; RealSplit = false; Junk = true; }; };
            { Name = "StringXOR";   Settings = { Probability = 0.5; }; };
        }
        steps[#steps+1] = cvmOuter(0, "medium", 0.9, {
            EnableFfiLibrary    = false;
            StaticEnvironment   = false;
            HardcodeGlobals     = false;
            VmCompression       = true;
            OptLevel            = 2;
            CoroutineRequired   = true;
            Bit32Helper         = true;
            RandomizedHandlers  = true;
            Flatten             = true;
            MicroOps            = true;
            StreamCipher        = true;
        })
        steps[#steps+1] = { Name = "EncryptStrings"; Settings = { EncryptNumbers = false; }; }
        steps[#steps+1] = { Name = "DummyStep";      Settings = { Intensity = 0.3; }; }
        steps[#steps+1] = { Name = "ConstantArray";  Settings = {
            Encoding     = "b85";
            Rotate       = true;
            Shuffle      = true;
            StringsOnly  = true;
            Treshold     = 1;
            MaxStringLen = 200;
        }; }
        return {
            LuaVersion    = "LuaU";
            VarNamePrefix = "";
            NameGenerator = "shortrand";
            PrettyPrint   = false;
            Seed          = 0;
            Steps         = steps;
        }
    end)();

    
    
    
    ["customvm+luabc"] = (function()
        if not luauCompilePath then
            
            
            return {
                LuaVersion    = "LuaU";
                VarNamePrefix = "";
                NameGenerator = "shortrand";
                PrettyPrint   = false;
                Seed           = 0;
                Steps = {
                    { Name = "MacroExpand"; Settings = {}; };
            { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
                    { Name = "LuraphMetatable"; Settings = {}; };
                    { Name = "EnvLoggerBypass"; Settings = {}; };
                    { Name = "MemeString"; Settings = { Intensity = 0.6; }; };
                    { Name = "AntiDumpConstants"; Settings = { Probability=0.60, ProtectStrings=false }; };
                    { Name = "AntiTamper"; Settings = {}; };
                    { Name = "RobloxAntiTamper"; Settings = {}; };
                    { Name = "StringXOR"; Settings = { Probability = 0.5; }; };
                    { Name = "OpaquePredicates"; Settings = { Probability = 0.4; }; };
                    cvmOuter(2, "high", 0.9);
                    { Name = "EncryptStrings"; Settings = { EncryptNumbers = false; }; };
                    { Name = "DummyStep"; Settings = { Intensity = 0.3; }; };
                };
            };
        end

        return {
        LuaVersion    = "LuaU";
        VarNamePrefix = "";
        NameGenerator = "shortrand";
        PrettyPrint   = false;
        Seed          = 0;
        Steps = {
            { Name = "MacroExpand";       Settings = {}; };
            { Name = "LuraphMetatable"; Settings = {}; };
            { Name = "EnvLoggerBypass"; Settings = {}; };
            { Name = "MemeString";       Settings = { Intensity = 0.6; }; };
            { Name = "AntiDumpConstants"; Settings = { Probability=0.9, ProtectStrings=true }; };
            { Name = "AntiTamper"; Settings = {}; };
            { Name = "RobloxAntiTamper"; Settings = {}; };
            { Name = "StringXOR";         Settings = { Probability = 0.5; }; };
            { Name = "OpaquePredicates";  Settings = { Probability = 0.4; }; };
            
            {
                Name = "LuauBytecode";
                Settings = {
                    CompilerPath      = luauCompilePath;
                    OptLevel          = 1;
                    Remap             = true;
                    EncryptBytecode   = true;
                    B85               = true;
                    PolymorphicVM     = true;
                    VMStyle           = "random";
                    VMRegisterRemap   = true;
                    VMConstRemap      = true;
                    VMContainerSchema = "random";
                };
            };
            
            cvmOuter(2, "high", 0.9);
            { Name = "EncryptStrings"; Settings = { EncryptNumbers = false; }; };
            { Name = "DummyStep";      Settings = { Intensity = 0.3; }; };
        };
        };
    end)();

    
    
    ["luac"] = {
        LuaVersion    = "LuaU";
        VarNamePrefix = "";
        NameGenerator = "shortrand";
        PrettyPrint   = false;
        Seed          = 0;
        Steps = {
            { Name = "MacroExpand"; Settings = {}; };
            { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
            {
                Name = "LuacVM";
                Settings = {
                    LuacPath    = "luac";
                    OptLevel    = 2;
                    EncryptCode = true;
                };
            };
            { Name = "EncryptStrings"; Settings = { EncryptNumbers = false; }; };
            { Name = "DummyStep";      Settings = { Intensity = 0.2; }; };
        };
    };

    
    
    
    
    
    
    
    
    ["luac+customvm"] = (function()
        
        math.randomseed(os.time() * 997 + math.floor((os.clock() % 1) * 1e6))
        math.random(); math.random() 

        
        
        local innerVm
        local roll = math.random()
        if luauCompilePath and roll < 0.33 then
            
            innerVm = luauBytecodeStep(2, "random")
        elseif luauCompilePath and roll < 0.67 then
            
            innerVm = luauBytecodeStep(1, "random")
        else
            
            
            innerVm = cvmOuter(1, "medium", 0.8)
        end

        return {
            LuaVersion     = "LuaU";
            VarNamePrefix  = "";
            NameGenerator  = "shortrand";
            PrettyPrint    = false;
            Seed           = 0;
            DispatcherJunk = 3;
            Steps = {
                { Name = "MacroExpand"; Settings = {}; };
            { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
                { Name = "LuraphMetatable"; Settings = {}; };
                { Name = "EnvLoggerBypass"; Settings = {}; };
                { Name = "MemeString"; Settings = { Intensity = 0.8; }; };
                { Name = "AntiDumpConstants"; Settings = { Probability=0.60, ProtectStrings=false }; };
                { Name = "AntiTamper"; Settings = {}; };
                { Name = "RobloxAntiTamper"; Settings = {}; };
                { Name = "StringXOR";   Settings = { Probability = 0.85; }; };
                { Name = "OpaquePredicates"; Settings = { Probability = 0.7; }; };
                innerVm;
                cvmOuter(3, "max", 0.95, {
                    EnableFfiLibrary  = false;
                    StaticEnvironment = false;
                    HardcodeGlobals   = false;
                    VmCompression     = true;
                    OptLevel          = 2;
                });
                { Name = "EncryptStrings"; Settings = { EncryptNumbers = false; }; };
                { Name = "DummyStep";      Settings = { Intensity = 0.6; }; };
                { Name = "ConstantArray";  Settings = {
                    Encoding     = "b85";
                    Rotate       = true;
                    Shuffle      = true;
                    StringsOnly  = false;
                    Treshold     = 1;
                    MaxStringLen = 512;
                }; };
            };
        }
    end)();

["min"] = (function()
        local steps = {
            { Name = "MacroExpand"; Settings = {}; };
            { Name = "EnvLoggerBypass"; Settings = {}; };
            { Name = "CustomVM"; Settings = {
                VmCompression = false;
                Compress = false;
                OptLevel = 1;
                StreamCipher = true;
            }; };
            { Name = "EncryptStrings"; Settings = { EncryptNumbers = false; }; };
            { Name = "ConstantArray"; Settings = {
                Encoding     = "b85";
                Rotate       = true;
                Shuffle      = true;
                StringsOnly  = true;
                Treshold     = 1;
                MaxStringLen = 200;
            }; };
        };
        return {
            LuaVersion    = "LuaU";
            VarNamePrefix = "";
            NameGenerator = "shortrand";
            PrettyPrint   = false;
            Seed          = 0;
            Steps         = steps;
        }
    end)();

["min2"] = (function()
        local steps = {
            { Name = "MacroExpand"; Settings = {}; };
            { Name = "EnvLoggerBypass"; Settings = {}; };
            { Name = "EncryptStrings"; Settings = { EncryptNumbers = false; }; };
            { Name = "ConstantArray"; Settings = {
                Encoding     = "b85";
                Rotate       = true;
                Shuffle      = true;
                StringsOnly  = true;
                Treshold     = 1;
                MaxStringLen = 200;
            }; };
        };
        return {
            LuaVersion    = "LuaU";
            VarNamePrefix = "";
            NameGenerator = "shortrand";
            PrettyPrint   = false;
            Seed          = 0;
            Steps         = steps;
        }
    end)();

["guardtest3"] = (function()
        local steps = {
            { Name = "MacroExpand"; Settings = {}; };
            { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
            { Name = "FuncInline"; Settings = {}; };
            { Name = "LuraphMetatable"; Settings = {}; };
            { Name = "EnvLoggerBypass"; Settings = {}; };
            { Name = "AntiDumpConstants"; Settings = { Probability=0.30, ProtectStrings=false }; };
            { Name = "TamperGuard"; Settings = { Strict = false; }; };
            { Name = "WrapMainLogic"; Settings = {}; };
            { Name = "SplitFunctions"; Settings = { TargetFunctions = 200; RealSplit = false; Junk = true; }; };
            { Name = "StringXOR"; Settings = { Probability = 0.3; }; };
            { Name = "OpaquePredicates"; Settings = { Probability = 0.6; }; };
            { Name = "CustomVM"; Settings = {
                VmCompression = false;
                Compress = false;
                OptLevel = 1;
                StreamCipher = true;
            }; };
            { Name = "EncryptStrings"; Settings = { EncryptNumbers = true; }; };
            { Name = "ConstantArray"; Settings = {
                Encoding     = "b85";
                Rotate       = true;
                Shuffle      = true;
                StringsOnly  = true;
                Treshold     = 1;
                MaxStringLen = 200;
            }; };
{ Name = "ChecksumChunk"; Settings = {}; };
};
return {
            LuaVersion    = "LuaU";
            VarNamePrefix = "";
            NameGenerator = "shortrand";
            PrettyPrint   = false;
            Seed          = 0;
            Steps         = steps;
        }
    end)();

["bisect1"] = (function()
    local steps = {
        { Name = "MacroExpand"; Settings = {}; };
        { Name = "EnvLoggerBypass"; Settings = {}; };
        { Name = "CustomVM"; Settings = {
            EnableFfiLibrary = false;
            StaticEnvironment = false;
            HardcodeGlobals = false;
            VmCompression = false;
            Compress = false;
            OptLevel = 1;
            CoroutineRequired = false;
            Bit32Helper = false;
            RandomizedHandlers = false;
            Flatten = false;
            MicroOps = false;
            StreamCipher = false;
        }; };
        { Name = "EncryptStrings"; Settings = { EncryptNumbers = false; }; };
        { Name = "ConstantArray"; Settings = {
            Encoding = "b85";
            Rotate = true;
            Shuffle = true;
            StringsOnly = true;
            Treshold = 1;
            MaxStringLen = 200;
        }; };
        { Name = "ChecksumChunk"; Settings = {}; };
    };
    return { LuaVersion = "LuaU"; VarNamePrefix = ""; NameGenerator = "shortrand"; PrettyPrint = false; Seed = 0; Steps = steps; }
end)();

["bisect3"] = (function()
    local steps = {
        { Name = "MacroExpand"; Settings = {}; };
        { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
        { Name = "FuncInline"; Settings = {}; };
        { Name = "LuraphMetatable"; Settings = {}; };
        { Name = "EnvLoggerBypass"; Settings = {}; };
        { Name = "AntiDumpConstants"; Settings = { Probability=0.30, ProtectStrings=false }; };
        { Name = "TamperGuard"; Settings = { Strict = false; }; };
        { Name = "StringXOR";   Settings = { Probability = 0.3; }; };
        { Name = "OpaquePredicates"; Settings = { Probability = 0.6; }; };
        { Name = "CustomVM"; Settings = {
            EnableFfiLibrary = false;
            StaticEnvironment = false;
            HardcodeGlobals = false;
            VmCompression = false;
            Compress = false;
            OptLevel = 1;
            CoroutineRequired = false;
            Bit32Helper = false;
            RandomizedHandlers = false;
            Flatten = false;
            MicroOps = false;
            StreamCipher = false;
        }; };
        { Name = "EncryptStrings"; Settings = { EncryptNumbers = true; }; };
        { Name = "ConstantArray"; Settings = {
            Encoding = "b85";
            Rotate = true;
            Shuffle = true;
            StringsOnly = true;
            Treshold = 1;
            MaxStringLen = 200;
        }; };
        { Name = "ChecksumChunk"; Settings = {}; };
    };
    return { LuaVersion = "LuaU"; VarNamePrefix = ""; NameGenerator = "shortrand"; PrettyPrint = false; Seed = 0; Steps = steps; }
end)();

["bisect5"] = (function()
    local steps = {
        { Name = "MacroExpand"; Settings = {}; };
        { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
        { Name = "FuncInline"; Settings = {}; };
        { Name = "LuraphMetatable"; Settings = {}; };
        { Name = "EnvLoggerBypass"; Settings = {}; };
        { Name = "AntiDumpConstants"; Settings = { Probability=0.30, ProtectStrings=false }; };
        { Name = "TamperGuard"; Settings = { Strict = false; }; };
        { Name = "WrapMainLogic"; Settings = {}; };
        { Name = "StringXOR";   Settings = { Probability = 0.3; }; };
        { Name = "OpaquePredicates"; Settings = { Probability = 0.6; }; };
        { Name = "CustomVM"; Settings = {
            EnableFfiLibrary = false;
            StaticEnvironment = false;
            HardcodeGlobals = false;
            VmCompression = false;
            Compress = false;
            OptLevel = 1;
            CoroutineRequired = false;
            Bit32Helper = false;
            RandomizedHandlers = false;
            Flatten = false;
            MicroOps = false;
            StreamCipher = false;
        }; };
        { Name = "EncryptStrings"; Settings = { EncryptNumbers = true; }; };
        { Name = "ConstantArray"; Settings = {
            Encoding = "b85";
            Rotate = true;
            Shuffle = true;
            StringsOnly = true;
            Treshold = 1;
            MaxStringLen = 200;
        }; };
        { Name = "ChecksumChunk"; Settings = {}; };
    };
    return { LuaVersion = "LuaU"; VarNamePrefix = ""; NameGenerator = "shortrand"; PrettyPrint = false; Seed = 0; Steps = steps; }
end)();

["pro3"] = (function()
    local steps = {
        { Name = "MacroExpand"; Settings = {}; };
        { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
        { Name = "FuncInline"; Settings = {}; };
        { Name = "LuraphMetatable"; Settings = {}; };
        { Name = "AntiDumpConstants"; Settings = { Probability=0.30, ProtectStrings=false }; };
        { Name = "TamperGuard"; Settings = { Strict = false; }; };
        { Name = "WrapMainLogic"; Settings = {}; };
        { Name = "SplitFunctions"; Settings = { TargetFunctions = 200; RealSplit = false; Junk = true; }; };
        { Name = "StringXOR";   Settings = { Probability = 0.3; }; };
        { Name = "OpaquePredicates"; Settings = { Probability = 0.6; }; };
        { Name = "CustomVM"; Settings = {
            EnableFfiLibrary = false;
            StaticEnvironment = false;
            HardcodeGlobals = false;
            VmCompression = false;
            Compress = false;
            OptLevel = 1;
            CoroutineRequired = false;
            Bit32Helper = false;
            RandomizedHandlers = false;
            Flatten = false;
            MicroOps = false;
            StreamCipher = false;
        }; };
        { Name = "EncryptStrings"; Settings = { EncryptNumbers = true; }; };
        { Name = "ConstantArray"; Settings = {
            Encoding = "b85";
            Rotate = true;
            Shuffle = true;
            StringsOnly = true;
            Treshold = 1;
            MaxStringLen = 200;
        }; };
        { Name = "ChecksumChunk"; Settings = {}; };
    };
    return { LuaVersion = "LuaU"; VarNamePrefix = ""; NameGenerator = "shortrand"; PrettyPrint = false; Seed = 0; Steps = steps; }
end)();

["pro5_novm"] = (function()
    local steps = {
        { Name = "MacroExpand"; Settings = {}; };
        { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
        { Name = "FuncInline"; Settings = {}; };
        { Name = "LuraphMetatable"; Settings = {}; };
        { Name = "AntiDumpConstants"; Settings = { Probability=0.30, ProtectStrings=false }; };
        { Name = "StringXOR";   Settings = { Probability = 0.3; }; };
        { Name = "OpaquePredicates"; Settings = { Probability = 0.6; }; };
        { Name = "ConstantArray"; Settings = {
            Encoding = "b85";
            Rotate = true;
            Shuffle = true;
            StringsOnly = true;
            Treshold = 1;
            MaxStringLen = 200;
        }; };
        { Name = "ChecksumChunk"; Settings = {}; };
    };
    return { LuaVersion = "LuaU"; VarNamePrefix = ""; NameGenerator = "shortrand"; PrettyPrint = false; Seed = 0; Steps = steps; }
end)();
["pro4"] = (function()
    local steps = {
        { Name = "MacroExpand"; Settings = {}; };
        { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
        { Name = "FuncInline"; Settings = {}; };
        { Name = "LuraphMetatable"; Settings = {}; };
        { Name = "AntiDumpConstants"; Settings = { Probability=0.30, ProtectStrings=false }; };
        { Name = "TamperGuard"; Settings = { Strict = false; }; };
        { Name = "WrapMainLogic"; Settings = {}; };
        { Name = "SplitFunctions"; Settings = { TargetFunctions = 200; RealSplit = false; Junk = true; }; };
        { Name = "StringXOR";   Settings = { Probability = 0.3; }; };
        { Name = "OpaquePredicates"; Settings = { Probability = 0.6; }; };
        { Name = "CustomVM"; Settings = {
            EnableFfiLibrary = false;
            StaticEnvironment = true;
            HardcodeGlobals = true;
            VmCompression = false;
            Compress = false;
            OptLevel = 1;
            CoroutineRequired = false;
            Bit32Helper = false;
            RandomizedHandlers = false;
            Flatten = false;
            MicroOps = false;
            StreamCipher = false;
        }; };
        { Name = "EncryptStrings"; Settings = { EncryptNumbers = true; }; };
        { Name = "ConstantArray"; Settings = {
            Encoding = "b85";
            Rotate = true;
            Shuffle = true;
            StringsOnly = true;
            Treshold = 1;
            MaxStringLen = 200;
        }; };
        { Name = "ChecksumChunk"; Settings = {}; };
    };
    return { LuaVersion = "LuaU"; VarNamePrefix = ""; NameGenerator = "shortrand"; PrettyPrint = false; Seed = 0; Steps = steps; }
end)();

["Catph"] = (function()
    local steps = {
        { Name = "HexPrelude"; Settings = {}; };
        { Name = "MacroExpand"; Settings = {}; };
        { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
        { Name = "FuncInline"; Settings = {}; };
        { Name = "LuraphMetatable"; Settings = {}; };
        { Name = "WatermarkCheck"; Settings = { Content = "Catph V2.2.5"; }; };
        { Name = "AntiDumpConstants"; Settings = { Probability=0.30, ProtectStrings=false }; };
        { Name = "WrapNoGate"; Settings = {}; };
        { Name = "SplitFunctions"; Settings = { TargetFunctions = 200; RealSplit = false; Junk = true; }; };
        { Name = "StringXOR";   Settings = { Probability = 0.3; }; };
        { Name = "OpaquePredicates"; Settings = { Probability = 0.6; }; };
        { Name = "CustomVM"; Settings = {
            EnableFfiLibrary = false;
            StaticEnvironment = true;
            HardcodeGlobals = true;
            VmCompression = false;
            Compress = false;
            OptLevel = 1;
            CoroutineRequired = false;
            Bit32Helper = false;
            RandomizedHandlers = false;
            Flatten = false;
            MicroOps = false;
            StreamCipher = true;
            InstructionFlood = 1000000;
            StackDepth = 300;
            ReturnFunction = true;
        }; };
        { Name = "EncryptStrings"; Settings = { EncryptNumbers = true; Layers = 2; }; };
        { Name = "ConstantArray"; Settings = {
            Encoding = "b85";
            Rotate = true;
            Shuffle = true;
            StringsOnly = true;
            Treshold = 1;
            MaxStringLen = 200;
        }; };
        { Name = "ChecksumChunk"; Settings = {}; };
        -- { Name = "RATAntiTamper"; Settings = { KeyHex = ""; }; };  -- TAM XOA: hex key fingerprint anti-tamper
    };
    return { LuaVersion = "LuaU"; VarNamePrefix = ""; NameGenerator = "shortrand"; PrettyPrint = false; Seed = 0; Steps = steps; }
end)();

["CatphLow"] = (function()
    local steps = {
        { Name = "HexPrelude"; Settings = {}; };
        { Name = "MacroExpand"; Settings = {}; };
        { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
        { Name = "FuncInline"; Settings = {}; };
        { Name = "LuraphMetatable"; Settings = {}; };
        { Name = "SplitFunctions"; Settings = { TargetFunctions = 20; RealSplit = true; Junk = false; }; };
        { Name = "StringXOR";   Settings = { Probability = 0.3; }; };
        { Name = "OpaquePredicates"; Settings = { Probability = 0.25; }; };
        { Name = "CustomVM"; Settings = {
            EnableFfiLibrary = false;
            StaticEnvironment = false;
            HardcodeGlobals = false;
            VmCompression = false;
            Compress = false;
            OptLevel = 0;
            CoroutineRequired = false;
            Bit32Helper = false;
            RandomizedHandlers = false;
            Flatten = false;
            MicroOps = false;
            StreamCipher = true;
            InstructionFlood = 0;
            StackDepth = 32;
            ReturnFunction = true;
        }; };
        { Name = "EncryptStrings"; Settings = { EncryptNumbers = true; Layers = 2; }; };
        { Name = "ConstantArray"; Settings = {
            Encoding = "b85";
            Rotate = true;
            Shuffle = true;
            StringsOnly = true;
            Treshold = 1;
            MaxStringLen = 200;
        }; };
        -- { Name = "RATAntiTamper"; Settings = { KeyHex = ""; }; };  -- TAM XOA: hex key fingerprint anti-tamper
    };
    return { LuaVersion = "LuaU"; VarNamePrefix = ""; NameGenerator = "shortrand"; PrettyPrint = false; Seed = 0; Steps = steps; }
end)();

["pro7_astmax"] = (function()
    local steps = {
        { Name = "MacroExpand"; Settings = {}; };
        { Name = "NumbersToExpressions"; Settings = { Treshold = 0.5; }; };
        { Name = "FuncInline"; Settings = {}; };
        { Name = "LuraphMetatable"; Settings = {}; };
        { Name = "AntiDumpConstants"; Settings = { Probability=0.30, ProtectStrings=false }; };
        { Name = "TamperGuard"; Settings = { Strict = false; }; };
        { Name = "WrapMainLogic"; Settings = {}; };
        { Name = "StringXOR";   Settings = { Probability = 0.3; }; };
        { Name = "OpaquePredicates"; Settings = { Probability = 0.6; }; };
        { Name = "EncryptStrings"; Settings = { EncryptNumbers = true; }; };
        { Name = "ConstantArray"; Settings = {
            Encoding = "b85";
            Rotate = true;
            Shuffle = true;
            StringsOnly = true;
            Treshold = 1;
            MaxStringLen = 200;
        }; };
        { Name = "ChecksumChunk"; Settings = {}; };
    };
    return { LuaVersion = "LuaU"; VarNamePrefix = ""; NameGenerator = "shortrand"; PrettyPrint = false; Seed = 0; Steps = steps; }
end)();
}

