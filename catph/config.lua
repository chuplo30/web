--
-- config.lua
--
-- In this Script, some Global config Variables are defined

local NAME    = "Catph";
local REVISION = "Nigger";
local VERSION = "V4";
local BY      = "tthanh promaxlevl999";

for _, currArg in pairs(arg) do
	if currArg == "--CI" then
		local releaseName = string.gsub(string.format("%s %s %s", NAME, REVISION, VERSION), "%s", "-")
		print(releaseName)
	end
	
	if currArg == "--FullVersion" then
		print(VERSION)
	end
end

-- Config Starts here
return {
	Name = NAME,
	NameUpper = string.upper(NAME),
	NameAndVersion = string.format("%s %s", NAME, VERSION),
	Version = VERSION;
	Revision = REVISION;
	IdentPrefix = "_catph_"; -- The Prefix used for generated Identifiers.
	
	SPACE = " "; -- The Whitespace to be used by the unparser
	TAB   = "\t"; -- The Tab Whitespace to be used by the unparser for pretty printing
}
