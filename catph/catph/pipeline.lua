





local config = require("config");
local Ast    = require("catph.ast");
local Enums  = require("catph.enums");
local util = require("catph.util");
local Parser = require("catph.parser");
local Unparser = require("catph.unparser");
local logger = require("logger");

local NameGenerators = require("catph.namegenerators");

local Steps = require("catph.steps");

local lookupify = util.lookupify;
local LuaVersion = Enums.LuaVersion;
local AstKind = Ast.AstKind;


local isWindows = package and package.config and type(package.config) == "string" and package.config:sub(1,1) == "\\";
local function gettime()
	if isWindows then
		return os.clock();
	else
		return os.time();
	end
end

local Pipeline = {
	NameGenerators = NameGenerators;
	Steps = Steps;
	DefaultSettings = {
		LuaVersion = LuaVersion.LuaU; 
		PrettyPrint = false; 
		Seed = 0; 
		VarNamePrefix = ""; 
	}
}


function Pipeline:new(settings)
	local luaVersion = settings.luaVersion or settings.LuaVersion or Pipeline.DefaultSettings.LuaVersion;
	local conventions = Enums.Conventions[luaVersion];
	if(not conventions) then
		logger:error("The Lua Version \"" .. luaVersion 
			.. "\" is not recognised by the Tokenizer! Please use one of the following: \"" .. table.concat(util.keys(Enums.Conventions), "\",\"") .. "\"");
	end
	
	local prettyPrint = settings.PrettyPrint or Pipeline.DefaultSettings.PrettyPrint;
	local prefix = settings.VarNamePrefix or Pipeline.DefaultSettings.VarNamePrefix;
	local seed = settings.Seed or 0;
	
	local pipeline = {
		LuaVersion = luaVersion;
		PrettyPrint = prettyPrint;
		VarNamePrefix = prefix;
		Seed = seed;
		parser = Parser:new({
			LuaVersion = luaVersion;
		});
		unparser = Unparser:new({
			LuaVersion = luaVersion;
			PrettyPrint = prettyPrint;
			Highlight = settings.Highlight;
		});
		namegenerator = Pipeline.NameGenerators.MangledShuffled;
		conventions = conventions;
		steps = {};
	}
	
	setmetatable(pipeline, self);
	self.__index = self;
	
	return pipeline;
end

function Pipeline:fromConfig(config)
	config = config or {};
	local pipeline = Pipeline:new({
		LuaVersion    = config.LuaVersion or LuaVersion.Lua51;
		PrettyPrint   = config.PrettyPrint or false;
		VarNamePrefix = config.VarNamePrefix or "";
		Seed          = config.Seed or 0;
	});

	pipeline:setNameGenerator(config.NameGenerator or "MangledShuffled")

	
	local steps = config.Steps or {};
	for i, step in ipairs(steps) do
		if type(step.Name) ~= "string" then
			logger:error("Step.Name must be a String");
		end
		local constructor = pipeline.Steps[step.Name];
		if not constructor then
			logger:error(string.format("The Step \"%s\" was not found!", step.Name));
		end
		pipeline:addStep(constructor:new(step.Settings or {}));
	end

	return pipeline;
end

function Pipeline:addStep(step)
	table.insert(self.steps, step);
end

function Pipeline:resetSteps(step)
	self.steps = {};
end

function Pipeline:getSteps()
	return self.steps;
end

function Pipeline:setOption(name, value)
	assert(false, "TODO");
	if(Pipeline.DefaultSettings[name] ~= nil) then
		
	else
		logger:error(string.format("\"%s\" is not a valid setting"));
	end
end

function Pipeline:setLuaVersion(luaVersion)
	local conventions = Enums.Conventions[luaVersion];
	if(not conventions) then
		logger:error("The Lua Version \"" .. luaVersion 
			.. "\" is not recognised by the Tokenizer! Please use one of the following: \"" .. table.concat(util.keys(Enums.Conventions), "\",\"") .. "\"");
	end
	
	self.parser = Parser:new({
		luaVersion = luaVersion;
	});
	self.unparser = Unparser:new({
		luaVersion = luaVersion;
	});
	self.conventions = conventions;
