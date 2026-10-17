












local util = require("catph.util");


local ALPHA = {}
for c in ("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"):gmatch(".") do
    ALPHA[#ALPHA+1] = c
end

local N = #ALPHA  


local _gid = 0




local _unpack = table.unpack or unpack
local ALPHA2  = {_unpack(ALPHA)}
local ALPHA3a = {_unpack(ALPHA)}
local ALPHA3b = {_unpack(ALPHA)}

local function idToName(id)
    if id < N then
        return ALPHA[id + 1]
    elseif id < N + N * N then
        local rem = id - N
        local d1  = math.floor(rem / N) % N
        local d2  = rem % N
        
        return ALPHA[d1 + 1] .. ALPHA2[d2 + 1]
    else
        local rem = id - N - N * N
        local d1  = math.floor(rem / (N * N)) % N
        local d2  = math.floor(rem / N) % N
        local d3  = rem % N
        
        return ALPHA[d1 + 1] .. ALPHA3a[d2 + 1] .. ALPHA3b[d3 + 1]
    end
end



local function generateName(id, scope)
    local name = idToName(_gid)
    _gid = _gid + 1
    return name
end

local function prepare(ast)
    ALPHA2  = {_unpack(ALPHA)}
    ALPHA3a = {_unpack(ALPHA)}
    ALPHA3b = {_unpack(ALPHA)}
    _gid = 0   
end

return {
    generateName = generateName,
    prepare      = prepare,
}
