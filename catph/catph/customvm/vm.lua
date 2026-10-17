



local ISA = require("catph.customvm.isa")
local OP = ISA.OP

local VM = {}

local pack = table.pack or function(...) local t = {...}; t.n = select("#", ...); return t end
local unpack = table.unpack or unpack
local floor = math.floor


local function getOpen(openuv, R, reg)
    for i = 1, #openuv do
        local uv = openuv[i]
        if uv.open and uv.idx == reg then return uv end
    end
    local uv = { open = true, stack = R, idx = reg }
    openuv[#openuv + 1] = uv
    return uv
end

local function closeFrom(openuv, R, a)
    for i = 1, #openuv do
        local uv = openuv[i]
        if uv.open and uv.idx >= a then
            uv.val = R[uv.idx]; uv.open = false; uv.stack = nil
        end
    end
end

local run

local function makeClosure(proto, env, ups)
    return function(...)
        return run(proto, env, ups, pack(...))
    end
end


function run(proto, env, upvals, args)
    local code = proto.code
    local K = proto.k
    local protos = proto.protos
    local R = {}
    local pc = 1
    local top = 0
    local openuv = {}

    local np = proto.numparams or 0
    local n = args and (args.n or #args) or 0
    for i = 1, np do R[i - 1] = args[i] end

    local varargs, nva = nil, 0
    if proto.isvararg and n > np then
        varargs = {}
        for i = np + 1, n do nva = nva + 1; varargs[nva] = args[i] end
    end

    while true do
        local ins = code[pc]; pc = pc + 1
        local op = ins.op
        local a = ins.a

        if op == OP.LOADK then R[a] = K[ins.k]
        elseif op == OP.MOVE then R[a] = R[ins.b]
        elseif op == OP.LOADNIL then R[a] = nil
        elseif op == OP.LOADB then R[a] = ins.b ~= 0
        elseif op == OP.LOADN then R[a] = ins.b
        elseif op == OP.GETGLOBAL then R[a] = env[K[ins.k]]
        elseif op == OP.SETGLOBAL then env[K[ins.k]] = R[a]
        elseif op == OP.GETTABLE then R[a] = R[ins.b][R[ins.c]]
        elseif op == OP.SETTABLE then R[ins.b][R[ins.c]] = R[a]
        elseif op == OP.GETTABLEKS then R[a] = R[ins.b][K[ins.k]]
        elseif op == OP.SETTABLEKS then R[ins.b][K[ins.k]] = R[a]
        elseif op == OP.GETTABLEN then R[a] = R[ins.b][ins.c]
        elseif op == OP.SETTABLEN then R[ins.b][ins.c] = R[a]
        elseif op == OP.ADD then R[a] = R[ins.b] + R[ins.c]
        elseif op == OP.SUB then R[a] = R[ins.b] - R[ins.c]
        elseif op == OP.MUL then R[a] = R[ins.b] * R[ins.c]
        elseif op == OP.DIV then R[a] = R[ins.b] / R[ins.c]
        elseif op == OP.MOD then R[a] = R[ins.b] % R[ins.c]
        elseif op == OP.POW then R[a] = R[ins.b] ^ R[ins.c]
        elseif op == OP.IDIV then R[a] = floor(R[ins.b] / R[ins.c])
        elseif op == OP.CONCAT then
            local s = R[ins.b]
            for r = ins.b + 1, ins.c do s = s .. R[r] end
            R[a] = s
        elseif op == OP.NOT then R[a] = not R[ins.b]
        elseif op == OP.MINUS then R[a] = -R[ins.b]
        elseif op == OP.LENGTH then R[a] = #R[ins.b]

        elseif op == OP.JUMP or op == OP.JUMPBACK then pc = pc + ins.b
        elseif op == OP.JUMPIF then if R[a] then pc = pc + ins.b end
        elseif op == OP.JUMPIFNOT then if not R[a] then pc = pc + ins.b end
        elseif op == OP.JUMPIFEQ then if R[a] == R[ins.c] then pc = pc + ins.b end
        elseif op == OP.JUMPIFLT then if R[a] < R[ins.c] then pc = pc + ins.b end
        elseif op == OP.JUMPIFLE then if R[a] <= R[ins.c] then pc = pc + ins.b end
        elseif op == OP.JUMPIFNOTEQ then if R[a] ~= R[ins.c] then pc = pc + ins.b end
        elseif op == OP.JUMPIFNOTLT then if not (R[a] < R[ins.c]) then pc = pc + ins.b end
        elseif op == OP.JUMPIFNOTLE then if not (R[a] <= R[ins.c]) then pc = pc + ins.b end
        elseif op == OP.FORNPREP then
            local limit, step, idx = R[a], R[a + 1], R[a + 2]
            if (step > 0 and idx <= limit) or (step <= 0 and idx >= limit) then
                R[a + 3] = idx
            else
                pc = pc + ins.b
            end
        elseif op == OP.FORNLOOP then
            local limit, step = R[a], R[a + 1]
            local idx = R[a + 2] + step; R[a + 2] = idx
            if (step > 0 and idx <= limit) or (step <= 0 and idx >= limit) then
                R[a + 3] = idx; pc = pc + ins.b
            end
        elseif op == OP.FORGLOOP then
            local varcount = ins.k
            local gen = R[a]
            if type(gen) == "function" then
                if varcount <= 2 then
                    local v1, v2 = gen(R[a + 1], R[a + 2])
                    if v1 ~= nil then
                        R[a + 2] = v1; R[a + 3] = v1
                        if varcount == 2 then R[a + 4] = v2 end
                        pc = pc + ins.b
                    end
                else
                    local res = pack(gen(R[a + 1], R[a + 2]))
                    if res[1] ~= nil then
                        R[a + 2] = res[1]
                        for j = 1, varcount do R[a + 2 + j] = res[j] end
                        pc = pc + ins.b
                    end
                end
            else
                local key, val = next(gen, R[a + 2])
                if key ~= nil then
                    R[a + 2] = key; R[a + 3] = key
                    if varcount >= 2 then R[a + 4] = val end
                    pc = pc + ins.b
                end
            end

        elseif op == OP.NEWTABLE then R[a] = {}
        elseif op == OP.SETLIST then
            local t = R[a]; local base = ins.b; local start = ins.k
            local count = ins.c
            if count == 0 then count = top - base end 
            for i = 0, count - 1 do t[start + i] = R[base + i] end

        
        elseif op == OP.NEWCLOSURE then
            local cp = protos[ins.k]
            local ups = {}
            local caps = ins.captures
            for u = 1, #caps do
                local cap = caps[u]
                if cap.type == 1 then
                    ups[u] = getOpen(openuv, R, cap.idx)
                else
                    ups[u] = upvals[cap.idx]
                end
            end
            R[a] = makeClosure(cp, env, ups)
        elseif op == OP.GETUPVAL then
            local uv = upvals[ins.b]
            if uv.open then R[a] = uv.stack[uv.idx] else R[a] = uv.val end
        elseif op == OP.SETUPVAL then
            local uv = upvals[ins.b]
            if uv.open then uv.stack[uv.idx] = R[a] else uv.val = R[a] end
        elseif op == OP.CLOSEUPVALS then
            closeFrom(openuv, R, a)
        elseif op == OP.GETVARARGS then
            if ins.b == 0 then
                for i = 1, nva do R[a + i - 1] = varargs[i] end
                top = a + nva
            else
                for i = 1, ins.b - 1 do R[a + i - 1] = varargs[i] end
            end

        elseif op == OP.NAMECALL then
            local s = R[ins.b]
            R[a + 1] = s
            R[a] = s[K[ins.k]]

        elseif op == OP.CALL then
            local f = R[a]
            local nargs = ins.b == 0 and (top - a - 1) or (ins.b - 1)
            local res
            if nargs == 0 then res = pack(f())
            elseif nargs == 1 then res = pack(f(R[a + 1]))
            elseif nargs == 2 then res = pack(f(R[a + 1], R[a + 2]))
            elseif nargs == 3 then res = pack(f(R[a + 1], R[a + 2], R[a + 3]))
            else
                local av = {}
                for i = 1, nargs do av[i] = R[a + i] end
                res = pack(f(unpack(av, 1, nargs)))
            end
            if ins.c == 0 then
                for i = 1, res.n do R[a + i - 1] = res[i] end
                top = a + res.n
            else
                for i = 1, ins.c - 1 do R[a + i - 1] = res[i] end
            end

        elseif op == OP.RETURN then
            local b = ins.b
            if b == 1 then return
            elseif b == 2 then return R[a]
            elseif b == 0 then
                local out, m = {}, 0
                for r = a, top - 1 do m = m + 1; out[m] = R[r] end
                return unpack(out, 1, m)
            else
                local out = {}
                for i = 1, b - 1 do out[i] = R[a + i - 1] end
                return unpack(out, 1, b - 1)
            end
        else
            error("customvm: unimplemented opcode " .. tostring(op)
                .. " (" .. tostring(ISA.NAME[op]) .. ") at pc " .. (pc - 1))
        end
    end
end

VM.run = run
    
function VM.exec(proto, env, ...)
    env = env or (getfenv and getfenv()) or _G
    return run(proto, env, nil, pack(...))
end

return VM