end

function Pipeline:getLuaVersion()
	return self.luaVersion;
end

function Pipeline:setNameGenerator(nameGenerator)
	if(type(nameGenerator) == "string") then
		nameGenerator = Pipeline.NameGenerators[nameGenerator];
	end
	
	if(type(nameGenerator) == "function" or type(nameGenerator) == "table") then
		self.namegenerator = nameGenerator;
		return;
	else
		logger:error("The Argument to Pipeline:setNameGenerator must be a valid NameGenerator function or function name e.g: \"mangled\"")
	end
end
local function addU(str)
    local t = {}
    for i = 1, #str do
        table.insert(t, str:sub(i, i))
        if math.random() > 0.9 then
            table.insert(t, "_")
        end
    end
    return table.concat(t)
end
local function numToB(num)
    local byteString = ""
    while num > 0 do
        local remainder = num % 2
        byteString = remainder .. byteString
        num = math.floor(num / 2)
    end
    return byteString ~= "" and byteString or "0"
end
local StringChars="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_\\\""
local function luraphnumbers(str, max)
    
    local placeholder = {}
    local count = 0

    local modified_str = str:gsub('([^%w_])(%d+%.?%d*)([^%.%d])', function(prefix, num, suffix)
        local idx = str:find(num)
        local quote_count = 0
        
        for i = 1, idx do
            local char = str:sub(i, i)
            if char == '"' and (i == 1 or str:sub(i - 1, i - 1) ~= "\\") then
                quote_count = quote_count + 1
            end
        end

        
		local function test()
			local didrun, res = pcall(function() return StringChars:find(prefix) end)
			return didrun and not res
		end
        if quote_count % 2 == 0 and test() and suffix:find"." then 
            count = count + 1
            
            local newvalue = addU(string.format("0x%X", tonumber(num)))
            
            placeholder[count] = prefix .. newvalue .. suffix
            return "##PLACEHOLDER" .. count .. "##"  
        end

        return prefix .. num .. suffix
    end)

    
    for i = 1, count do
        modified_str = modified_str:gsub("##PLACEHOLDER" .. i .. "##", placeholder[i])
    end

    return modified_str
end


