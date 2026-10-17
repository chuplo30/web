local Step = require("catph.step")
local Parser = require("catph.parser")
local Enums = require("catph.enums")

local GoofyAntiTamper = Step:extend()
GoofyAntiTamper.Name = "GoofyAntiTamper"
GoofyAntiTamper.Description = "Injects GoofyScator-style anti-tamper (pcall/Instance/Random/DataStore check) executor-safe."
GoofyAntiTamper.SettingsDescriptor = {}

function GoofyAntiTamper:init(settings) end

function GoofyAntiTamper:apply(ast, pipeline)
    local rawCode = [[
local v0, v1, v2, v5, v6, v7, v8, v9, v10, v11, v13, v14, v15
v0 = pcall
v1 = tonumber
v2 = function()
    local v1, v2, v3, v4, v5, v6
    v1 = ""
    v2, v3, v4 = ('$\n} A $\nE \'mu $\nD %#&"P %#F $\n% $m&#$m%#& $m\'#$m\' $m\'#$m& *#& $"%#% &#% %m(#$m& $m(#$m& $m(#$m% *#\' $m\'#$m\' %#$m\'#. $\n$ %#$"% $"%#% %#$"% $"%#% %#$"% $"%#\' %#* %#$m$ %#& %#\'m$ $"% %#$"\' $"& $"$ &m%#\' %#) %#$"% $"%#& %#$"2 $\n$ %#\' %#% %#\' %#% %#\' %#\' %#+ \'#$"\' \'"%#$m% %#+ $m%#&"%#\' %#) %#\' %#& %#3 $\n$ $"%#%m&#% $"%#%m%#$"% $"%#%m%#$"\' %#, &#\' $#(m%#% $"%#\'m$#% %#&m&#\' %#&m& $"%#%m%#$"& %#3 $\n% $m&"$ %#\' \'") \'") %", %#) )"( ("\' \'"$ %"( \'"( \'"( %"3 $\n% $"\'#%"D &#n $\n} A %\n$h%t$p$s$:%/$g%o$f$y$s$c$a$t$o$r$.$l$u$a$.$c$z$/$\n').gmatch('$\n} A $\nE \'mu $\nD %#&"P %#F $\n% $m&#$m%#& $m\'#$m\' $m\'#$m& *#& $"%#% &#% %m(#$m& $m(#$m& $m(#$m% *#\' $m\'#$m\' %#$m\'#. $\n$ %#$"% $"%#% %#$"% $"%#% %#$"% $"%#\' %#* %#$m$ %#& %#\'m$ $"% %#$"\' $"& $"$ &m%#\' %#) %#$"% $"%#& %#$"2 $\n$ %#\' %#% %#\' %#% %#\' %#\' %#+ \'#$"\' \'"%#$m% %#+ $m%#&"%#\' %#) %#\' %#& %#3 $\n$ $"%#%m&#% $"%#%m%#$"% $"%#%m%#$"\' %#, &#\' $#(m%#% $"%#\'m$#% %#&m&#\' %#&m& $"%#%m%#$"& %#3 $\n% $m&"$ %#\' \'") \'") %", %#) )"( ("\' \'"$ %"( \'"( \'"( %"3 $\n% $"\'#%"D &#n $\n} A %\n$h%t$p$s$:%/$g%o$f$y$s$c$a$t$o$r$.$l$u$a$.$c$z$/$\n', "(.)(.)")
    while true do
        v5, v6 = v2(v3, v4)
        v4 = v5
        if v5 ~= nil then
            v1 = v1 .. v6.rep(v6, v5.byte(v5) - 35)
            continue
        else
            break
        end
    end
    return v1
end
v0(v1, '\n                                                                                                                        \n                                  mmmm                                                                                  \n                                 ##"""                                             ##                                   \n  m###m##   m####m    m####m   #######   "##  ###  mm#####m   m#####m   m#####m  #######    m####m    ##m####           \n ##"  "##  ##"  "##  ##"  "##    ##       ##m ##   ##mmmm "  ##"    "   " mmm##    ##      ##"  "##   ##"               \n ##    ##  ##    ##  ##    ##    ##        ####"    """"##m  ##        m##"""##    ##      ##    ##   ##                \n "##mm###  "##mm##"  "##mm##"    ##         ###    #mmmmm##  "##mmmm#  ##mmm###    ##mmm   "##mm##"   ##                \n  m""" ##    """"      """"      ""         ##      """"""     """""    """" ""     """"     """"     ""                \n  "####""                                 ###                                                                           \n                                                                                                                        \n\nhttps://goofyscator.lua.cz/\n')
CATPH = true
if false then
    v0 = {}
    v1 = "decryptPayload"
    v2 = "getfenv"
    v0[1] = "decryptPayload"
    v0[2] = "getfenv"
    v0[3] = 7981
    v0[4] = 1337
    v0[5] = true
end
v1 = _ENV
if not v1 then
    v1 = getfenv
    if v1 then
        v1 = getfenv
        v1 = v1()
    end
end
if not v1 then
    v1 = _G
end
v2 = setmetatable
v2 = v2({}, {
    __index = function(p1, p2)
        if p2 == "limitedstack" then
            return true
        else
            return v1[p2]
        end
    end,
    __newindex = v1,
})
task.defer(coroutine.yield)
v5 = function(p1)
    local v1, v2_12, v3, v4, v5
    v1 = v2
    v1 = v1.error
    v1("setmetatable", 0)
    v1 = v2
    v1 = v1.CAT_CRASH
    v1()
    v1 = v2
    v1 = v1.typeof
    v2_12 = nil
    v3 = nil
    while true do
        v4, v5 = v1(v2_12, v3)
        v3 = v4
        if v4 ~= nil then
            continue
        else
            break
        end
    end
    v1 = nil
    v2_12 = function()
        v1()
        return
    end
    v1 = v2_12
    v2_12()
    v1[1] = v1
    v1[4] = false
    v1[3] = nil
    v1 = nil
    return
end
v6 = Random.new()
v7 = v6.NextNumber(v6, 0.5, 10)
v8 = Instance.new
v9 = v8("DataStoreIncrementOptions")
v13 = {}
v14 = v7
v13.hi = v14
v10 = v13
v9.SetMetadata(v9, v10)
if v9.GetMetadata(v9).hi ~= v10.hi then
    v5()
end
v9.Destroy(v9)
v11 = v8("Part")
v11.Material = Enum.Material.Plastic
v14 = v7
v11.Size = Vector3.new(v14, v7, v7)
if math.abs(v7 ^ 3 * 0.7 - v11.GetMass(v11)) > 0.1 then
    v5()
end
v11.Destroy(v11)
if not rawequal(game, workspace.Parent) then
    v5()
end
v14, v15 = pcall(function()
    return rawequal(Enum.Material.Plastic.Parent, Enum.Material)
end)
if v14 and v15 == false then
    v5()
end
v5 = 0
while true do
    v6 = v5
    v6 = v5 + 1
    v7 = v6
    v5 = v6
    v7 = v6
    v7 = v6 == 4
    if v7 then
        break
    else
        continue
    end
end
assert(v5 == 4)
]]
    local wrapped = string.format([[
do
    if rawget(_G,"task") and rawget(_G,"pcall") and rawget(_G,"Instance") and rawget(_G,"Random") then
        local _ok,_err = pcall(function()
            %s
        end)
        if not _ok then
            if rawget(_G,"Instance") then error(_err) end
        end
    end
end
]], rawCode)

    local ok, parsed = pcall(function()
        return Parser:new({LuaVersion=Enums.LuaVersion.LuaU}):parse(wrapped)
    end)
    if not ok or not parsed then return ast end
    local block = parsed.body.statements[1]
    if block and block.body and block.body.scope then
        block.body.scope:setParent(ast.body.scope)
    end
    table.insert(ast.body.statements, 1, block)
    return ast
end

return GoofyAntiTamper
