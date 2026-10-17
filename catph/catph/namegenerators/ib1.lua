











local ALPHA = {}
for c in ("abcdefghijklmnopqrstuvwxyz"):gmatch(".") do
    ALPHA[#ALPHA+1] = c
end
local N = #ALPHA  

local _gid = 0

local function idToName(id)
    if id < N then
        return ALPHA[id + 1]
    elseif id < N + N * N then
        local rem = id - N
        local d1  = math.floor(rem / N) % N
        local d2  = rem % N
        return ALPHA[d1 + 1] .. ALPHA[d2 + 1]
    else
        local rem = id - N - N * N
        local d1  = math.floor(rem / (N * N)) % N
        local d2  = math.floor(rem / N) % N
        local d3  = rem % N
        return ALPHA[d1 + 1] .. ALPHA[d2 + 1] .. ALPHA[d3 + 1]
    end
end

local function generateName(id, scope)
    local name = idToName(_gid)
    _gid = _gid + 1
    return name
end

local function prepare(ast)
    _gid = 0
end

return {
    generateName = generateName,
    prepare      = prepare,
}
