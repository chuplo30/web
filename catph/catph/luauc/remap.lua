













local Remap = {}


local INSN_AUX = {
    [7] = true, [8] = true, [12] = true, [15] = true, [16] = true, [20] = true,
    [27] = true, [28] = true, [29] = true, [30] = true, [31] = true, [32] = true,
    [53] = true, [55] = true, [58] = true, [60] = true, [66] = true,
    [74] = true, [75] = true, [77] = true, [78] = true, [79] = true, [80] = true,
    [83] = true, [84] = true, [85] = true, [86] = true, [87] = true, [88] = true,
}

local MAXOP = 88















function Remap.derivePerm(N)
    local s = N % 2147483647
    if s == 0 then s = 1 end
    local ids = {}
    for i = 0, MAXOP do ids[i + 1] = i end
    for i = MAXOP + 1, 2, -1 do
        s = (s * 16807) % 2147483647
        local j = (s % i) + 1
        ids[i], ids[j] = ids[j], ids[i]
    end
    return ids
end


function Remap.deriveKeys(N)
    local t = (N * 16807 + 1) % 2147483647
    t = (t * 16807) % 2147483647; local hi = t % 65536
    t = (t * 16807) % 2147483647; local lo = t % 65536
    t = (t * 16807) % 2147483647; local bstep = (t % 65535) * 2 + 1
    return hi * 65536 + lo, bstep
end




function Remap.applyWithPerm(bc, ids)
    for _, p in ipairs(bc.protos) do
        local code = p.code
        local i = 1
        while i <= #code do
            local wd = code[i]
            local op = wd % 256
            code[i] = ids[op + 1] + (wd - op)
            if INSN_AUX[op] then i = i + 2 else i = i + 1 end
        end
    end
    return bc
end


function Remap.encryptCodeWithKeys(bc, bkey, bstep)
    for _, p in ipairs(bc.protos) do
        local code = p.code
        
        
        local key = bkey + bstep
        for i = 1, #code do
            code[i] = (code[i] + key) % 4294967296
            key = key + bstep
        end
    end
    return bc
end

function Remap.apply(bc)
    
    local ids = {}
    for i = 0, MAXOP do ids[#ids + 1] = i end
    for i = #ids, 2, -1 do
        local j = math.random(1, i)
        ids[i], ids[j] = ids[j], ids[i]
    end
    local perm = {}
    for i = 0, MAXOP do perm[i] = ids[i + 1] end

    
    for _, p in ipairs(bc.protos) do
        local code = p.code
        local i = 1
        while i <= #code do
            local wd = code[i]
            local op = wd % 256
            code[i] = perm[op] + (wd - op)
            if INSN_AUX[op] then i = i + 2 else i = i + 1 end
        end
    end

    
    local inv = {}
    for c = 0, MAXOP do inv[perm[c]] = c end
    bc.opmap = inv
    return bc
end

local TWO32 = 4294967296






function Remap.encryptCode(bc)
    
    local bkey = math.random(0, 65535) * 65536 + math.random(0, 65535)
    local bstep = math.random(1, 65535) * 2 + 1 
    for _, p in ipairs(bc.protos) do
        local code = p.code
        local key = bkey + bstep
        for i = 1, #code do
            code[i] = (code[i] + key) % TWO32
            key = key + bstep
        end
    end
    bc.bkey = bkey
    bc.bstep = bstep
    return bc
end

return Remap
