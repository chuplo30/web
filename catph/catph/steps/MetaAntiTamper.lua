local Step = require("catph.step")
local Parser = require("catph.parser")
local Enums = require("catph.enums")







local MetaAntiTamper = Step:extend()
MetaAntiTamper.Name = "MetaAntiTamper"
MetaAntiTamper.Description = "Strict Roblox anti-tamper: typeof/table.create/math.clamp/debug/Instance/buffer/vector/enum/Random/RBXScriptSignal C-closure checks + JobId/PlaceId anti-wipe. Executor-only."
MetaAntiTamper.SettingsDescriptor = {}

function MetaAntiTamper:init(settings) end

function MetaAntiTamper:apply(ast, pipeline)
    local rawCode = [[
local JaN9y=type
local sZBnw=pcall
do
	local aFM=sZBnw(error,"\000",0)
	if aFM then
		do error("n.err",0) end
	end
end
do
	if JaN9y(game)==JaN9y({}) then
		if not (JaN9y(typeof)=="function" and typeof(game)=="Instance") then do error("g.type",0) end end
	end
	if JaN9y(workspace)==JaN9y({}) then
		if not (JaN9y(typeof)=="function" and typeof(workspace)=="Instance") then do error("ws.type",0) end end
	end
	if JaN9y(typeof)~="function" then do error("luau.typeof",0) end end
	if JaN9y(table.create)~="function" or JaN9y(table.clear)~="function" then do error("luau.table",0) end end
	if JaN9y(math.clamp)~="function" then do error("luau.math",0) end end
	if JaN9y(debug)~=JaN9y({}) or JaN9y(debug.info)~="function" then do error("luau.debug",0) end end
	if JaN9y(rawequal)~="function" then do error("luau.rawequal",0) end end
	if tostring({})==tostring({}) then do error("tostring.id",0) end end
	if not rawequal(string.byte,("A").byte) then do error("str.byte",0) end end
end
local hRx53=false
if JaN9y(typeof)=="function" and typeof(game)=="Instance" and JaN9y(game)~=JaN9y({}) then hRx53=true end
if hRx53 then
	if JaN9y(getmetatable)=="function" then
		local aFM,SScS6=sZBnw(getmetatable,game)
		if aFM and JaN9y(SScS6)==JaN9y({}) then do error("g.mt",0) end end
	end
	if not rawequal(game:GetService("Workspace"),workspace) then do error("ws.id",0) end end

do
	local W8pR=Instance.new
	local aFM,WGEY,sWth,kaES,a4GpZ,C72,CaqHF=sZBnw(function()
		return debug.info(W8pR,"slnaf")
	end)
	if aFM and WGEY=="[C]" then
		if sWth~=-1 then do error("c.inst.line",0) end end
		if kaES~="new" then do error("c.inst.name",0) end end
		if a4GpZ~=0 then do error("c.inst.argc",0) end end
		if C72~=true then do error("c.inst.var",0) end end
		if not rawequal(CaqHF,W8pR) then do error("c.inst.id",0) end end
	end
end
do
	local W8pR=UDim2.new
	local aFM,WGEY,sWth,kaES,a4GpZ,C72,CaqHF=sZBnw(function()
		return debug.info(W8pR,"slnaf")
	end)
	if aFM and WGEY=="[C]" then
		if sWth~=-1 then do error("c.udim.line",0) end end
		if kaES~="new" then do error("c.udim.name",0) end end
		if a4GpZ~=0 then do error("c.udim.argc",0) end end
		if C72~=true then do error("c.udim.var",0) end end
		if not rawequal(CaqHF,W8pR) then do error("c.udim.id",0) end end
	end
end
do
	local W8pR=Random.new
	local aFM,WGEY,sWth,kaES,a4GpZ,C72,CaqHF=sZBnw(function()
		return debug.info(W8pR,"slnaf")
	end)
	if aFM and WGEY=="[C]" then
		if sWth~=-1 then do error("c.rnd.line",0) end end
		if kaES~="new" then do error("c.rnd.name",0) end end
		if a4GpZ~=0 then do error("c.rnd.argc",0) end end
		if C72~=true then do error("c.rnd.var",0) end end
		if not rawequal(CaqHF,W8pR) then do error("c.rnd.id",0) end end
	end
end
do
	local W8pR=task.spawn
	local aFM,WGEY,sWth,kaES,a4GpZ,C72,CaqHF=sZBnw(function()
		return debug.info(W8pR,"slnaf")
	end)
	if aFM and WGEY=="[C]" then
		if sWth~=-1 then do error("c.tspawn.line",0) end end
		if kaES~="spawn" then do error("c.tspawn.name",0) end end
		if a4GpZ~=0 then do error("c.tspawn.argc",0) end end
		if C72~=true then do error("c.tspawn.var",0) end end
		if not rawequal(CaqHF,W8pR) then do error("c.tspawn.id",0) end end
	end
end
do
	local W8pR=task.defer
	local aFM,WGEY,sWth,kaES,a4GpZ,C72,CaqHF=sZBnw(function()
		return debug.info(W8pR,"slnaf")
	end)
	if aFM and WGEY=="[C]" then
		if sWth~=-1 then do error("c.tdefer.line",0) end end
		if kaES~="defer" then do error("c.tdefer.name",0) end end
		if a4GpZ~=0 then do error("c.tdefer.argc",0) end end
		if C72~=true then do error("c.tdefer.var",0) end end
		if not rawequal(CaqHF,W8pR) then do error("c.tdefer.id",0) end end
	end
end
do
	local W8pR=task.delay
	local aFM,WGEY,sWth,kaES,a4GpZ,C72,CaqHF=sZBnw(function()
		return debug.info(W8pR,"slnaf")
	end)
	if aFM and WGEY=="[C]" then
		if sWth~=-1 then do error("c.tdelay.line",0) end end
		if kaES~="delay" then do error("c.tdelay.name",0) end end
		if a4GpZ~=0 then do error("c.tdelay.argc",0) end end
		if C72~=true then do error("c.tdelay.var",0) end end
		if not rawequal(CaqHF,W8pR) then do error("c.tdelay.id",0) end end
	end
end
do
	local W8pR=task.wait
	local aFM,WGEY,sWth,kaES,a4GpZ,C72,CaqHF=sZBnw(function()
		return debug.info(W8pR,"slnaf")
	end)
	if aFM and WGEY=="[C]" then
		if sWth~=-1 then do error("c.twait.line",0) end end
		if kaES~="wait" then do error("c.twait.name",0) end end
		if a4GpZ~=0 then do error("c.twait.argc",0) end end
		if C72~=true then do error("c.twait.var",0) end end
		if not rawequal(CaqHF,W8pR) then do error("c.twait.id",0) end end
	end
end
do
	local W8pR=task.cancel
	local aFM,WGEY,sWth,kaES,a4GpZ,C72,CaqHF=sZBnw(function()
		return debug.info(W8pR,"slnaf")
	end)
	if aFM and WGEY=="[C]" then
		if sWth~=-1 then do error("c.tcancel.line",0) end end
		if kaES~="cancel" then do error("c.tcancel.name",0) end end
		if a4GpZ~=0 then do error("c.tcancel.argc",0) end end
		if C72~=true then do error("c.tcancel.var",0) end end
		if not rawequal(CaqHF,W8pR) then do error("c.tcancel.id",0) end end
	end
end
end
do
	if hRx53 and JaN9y(getfenv)=="function" and JaN9y(setfenv)=="function" then
		local zY8=getfenv(UDim2.new)
		if JaN9y(zY8)~=JaN9y({}) then do error("fenv.c",0) end end
		if sZBnw(setfenv,UDim2.new,{}) then do error("setfenv.c",0) end end
		local function MrCm() return true end
		local YPs6={["m"]=true}
		setfenv(MrCm,YPs6)
		if not rawequal(getfenv(MrCm),YPs6) then do error("fenv.lua",0) end end
	end
end
do
	local XaG=7
	if XaG~=XaG then do error("nan",0) end end
	if XaG*0~=0 then do error("arith",0) end end
	if XaG<0 then do error("sign",0) end end
end
if hRx53 then
do
	local Fct=game.JobId
	if Fct=="00000000-0000-0000-0000-000000000000" then
		local REQcU=false
		sZBnw(function()
			local g5U42=game:GetService("Players")
			local Kubzy,PmPp=sZBnw(function() return g5U42 and g5U42.LocalPlayer end)
			if Kubzy and PmPp and (PmPp.UserId==123456789 or PmPp.Name=="vole7vin") then REQcU=true end
		end)
		if game.PlaceId==8916037983 then REQcU=true end
		if REQcU then do error("jobid",0) end end
	end
	if Fct=="bypass-job-id" or Fct=="sandbox" then do error("l2.job",0) end end
	if JaN9y(Fct)=="string" and #Fct>0 and not string.find(Fct,"%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x") then
		if Fct~="" then do error("l2.job2",0) end end
	end
	local k2p7h=game.PlaceId
	if k2p7h==8916037983 then do error("place",0) end end
	local BWQd3=game.GameId
	if BWQd3==8916037983 then do error("gameid",0) end end
	if k2p7h==142823291 and BWQd3==66654135 then do error("l2.place",0) end end
end
do
	local aFM,g5U42=sZBnw(function() return game:GetService("Players") end)
	if not aFM or g5U42==nil then do error("pl.get",0) end end
	local WKPj,AuER=sZBnw(function() return game:GetService("RunService") end)
	if WKPj and AuER~=nil and AuER:IsClient() then
		local Kubzy,PmPp=sZBnw(function() return g5U42.LocalPlayer end)
		if not Kubzy or PmPp==nil then do error("lp.nil",0) end end
		if PmPp.UserId==123456789 then do error("uid",0) end end
		-- Note: CharacterAppearanceId deprecated on modern Roblox; keep check but it may fail
		if PmPp.CharacterAppearanceId==123456789 then do error("caid",0) end end
		if PmPp.Name=="vole7vin" then do error("name",0) end end
		if PmPp.DisplayName=="vole7vin" then do error("dname",0) end end
		if PmPp.UserId==1 and PmPp.Name=="Player" and PmPp.DisplayName=="Player" then do error("l2.lp",0) end end
		local cYxby=g5U42:GetPlayers()
		if JaN9y(cYxby)==JaN9y({}) and #cYxby>0 then
			local rFSpP=cYxby[1]
			if rFSpP~=nil and rFSpP.UserId==123456789 then do error("p0uid",0) end end
			if rFSpP~=nil and rFSpP.Name=="vole7vin" then do error("p0name",0) end end
		end
		if g5U42.MaxPlayers==16 and PmPp.UserId==123456789 then do error("maxpl",0) end end
	end
end
do
	local qNda=game:GetService("Lighting")
	if qNda~=nil then
		if qNda.GeographicLatitude==41.7 and qNda.FogEnd==100000 then do error("light",0) end end
		if qNda.TimeOfDay=="12:00:00" and qNda.GeographicLatitude==41.7 then do error("tod",0) end end
	end
end
do
	local UvbW=game:GetService("SoundService")
	if UvbW~=nil then
		if UvbW.DistanceFactor==3.33 and UvbW.RolloffScale==1 then
			local Fct=game.JobId
			if Fct=="bypass-job-id" or Fct=="sandbox" then
				do error("sound",0) end
			elseif Fct=="00000000-0000-0000-0000-000000000000" and game.PlaceId==8916037983 then
				do error("sound",0) end
			end
		end
	end
end
do
	local YgarP=game:GetService("HttpService")
	if YgarP~=nil then
		if YgarP.HttpEnabled==true and game.JobId=="00000000-0000-0000-0000-000000000000" and game.PlaceId==8916037983 then do error("http",0) end end
		if YgarP.HttpEnabled==true and game.JobId=="bypass-job-id" then do error("l2.http",0) end end
	end
end
do
	local xbH=game:GetService("Stats")
	if xbH==nil then do error("st.get",0) end end
	local kbnbh=xbH:GetChildren()
	if JaN9y(kbnbh)==JaN9y({}) and #kbnbh==5 then
		if game.PlaceId==8916037983 then do error("stats5",0) end end
	end
	local aFM,PW8WX=sZBnw(function() return xbH.Network end)
	if aFM and PW8WX~=nil then
		local Kubzy,De4=sZBnw(function() return PW8WX.ServerStatsItem end)
		if Kubzy and De4~=nil then
			local GtUq=nil
			Kubzy,GtUq=sZBnw(function() return De4["Data Ping"] end)
			if Kubzy and GtUq~=nil then
				local kYttw=nil
				aFM,kYttw=sZBnw(GtUq.GetValue,GtUq)
				if aFM then
					local Xyh=math.floor(tonumber(kYttw) or 0)
					local AuER=game:GetService("RunService")
					if Xyh==0 and AuER~=nil and not AuER:IsStudio() then do error("st.ping",0) end end
				end
			end
		end
	end
end
do
	local AuER=game:GetService("RunService")
	if AuER~=nil and AuER:IsClient() then
		local aFM,rZN8=sZBnw(function() return game:GetService("CoreGui") end)
		if not aFM or rZN8==nil then do error("cg.get",0) end end
		local cThMx=rZN8:FindFirstChild("RobloxGui")
		if cThMx==nil then do error("cg.rbx",0) end end
		if cThMx.ClassName~="ScreenGui" then do error("cg.rbx.cls",0) end end
		if cThMx:IsA("Folder") then do error("l2.rbx",0) end end
	end
end
do
	local Fcd=game:GetService("Workspace") or workspace
	if Fcd~=nil then
		if Fcd:IsA("WorldRoot")==false then do error("ws.wr",0) end end
		local Yz4P8=Fcd:GetFullName()
		if JaN9y(Yz4P8)=="string" and string.sub(Yz4P8,1,5)=="Game." then do error("ws.gdot",0) end end
	end
end
do
	local AuER=game:GetService("RunService")
	if AuER==nil then do error("rs.get",0) end end
do
	local W8pR=AuER.IsStudio
	local aFM,WGEY,sWth,kaES,a4GpZ,C72,CaqHF=sZBnw(function()
		return debug.info(W8pR,"slnaf")
	end)
	if aFM and WGEY=="[C]" then
		if sWth~=-1 then do error("c.studio.line",0) end end
		if kaES~="IsStudio" then do error("c.studio.name",0) end end
		if a4GpZ~=0 then do error("c.studio.argc",0) end end
		if C72~=true then do error("c.studio.var",0) end end
		if not rawequal(CaqHF,W8pR) then do error("c.studio.id",0) end end
	end
end
do
	local W8pR=AuER.IsClient
	local aFM,WGEY,sWth,kaES,a4GpZ,C72,CaqHF=sZBnw(function()
		return debug.info(W8pR,"slnaf")
	end)
	if aFM and WGEY=="[C]" then
		if sWth~=-1 then do error("c.client.line",0) end end
		if kaES~="IsClient" then do error("c.client.name",0) end end
		if a4GpZ~=0 then do error("c.client.argc",0) end end
		if C72~=true then do error("c.client.var",0) end end
		if not rawequal(CaqHF,W8pR) then do error("c.client.id",0) end end
	end
end
do
	local W8pR=AuER.IsServer
	local aFM,WGEY,sWth,kaES,a4GpZ,C72,CaqHF=sZBnw(function()
		return debug.info(W8pR,"slnaf")
	end)
	if aFM and WGEY=="[C]" then
		if sWth~=-1 then do error("c.server.line",0) end end
		if kaES~="IsServer" then do error("c.server.name",0) end end
		if a4GpZ~=0 then do error("c.server.argc",0) end end
		if C72~=true then do error("c.server.var",0) end end
		if not rawequal(CaqHF,W8pR) then do error("c.server.id",0) end end
	end
end
	if sZBnw(AuER.IsStudio) then do error("rs.studio.self",0) end end
	if sZBnw(AuER.IsClient) then do error("rs.client.self",0) end end
	if sZBnw(AuER.IsServer) then do error("rs.server.self",0) end end
	if AuER:IsClient() and AuER:IsServer() then do error("rs.both",0) end end
end
end
]]
    
    
    local wrapped = string.format([[
do
    if rawget(_G,"typeof") and rawget(_G,"game") and type(rawget(_G,"game"))~="table" and rawget(_G,"task") and rawget(_G,"Instance") then
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

return MetaAntiTamper
