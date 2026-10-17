





























local function makeVM(protos, mainid, xk)
    local fl    = math.floor
    local unp   = table.unpack or unpack
    local pk    = table.pack or function(...)
        local t = {...}; t.n = select('#', ...); return t
    end
    local sb    = string.byte
    local tcat  = table.concat
    local tstr  = tostring

    
    
    
    
    local NX = {}
    for na = 0, 15 do
        for nb = 0, 15 do
            local r, aa, bb, m = 0, na, nb, 1
            for _ = 1, 4 do
                local abit, bbit = aa % 2, bb % 2
                if abit ~= bbit then r = r + m end
                aa = (aa - abit) / 2
                bb = (bb - bbit) / 2
                m = m * 2
            end
            NX[na * 16 + nb] = r
        end
    end

    local function xor32(a, b)
        if a == b then return 0 end
        local r, m = 0, 1
        for _ = 1, 8 do
            local an, bn = a % 16, b % 16
            r = r + NX[an * 16 + bn] * m
            a = (a - an) / 16
            b = (b - bn) / 16
            m = m * 16
        end
        return r
    end

    
    local B85 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^"
    local b85d = {}
    for i = 1, #B85 do b85d[sb(B85, i)] = i - 1 end

    local function decB85(s)
        local w, nw = {}, 0
        local i, n = 1, #s
        while i + 3 <= n do
            local c1,c2,c3,c4,c5 = sb(s, i, i+4)
            local v = (((b85d[c1]*85+b85d[c2])*85+b85d[c3])*85+b85d[c4])*85
                      + (c5 and b85d[c5] or 0)
            nw = nw+1; w[nw] = v; i = i+5
        end
        return w
    end

    
    local run

    local function mkclo(p, uv, env)
        return function(...) return run(p, uv, env, ...) end
    end

    function run(proto, upvals, env, ...)
        
        if not proto[8] then
            local c = proto[5]
            if type(c) == "string" then c = decB85(c) end
            if xk ~= 0 then
                for i = 1, #c do c[i] = xor32(c[i], xk) end
            end
            proto[5] = c; proto[8] = true
        end

        local code   = proto[5]
        local K      = proto[6]   
        local cps    = proto[7]   
        local nparam = proto[2]
        local isva   = proto[4]   

        local R = {}
        local args = pk(...); local na = args.n
        for i = 1, math.min(nparam, na) do R[i-1] = args[i] end

        
        local VA, nva = nil, 0
        if isva ~= 0 and na > nparam then
            VA = {}
            for i = nparam+1, na do nva = nva+1; VA[nva] = args[i] end
        end

        
        local ouv = {}
        local function gopen(r)
            for i = 1, #ouv do
                if ouv[i].r == r and ouv[i].open then return ouv[i] end
            end
            local o = {r=r, val=R[r], open=true}
            ouv[#ouv+1] = o; return o
        end
        local function closeFrom(from)
            for i = 1, #ouv do
                local o = ouv[i]
                if o.open and o.r >= from then
                    o.val = R[o.r]; o.open = false; o.r = nil
                end
            end
        end
        local function syncOUV()
            for i = 1, #ouv do
                local o = ouv[i]; if o.open then o.val = R[o.r] end
            end
        end

        local pc = 1
        local top = 0

        local function RK(x)
            if x >= 256 then return K[x-255] else return R[x] end
        end

        while true do
            local ins = code[pc]; pc = pc+1
            local op  = ins % 64
            local a   = fl(ins / 64) % 256
            local c2  = fl(ins / 16384) % 512    
            local b   = fl(ins / 8388608) % 512  
            local bx  = fl(ins / 16384) % 262144 
            local sbx = bx - 131071               

            
            for i = 1, #ouv do
                local o = ouv[i]; if o.open then o.val = R[o.r] end
            end

            if op == 0 then         
                R[a] = R[b]

            elseif op == 1 then     
                R[a] = K[bx+1]

            elseif op == 2 then     
                R[a] = (b ~= 0); if c2 ~= 0 then pc = pc+1 end

            elseif op == 3 then     
                for i = a, b do R[i] = nil end

            elseif op == 4 then     
                local uv = upvals[b+1]; R[a] = uv and uv.val

            elseif op == 5 then     
                R[a] = env[K[bx+1]]

            elseif op == 6 then     
                R[a] = R[b][RK(c2)]

            elseif op == 7 then     
                env[K[bx+1]] = R[a]

            elseif op == 8 then     
                local uv = upvals[b+1]; if uv then uv.val = R[a] end

            elseif op == 9 then     
                R[a][RK(b)] = RK(c2)

            elseif op == 10 then    
                R[a] = {}

            elseif op == 11 then    
                local t = R[b]; R[a+1] = t; R[a] = t[RK(c2)]

            elseif op == 12 then    
                local rb, rc = RK(b), RK(c2)
                if type(rb)=="number" and type(rc)=="number" then
                    R[a] = rb + rc
                else
                    local mt = getmetatable(rb)
                    local fn = mt and mt.__add
                    if not fn then mt = getmetatable(rc); fn = mt and mt.__add end
                    R[a] = fn(rb, rc)
                end

            elseif op == 13 then    
                local rb, rc = RK(b), RK(c2)
                if type(rb)=="number" and type(rc)=="number" then
                    R[a] = rb - rc
                else
                    local mt = getmetatable(rb)
                    local fn = mt and mt.__sub
                    if not fn then mt = getmetatable(rc); fn = mt and mt.__sub end
                    R[a] = fn(rb, rc)
                end

            elseif op == 14 then    
                local rb, rc = RK(b), RK(c2)
                if type(rb)=="number" and type(rc)=="number" then
                    R[a] = rb * rc
                else
                    local mt = getmetatable(rb)
                    local fn = mt and mt.__mul
                    if not fn then mt = getmetatable(rc); fn = mt and mt.__mul end
                    R[a] = fn(rb, rc)
                end

            elseif op == 15 then    
                local rb, rc = RK(b), RK(c2)
                if type(rb)=="number" and type(rc)=="number" then
                    R[a] = rb / rc
                else
                    local mt = getmetatable(rb)
                    local fn = mt and mt.__div
                    if not fn then mt = getmetatable(rc); fn = mt and mt.__div end
                    R[a] = fn(rb, rc)
                end

            elseif op == 16 then    
                local rb, rc = RK(b), RK(c2)
                if type(rb)=="number" and type(rc)=="number" then
                    R[a] = rb % rc
                else
                    local mt = getmetatable(rb)
                    local fn = mt and mt.__mod
                    if not fn then mt = getmetatable(rc); fn = mt and mt.__mod end
                    R[a] = fn(rb, rc)
                end

            elseif op == 17 then    
                local rb, rc = RK(b), RK(c2)
                if type(rb)=="number" and type(rc)=="number" then
                    R[a] = rb ^ rc
                else
                    local mt = getmetatable(rb)
                    local fn = mt and mt.__pow
                    if not fn then mt = getmetatable(rc); fn = mt and mt.__pow end
                    R[a] = fn(rb, rc)
                end

            elseif op == 18 then    
                local rb = R[b]
                if type(rb) == "number" then
                    R[a] = -rb
                else
                    local mt = getmetatable(rb)
                    R[a] = mt.__unm(rb)
                end

            elseif op == 19 then    
                R[a] = not R[b]

            elseif op == 20 then    
                local rb = R[b]
                local mt = getmetatable(rb)
                if mt and mt.__len then
                    R[a] = mt.__len(rb)
                else
                    R[a] = #rb
                end

            elseif op == 21 then    
                local parts = {}
                for i = b, c2 do parts[#parts+1] = tstr(R[i]) end
                R[a] = tcat(parts)

            elseif op == 22 then    
                pc = pc + sbx

            elseif op == 23 then    
                local eq = (RK(b) == RK(c2)) and 1 or 0
                if eq == a then
                    local ji = code[pc]; pc = pc+1
                    pc = pc + (fl(ji/16384)%262144 - 131071)
                else
                    pc = pc+1
                end

            elseif op == 24 then    
                local lt = (RK(b) < RK(c2)) and 1 or 0
                if lt == a then
                    local ji = code[pc]; pc = pc+1
                    pc = pc + (fl(ji/16384)%262144 - 131071)
                else
                    pc = pc+1
                end

            elseif op == 25 then    
                local le = (RK(b) <= RK(c2)) and 1 or 0
                if le == a then
                    local ji = code[pc]; pc = pc+1
                    pc = pc + (fl(ji/16384)%262144 - 131071)
                else
                    pc = pc+1
                end

            elseif op == 26 then    
                local falsy = (R[a] == nil or R[a] == false) and 1 or 0
                if falsy == c2 then
                    local ji = code[pc]; pc = pc+1
                    pc = pc + (fl(ji/16384)%262144 - 131071)
                else
                    pc = pc+1
                end

            elseif op == 27 then    
                local rb   = R[b]
                local falsy = (rb == nil or rb == false) and 1 or 0
                if falsy ~= c2 then
                    R[a] = rb; pc = pc+1
                else
                    local ji = code[pc]; pc = pc+1
                    pc = pc + (fl(ji/16384)%262144 - 131071)
                end

            elseif op == 28 then    
                syncOUV()
                local f      = R[a]
                local nargs2 = b == 0 and (top - a) or (b - 1)
                local aret   = c2  
                local ta = {}
                for i = 1, nargs2 do ta[i] = R[a+i] end
                local res = pk(f(unp(ta, 1, nargs2)))
                if aret == 0 then
                    for i = 1, res.n do R[a+i-1] = res[i] end
                    top = a + res.n - 1
                elseif aret == 1 then
                    
                else
                    for i = 1, aret-1 do R[a+i-1] = res[i] end
                end

            elseif op == 29 then    
                syncOUV(); closeFrom(0)
                local f      = R[a]
                local nargs2 = b == 0 and (top - a) or (b - 1)
                local ta = {}
                for i = 1, nargs2 do ta[i] = R[a+i] end
                return f(unp(ta, 1, nargs2))

            elseif op == 30 then    
                syncOUV(); closeFrom(0)
                if b == 1 then
                    return
                elseif b == 2 then
                    return R[a]
                elseif b == 0 then
                    local nret = top - a + 1
                    if nret <= 0 then return end
                    local out = {}
                    for i = 0, nret-1 do out[i+1] = R[a+i] end
                    return unp(out, 1, nret)
                else
                    local nret = b - 1
                    local out = {}
                    for i = 0, nret-1 do out[i+1] = R[a+i] end
                    return unp(out, 1, nret)
                end

            elseif op == 31 then    
                local idx  = R[a] + R[a+2]; R[a] = idx
                local lim  = R[a+1]
                local step = R[a+2]
                if (step > 0 and idx <= lim) or (step < 0 and idx >= lim) then
                    R[a+3] = idx; pc = pc + sbx
                end

            elseif op == 32 then    
                R[a] = R[a] - R[a+2]; pc = pc + sbx

            elseif op == 33 then    
                syncOUV()
                local gen  = R[a]; local st = R[a+1]; local ctrl = R[a+2]
                local res  = pk(gen(st, ctrl))
                local fst  = res[1]
                if fst == nil then
                    pc = pc+1   
                else
                    for i = 1, c2 do R[a+2+i] = res[i] end
                    R[a+2] = fst  
                    
                    local ji = code[pc]; pc = pc+1
                    pc = pc + (fl(ji/16384)%262144 - 131071)
                end

            elseif op == 34 then    
                local batch = c2
                if batch == 0 then
                    
                    batch = code[pc]; pc = pc+1
                end
                local nf = b
                if b == 0 then nf = top - a end
                local t2 = R[a]
                local off = (batch - 1) * 50
                for i = 1, nf do t2[off+i] = R[a+i] end

            elseif op == 35 then    
                closeFrom(a)

            elseif op == 36 then    
                syncOUV()
                local cp  = cps[bx+1]
                local uvs = {}
                for j = 1, cp[3] do   
                    local ci  = code[pc]; pc = pc+1
                    local cop = ci % 64           
                    local cb  = fl(ci/8388608) % 512   
                    if cop == 0 then  
                        uvs[j] = gopen(cb)
                    else              
                        uvs[j] = upvals[cb+1]
                    end
                end
                R[a] = mkclo(cp, uvs, env)

            elseif op == 37 then    
                local nwant = b - 1
                if b == 0 then
                    for i = 1, nva do R[a+i-1] = VA and VA[i] end
                    top = a + nva - 1
                else
                    for i = 1, nwant do R[a+i-1] = VA and VA[i] end
                end
            end
        end 
    end 

    local mainEnv = (getfenv and getfenv()) or _G
    return run(protos[mainid], {}, mainEnv)
end