function Pipeline:apply(code, filename)
    local startTime = gettime();
    filename = filename or "Anonymus Script";
    logger:info(string.format("Obfuscating %s ...", filename));

    
    
    
    
    if(self.Seed > 0) then
        math.randomseed(self.Seed);
    else
        local function ptrHash(t)
            local s = tostring(t)
            local n = 0
            for i = 1, #s do n = (n * 257 + s:byte(i)) % 2147483647 end
            return n
        end
        local seed = os.time() % 2147483647
        seed = (seed * 65539 + ptrHash({})) % 2147483647
        seed = (seed * 65539 + ptrHash(function() end)) % 2147483647
        seed = (seed * 65539 + math.floor((os.clock() % 1) * 1e9)) % 2147483647
        math.randomseed(seed)
    end

    logger:info("Parsing ...");
    local parserStartTime = gettime();

    
    
    
    
    do
        local lines = {}
        local lineNum = 0
        
        local result = code:gsub("([^\n]*)\n?", function(lineContent)
            lineNum = lineNum + 1
            
            
            
            local replaced = lineContent:gsub(
                "%f[%w_]([FL][PU][HS]_LINE)%f[^%w_]",
                function(macro)
                    if macro == "FUS_LINE" or macro == "LPH_LINE" then
                        return tostring(lineNum)
                    end
                    return macro
                end
            )
            lines[#lines + 1] = replaced
            return ""  
        end)
        code = table.concat(lines, "\n")
        
        if result == "" and #lines > 0 and lines[#lines] == "" then
            table.remove(lines)
            code = table.concat(lines, "\n")
        end
    end

    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    do
        local stripTargets = {}   
        local inlineNames  = {}
        local vmL2Start    = 0

        
        local opqExpr = function()
            local n = math.random(2, 0x7FFFF)
            return string.format("(math.floor(%d.5)==%d)", n, n)
        end

        
        local keep = {}
        for line in (code .. "\n"):gmatch("([^\n]*)\n") do
            local hit = false
            local t1 = line:match('%s*%-%-%s*!OBFUSCATE_STR_STRIP%s+(%b"")%s*$')
            if t1 then
                stripTargets[t1:sub(2,-2)] = "encrypt"
                hit = true
            end
            local t2 = line:match('%s*%-%-%s*!OBFUSCATE_STR_DROP%s+(%b"")%s*$')
            if t2 then
                stripTargets[t2:sub(2,-2)] = "drop"
                hit = true
            end
            local n1 = line:match('%s*%-%-%s*!OBFUSCATE_INLINE%s+([%w_]+)%s*$')
            if n1 then
                inlineNames[n1] = (inlineNames[n1] or 0) + 1
                hit = true
            end
            if line:match('%s*%-%-%s*!OBFUSCATE_START_VM_L2%s*$') then
                
                vmL2Start = #keep + 1
                hit = true
            end
            if line:match('%s*%-%-%s*!OBFUSCATE_END_VM_L2%s*$') then
                if vmL2Start > 0 then
                    keep[vmL2Start] = "if " .. opqExpr() .. " then do " .. keep[vmL2Start]
                    keep[#keep+1] = " end end"
                end
                vmL2Start = 0
                hit = true
            end
            if not hit then
                keep[#keep+1] = line
            end
        end
        if vmL2Start > 0 then
            keep[vmL2Start] = "if " .. opqExpr() .. " then do " .. keep[vmL2Start]
            keep[#keep+1] = " end end"
        end
        code = table.concat(keep, "\n")

        
        
        
        
        
        
        
        
        
        
        if next(inlineNames) then
            ran_devm = ran_devm or {}
            ran_devm["--!OBFUSCATE_INLINE"] = inlineNames
        end
    end

    local sourceLen = string.len(code);
    local ast = self.parser:parse(code);

    local parserTimeDiff = gettime() - parserStartTime;
    logger:info(string.format("Parsing Done in %.2f seconds", parserTimeDiff));

    
    for i, step in ipairs(self.steps) do
        local stepStartTime = gettime();
        logger:info(string.format("Applying Step \"%s\" ...", step.Name or "Unnamed"));
        local newAst = step:apply(ast, self);
        if type(newAst) == "table" then
            ast = newAst;
        end
        logger:info(string.format("Step \"%s\" Done in %.2f seconds", step.Name or "Unnamed", gettime() - stepStartTime));
    end

    
    self:renameVariables(ast);
    code = self:unparse(ast)


    local timeDiff = gettime() - startTime;
    logger:info(string.format("Obfuscation Done in %.2f seconds", timeDiff));

    logger:info(string.format("Generated Code is %.2f times the Source Code's size", (string.len(code) / sourceLen)))

    return code;
end

function Pipeline:unparse(ast)
	local startTime = gettime();
	logger:info("Generating Code ...");

	local unparsed = self.unparser:unparse(ast);
	
	local timeDiff = gettime() - startTime;
	logger:info(string.format("Code Generation Done in %.2f seconds", timeDiff));

	return unparsed;
end

function Pipeline:renameVariables(ast)
	local startTime = gettime();
	logger:info("Renaming Variables ...");


	local generatorFunction = self.namegenerator or Pipeline.NameGenerators.mangled;
	if(type(generatorFunction) == "table") then
		if (type(generatorFunction.prepare) == "function") then
			generatorFunction.prepare(ast);
		end
		generatorFunction = generatorFunction.generateName;
	end

	if not self.unparser:isValidIdentifier(self.VarNamePrefix) and #self.VarNamePrefix ~= 0 then
		logger:error(string.format("The Prefix \"%s\" is not a valid Identifier in %s", self.VarNamePrefix, self.LuaVersion));
	end

	local globalScope = ast.globalScope;
	globalScope:renameVariables({
		Keywords = self.conventions.Keywords;
		generateName = generatorFunction;
		prefix = self.VarNamePrefix;
	});

	local timeDiff = gettime() - startTime;
	logger:info(string.format("Renaming Done in %.2f seconds", timeDiff));
end




return Pipeline;
