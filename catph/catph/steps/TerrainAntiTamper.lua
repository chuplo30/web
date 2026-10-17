local Step = require("catph.step")
local Parser = require("catph.parser")
local Enums = require("catph.enums")










local TerrainAntiTamper = Step:extend()
TerrainAntiTamper.Name = "TerrainAntiTamper"
TerrainAntiTamper.Description = "Roblox anti-tamper: genuine TerrainRegion/Region3/CopyRegion instance-creating integrity checks + decoy-error trap. Executor-only."
TerrainAntiTamper.SettingsDescriptor = {}

function TerrainAntiTamper:init(settings) end

function TerrainAntiTamper:apply(ast, pipeline)
    local rawCode = [[
local success = pcall(function()
	do
		local c = Instance.new("TerrainRegion")
		assert(typeof(c) == "Instance")
		assert(c.ClassName == "TerrainRegion")
		assert(c:IsA("TerrainRegion"))
		assert(c:IsA("Instance"))
		local workspaceTerrain = workspace:FindFirstChildOfClass("Terrain")
		if workspaceTerrain then
			local ok, region = pcall(function()
				return workspaceTerrain:CopyRegion(Region3.new(Vector3.new(0,0,0), Vector3.new(4,4,4)))
			end)
			if ok and region then
				assert(typeof(region) == "TerrainRegion")
				assert(region.ClassName == "TerrainRegion")
				assert(region:IsA("TerrainRegion"))
				local size = region.Size
				assert(typeof(size) == "Vector3int16")
				assert(type(size.X) == "number")
				assert(type(size.Y) == "number")
				assert(type(size.Z) == "number")
			end
		end
		local okCreate = pcall(function()
			local part = Instance.new("Part")
			local pos = part.Position
			part:Destroy()
		end)
		assert(okCreate)
	end
end)
if success then
	print("[string \"vozhsi\"]:1: attempt to compare nil < number")
else
	error("[string \"vozhsi\"]:1: attempt to compare nil < number")
end
]]
    
    
    local wrapped = string.format([[
do
    if rawget(_G,"typeof") and rawget(_G,"game") and type(rawget(_G,"game"))~="table" and rawget(_G,"task") and rawget(_G,"Instance") and rawget(_G,"workspace") then
        local _ok,_err = pcall(function()
            %s
        end)
        if not _ok then
            error(_err)
        end
    end
end
]], rawCode)

    local ok, parsed = pcall(function()
        return Parser:new({LuaVersion=Enums.LuaVersion.LuaU}):parse(wrapped)
    end)
    if not ok or not parsed then return ast end
    local block = parsed.body.statements[1]
    block.__catphAntiTamper = true
    if block and block.body and block.body.scope then
        block.body.scope:setParent(ast.body.scope)
    end
    table.insert(ast.body.statements, 1, block)
    return ast
end

return TerrainAntiTamper
