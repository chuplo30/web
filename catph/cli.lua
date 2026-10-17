local function script_path()
    local str = debug.getinfo(1, "S").source
    if str:sub(1, 1) == "@" then
        str = str:sub(2)
    end
    return str:match("(.*[/%\\])") or "./"
end
package.path = script_path() .. "?.lua;" .. package.path;

for i = 1, #arg do
    if arg[i] == "--max" then
        _G.__catph_max_mode = true
    end
    if arg[i] == "--quiet" or arg[i] == "--silent" then
        _G.__catph_quiet = true
    end
end

local Obf = require("catph");

if _G.__catph_quiet then
    Obf.Logger.logLevel = Obf.Logger.LogLevel.Error;
else
    Obf.Logger.logLevel = Obf.Logger.LogLevel.Info;
end

local function file_exists(file)
    local f = io.open(file, "rb")
    if f then f:close() end
    return f ~= nil
end

string.split = function(str, sep)
    local fields = {}
    local pattern = string.format("([^%s]+)", sep)
    str:gsub(pattern, function(c) fields[#fields+1] = c end)
    return fields
end

local function lines_from(file)
    if not file_exists(file) then return {} end
    local lines = {}
    for line in io.lines(file) do
      lines[#lines + 1] = line
    end
    return lines
  end

local config;
local sourceFile;
local outFile;
local luaVersion;
local prettyPrint;

Obf.colors.enabled = true;

local i = 1;
while i <= #arg do
    local curr = arg[i];
    if curr:sub(1, 2) == "--" then
        if curr == "--preset" or curr == "--p" then
            if config then
                Obf.Logger:warn("The config was set multiple times");
            end

            i = i + 1;
            local preset = Obf.Presets[arg[i]];
            if not preset then
                Obf.Logger:error(string.format("A Preset with the name \"%s\" was not found!", tostring(arg[i])));
            end

            config = preset;
        elseif curr == "--config" or curr == "--c" then
            i = i + 1;
            local filename = tostring(arg[i]);
            if not file_exists(filename) then
                Obf.Logger:error(string.format("The config file \"%s\" was not found!", filename));
            end

            local content = table.concat(lines_from(filename), "\n");

            local okf, func = pcall(loadstring, content);
            if (not okf or not func) and load then okf, func = pcall(load, content) end

            setfenv(func, {});
            config = func();
        elseif curr == "--out" or curr == "--o" then
            i = i + 1;
            if(outFile) then
                Obf.Logger:warn("The output file was specified multiple times!");
            end
            outFile = arg[i];
        elseif curr == "--nocolors" then
            Obf.colors.enabled = false;
        elseif curr == "--Lua51" then
            luaVersion = "Lua51";
        elseif curr == "--LuaU" then
            luaVersion = "LuaU";
        elseif curr == "--pretty" then
            prettyPrint = true;
        elseif curr == "--compression" then
            i = i + 1;
            local val = arg[i];
            if val == "false" or val == "0" or val == "no" then
                _G.__catph_no_compression = true;
            end
        elseif curr == "--saveerrors" then

            Obf.Logger.errorCallback =  function(...)
                print(Obf.colors(Obf.Config.NameUpper .. ": " .. ..., "red"))

                local args = {...};
                local message = table.concat(args, " ");

                local fileName = sourceFile:sub(-4) == ".lua" and sourceFile:sub(0, -5) .. ".error.txt" or sourceFile .. ".error.txt";
                local handle = io.open(fileName, "w");
                handle:write(message);
                handle:close();

                os.exit(1);
            end;
        elseif curr == "--quiet" or curr == "--silent" then

        else
            Obf.Logger:warn(string.format("The option \"%s\" is not valid and therefore ignored", curr));
        end
    else
        if sourceFile then
            Obf.Logger:error(string.format("Unexpected argument \"%s\"", arg[i]));
        end
        sourceFile = tostring(arg[i]);
    end
    i = i + 1;
end

if not sourceFile then
    Obf.Logger:warn("No input file was specified, defaulting to output.lua");
    sourceFile = "output.lua";
end

if not config then
    config = Obf.Presets.customvm;
end

config.LuaVersion = luaVersion or config.LuaVersion;
config.PrettyPrint = prettyPrint ~= nil and prettyPrint or config.PrettyPrint;

if not file_exists(sourceFile) then
    Obf.Logger:error(string.format("The File \"%s\" was not found!", sourceFile));
end

if not outFile then
    if sourceFile:sub(-4) == ".lua" then
        outFile = sourceFile:sub(0, -5) .. ".obfuscated.lua";
    else
        outFile = sourceFile .. ".obfuscated.lua";
    end
end

local source = table.concat(lines_from(sourceFile), "\n");

if config.AggressiveOpt then
    if source:sub(1, 8) ~= "--!native" and source:sub(1, 12) ~= "--!optimize" then
        source = "--!native\n--!optimize 2\n" .. source;
    end
end




local pipeline = Obf.Pipeline:fromConfig(config);
local out = pipeline:apply(source, sourceFile);

Obf.Logger:info(string.format("Writing output to \"%s\"", outFile));

local function ensure_dir(path)
    local dir = path:match("^(.*)[/\\][^/\\]+$");
    if not dir or dir == "" then return end

    local probe = io.open(dir, "r");
    if probe then probe:close(); return end

    local isWin = package.config:sub(1,1) == "\\";
    if isWin then
        os.execute('mkdir "' .. dir:gsub("/", "\\") .. '" 2>nul');
    else
        os.execute('mkdir -p "' .. dir .. '"');
    end
end
ensure_dir(outFile);

local handle, err = io.open(outFile, "w");
if not handle then
    Obf.Logger:error(string.format("Could not open output file \"%s\" for writing: %s", tostring(outFile), tostring(err)));
end

math.randomseed(os.time() + math.random(1, 100000));

local reserved = {
    ["and"]=true,["break"]=true,["do"]=true,["else"]=true,["elseif"]=true,
    ["end"]=true,["false"]=true,["for"]=true,["function"]=true,["goto"]=true,
    ["if"]=true,["in"]=true,["local"]=true,["nil"]=true,["not"]=true,
    ["or"]=true,["repeat"]=true,["return"]=true,["then"]=true,["true"]=true,
    ["until"]=true,["while"]=true,["continue"]=true,
};

local LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
local ALNUM   = LETTERS .. "0123456789";

local function luraphName()
    local first = math.random(1, #LETTERS);
    local s = LETTERS:sub(first, first);
    for _ = 2, math.random(2, 6) do
        local k = math.random(1, #ALNUM);
        s = s .. ALNUM:sub(k, k);
    end
    return s;
end

local usedNames = {};

local outIdentSet = {};
do
    for word in out:gmatch("[%a_][%w_]*") do
        outIdentSet[word] = true;
    end
end

local function freshName(avoidOut)
    local name;
    repeat
        name = luraphName();
    until name
        and not reserved[name]
        and not usedNames[name]
        and (not avoidOut or not outIdentSet[name]);
    usedNames[name] = true;
    outIdentSet[name] = true;
    return name;
end

local helpers = {};

for _, h in ipairs(helpers) do
    h.name = freshName(true);
end

for _, h in ipairs(helpers) do
    out = out:gsub("%f[%w_]" .. h.placeholder .. "%f[^%w_]", h.name);
end

local defs = {};
for _, h in ipairs(helpers) do
    table.insert(defs, "local " .. h.name .. "=" .. h.body);
end

local prologue = #defs > 0 and (table.concat(defs, " ") .. " ") or "";





local body = prologue .. out;

local nvEntries    = {};
local nvShortNames = {};

if pipeline._nvFuncs and #pipeline._nvFuncs > 0 then
    for _, nv in ipairs(pipeline._nvFuncs) do
        nvEntries[#nvEntries + 1] = { key = nv.name, src = nv.src };
        nvShortNames[#nvShortNames + 1] = nv.name;
    end
    Obf.Logger:info(string.format(
        "Emitting %d FUS_NO_VIRTUALIZE function(s) as dispatch-table entries.", #pipeline._nvFuncs))
end

local entropy = math.random(1, 1e6) + math.floor(collectgarbage("count"));
math.random(entropy % 97 + 1);

local usedHexKeys = {};
local function hexKey(minLen, maxLen)
    local len = math.random(minLen or 5, maxLen or 9);
    local attempt;
    repeat
        local t = {};
        for _ = 1, len do

            local b;
            repeat b = math.random(0x21, 0x7e) until b ~= 0x22 and b ~= 0x5c;
            t[#t+1] = string.format("\\x%02x", b);
        end
        attempt = table.concat(t);
    until not usedHexKeys[attempt];
    usedHexKeys[attempt] = true;
    return '"' .. attempt .. '"';
end

local function junkStmts(nMin, nMax)
    local stmts = {}
    local numLocs = {}
    local allLocs = {}
    local function rn()
        local num = math.random(1, 999999)
        local fmt = math.random(1, 10)
        if fmt <= 3 then
            local str = tostring(num)
            
            return str
        elseif fmt <= 6 then
            
            return string.format("0x%x", num)
        else
            
            return string.format("%g", num)
        end
    end
    local function rnl() return #numLocs > 0 and numLocs[math.random(1, #numLocs)] or rn() end
    local function luraphBlock()
        local v1 = freshName(true); local v2 = freshName(true)
        local v3 = freshName(true); local st = freshName(true)
        numLocs[#numLocs+1] = v1; numLocs[#numLocs+1] = v2; numLocs[#numLocs+1] = v3
        allLocs[#allLocs+1] = v1; allLocs[#allLocs+1] = v2; allLocs[#allLocs+1] = v3
        allLocs[#allLocs+1] = st
        local s1 = rn(); local s2 = rn(); local s3 = rn()
        return "local "..v1.."="..rn().." local "..v2.."="..rn().." local "..v3.."="..rn()
            .." local "..st.."="..s1
            .." if "..st.."<="..s2.." then"
            .." "..v2.."=("..v3..">"..rn().." and "..rn().." or "..rn()..")"
            .." "..v1.."="..v2
            .." else"
            .." "..v3.."="..v3.."+"..rn()
            .." "..v1.."="..rn()
            .." end"
    end
    local function repeatBlock()
        local v1 = freshName(true); local v2 = freshName(true)
        local st = freshName(true)
        numLocs[#numLocs+1] = v1; numLocs[#numLocs+1] = v2
        allLocs[#allLocs+1] = v1; allLocs[#allLocs+1] = v2; allLocs[#allLocs+1] = st
        local s1 = rn(); local s2 = rn()
        return "local "..v1.."="..rn().." local "..v2.."="..rn()
            .." local "..st.."="..s1
            .." if "..st.."=="..s1.." then"
            .." "..v1.."=("..v2..">="..rn().." and "..v2.." or "..rn()..")"
            .." else"
            .." "..v2.."="..v2.."+"..rn()
            .." end"
    end
    local n = math.random(nMin, nMax)
    for _ = 1, n do
        local t = math.random(1, 12)
        if t <= 3 then
            stmts[#stmts+1] = luraphBlock()
        elseif t <= 5 then
            stmts[#stmts+1] = repeatBlock()
        else
            local ln = freshName(true)
            local expr; local isNum = false
            local st = math.random(1, 8)
            if     st == 1 then expr = rn();                                                  isNum = true
            elseif st == 2 then expr = "tostring(" .. rn() .. ")"
            elseif st == 3 then expr = "#tostring(" .. rnl() .. ")";                          isNum = true
            elseif st == 4 then expr = "math.max(" .. rn() .. "," .. rn() .. ")";            isNum = true
            elseif st == 5 then expr = "type(nil)"
            elseif st == 6 then expr = "tostring(" .. rn() .. ")..\""..freshName(true).."\""
            elseif st == 7 then expr = "(function() return " .. rn() .. " end)()";           isNum = true
            else              expr = rnl() .. "+" .. rn();                                    isNum = true
            end
            stmts[#stmts + 1] = "local " .. ln .. "=" .. expr
            allLocs[#allLocs + 1] = ln
            if isNum then numLocs[#numLocs + 1] = ln end
        end
    end
    return table.concat(stmts, " ")
end

local dispJunk = (config and config.DispatcherJunk) or 2;
local _djRanges = {
    [0] = {stmtMin=0,  stmtMax=0},
    [1] = {stmtMin=2,  stmtMax=5},
    [2] = {stmtMin=6,  stmtMax=14},
    [3] = {stmtMin=12, stmtMax=22},
}
local _djCfg = _djRanges[dispJunk] or _djRanges[2];
local function junkStmtsScaled(base1, base2)
    if _djCfg.stmtMin == 0 then return "" end
    local lo = math.max(_djCfg.stmtMin, base1 - 2)
    local hi = math.min(_djCfg.stmtMax, base2 + 2)
    if lo > hi then lo = hi end
    return junkStmts(lo, hi)
end

local KR = hexKey(5, 9);
local KP = hexKey(5, 9);
local KE = hexKey(5, 9);

local nvEnvSetup = "";
if #nvShortNames > 0 then
    local envLocal = freshName(true);
    local parts2 = {};
    parts2[#parts2+1] = "local " .. envLocal .. "=getfenv and getfenv() or _G";
    for _, sn in ipairs(nvShortNames) do
        parts2[#parts2+1] = envLocal .. "." .. sn .. "=a." .. sn;
    end
    nvEnvSetup = table.concat(parts2, ";") .. ";";
end





local methodPayload  = "function(a,...)" .. nvEnvSetup .. body .. ";end";
local methodPassThru = "function(a,b,...)" .. junkStmtsScaled(4, 10)
    .. ";return b(a,...)end";
local methodEntry    = "function(a,...)" .. junkStmtsScaled(4, 10)
    .. ";return a[" .. KP .. "](a,a[" .. KR .. "],...)end";

local methods = {
    { key = KR, def = methodPayload  };
    { key = KP, def = methodPassThru };
    { key = KE, def = methodEntry    };
};

for _, nve in ipairs(nvEntries) do
    methods[#methods+1] = { key = '"' .. nve.key .. '"', def = nve.src };
end

for k = #methods, 2, -1 do
    local j = math.random(1, k);
    methods[k], methods[j] = methods[j], methods[k];
end

local parts = {};
for _, m in ipairs(methods) do
    parts[#parts+1] = "[" .. m.key .. "]=" .. m.def;
end

local ib1SinglePool = {};
do
    local L = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for i = 1, #L do
        local ch = L:sub(i, i);
        if not reserved[ch] then
            ib1SinglePool[#ib1SinglePool+1] = ch;
        end
    end
    for i = #ib1SinglePool, 2, -1 do
        local j = math.random(i);
        ib1SinglePool[i], ib1SinglePool[j] = ib1SinglePool[j], ib1SinglePool[i];
    end
end
local ib1Params = {};
for _ = 1, 14 do
    if #ib1SinglePool > 0 then
        local ch = table.remove(ib1SinglePool);
        usedNames[ch] = true;
        outIdentSet[ch] = true;
        ib1Params[#ib1Params+1] = ch;
    else
        ib1Params[#ib1Params+1] = freshName(true);
    end
end
local IB1_PARAMS = table.concat(ib1Params, ",");
local wrapped = "return(function(" .. IB1_PARAMS .. ",...)return " .. ib1Params[1] .. "[" .. KE
    .. "](" .. ib1Params[1] .. ",...)end)({" .. table.concat(parts, ";") .. "});";

do
    
    
    
    local function toHexStr(s)
        return '"' .. s:gsub(".", function(c)
            return string.format("\\x%02x", string.byte(c))
        end) .. '"'
    end

    
    local junkPool = {
        "nigger",
        "chickennugget",
        "holyshit",
        "petapetashit",
        "fuckingbad",
        "catph_n1gger",
        "vmcat",
        "pipelinenigger",
    };
    local nFake = math.random(3, 5);
    local fakeEntries = {};
    for _ = 1, nFake do
        local k = hexKey(3, 6);
        
        local bdy = toHexStr(junkPool[math.random(1, #junkPool)]);
        fakeEntries[#fakeEntries+1] = "[" .. k .. "]=" .. bdy;
    end
    local injection = table.concat(fakeEntries, ";") .. ";";

    local insertPos = wrapped:find("end)({", 1, true);
    if insertPos then
        insertPos = insertPos + 6; 
        wrapped = wrapped:sub(1, insertPos - 1) .. injection .. wrapped:sub(insertPos);
    end
end






do
    local OutputParser = require("catph.parser");
    local valid, validationError = pcall(function()
        OutputParser:new({ LuaVersion = "LuaU" }):parse(wrapped);
    end);
    if not valid then
        handle:close();
        os.remove(outFile);
        Obf.Logger:error("Generated output failed final LuaU syntax validation: " .. tostring(validationError));
    end
end

handle:write('-- This File Protected By Catph V2.2.5 [ discord.gg/uHU98Z3E8z ]\n\n' .. wrapped .. '\n');
handle:close();
