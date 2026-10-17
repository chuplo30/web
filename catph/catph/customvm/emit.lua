




local Serializer = require("catph.customvm.serializer")
local ISA        = require("catph.customvm.isa")
local Flatten    = require("catph.customvm.flatten")

local Emit = {}
local floor = math.floor



local _IB_START = {"l","I","O","Il","lI","Ol","lO","OI","III","lll","OOO","lIl","IlI","OlO","lOl","IOI"}
local _IB_BODY  = {"l","I","1","O","0","l","l","I","I","l","I","1","l","I","l","0","O","l","1","I"}

local function randomName(used)
    local name
    repeat
        local prefix = _IB_START[math.random(1, #_IB_START)]
        local len = math.random(7, 14)
        local t = {prefix}
        for i = 1, len do
            t[#t+1] = _IB_BODY[math.random(1, #_IB_BODY)]
        end
        name = table.concat(t)
    until not used[name]
    used[name] = true
    return name
end


local function randomSaltStr(len)
    local t = {}
    for i = 1, len do
        local c; repeat c = math.random(48, 122) until c~=92 and c~=34 and c~=39 and c~=37
        t[i] = string.char(c)
    end
    return table.concat(t)
end

local function shuffle(arr)
    for i = #arr, 2, -1 do
        local j = math.random(1, i)
        arr[i], arr[j] = arr[j], arr[i]
    end
    return arr
end

local B85_ALPHA = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^"


local function encodeB85(s)
    local len = #s
    local data = string.char(
        floor(len/16777216)%256, floor(len/65536)%256,
        floor(len/256)%256,     len%256
    ) .. s
    local pad = (4 - #data % 4) % 4
    if pad > 0 then data = data .. string.rep("\0", pad) end
    local out = {}
    for i = 1, #data, 4 do
        local b1,b2,b3,b4 = string.byte(data, i, i+3)
        b1=b1 or 0; b2=b2 or 0; b3=b3 or 0; b4=b4 or 0
        local v = ((b1*256+b2)*256+b3)*256+b4
        local c5=v%85; v=floor(v/85)
        local c4=v%85; v=floor(v/85)
        local c3=v%85; v=floor(v/85)
        local c2=v%85; v=floor(v/85); local c1=v
        out[#out+1] = B85_ALPHA:sub(c1+1,c1+1)..B85_ALPHA:sub(c2+1,c2+1)
                   .. B85_ALPHA:sub(c3+1,c3+1)..B85_ALPHA:sub(c4+1,c4+1)
                   .. B85_ALPHA:sub(c5+1,c5+1)
    end
    return table.concat(out)
end



local function lzCompress(data)
    local WINDOW  = 4096
    local MIN_LEN = 3
    local MAX_LEN = 18
    local n  = #data
    local sb = string.byte
    local fl = math.floor

    local bytes = {}
    for i = 1, n, 4096 do
        local chunk = {sb(data, i, math.min(i+4095, n))}
        for _, b in ipairs(chunk) do bytes[#bytes+1] = b end
    end

    local chains = {}
    for i = 1, n-2 do
        local k = bytes[i]*65536 + bytes[i+1]*256 + bytes[i+2]
        local c = chains[k]; if not c then c = {}; chains[k] = c end
        c[#c+1] = i
    end

    local items = {}
    local i = 1
    while i <= n do
        local bestLen, bestOff = 0, 0
        if i <= n-2 then
            local k = bytes[i]*65536 + bytes[i+1]*256 + bytes[i+2]
            local c = chains[k]
            if c then
                local wStart = i - WINDOW
                for ci = #c, math.max(1, #c-20), -1 do
                    local j = c[ci]
                    if j >= wStart and j < i then
                        local maxL = math.min(MAX_LEN, n-i+1)
                        local len = 0
                        while len < maxL and bytes[j+len] == bytes[i+len] do len=len+1 end
                        if len > bestLen then bestLen=len; bestOff=i-j end
                        if bestLen == MAX_LEN then break end
                    end
                end
            end
        end
        if bestLen >= MIN_LEN then
            items[#items+1] = {true, bestLen, bestOff}
            i = i + bestLen
        else
            items[#items+1] = {false, bytes[i]}
            i = i + 1
        end
    end

    local packed = {}
    local ii = 1
    while ii <= #items do
        local flagIdx = #packed+1
        packed[flagIdx] = 0
        local flag, bit = 0, 1
        for _ = 0, 7 do
            local item = items[ii]; if not item then break end; ii=ii+1
            if item[1] then
                flag = flag + bit
                local eLen = item[2] - MIN_LEN
                local eOff = item[3] - 1
                packed[#packed+1] = eLen*16 + fl(eOff/256)
                packed[#packed+1] = eOff%256
            else
                packed[#packed+1] = item[2]
            end
            bit = bit * 2
        end
        packed[flagIdx] = flag
    end

    local chunks = {}
    for j = 1, #packed, 4096 do
        local sub = {}
        for k = j, math.min(j+4095, #packed) do sub[#sub+1] = packed[k] end
        chunks[#chunks+1] = string.char((table.unpack or unpack)(sub))
    end
    return table.concat(chunks)
end


local function randomizeLayout()
    local pool = {1,2,3,4,5,6,7,8,9,10}
    shuffle(pool)
    local insSlots = {
        op = pool[1],
        a  = pool[2],
        b  = pool[3],
        c  = pool[4],
        k  = pool[5],
        dk = pool[6],   
        
    }
    
    local capPool = {1,2,3,4}
    shuffle(capPool)
    local capSlots = { type = capPool[1], idx = capPool[2] }

    
    local protoPool = {1,2,3,4,5,6,7,8,9}
    shuffle(protoPool)
    local protoSlots = {
        numparams = protoPool[1],
        isvararg  = protoPool[2],
        maxstack  = protoPool[3],
        k         = protoPool[4],
        code      = protoPool[5],
        protos    = protoPool[6],
    }

    return insSlots, capSlots, protoSlots
end



local function generateHardenedNonce(nonce, used)
    local M = 2147483647
    local code = {}

    local part1 = math.random(1, floor(M/3))
    local part2 = math.random(1, floor(M/3))
    local part3 = (nonce - part1 - part2) % M

    
    local p1Ret = randomName(used)
    local p1a = math.random(2, 9999)
    local p1b = math.random(2, 9999)
    local p1c = (part1 - p1a * p1b) % M
    local p1d = math.random(1, 999999)
    local n1=randomName(used); local n2=randomName(used); local n3=randomName(used); local n4=randomName(used)
    code[#code+1] = string.format(
        'local %s=(function() local %s=%d;local %s=%d;local %s=%d;local %s=%d;'..
        'if type("")=="string" then return (%s*%s+%s)%%2147483647 else return %s end end)()',
        p1Ret, n1,p1a, n2,p1b, n3,p1c, n4,p1d, n1,n2,n3, n4)

    
    local saltLen = math.random(8,16)
    local salt = randomSaltStr(saltLen)
    local saltName = randomName(used)
    code[#code+1] = string.format('local %s="%s"', saltName, salt)
    local nPos = math.random(3, math.min(4, saltLen))
    local byteSum = 0
    local bparts = {}
    for _ = 1, nPos do
        local pos = math.random(1, saltLen)
        byteSum = byteSum + string.byte(salt, pos)
        bparts[#bparts+1] = string.format("%s:byte(%d)", saltName, pos)
    end
    local p2mult = math.random(100, 99999)
    local p2off = (part2 - byteSum * p2mult) % M
    local mn = randomName(used); local on = randomName(used); local rn = randomName(used)
    code[#code+1] = string.format("local %s=%d;local %s=%d", mn, p2mult, on, p2off)
    code[#code+1] = string.format("local %s=((%s)*%s+%s)%%2147483647", rn, table.concat(bparts,"+"), mn, on)

    
    local tName = randomName(used)
    local tSize = math.random(5,9)
    local rIdx = math.random(1, tSize)
    local entries = {}
    for i=1,tSize do entries[i] = i==rIdx and tostring(part3) or tostring(math.random(1,2147483646)) end
    code[#code+1] = string.format("local %s={%s}", tName, table.concat(entries,","))
    local iName = randomName(used)
    local ib = math.random(1,99)
    code[#code+1] = string.format('local %s=(type(nil)=="nil") and (%d+%d) or %d', iName, ib, rIdx-ib, math.random(1,tSize))

    
    for _=1, math.random(3,6) do
        local dn = randomName(used)
        local dt = math.random(1,3)
        if dt==1 then code[#code+1]=string.format("local %s=%d",dn,math.random(1,2147483646))
        elseif dt==2 then code[#code+1]=string.format("local %s=(function() return %d end)()",dn,math.random(1,999999))
        else code[#code+1]=string.format("local %s=%s[%d]",dn,tName,math.random(1,tSize)) end
    end

    local finalExpr = string.format("(%s+%s+%s[%s])%%2147483647", p1Ret, rn, tName, iName)
    return table.concat(code, "\n"), finalExpr
end



local function buildRuntime(nonce, usedOps, aliasesOf, junkLevel, opFreqs, integrityHash, rtOpts)
    usedOps = usedOps or {}
    
    local function fmtN(n)
        if type(n) ~= "number" then return tostring(n) end
        if n == 0 then
            local z = math.random(1,4)
            if z==1 then return "0x0" elseif z==2 then return "0X0"
            else return "0" end
        end
        if n < 0 then return "-"..fmtN(-n) end
        
        
        local fmt = math.random(1, 10)
        if fmt <= 5 then
            local hex = string.format(math.random()<0.5 and "%X" or "%x", n)
            return (math.random()<0.5 and "0X" or "0x")..hex
        else
            return tostring(n)
        end
    end
    local ncSet
    do
        local parts = {}
        if aliasesOf then
            for _, b in ipairs(aliasesOf[19] or {}) do parts[#parts+1] = "["..fmtN(b).."]=true" end
        else
            parts[1] = "["..fmtN(19).."]=true"
            parts[2] = "["..fmtN(118).."]=true"
        end
        ncSet = "{" .. table.concat(parts, ",") .. "}"
    end
    local fieldOrderTable
    do
        local parts = {}
        for op = 0, 200 do
            
            local inv = {1,2,3,4}
            parts[#parts+1] = "["..fmtN(op).."]={" .. fmtN(inv[1]) .. "," .. fmtN(inv[2]) .. "," .. fmtN(inv[3]) .. "," .. fmtN(inv[4]) .. "}"
        end
        fieldOrderTable = "{" .. table.concat(parts, ",") .. "}"
    end
    local used = {}
    local nonceCode, nonceExpr = generateHardenedNonce(nonce, used)
    local blindKey = Serializer.deriveBlindKey(nonce)
    
    local dispMod = 1024  
    local dispMul = math.random(3, 499) * 2 + 1  
    local dispAdd = math.random(1, dispMod - 1)
    
    local rkSeed, rkStep = Serializer.deriveRekeyParams(nonce)
    
    local rkSeed2 = math.random(1, 255)
    local rkStep2 = math.random(0, 127) * 2 + 1  
    
    local streamBase, streamStep = Serializer.deriveStreamKeys(nonce)
    local insSlots, capSlots, protoSlots = randomizeLayout()

    local function randomOpSlots()
        local pool = {11,12,13,14,15,16}
        shuffle(pool)
        return { b = pool[1], c = pool[2], k = pool[3] }
    end
    local opSlotMap = {}
    for op = 0, 200 do opSlotMap[op] = randomOpSlots() end

    local function deriveCK(n)
        
        local h = Serializer.kdf(n, "strings")
        local k1 = h % 256
        h = (h * 65521 + 1) % 2147483647
        local k2 = (h % 255) + 1
        return k1, k2
    end
    local ck1, ck2 = deriveCK(nonce)
    local maskA = math.random(0, 255)
    local maskB = math.random(0, 254)
    local wck1 = (ck1 + maskA) % 256
    local wck2 = ((ck2 - 1) + maskB) % 255
    local wrapRecovery = "    sk1=("..fmtN(wck1).."-"..fmtN(maskA)..")%256;sk2=(("..fmtN(wck2).."-"..fmtN(maskB)..")%255)+1"


    local vR = randomName(used)       
    local vPC = randomName(used)      
    local vTop = randomName(used)     
    local vOUV = randomName(used)     
    local vCode = randomName(used)    
    local vK = randomName(used)       
    local vProtos = randomName(used)  
    local vIns = randomName(used)     
    local vOp = randomName(used)      
    local vA = randomName(used)       
    local vRun = randomName(used)     
    local vMkCl = randomName(used)    
    local vGetO = randomName(used)    
    local vClsF = randomName(used)    
    local vPk = randomName(used)      
    local vUnpk = randomName(used)    
    local vFl = randomName(used)      
    local vEnv = randomName(used)     
    local vRawGet = randomName(used)  
    local vRawSet = randomName(used)  
    local vNextF  = randomName(used)  
    local vTypeF  = randomName(used)  


    local vHash = randomName(used)
    local vMask = randomName(used)    
    local vDK = randomName(used)      
    local hashSeed = math.random(1, 999999)
    local hashMult = math.random(3, 97)
    
    local vDkRoll = randomName(used)   
    local vDkInst = randomName(used)   


    local sOp = insSlots.op
    local sA = insSlots.a
    local sB = insSlots.b
    local sC = insSlots.c
    local sK = insSlots.k
    local sDK = insSlots.dk  
    local sCT = capSlots.type
    local sCI = capSlots.idx
    local pNP = protoSlots.numparams
    local pVA = protoSlots.isvararg
    local pMS = protoSlots.maxstack
    local pK = protoSlots.k
    local pCD = protoSlots.code
    local pPR = protoSlots.protos

    local rProtoCode = (
"local FO="..fieldOrderTable.."\n"..
"local _rkx = bit32.bxor\n"..
"local function rProto()\n"..
"    local p = {}\n"..
"    p["..fmtN(pNP).."] = rVU()\n"..
"    p["..fmtN(pVA).."] = r8() == 1\n"..
"    p["..fmtN(pMS).."] = rVU()\n"..
"    local nk = rVU(); local K = {}\n"..
"    for i = 1, nk do K[i] = rConst() end\n"..
"    p["..fmtN(pK).."] = K\n"..
"    local nc = rVU(); local cd = {}\n"..
"    local _rkm = "..fmtN(rkSeed).."\n"..
"    local "..vDkRoll.." = "..fmtN(rkSeed2).."\n"..
"    for i = 1, nc do\n"..
"        local raw = _rkx(r8(), _rkm)\n"..
"        _rkm = _rkx(_rkm, "..fmtN(rkStep)..")\n"..
"        local "..vDkInst.." = "..vDkRoll.."\n"..
"        "..vDkRoll.." = _rkx("..vDkRoll..", "..fmtN(rkStep2)..")\n"..
"        local v1,v2,v3,v4 = rVI(),rVI(),rVI(),rVI()\n"..
"        local fo = FO[raw]\n"..
"        local ins = {}\n"..
"        ins["..fmtN(sDK).."]="..vDkInst.."\n"..
"        ins["..fmtN(sOp).."]=_rkx(raw,"..vDkInst..")\n"..
"        if fo then ins["..fmtN(sA).."]=({v1,v2,v3,v4})[fo[1]];ins["..fmtN(sB).."]=({v1,v2,v3,v4})[fo[2]];ins["..fmtN(sC).."]=({v1,v2,v3,v4})[fo[3]];ins["..fmtN(sK).."]=({v1,v2,v3,v4})[fo[4]]\n"..
"        else ins["..fmtN(sA).."]=v1;ins["..fmtN(sB).."]=v2;ins["..fmtN(sC).."]=v3;ins["..fmtN(sK).."]=v4 end\n"..
"        if NC[raw] then\n"..
"            local ncap = rVU(); local caps = {}\n"..
"            for j = 1, ncap do local c={}; c["..fmtN(sCT).."]=r8(); c["..fmtN(sCI).."]=rVI(); caps[j]=c end\n"..
"            ins.cap = caps\n"..
"        end\n"..
"        ins[11]=_rkx("..vDkRoll..","..fmtN(rkStep)..")\n"..
"        ins[12]=_rkx(_rkm,"..fmtN(rkSeed2)..")\n"..
"        cd[i] = ins\n"..
"    end\n"..
"    p["..fmtN(pCD).."] = cd\n"..
"    local np = rVU(); local pr = {}\n"..
"    for i = 1, np do pr[i] = rProto() end\n"..
"    p["..fmtN(pPR).."] = pr\n"..
"    return p\n"..
"end")


    local vmCode = (
"local "..vRun.."\n"..
"local function "..vMkCl.."(p, env, ups) return function(...) return "..vRun.."(p, env, ups, "..vPk.."(...)) end end\n"..
"\n"..
"function "..vRun.."(proto, "..vEnv..", upvals, args)\n"..
"    local "..vCode.." = proto["..fmtN(pCD).."]\n"..
"    local "..vK.." = proto["..fmtN(pK).."]\n"..
"    local "..vProtos.." = proto["..fmtN(pPR).."]\n"..
"    local "..vR..", "..vPC..", "..vTop..", "..vOUV.." = {}, 1, 0, {}\n"..
"    local np = proto["..fmtN(pNP).."] or 0\n"..
"    local n = args and (args.n or #args) or 0\n"..
"    for i = 1, np do "..vR.."[i-1] = args[i] end\n"..
"    local va, nva = nil, 0\n"..
"    if proto["..fmtN(pVA).."] and n > np then\n"..
"        va = {}; for i = np+1, n do nva = nva+1; va[nva] = args[i] end\n"..
"    end\n"..
"    local "..vHash.." = "..fmtN(hashSeed).."\n"..
"    local "..vRawGet..","..vRawSet..","..vNextF..","..vTypeF.." = rawget,rawset,next,type\n"..


"    local _rkx,_rkb,_rks=bit32.bxor,bit32.band,bit32.rshift\n"..
"    local "..vDK.."="..fmtN(hashSeed*3+7).."; local "..vMask.."="..fmtN(hashSeed*7+1).."\n"..
"\n")

   
    local emitAll = (next(usedOps) == nil)
    local handlers = {}
    -- Catph: fused ops reuse base-op handler bodies (looked up below), so make
    -- sure the base handler is emitted whenever a dependent fused op is used.
    -- Map: fused op -> base op numbers whose bodies it needs.
    do
        local fusedBase = {
            [44]={21}, [45]={21}, [46]={21}, [47]={21},
            [112]={21}, [113]={21}, [114]={21},
        }
        if usedOps then
            for fop, bases in pairs(fusedBase) do
                if usedOps[fop] then
                    for _, bop in ipairs(bases) do
                        if usedOps[bop] == nil then usedOps[bop] = 1 end
                    end
                end
            end
        end
    end
    
    
    local function junkPrefix()
        local t = math.random(1, 8)
        if t == 1 then return string.format("local _jp=%s%%3;", vHash)
        elseif t == 2 then return string.format("local _jp=bit32.band(%s,0xFF);", vPC)
        elseif t == 3 then return string.format("do local _jp=%s*0 end;", vOp)
        elseif t == 4 then return string.format("local _jp=(%s==%s) and 0 or 1;", vA, vA)
        elseif t == 5 then return string.format("local _jp=bit32.bxor(%s,%s);", vHash, vPC)
        elseif t == 6 then return string.format("local _jp=math.floor(%s);", vPC)
        elseif t == 7 then return string.format("do local _jp=(%s or 0) end;", vHash)
        else return string.format("local _jp=(%s)-(%s);", vHash, vHash) end
    end
    local function h(opNum, body, generator)
        if emitAll or usedOps[opNum] then
            
            if math.random() < 0.35 and not generator then
                body = junkPrefix() .. body
            end
            handlers[#handlers+1] = {op=opNum, code=body, gen=generator}
        end
    end

   
    local vB = randomName(used)    
    local vC = randomName(used)    
    local vKI = randomName(used)   
    local B = vB
    local C = vC
    local K_IDX = vKI
    
    local KC = string.format("kg(%s,%s)", vK, K_IDX)

    local vT1 = randomName(used)   
    local vT2m = randomName(used)
    local vT3 = randomName(used)

    
    do
        local function gen()
            local lkv = math.random(1, 3)
            if lkv == 1 then return string.format("%s[%s]=%s", vR, vA, KC)
            elseif lkv == 2 then return string.format("local %s=%s;%s[%s]=%s", vT1, KC, vR, vA, vT1)
            else return string.format("do %s[%s]=%s end", vR, vA, KC) end
        end
        h(5, gen(), gen)
    end
    
    do
        local function gen()
            local mv = math.random(1, 3)
            if mv == 1 then return string.format("%s[%s]=%s[%s]", vR, vA, vR, B)
            elseif mv == 2 then return string.format("local %s=%s[%s];%s[%s]=%s", vT1, vR, B, vR, vA, vT1)
            else return string.format("do %s[%s]=%s[%s] end", vR, vA, vR, B) end
        end
        h(6, gen(), gen)
    end
    
    h(2, string.format("%s[%s]=nil", vR, vA))
    
    h(3, string.format("%s[%s]=%s~=0", vR, vA, B))
    
    h(4, string.format("%s[%s]=%s-%d", vR, vA, B, blindKey))
    
    h(7, string.format("do local _v=%s(%s,%s);if _v==nil then _v=%s[%s] end;%s[%s]=_v end",
        vRawGet, vEnv, KC, vEnv, KC, vR, vA))
    
    h(8, string.format("%s(%s,%s,%s[%s])", vRawSet, vEnv, KC, vR, vA))
    
    h(13, string.format("%s[%s]=%s[%s][%s[%s]]", vR, vA, vR, B, vR, C))
    
    h(14, string.format("%s[%s][%s[%s]]=%s[%s]", vR, B, vR, C, vR, vA))
    
    do
        local function gen()
            local gv = math.random(1, 3)
            if gv == 1 then return string.format("%s[%s]=%s[%s][%s]", vR, vA, vR, B, KC)
            elseif gv == 2 then return string.format("local %s=%s[%s];%s[%s]=%s[%s]", vT1, vR, B, vR, vA, vT1, KC)
            else return string.format("local %s=%s[%s][%s];%s[%s]=%s", vT1, vR, B, KC, vR, vA, vT1) end
        end
        h(15, gen(), gen)
    end
    
    h(16, string.format("%s[%s][%s]=%s[%s]", vR, B, KC, vR, vA))
    
    h(17, string.format("%s[%s]=%s[%s][%s]", vR, vA, vR, B, C))
    
    h(18, string.format("%s[%s][%s]=%s[%s]", vR, B, C, vR, vA))
    
    
    
    

    
    local function polyBinOp(opNum, op)
        local function gen()
            local variant = math.random(1, 5)
            if variant == 1 then
                return string.format(
                    "local %s=%s[%s];local %s=%s[%s];%s[%s]=%s"..op.."%s",
                    vT1, vR, B, vT2m, vR, C, vR, vA, vT1, vT2m)
            elseif variant == 2 then
                return string.format(
                    "local %s=%s[%s];%s[%s]=%s"..op.."%s[%s]",
                    vT1, vR, B, vR, vA, vT1, vR, C)
            elseif variant == 3 then
                return string.format(
                    "local %s=%s[%s];%s[%s]=%s[%s]"..op.."%s",
                    vT2m, vR, C, vR, vA, vR, B, vT2m)
            elseif variant == 4 then
                return string.format(
                    "%s[%s]=%s[%s]"..op.."%s[%s]",
                    vR, vA, vR, B, vR, C)
            else
                return string.format(
                    "local %s=%s[%s];local %s=%s[%s];local %s=%s"..op.."%s;%s[%s]=%s",
                    vT1, vR, B, vT2m, vR, C, vT3, vT1, vT2m, vR, vA, vT3)
            end
        end
        h(opNum, gen(), gen)
    end

    
    local function polyBinOpCommutative(opNum, op)
        local function gen()
            if math.random() < 0.3 then
                local variant = math.random(1, 3)
                if variant == 1 then
                    return string.format(
                        "local %s=%s[%s];local %s=%s[%s];%s[%s]=%s"..op.."%s",
                        vT1, vR, C, vT2m, vR, B, vR, vA, vT1, vT2m)
                elseif variant == 2 then
                    return string.format(
                        "%s[%s]=%s[%s]"..op.."%s[%s]",
                        vR, vA, vR, C, vR, B)
                else
                    return string.format(
                        "local %s=%s[%s];%s[%s]=%s[%s]"..op.."%s",
                        vT1, vR, C, vR, vA, vR, B, vT1)
                end
            else
                local variant = math.random(1, 5)
                if variant == 1 then
                    return string.format(
                        "local %s=%s[%s];local %s=%s[%s];%s[%s]=%s"..op.."%s",
                        vT1, vR, B, vT2m, vR, C, vR, vA, vT1, vT2m)
                elseif variant == 2 then
                    return string.format(
                        "local %s=%s[%s];%s[%s]=%s"..op.."%s[%s]",
                        vT1, vR, B, vR, vA, vT1, vR, C)
                elseif variant == 3 then
                    return string.format(
                        "local %s=%s[%s];%s[%s]=%s[%s]"..op.."%s",
                        vT2m, vR, C, vR, vA, vR, B, vT2m)
                elseif variant == 4 then
                    return string.format(
                        "%s[%s]=%s[%s]"..op.."%s[%s]",
                        vR, vA, vR, B, vR, C)
                else
                    return string.format(
                        "local %s=%s[%s];local %s=%s[%s];local %s=%s"..op.."%s;%s[%s]=%s",
                        vT1, vR, B, vT2m, vR, C, vT3, vT1, vT2m, vR, vA, vT3)
                end
            end
        end
        h(opNum, gen(), gen)
    end

    
    do
        local function gen()
            local variant = math.random(1, 3)
            if variant == 1 then
                return string.format(
                    "if %s<0 then %s[%s]=%s[%s]-%s[-%s-1] else %s[%s]=%s[%s]+%s[%s] end",
                    C, vR, vA, vR, B, vR, C, vR, vA, vR, B, vR, C)
            elseif variant == 2 then
                return string.format(
                    "local %s=%s;if %s<0 then %s[%s]=%s[%s]-%s[-%s-1] else %s[%s]=%s[%s]+%s[%s] end",
                    vT1, C, vT1, vR, vA, vR, B, vR, vT1, vR, vA, vR, B, vR, vT1)
            else
                return string.format(
                    "local %s=%s[%s];if %s<0 then %s[%s]=%s-%s[-%s-1] else %s[%s]=%s+%s[%s] end",
                    vT1, vR, B, C, vR, vA, vT1, vR, C, vR, vA, vT1, vR, C)
            end
        end
        h(33, gen(), gen)
    end
    
    polyBinOp(34, "-")
    
    polyBinOpCommutative(35, "*")
    
    polyBinOp(36, "/")
    
    polyBinOp(37, "%%")
    
    polyBinOp(38, "^")
    
    
    do
        local function gen()
            local lhs = string.format("%s[%s]", vR, B)
            local rhs = string.format("%s[%s]", vR, C)
            return string.format("%s[%s]=math.floor(%s/%s)", vR, vA, lhs, rhs)
        end
        h(81, gen(), gen)
    end

    
    do
        local cv = math.random(1, 3)
        if cv == 1 then
            h(49, string.format("local s=%s[%s];for r=%s+1,%s do s=s..%s[r] end;%s[%s]=s", vR, B, B, C, vR, vR, vA))
        elseif cv == 2 then
            h(49, string.format("local %s=%s[%s];local r=%s+1;while r<=%s do %s=%s..%s[r];r=r+1 end;%s[%s]=%s", vT1, vR, B, B, C, vT1, vT1, vR, vR, vA, vT1))
        else
            h(49, string.format("local %s=%s;local %s=%s[%s];for i=%s+1,%s do %s=%s..%s[i] end;%s[%s]=%s", vT1, B, vT2m, vR, vT1, vT1, C, vT2m, vT2m, vR, vR, vA, vT2m))
        end
    end

    
    do
        local function gen()
            local nv = math.random(1, 3)
            if nv == 1 then return string.format("%s[%s]=not %s[%s]", vR, vA, vR, B)
            elseif nv == 2 then return string.format("local %s=%s[%s];%s[%s]=not %s", vT1, vR, B, vR, vA, vT1)
            else return string.format("if %s[%s] then %s[%s]=false else %s[%s]=true end", vR, B, vR, vA, vR, vA) end
        end
        h(50, gen(), gen)
    end
    
    do
        local function gen()
            local mv = math.random(1, 3)
            if mv == 1 then return string.format("%s[%s]=-%s[%s]", vR, vA, vR, B)
            elseif mv == 2 then return string.format("local %s=%s[%s];%s[%s]=-%s", vT1, vR, B, vR, vA, vT1)
            else return string.format("%s[%s]=0-%s[%s]", vR, vA, vR, B) end
        end
        h(51, gen(), gen)
    end
    
    do
        local function gen()
            local lv = math.random(1, 2)
            if lv == 1 then return string.format("%s[%s]=#%s[%s]", vR, vA, vR, B)
            else return string.format("local %s=%s[%s];%s[%s]=#%s", vT1, vR, B, vR, vA, vT1) end
        end
        h(52, gen(), gen)
    end
    
    h(23, string.format("%s=%s+%s", vPC, vPC, B))
    h(24, string.format("%s=%s+%s", vPC, vPC, B))
    
    h(25, string.format("if %s[%s] then %s=%s+%s end", vR, vA, vPC, vPC, B))
    h(26, string.format("if not %s[%s] then %s=%s+%s end", vR, vA, vPC, vPC, B))
    h(27, string.format("if %s[%s]==%s[%s] then %s=%s+%s end", vR, vA, vR, C, vPC, vPC, B))
    h(29, string.format("if %s[%s]<%s[%s] then %s=%s+%s end", vR, vA, vR, C, vPC, vPC, B))
    h(28, string.format("if %s[%s]<=%s[%s] then %s=%s+%s end", vR, vA, vR, C, vPC, vPC, B))
    h(30, string.format("if %s[%s]~=%s[%s] then %s=%s+%s end", vR, vA, vR, C, vPC, vPC, B))
    h(32, string.format("if not(%s[%s]<%s[%s]) then %s=%s+%s end", vR, vA, vR, C, vPC, vPC, B))
    h(31, string.format("if not(%s[%s]<=%s[%s]) then %s=%s+%s end", vR, vA, vR, C, vPC, vPC, B))
    
    h(53, string.format("%s[%s]={}", vR, vA))
    
    h(56, string.format(
        "local lim,step,idx=%s[%s],%s[%s+1],%s[%s+2];"..
        "if (step>0 and idx<=lim) or (step<=0 and idx>=lim) then %s[%s+3]=idx else %s=%s+%s end",
        vR, vA, vR, vA, vR, vA, vR, vA, vPC, vPC, B))
    
    h(57, string.format(
        "local lim,step=%s[%s],%s[%s+1];"..
        "local idx=%s[%s+2]+step;%s[%s+2]=idx;"..
        "if (step>0 and idx<=lim) or (step<=0 and idx>=lim) then %s[%s+3]=idx;%s=%s+%s end",
        vR, vA, vR, vA, vR, vA, vR, vA, vR, vA, vPC, vPC, B))
    
    h(58, string.format(
        "local vc=%s;local gen=%s[%s];"..
        "if %s(gen)==\"function\" then "..
        "if vc<=2 then local v1,v2=gen(%s[%s+1],%s[%s+2]);"..
        "if v1~=nil then %s[%s+2]=v1;%s[%s+3]=v1;if vc==2 then %s[%s+4]=v2 end;%s=%s+%s end "..
        "else local res=%s(gen(%s[%s+1],%s[%s+2]));"..
        "if res[1]~=nil then %s[%s+2]=res[1];for j=1,vc do %s[%s+2+j]=res[j] end;%s=%s+%s end end "..
        "else "..
        "local key,val=%s(gen,%s[%s+2]);"..
        "if key~=nil then %s[%s+2]=key;%s[%s+3]=key;if vc>=2 then %s[%s+4]=val end;%s=%s+%s end "..
        "end",
        K_IDX, vR, vA,
        vTypeF,
        vR, vA, vR, vA,
        vR, vA, vR, vA, vR, vA, vPC, vPC, B,
        vPk, vR, vA, vR, vA,
        vR, vA, vR, vA, vPC, vPC, B,
        vNextF, vR, vA,
        vR, vA, vR, vA, vR, vA, vPC, vPC, B))
    
    h(55, string.format(
        "local t=%s[%s];local base=%s;local start=%s;"..
        "local cnt=%s;if cnt==0 then cnt=%s-base end;"..
        "for i=0,cnt-1 do t[start+i]=%s[base+i] end",
        vR, vA, B, K_IDX, C, vTop, vR))
    
    h(19, string.format(
        "local cp=%s[%s];local caps=%s.cap;local nc=#caps;local ups;"..
        "if nc==0 then ups={} "..
        "elseif nc==1 then local c=caps[1];if c[%d]==1 then ups={%s(%s,%s,c[%d])} else ups={upvals[c[%d]]} end "..
        "else ups={};for u=1,nc do local c=caps[u];"..
        "if c[%d]==1 then ups[u]=%s(%s,%s,c[%d]) else ups[u]=upvals[c[%d]] end end end;"..
        "%s[%s]=%s(cp,%s,ups);_WR[%s[%s]]={ups=ups,k=cp[%d],pr=cp[%d]}",
        vProtos, K_IDX, vIns,
        sCT, vGetO, vOUV, vR, sCI, sCI,
        sCT, vGetO, vOUV, vR, sCI, sCI,
        vR, vA, vMkCl, vEnv, vR, vA, pK, pPR))
    
    h(9, string.format(
        "local uv=upvals[%s];if uv.open then %s[%s]=uv.stack[uv.idx] else %s[%s]=uv.val end",
        B, vR, vA, vR, vA))
    
    h(10, string.format(
        "local uv=upvals[%s];if uv.open then uv.stack[uv.idx]=%s[%s] else uv.val=%s[%s] end",
        B, vR, vA, vR, vA))
    
    h(11, string.format("%s(%s,%s,%s)", vClsF, vOUV, vR, vA))
    
    h(63, string.format(
        "if %s==0 then for i=1,nva do %s[%s+i-1]=va[i] end;%s=%s+nva "..
        "else for i=1,%s-1 do %s[%s+i-1]=va and va[i] or nil end end",
        B, vR, vA, vTop, vA, B, vR, vA))
    
    h(20, string.format(
        "local s=%s[%s];%s[%s+1]=s;%s[%s]=s[%s]",
        vR, B, vR, vA, vR, vA, KC))
    
    h(21, string.format(
        "local f=%s[%s];"..
        "local na=%s==0 and (%s-%s-1) or (%s-1);"..
        "if %s==2 then "..
        "if na==0 then %s[%s]=f() "..
        "elseif na==1 then %s[%s]=f(%s[%s+1]) "..
        "elseif na==2 then %s[%s]=f(%s[%s+1],%s[%s+2]) "..
        "elseif na==3 then %s[%s]=f(%s[%s+1],%s[%s+2],%s[%s+3]) "..
        "elseif na==4 then %s[%s]=f(%s[%s+1],%s[%s+2],%s[%s+3],%s[%s+4]) "..
        "elseif na==5 then %s[%s]=f(%s[%s+1],%s[%s+2],%s[%s+3],%s[%s+4],%s[%s+5]) "..
        "elseif na==6 then %s[%s]=f(%s[%s+1],%s[%s+2],%s[%s+3],%s[%s+4],%s[%s+5],%s[%s+6]) "..
        "else local av={};for i=1,na do av[i]=%s[%s+i] end;%s[%s]=f(%s(av,1,na)) end "..
        "else "..
        "local res;"..
        "if na==0 then res=%s(f()) "..
        "elseif na==1 then res=%s(f(%s[%s+1])) "..
        "elseif na==2 then res=%s(f(%s[%s+1],%s[%s+2])) "..
        "elseif na==3 then res=%s(f(%s[%s+1],%s[%s+2],%s[%s+3])) "..
        "elseif na==4 then res=%s(f(%s[%s+1],%s[%s+2],%s[%s+3],%s[%s+4])) "..
        "elseif na==5 then res=%s(f(%s[%s+1],%s[%s+2],%s[%s+3],%s[%s+4],%s[%s+5])) "..
        "elseif na==6 then res=%s(f(%s[%s+1],%s[%s+2],%s[%s+3],%s[%s+4],%s[%s+5],%s[%s+6])) "..
        "else local av={};for i=1,na do av[i]=%s[%s+i] end;res=%s(f(%s(av,1,na))) end;"..
        "if %s==0 then for i=1,res.n do %s[%s+i-1]=res[i] end;%s=%s+res.n "..
        "else for i=1,%s-1 do %s[%s+i-1]=res[i] end end "..
        "end",
        vR, vA,
        B, vTop, vA, B,
        C,
        
        vR, vA,
        vR, vA, vR, vA,
        vR, vA, vR, vA, vR, vA,
        vR, vA, vR, vA, vR, vA, vR, vA,
        vR, vA, vR, vA, vR, vA, vR, vA, vR, vA,
        vR, vA, vR, vA, vR, vA, vR, vA, vR, vA, vR, vA,
        vR, vA, vR, vA, vR, vA, vR, vA, vR, vA, vR, vA, vR, vA,
        vR, vA, vR, vA, vUnpk,
        
        vPk, vPk, vR, vA, vPk, vR, vA, vR, vA, vPk, vR, vA, vR, vA, vR, vA,
        vPk, vR, vA, vR, vA, vR, vA, vR, vA,
        vPk, vR, vA, vR, vA, vR, vA, vR, vA, vR, vA,
        vPk, vR, vA, vR, vA, vR, vA, vR, vA, vR, vA, vR, vA,
        vR, vA, vPk, vUnpk,
        C, vR, vA, vTop, vA,
        C, vR, vA))
    
    h(22, string.format(
        "local b=%s;"..
        "if b==1 then return "..
        "elseif b==2 then return %s[%s] "..
        "elseif b==0 then local out,m={},0;for r=%s,%s-1 do m=m+1;out[m]=%s[r] end;return %s(out,1,m) "..
        "else local out={};for i=1,b-1 do out[i]=%s[%s+i-1] end;return %s(out,1,b-1) end",
        B, vR, vA, vA, vTop, vR, vUnpk, vR, vA, vUnpk))

    
    
    h(82, string.format(
        "local %s=%s[%s]+%s[%s];%s[%s]=%s;%s[%s]=%s",
        vT1, vR, B, vR, C,
        vR, vA, vT1,
        vR, K_IDX, vT1))
    
    h(83, string.format(
        "local %s=%s[%s];%s[%s]=%s;%s[%s]=%s[%s]+%s[%s]",
        vT1, vR, B,
        vR, vA, vT1,
        vR, vA, vR, vA, vR, C))
    
    h(84, string.format(
        "local %s=%s[%s][kg(%s,%s)];%s[%s]=%s;%s[%s]=%s",
        vT1, vR, B, vK, C,
        vR, vA, vT1,
        vR, K_IDX, vT1))
    
    -- Catph extended ISA handlers. Alias ops reuse base shapes with fixed
    -- distinct variants; fused ops compose small bodies; the 4 call-fusions
    -- reuse the exact CALL handler body (looked up, never retranscribed).
    local handlerBodies = {}
    for _, hd in ipairs(handlers) do
        if handlerBodies[hd.op] == nil then handlerBodies[hd.op] = hd.code end
    end
    local callBody21 = handlerBodies[21]
    -- arithmetic aliases (same operand shapes as base handlers)
    polyBinOpCommutative(88, "+")
    polyBinOp(89, "-")
    polyBinOpCommutative(90, "*")
    polyBinOp(91, "/")
    polyBinOp(92, "%%")
    polyBinOp(93, "^")
    do
        local lhs = string.format("%s[%s]", vR, B)
        local rhs = string.format("%s[%s]", vR, C)
        h(94, string.format("%s[%s]=math.floor(%s/%s)", vR, vA, lhs, rhs))
    end
    -- move/load aliases, fixed distinct shapes
    h(95, string.format("%s[%s]=%s[%s]", vR, vA, vR, B))
    h(96, string.format("local %s=%s[%s];%s[%s]=%s", vT1, vR, B, vR, vA, vT1))
    h(97, string.format("do %s[%s]=%s[%s] end", vR, vA, vR, B))
    h(98, string.format("%s[%s]=%s", vR, vA, KC))
    h(99, string.format("local %s=%s;%s[%s]=%s", vT1, KC, vR, vA, vT1))
    h(100, string.format("%s[%s]=%s", vR, vA, B))
    h(101, string.format("%s[%s]=%s~=0", vR, vA, B))
    h(102, string.format("%s[%s]=nil", vR, vA))
    -- table/global/call/misc aliases (same shapes as base handlers)
    h(103, string.format("%s[%s]=%s[%s][%s[%s]]", vR, vA, vR, B, vR, C))
    h(104, string.format("do local %s=%s[%s][%s[%s]];%s[%s]=%s end", vT1, vR, B, vR, C, vR, vA, vT1))
    h(105, string.format("%s[%s][%s[%s]]=%s[%s]", vR, B, vR, C, vR, vA))
    h(106, string.format("%s[%s]=%s[%s][%s]", vR, vA, vR, B, KC))
    h(107, string.format("%s[%s][%s]=%s[%s]", vR, B, KC, vR, vA))
    h(108, string.format("%s[%s]=%s[%s][%s]", vR, vA, vR, B, C))
    h(109, string.format("%s[%s][%s]=%s[%s]", vR, B, C, vR, vA))
    h(110, string.format("%s[%s]={}", vR, vA))
    h(111, string.format(
        "local t=%s[%s];local base=%s;local start=%s;"..
        "local cnt=%s;if cnt==0 then cnt=%s-base end;"..
        "for i=0,cnt-1 do t[start+i]=%s[base+i] end",
        vR, vA, B, K_IDX, C, vTop, vR))
    -- call aliases share the exact CALL body (looked up, never retranscribed)
    if callBody21 then
        h(112, callBody21)
        h(113, callBody21)
        h(114, callBody21)
    end
    -- return aliases (same generic body as RETURN: handles every b count)
    h(115, string.format(
        "local b=%s;"..
        "if b==1 then return "..
        "elseif b==2 then return %s[%s] "..
        "elseif b==0 then local out,m={},0;for r=%s,%s-1 do m=m+1;out[m]=%s[r] end;return %s(out,1,m) "..
        "else local out={};for i=1,b-1 do out[i]=%s[%s+i-1] end;return %s(out,1,b-1) end",
        B, vR, vA, vA, vTop, vR, vUnpk, vR, vA, vUnpk))
    h(136, string.format(
        "local b=%s;"..
        "if b==1 then return "..
        "elseif b==2 then return %s[%s] "..
        "elseif b==0 then local out,m={},0;for r=%s,%s-1 do m=m+1;out[m]=%s[r] end;return %s(out,1,m) "..
        "else local out={};for i=1,b-1 do out[i]=%s[%s+i-1] end;return %s(out,1,b-1) end",
        B, vR, vA, vA, vTop, vR, vUnpk, vR, vA, vUnpk))
    h(137, string.format(
        "local b=%s;"..
        "if b==1 then return "..
        "elseif b==2 then return %s[%s] "..
        "elseif b==0 then local out,m={},0;for r=%s,%s-1 do m=m+1;out[m]=%s[r] end;return %s(out,1,m) "..
        "else local out={};for i=1,b-1 do out[i]=%s[%s+i-1] end;return %s(out,1,b-1) end",
        B, vR, vA, vA, vTop, vR, vUnpk, vR, vA, vUnpk))
    -- namecall/newclosure/varargs/global/upval aliases
    h(116, string.format(
        "local s=%s[%s];%s[%s+1]=s;%s[%s]=s[%s]",
        vR, B, vR, vA, vR, vA, KC))
    h(117, string.format(
        "local s=%s[%s];%s[%s+1]=s;local t=s[%s];%s[%s]=t",
        vR, B, vR, vA, KC, vR, vA))
    h(118, string.format(
        "local cp=%s[%s];local caps=%s.cap;local nc=#caps;local ups;"..
        "if nc==0 then ups={} "..
        "elseif nc==1 then local c=caps[1];if c[%d]==1 then ups={%s(%s,%s,c[%d])} else ups={upvals[c[%d]]} end "..
        "else ups={};for u=1,nc do local c=caps[u];"..
        "if c[%d]==1 then ups[u]=%s(%s,%s,c[%d]) else ups[u]=upvals[c[%d]] end end end;"..
        "%s[%s]=%s(cp,%s,ups);_WR[%s[%s]]={ups=ups,k=cp[%d],pr=cp[%d]}",
        vProtos, K_IDX, vIns,
        sCT, vGetO, vOUV, vR, sCI, sCI,
        sCT, vGetO, vOUV, vR, sCI, sCI,
        vR, vA, vMkCl, vEnv, vR, vA, pK, pPR))
    h(119, string.format(
        "if %s==0 then for i=1,nva do %s[%s+i-1]=va[i] end;%s=%s+nva "..
        "else for i=1,%s-1 do %s[%s+i-1]=va and va[i] or nil end end",
        B, vR, vA, vTop, vA, B, vR, vA))
    -- global/upvalue aliases
    h(120, string.format("do local _v=%s(%s,%s);if _v==nil then _v=%s[%s] end;%s[%s]=_v end",
        vRawGet, vEnv, KC, vEnv, KC, vR, vA))
    h(121, string.format("local _v=%s(%s,%s);if _v==nil then _v=%s[%s] end;do %s[%s]=_v end",
        vRawGet, vEnv, KC, vEnv, KC, vR, vA))
    h(122, string.format("do %s[%s]=(%s(%s,%s) or %s[%s]) end",
        vR, vA, vRawGet, vEnv, KC, vEnv, KC))
    h(123, string.format("%s(%s,%s,%s[%s])", vRawSet, vEnv, KC, vR, vA))
    h(124, string.format("do %s(%s,%s,%s[%s]) end", vRawSet, vEnv, KC, vR, vA))
    h(125, string.format(
        "local uv=upvals[%s];if uv.open then %s[%s]=uv.stack[uv.idx] else %s[%s]=uv.val end",
        B, vR, vA, vR, vA))
    h(126, string.format(
        "local uv=upvals[%s];if uv.open then uv.stack[uv.idx]=%s[%s] else uv.val=%s[%s] end",
        B, vR, vA, vR, vA))
    h(127, string.format("%s(%s,%s,%s)", vClsF, vOUV, vR, vA))
    -- unary/concat aliases, fixed distinct shapes
    h(128, string.format("local s=%s[%s];for r=%s+1,%s do s=s..%s[r] end;%s[%s]=s", vR, B, B, C, vR, vR, vA))
    h(129, string.format("if %s[%s] then %s[%s]=false else %s[%s]=true end", vR, B, vR, vA, vR, vA))
    h(130, string.format("%s[%s]=0-%s[%s]", vR, vA, vR, B))
    h(131, string.format("local %s=%s[%s];%s[%s]=#%s", vT1, vR, B, vR, vA, vT1))
    -- literal aliases (no blindKey: serializer only blinds canonical LOADN)
    h(132, string.format("%s[%s]=true", vR, vA))
    h(133, string.format("%s[%s]=false", vR, vA))
    h(134, string.format("%s[%s]=0", vR, vA))
    h(135, string.format("%s[%s]=1", vR, vA))
    -- fused super-ops: temp stores preserved, same field layout as bases
    h(39, string.format("%s[%s]=%s[%s];%s[%s]=%s[%s]",
        vR, vA, vR, B, vR, K_IDX, vR, vA))
    h(40, string.format("%s[%s]=%s;%s[%s]=%s[%s]",
        vR, vA, B, vR, K_IDX, vR, vA))
    h(41, string.format("%s[%s]=(%s~=0);%s[%s]=%s[%s]",
        vR, vA, B, vR, K_IDX, vR, vA))
    h(42, string.format("%s[%s]=nil;%s[%s]=%s[%s]",
        vR, vA, vR, K_IDX, vR, vA))
    h(43, string.format(
        "do local _v=%s(%s,%s);if _v==nil then _v=%s[%s] end;%s[%s]=_v;%s[%s]=%s[%s] end",
        vRawGet, vEnv, KC, vEnv, KC, vR, vA, vR, vC, vR, vA))
    -- fused calls reuse the exact CALL body (looked up, force-emitted above)
    if callBody21 then
        h(44, string.format(
            "do local _v=%s(%s,%s);if _v==nil then _v=%s[%s] end;%s[%s]=_v end;",
            vRawGet, vEnv, KC, vEnv, KC, vR, vA) .. callBody21)
        h(45, string.format("%s[%s]=%s;", vR, vA, KC) .. callBody21)
        h(46, callBody21 .. string.format(";%s[%s]=%s[%s]", vR, K_IDX, vR, vA))
        h(47, string.format("%s[%s]=%s[%s];", vR, vA, vR, K_IDX) .. callBody21)
    end
    -- fused table/unary/concat (result forwarded to k)
    h(48, string.format("%s[%s]=%s[%s][%s[%s]];%s[%s]=%s[%s]",
        vR, vA, vR, B, vR, C, vR, K_IDX, vR, vA))
    h(54, string.format("%s[%s]=%s[%s][%s];%s[%s]=%s[%s]",
        vR, vA, vR, B, C, vR, K_IDX, vR, vA))
    h(59, string.format("%s[%s]=not %s[%s];%s[%s]=%s[%s]",
        vR, vA, vR, B, vR, K_IDX, vR, vA))
    h(61, string.format("%s[%s]=-%s[%s];%s[%s]=%s[%s]",
        vR, vA, vR, B, vR, K_IDX, vR, vA))
    h(62, string.format("%s[%s]=#%s[%s];%s[%s]=%s[%s]",
        vR, vA, vR, B, vR, K_IDX, vR, vA))
    h(65, string.format(
        "local s=%s[%s];for r=%s+1,%s do s=s..%s[r] end;%s[%s]=s;%s[%s]=%s[%s]",
        vR, B, B, C, vR, vR, vA, vR, K_IDX, vR, vA))
    -- fused arithmetic (result forwarded to k)
    local function fusedBinOp(opNum, op)
        h(opNum, string.format(
            "local %s=%s[%s];local %s=%s[%s];%s[%s]=%s"..op.."%s;%s[%s]=%s[%s]",
            vT1, vR, B, vT2m, vR, C, vR, vA, vT1, vT2m, vR, K_IDX, vR, vA))
    end
    fusedBinOp(67, "-")
    fusedBinOp(68, "*")
    fusedBinOp(69, "/")
    fusedBinOp(70, "%%")
    fusedBinOp(71, "^")
    do
        local lhs = string.format("%s[%s]", vR, B)
        local rhs = string.format("%s[%s]", vR, C)
        h(72, string.format("%s[%s]=math.floor(%s/%s);%s[%s]=%s[%s]",
            vR, vA, lhs, rhs, vR, K_IDX, vR, vA))
    end
    h(76, string.format("%s[%s]=%s[%s];%s(%s,%s,%s[%s])",
        vR, vA, vR, B, vRawSet, vEnv, KC, vR, vB))
    h(77, string.format(
        "local uv=upvals[%s];if uv.open then %s[%s]=uv.stack[uv.idx] else %s[%s]=uv.val end;%s[%s]=%s[%s]",
        B, vR, vA, vR, vA, vR, K_IDX, vR, vA))
    h(78, string.format(
        "%s[%s]=%s[%s];local uv=upvals[%s];if uv.open then uv.stack[uv.idx]=%s[%s] else uv.val=%s[%s] end",
        vR, vA, vR, B, K_IDX, vR, vA, vR, vA))

    
    shuffle(handlers)

    
    
    
    do
        local function bogusH(op, body)
            handlers[#handlers+1] = {op=op, code=body, gen=nil}
        end
        
        bogusH(0, string.format(
            "local %s=%s[%s];if %s>0 then %s[%s]=%s+1 else %s[%s]=%s end",
            vT1,vR,B,vT1,vR,vA,vT1,vR,vA,vT1))
        
        bogusH(1, string.format(
            "local %s=kg(%s,%s);if %s~=nil then %s[%s]=%s end",
            vT1,vK,K_IDX,vT1,vR,vA,vT1))
        
        bogusH(12, string.format(
            "local %s=%s[%s];if %s then %s[%s]=%s[%s[%s]] else %s[%s]=nil end",
            vT1,vR,B,vT1,vR,vA,vT1,vR,C,vR,vA))
        
        bogusH(60, string.format(
            "if %s[%s] then %s[%s][%s]=%s[%s] end",
            vR,B,vR,B,KC,vR,vA))
        
        bogusH(64, string.format(
            [[local %s=%s[%s];for _r=%s+1,%s do %s=%s..tostring(%s[_r] or 0) end;%s[%s]=%s]],
            vT1,vR,B,B,C,vT1,vT1,vR,vR,vA,vT1))
        
        bogusH(86, string.format(
            "local _uv=upvals[%s];if _uv and _uv.open then _uv.stack[_uv.idx]=%s[%s] end",
            B,vR,vA))
    end

    local HelperVM = require("catph.customvm.helpervm")
    local catHandlers = HelperVM.splitHandlers(handlers)


    
    local function buildBSTDispatch(catHandlerList)
        if #catHandlerList == 0 then return "" end

        
        local entries = {}
        local usedVals = {}
        for _, hd in ipairs(catHandlerList) do
            local freq = opFreqs and opFreqs[hd.op] or 1
            if aliasesOf then
                local aliases = aliasesOf[hd.op] or {}
                local perAlias = math.max(1, math.floor(freq / #aliases))
                for _, av in ipairs(aliases) do
                    if not usedVals[av] then
                        
                        
                        local code = hd.gen and hd.gen() or hd.code
                        entries[#entries+1] = {val=av, code=code, weight=perAlias}
                        usedVals[av] = true
                    end
                end
            else
                if not usedVals[hd.op] then
                    entries[#entries+1] = {val=hd.op, code=hd.code, weight=freq}
                    usedVals[hd.op] = true
                end
            end
        end

        
        local function decoyBody()
            local t = math.random(1,3)
            if t==1 then return string.format("%s[%s]=%s[%s]", vR, vA, vR, B)
            elseif t==2 then return string.format("local _z=%s*1", vHash)
            else return string.format("%s=%s", vTop, vTop) end
        end
        for _ = 1, math.random(2,4) do
            local v; local tr=0
            repeat v=math.random(0,255); tr=tr+1 until not usedVals[v] or tr>200
            if not usedVals[v] then
                usedVals[v]=true
                entries[#entries+1] = {val=v, code=decoyBody(), decoy=true, weight=0}
            end
        end

        table.sort(entries, function(a,b) return a.val < b.val end)

        
        for _, e in ipairs(entries) do
            e.dval = e.val
        end
        table.sort(entries, function(a,b) return a.dval < b.dval end)

        local function bst(list, depth)
            local ind = string.rep("    ", (depth or 0) + 3)
            if #list == 0 then return "" end
            if #list == 1 then
                if list[1].decoy then
                    local dead = math.random(0, 253)
                    return ind.."if "..vOp.."<"..fmtN(dead).." then "..list[1].code.." end"
                else
                    return ind..list[1].code
                end
            end
            
            local totalWeight = 0
            for _, e in ipairs(list) do totalWeight = totalWeight + (e.weight or 1) end
            local mid = math.floor(#list/2)+1
            local bestDiff = math.huge
            local cumWeight = 0
            for i = 1, #list - 1 do
                cumWeight = cumWeight + (list[i].weight or 1)
                local diff = math.abs(cumWeight - (totalWeight - cumWeight))
                if diff < bestDiff then
                    bestDiff = diff
                    mid = i + 1
                end
            end
            local pivot = list[mid].dval
            local left, right = {}, {}
            for i, e in ipairs(list) do
                if i < mid then left[#left+1]=e else right[#right+1]=e end
            end

            
            
            
            
            local useOpaque = (depth or 0) >= 1 and (depth or 0) <= 6 and math.random() < 0.55
            local opaquePrefix, opaqueSuffix = "", ""
            if useOpaque then
                
                local predVariant = math.random(1, 10)
                local pred
                if predVariant == 1 then
                    
                    pred = string.format("%s*%s>=0", vPC, vPC)
                elseif predVariant == 2 then
                    
                    pred = string.format("bit32.band(%s,0)==0", vPC)
                elseif predVariant == 3 then
                    
                    pred = string.format("(%s-%s)==0", vHash, vHash)
                elseif predVariant == 4 then
                    
                    pred = string.format("type(%s)==\"table\"", vR)
                elseif predVariant == 5 then
                    
                    pred = string.format("%s>=0 or %s<0", vPC, vPC)
                elseif predVariant == 6 then
                    
                    pred = string.format("bit32.bor(%s,0)==%s", vA, vA)
                elseif predVariant == 7 then
                    
                    pred = string.format("(%s%%2==0 or %s%%2==1)", vPC, vPC)
                elseif predVariant == 8 then
                    
                    pred = string.format("bit32.band(%s,%s)==%s", vTop, vTop, vTop)
                elseif predVariant == 9 then
                    
                    pred = string.format("bit32.bor(%s,%s)>=bit32.band(%s,%s)", vHash, vPC, vHash, vPC)
                else
                    
                    pred = string.format("bit32.rshift(bit32.bxor(%s,%s),1)==0", vPC, vPC)
                end
                
                local decoy = decoyBody()
                opaquePrefix = ind.."if "..pred.." then\n"
                opaqueSuffix = "\n"..ind.."else\n"..ind.."    "..decoy.."\n"..ind.."end"
            end

            local out = {opaquePrefix..ind.."if "..vOp.."<"..fmtN(pivot).." then"}
            local lc = bst(left, (depth or 0)+1)
            if lc~="" then out[#out+1]=lc end
            if #right>0 then
                out[#out+1]=ind.."else"
                local rc = bst(right, (depth or 0)+1)
                if rc~="" then out[#out+1]=rc end
            end
            out[#out+1]=ind.."end"..opaqueSuffix
            return table.concat(out, "\n")
        end

        return bst(entries, 0)
    end

    local subDisp = {}
    for cat = 1, 4 do subDisp[cat] = buildBSTDispatch(catHandlers[cat]) end

    local vCatLUT = randomName(used)
    local catLutParts = {}
    local catLutUsed = {}
    for _, hd in ipairs(handlers) do
        local cat = HelperVM.categoryOf(hd.op)
        if aliasesOf then
            for _, b in ipairs(aliasesOf[hd.op] or {}) do
                if not catLutUsed[b] then
                    catLutParts[#catLutParts+1] = {fmtN(b), cat}  
                    catLutUsed[b] = true
                end
            end
        else
            if not catLutUsed[hd.op] then
                catLutParts[#catLutParts+1] = {fmtN(hd.op), cat}  
                catLutUsed[hd.op] = true
            end
        end
    end
    shuffle(catLutParts)

    local catIDs = {math.random(10,99), math.random(100,199), math.random(200,299), math.random(300,399)}
    shuffle(catIDs)
    local catIDMap = {}
    for i = 1, 4 do catIDMap[i] = catIDs[i] end
    local remappedCatLut = {}
    for _, entry in ipairs(catLutParts) do
        
        remappedCatLut[#remappedCatLut+1] = "["..entry[1].."]="..fmtN(catIDMap[entry[2]])
    end

    vmCode = vmCode .. string.format("    local %s={%s}\n", vCatLUT, table.concat(remappedCatLut, ","))

    local vCat = randomName(used)      
    local vST = randomName(used)       
    local vST2 = randomName(used)      

    local stFetch = math.random(1000, 9999)
    local stRoute = math.random(10000, 19999)
    local stCats = {}
    for i = 1, 4 do stCats[i] = math.random(20000, 59999) + i * 1000 end
    local stLoopBack = math.random(60000, 69999)

    local nBogus = math.random(4, 7)
    local bogusStates = {}
    local allUsed = {[stFetch]=true, [stLoopBack]=true}
    for i = 1, 4 do allUsed[stCats[i]] = true end
    for i = 1, nBogus do
        local bs; repeat bs = math.random(1000, 99999) until not allUsed[bs]
        allUsed[bs] = true
        bogusStates[i] = bs
    end

    local stMul = math.random(3, 97)
    local stMod = math.random(100000, 999999)

    local function stAssign(target)
        local a = math.random(1, 50000)
        local b = target - a
        return vST.."="..fmtN(a).."+"..fmtN(b)
    end

    local vCatSt = randomName(used)
    local catStLutParts = {}
    for i = 1, 4 do
        catStLutParts[#catStLutParts+1] = "["..fmtN(catIDs[i]).."]="..fmtN(stCats[i])
    end
    for i = 1, nBogus do
        catStLutParts[#catStLutParts+1] = "["..fmtN(math.random(400, 999)).."]="..fmtN(bogusStates[i])
    end
    shuffle(catStLutParts)

    local fetchBlock = (
        "        "..vIns.." = rawget("..vCode..","..vPC.."); "..vPC.." = "..vPC.." + 1\n" ..
        
        "        "..vOp.." = _rkx(rawget("..vIns..","..fmtN(sOp).."),rawget("..vIns..","..fmtN(sDK).."))\n" ..
        
        "        "..vHash.." = ("..vHash.."*"..fmtN(hashMult).."+("..vOp.."*3))%1073741823\n" ..
        "        "..vA.." = rawget("..vIns..","..fmtN(sA)..")\n" ..
        "        "..vB.." = rawget("..vIns..","..fmtN(sB)..")\n" ..
        "        "..vC.." = rawget("..vIns..","..fmtN(sC)..")\n" ..
        "        "..vKI.." = rawget("..vIns..","..fmtN(sK)..")\n")

    
    local allHandlerList = {}
    for _, hd in ipairs(handlers) do
        allHandlerList[#allHandlerList+1] = hd
    end
    local fullDispatch = buildBSTDispatch(allHandlerList)

    vmCode = vmCode .. string.format("    local %s,%s,%s,%s,%s,%s,%s\n", vIns, vOp, vA, vCat, vB, vC, vKI)
    
    local vICount = randomName(used)
    vmCode = vmCode .. string.format("    local %s=0\n", vICount)
    vmCode = vmCode .. "    while true do\n"
    
    fetchBlock = fetchBlock ..
        "        "..vICount.." = "..vICount.." + 1\n" ..
        "        if "..vICount.."%"..fmtN(math.random(31,63)).."==0 then "..
             vHash.."=bit32.bxor("..vHash..","..vICount..") end\n"
    
    vmCode = vmCode .. fetchBlock .. "\n"
    vmCode = vmCode .. fullDispatch .. "\n"
    vmCode = vmCode .. "    end\nend\n"

    local helpersCode = string.format([=[
local function %s(ouv, R, reg)
    for i=1,#ouv do local u=ouv[i];if u.open and u.idx==reg then return u end end
    local u={open=true,stack=R,idx=reg};ouv[#ouv+1]=u;return u
end
local function %s(ouv, R, a)
    for i=1,#ouv do local u=ouv[i]
        if u.open and u.idx>=a then u.val=R[u.idx];u.open=false;u.stack=nil end
    end
end
]=], vGetO, vClsF)


    local vAT = randomName(used)
    local antiTamperCode = string.format([=[
local function %s()
    local _e = getfenv and getfenv() or _G
    if getmetatable(_e) then return true end
    if rawget(_e, "____hook") or rawget(_e, "__log") then return true end
    local d = rawget(_e, "debug")
    if d and type(d) == "table" then
        if d.sethook and type(debug) == "table" and debug.sethook ~= d.sethook then return true end
        local ok, info = pcall(function() return debug.getinfo(1) end)
        if ok and info and info.what == "C" then
            if debug.getinfo(2) and debug.getinfo(2).func and
               type(tostring(debug.getinfo(2).func)) ~= "string" then return true end
        end
    end
    if type(rawget(_e, "print")) == "function" then
        local s = tostring(rawget(_e, "print"))
        if not s:find("builtin") and not s:find("function: 0x") and not s:find("function:") then
            return true
        end
    end
    return false
end
if %s() then do end end
]=], vAT, vAT)

   
    local vAT2 = randomName(used)
    local vAT2chk = randomName(used)
    local extAntiTamperCode = string.format([=[
-- LuaU-aware: prefers debug.info (newest Luau), falls back to debug.getinfo (Lua 5.1 / PUC). Returns true only when a builtin is PROVABLY not a C closure (pure-Lua executor).
local function %s(fn)
    local d = debug
    if type(d) ~= "table" then return false end
    if type(d.info) == "function" then
        local ok, src = pcall(d.info, fn, "s")
        if not ok then return true end
        return src ~= "[C]"
    elseif type(d.getinfo) == "function" then
        local ok, info = pcall(d.getinfo, fn, "S")
        if not ok then return true end
        return not (info ~= nil and info.what == "C")
    end
    return false
end
local function %s()
    -- executor-safe: all checks pcall, Roblox-only parts gated on game userdata
    local okR = pcall(debug.getregistry)
    if not okR then do end end
    local builtins={print,warn,require,getfenv,setfenv,pcall,rawget,rawset,select,type,getmetatable,setmetatable}
    for i=1,#builtins do if type(builtins[i])=="function" and %s(builtins[i]) then do end end end
    local okEnv,env=pcall(getfenv,0)
    if okEnv and type(env)=="table" then
        for _,v in next,env do if type(v)=="table" and getmetatable(v) then -- dumpers inject metatable hooks
            -- don't crash on vanilla Lua where some env tables have metatables; only if hook signature
            if rawget(v,"__hook") or rawget(v,"__dump") then do end end
        end end
    end
    local ok2,bad=pcall(function()
        local d=debug
        if d and type(d)=="table" and type(d.info)=="function" then
            local _,r1=pcall(d.info,print,'a')
            local _,r2=pcall(d.info,tostring,'a')
            if r1~="[C]" or r2~="[C]" then return true end
        end
        return select(1,pcall(getfenv,69))==true
    end)
    if not ok2 or bad then do end end
    -- Roblox FPS check only if Roblox env present
    if type(game)=="userdata" then
        local okW,ws=pcall(function() return game:GetService('Workspace') end)
        if okW and type(ws)=="userdata" then
            local okF,fps=pcall(function() return ws:GetRealPhysicsFPS() end)
            if okF and (type(fps)~="number" or fps<0.1 or fps>2000) then do end end
        end
    end
end
if pcall(debug.getregistry) then %s() end
]=], vAT2chk, vAT2, vAT2chk, vAT2)


    -- Anti-tamper ON by default: both blocks execute inside the VM bootstrapper,
    -- strictly BEFORE the VM starts interpreting the payload.
    -- Disable explicitly with _G.__cvm_test_noat (used by local test sims).
    if _G.__cvm_test_noat then
        antiTamperCode = ""
        extAntiTamperCode = ""
    end

    
    
    local junkRanges = {
        [0] = {funcs={0,0}, vars={0,0}, flocals={0,0}},
        [1] = {funcs={2,4}, vars={3,6},  flocals={3,6}},
        [2] = {funcs={4,10}, vars={6,14}, flocals={5,12}},
        [3] = {funcs={8,16}, vars={10,20}, flocals={8,16}},
    }
    local junkLevel_ = junkRanges[junkLevel] or junkRanges[2]
    local function junkBlock()
        if junkLevel == 0 then return "" end
        local parts = {}
        local numNames = {}  
        
        local nFuncs = math.random(junkLevel_.funcs[1], junkLevel_.funcs[2])
        for _ = 1, nFuncs do
            local fname = randomName(used)
            local np = math.random(1, 3)
            local pms = {}
            for _ = 1, np do pms[#pms+1] = randomName(used) end
            local fbody = {}
            local fnums = {}
            local nfl = math.random(junkLevel_.flocals[1], junkLevel_.flocals[2])
            for _ = 1, nfl do
                local ln = randomName(used)
                local t = math.random(1, 6)
                local ex
                if     t == 1 then ex = math.random(1,999999)
                elseif t == 2 then ex = math.random(1,99999).."+"..math.random(1,99999)
                elseif t == 3 then ex = "math.floor("..math.random(1,99999).."/"..math.random(1,99)..")"
                elseif t == 4 and #fnums>0 then ex = fnums[math.random(1,#fnums)].."*"..math.random(2,99)
                elseif t == 5 then ex = "(function() return "..math.random(1,999999).." end)()"
                else   ex = math.random(1,999999)
                end
                fbody[#fbody+1] = "local "..ln.."="..ex
                fnums[#fnums+1] = ln
            end
            if #fnums > 0 then fbody[#fbody+1] = "return "..fnums[math.random(1,#fnums)] end
            parts[#parts+1] = "local function "..fname.."("..table.concat(pms,",")..") "..table.concat(fbody," ").." end"
            numNames[#numNames+1] = fname  
        end
    
    
        local nVars = math.random(junkLevel_.vars[1], junkLevel_.vars[2])
        for _ = 1, nVars do
            local vn = randomName(used)
            local t = math.random(1, 8)
            if t == 6 then
                
                local ex = string.format("math.max(%d,%d)", math.random(1,999999), math.random(1,999999))
                parts[#parts+1] = "local "..vn.."="..ex
                numNames[#numNames+1] = vn
            elseif t == 7 then
                local ex = string.format("(function() local _a=%d;local _b=%d;return _a*_b end)()", math.random(1,9999), math.random(1,99))
                parts[#parts+1] = "local "..vn.."="..ex
                numNames[#numNames+1] = vn
                numNames[#numNames+1] = vn
            else
                local ex
                if     t == 1 then ex = math.random(1,999999)
                elseif t == 2 then ex = "math.max("..math.random(1,99999)..","..math.random(1,99999)..")"
                elseif t == 3 and #numNames>0 then ex = "("..numNames[math.random(1,#numNames)].." and "..math.random(1,999999).." or "..math.random(1,999999)..")"
                elseif t == 4 then ex = math.random(1,9999).."*"..math.random(1,9999)
                elseif t == 5 then ex = "(function() local _a="..math.random(1,99999).." local _b="..math.random(1,99).." return _a*_b end)()"
                else   ex = math.random(1,999999)
                end
                parts[#parts+1] = "local "..vn.."="..ex
                numNames[#numNames+1] = vn
            end
        end
        return table.concat(parts, " ")
    end

    local junkA = junkBlock()
    local junkB = junkBlock()
    local junkC = junkBlock()

    local kz = math.random(1, 240)
    local fmtKZ = fmtN(kz)

    local floodCode = ""
    do
        local target = rtOpts and rtOpts.instructionFlood or 0
        local stackDepth = rtOpts and rtOpts.stackDepth or 9000
        local parts = {}
        local sd = math.max(1, math.floor(stackDepth))
        if stackDepth > 0 then
            do
                local vf = randomName(used)
                local vn = randomName(used)
                local vr = randomName(used)
                local vres = randomName(used)
                parts[#parts+1] = string.format(
                    "do local function %s(%s) if %s>0 then local %s=%s(%s-1) return %s end return 0 end local %s=%s(%s) end ",
                    vf, vn, vn, vr, vf, vn, vr, vres, vf, fmtN(sd))
            end
        end
        if target and target > 0 then
            local iters = math.min(math.max(1, math.floor(target)), 1000000)
            local safeIters = math.min(iters, 250000)
            local vbk = randomName(used)
            local vg = randomName(used)
            local vft = randomName(used)
            local vcnt = randomName(used)
            local vws = randomName(used)
            local vok1 = randomName(used)
            local vv1 = randomName(used)
            local vok2 = randomName(used)
            local vv2 = randomName(used)
            local vok3 = randomName(used)
            local vv3 = randomName(used)
            local vok4 = randomName(used)
            local vv4 = randomName(used)
            local vcm = randomName(used)
            local venv = randomName(used)
            local vbuf = randomName(used)
            local vj = randomName(used)
            local vk = randomName(used)
            local va = randomName(used)
            local vb = randomName(used)
            local vpls = randomName(used)
            local vpst = randomName(used)
            local vprp = randomName(used)
            local vpbd = randomName(used)
            local vpix = randomName(used)
            local vrs = randomName(used)
            local vfi = randomName(used)
            local vbm = randomName(used)
            local vbt = randomName(used)
            local vb1 = randomName(used)
            local vbe1 = randomName(used)
            local vb2 = randomName(used)
            local vbe2 = randomName(used)
            local vbz = randomName(used)
            local vbf1 = randomName(used)
            local vbf2 = randomName(used)
            local vbd = randomName(used)
            local vbi = randomName(used)
            local vb3 = randomName(used)
            local vbsr = randomName(used)
            local vnil = randomName(used)
            local vpt = randomName(used)
            local vn1 = randomName(used)
            local vn2 = randomName(used)
            parts[#parts+1] = string.format(
                "do local %s=_gp(103,97,109,101);local %s=_gp(116,121,112,101,111,102);local %s=0;local %s=false;" ..
                "if %s~=nil and type(%s)==\"function\" and %s(%s)==_gC(73,110,115,116,97,110,99,101) then %s=%s+1 end;",
                vg, vft, vcnt, vbk,
                vg, vft, vft, vg, vcnt, vcnt)
            parts[#parts+1] = string.format(
                "local %s,%s=pcall(function() return %s[_gC(80,108,97,121,101,114,115)] end);if %s and %s~=nil and %s(%s)==_gC(73,110,115,116,97,110,99,101) then %s=%s+1 end;",
                vok1, vv1, vg, vok1, vv1, vft, vv1, vcnt, vcnt)
            parts[#parts+1] = string.format(
                "local %s=_gp(119,111,114,107,115,112,97,99,101);local %s,%s=pcall(function() return %s and %s[_gC(67,117,114,114,101,110,116,67,97,109,101,114,97)] end);if %s and %s~=nil and %s(%s)==_gC(73,110,115,116,97,110,99,101) then %s=%s+1 end;",
                vws, vok2, vv2, vws, vws, vok2, vv2, vft, vv2, vcnt, vcnt)
            parts[#parts+1] = string.format(
                "local %s,%s=pcall(function() local %s=%s and %s[_gC(67,117,114,114,101,110,116,67,97,109,101,114,97)];return %s and %s[_gC(71,101,116,80,97,114,116,115,79,98,115,99,117,114,105,110,103,84,97,114,103,101,116)] end);if %s and type(%s)==\"function\" then %s=%s+1 end;",
                vok3, vv3, vcm, vws, vws, vcm, vcm, vok3, vv3, vcnt, vcnt)
            parts[#parts+1] = string.format(
                "local %s,%s=pcall(function() local %s=_gp(69,110,117,109);if %s==nil then return nil end;%s=%s[_gC(72,117,109,97,110,111,105,100,83,116,97,116,101,84,121,112,101)];return %s and %s[_gC(83,119,105,109,109,105,110,103)] end);if %s and %s~=nil and %s(%s)==_gC(69,110,117,109,73,116,101,109) then %s=%s+1 end;",
                vok4, vv4, venv, venv, venv, venv, venv, venv, vok4, vv4, vft, vv4, vcnt, vcnt)
            parts[#parts+1] = string.format(
                "if %s<3 then %s=true end;local %s=%s and %s or %s;",
                vcnt, vbk,
                vfi, vbk, fmtN(iters), fmtN(safeIters))
            parts[#parts+1] = string.format(
                "local function %s(...) local %s=...; return %s() end;" ..
                "local %s,%s=pcall(%s,nil);" ..
                "local %s,%s=pcall(function() local %s; return %s() end);" ..
                "local %s=_gC(110,105,108,32,118,97,108,117,101);" ..
                "local %s=%s~=nil and tostring(%s) or \"\";" ..
                "local %s=%s~=nil and tostring(%s) or \"\";" ..
                "local %s=_gp(100,101,98,117,103);local %s=%s and %s[_gC(105,110,102,111)];" ..
                "local %s,%s=pcall(function() if type(%s)==\"function\" then return %s(%s,_gC(115)) end return nil end);" ..
                "local %s=_gC(58,40,37,100,43,41);" ..
                "local %s=%s and tonumber(%s:match(%s)) or nil;" ..
                "local %s=%s and tonumber(%s:match(%s)) or nil;" ..
                "if not %s:find(%s,1,true) or not %s:find(%s,1,true) or not %s or type(%s)~=\"string\" or not %s or not %s or not %s then %s=true end;" ..
                "if %s and %s and math.abs(%s-%s)>%s then %s=true end;",
                vbm, vbt, vbt,
                vb1, vbe1, vbm,
                vb2, vbe2, vbz, vbz,
                vnil, vbf1, vbe1, vbe1,
                vbf2, vbe2, vbe2,
                vbd, vbi, vbd, vbd,
                vb3, vbsr, vbi, vbi, vbm,
                vpt, vn1, vbf1, vbf1, vpt,
                vn2, vbf2, vbf2, vpt,
                vbf1, vnil, vbf2, vnil, vb3, vbsr, vbsr, vn1, vn2, vbk,
                vn1, vn2, vn1, vn2, fmtN(100), vbk)
            parts[#parts+1] = string.format(
                "local %s={};for %s=1,256 do %s[%s]=(%s*1103515245+12345)%%1000000007 end;" ..
                "local %s=0;for %s=1,%s do local %s=(%s*2654435761)%%256+1;%s=(%s*31+%s[%s])%%1000000007 end;if %s==0 then %s=%s+1 end;",
                vbuf, vj, vbuf, vj, vj,
                va, vb, vfi, vk, vb, va, va, vbuf, vk,
                va, va, va)
            -- NOTE(Catph): silent vbk decoy intentionally disabled (`if false and ...` below).
            -- Strict vbk fail-closes on executors with empty _G / neutered debug.info
            -- (payload then never runs and never errors). Detection is owned by EnvLoggerCheck.
            parts[#parts+1] = string.format(
                "if false and %s then return (function() local %s=_gp(108,111,97,100,115,116,114,105,110,103);if type(%s)~=\"function\" then %s=_gp(108,111,97,100) end;if type(%s)==\"function\" then local %s=_gp(115,116,114,105,110,103);if type(%s)==\"table\" then local %s=%s[_gC(114,101,112)];if type(%s)==\"function\" then local %s=%s(_gC(93,93),%s);for %s=1,%s do pcall(%s,%s) end end end end;" ..
                "local %s=_gp(114,97,119,115,101,116);if type(%s)==\"function\" then %s(_gp(95,71),_gC(103,101,116,109,101,116,97,116,97,98,108,101),function() error(_gC(115,121,110,116,97,120,32,101,114,114,111,114)) end) end;" ..
                "if type(%s)==\"function\" then %s(_gp(95,71),_gC(115,101,116,109,101,116,97,116,97,98,108,101),function() error(_gC(115,121,110,116,97,120,32,101,114,114,111,114)) end) end;" ..
                "_gp(101,114,114,111,114)(_gC(115,121,110,116,97,120,32,101,114,114,111,114)) end) end end ",
                vbk,
                vpls, vpls, vpls, vpls, vpst, vpst, vprp, vpst, vprp, vpbd, vprp, fmtN(4000), vpix, fmtN(666), vpls, vpbd,
                vrs, vrs, vrs,
                vrs, vrs)
        end
        floodCode = table.concat(parts)
    end
    junkA = junkA .. " " .. floodCode

    local fmtIntHash = fmtN(integrityHash or 0)
    local fmtStreamBase = fmtN(streamBase)
    local fmtStreamStep = fmtN(streamStep)

    local runtime = string.format([=[
local function CVMRUN(D, ...)
local rawget,rawset,type,pcall,next,select,tostring,getmetatable,setmetatable,rawequal,rawlen
local _gC=string.char
local _RNV=(getfenv and (getfenv(0) or getfenv())) or _G
local function _gp(...) return _RNV[_gC(...)] end
rawget=_gp(114,97,119,103,101,116)
rawset=_gp(114,97,119,115,101,116)
type=_gp(116,121,112,101)
pcall=_gp(112,99,97,108,108)
next=_gp(110,101,120,116)
select=_gp(115,101,108,101,99,116)
tostring=_gp(116,111,115,116,114,105,110,103)
getmetatable=_gp(103,101,116,109,101,116,97,116,97,98,108,101)
setmetatable=_gp(115,101,116,109,101,116,97,116,97,98,108,101)
rawequal=_gp(114,97,119,101,113,117,97,108)
rawlen=_gp(114,97,119,108,101,110)
local _WR
do
local _T={} local _M={} local _C=_gC
_M[_C(95,95,109,111,100,101)]=_C(107)
local _S=_RNV[_C(115,101,116,109,101,116,97,116,97,98,108,101)]
_WR=_S(_T,_M)
end
local _b32=(function() local _k=_gC(98,105,116,51,50);local _v=_RNV[_k];if type(_v)=='table' then return _v end;_k=_gC(98,105,116);_v=_RNV[_k];if type(_v)=='table' then return _v end;return {} end)()
local _b32Native=_b32
local function _u32(_x) return (tonumber(_x) or 0) %% 4294967296 end
local function _bitop(_a,_b,_mode)
    _a=_u32(_a); _b=_u32(_b)
    local _out,_p=0,1
    for _i=1,32 do
        local _xa,_yb=_a%%2,_b%%2
        local _yes
        if _mode==0 then _yes=(_xa==1 and _yb==1) elseif _mode==1 then _yes=(_xa==1 or _yb==1) else _yes=(_xa~=_yb) end
        if _yes then _out=_out+_p end
        _a=(_a-_xa)/2; _b=(_b-_yb)/2; _p=_p*2
    end
    return _out
end
local function _fband(_a,_b) return _bitop(_a,_b,0) end
local function _fbor(_a,_b) return _bitop(_a,_b,1) end
local function _fbxor(_a,_b) return _bitop(_a,_b,2) end
local function _frshift(_a,_n)
    _n=tonumber(_n) or 0
    if _n<=0 then return _u32(_a) end
    if _n>=32 then return 0 end
    return math.floor(_u32(_a)/2^_n)
end
local function _pickB32(_name,_fallback)
    local _fn=_b32Native[_name]
    return type(_fn)=='function' and _fn or _fallback
end
_b32={
    band=_pickB32(_gC(98,97,110,100),_fband),
    bor=_pickB32(_gC(98,111,114),_fbor),
    bxor=_pickB32(_gC(98,120,111,114),_fbxor),
    rshift=_pickB32(_gC(114,115,104,105,102,116),_frshift),
}
local _b32n=_b32
local %s=(function()
local _renv=(function() local s=_gC(103,101,116,102,101,110,118); local f=_gp(103,101,116,102,101,110,118) or _gp(103,101,116,102,101,110,118); local function _pick(g) if g and type(g)=="table" then if rawget(g,_gC(112,114,105,110,116)) or _gp(112,114,105,110,116) and g[_gp(112,114,105,110,116)] or rawget(g,_gC(112,99,97,108,108)) or _gp(112,99,97,108,108) and g[_gp(112,99,97,108,108)] then return g end end return nil end; local r0=_pick(f and f()); if r0 then return r0 end; local _z=0; local r1=_pick(f and f(_z)); if r1 then return r1 end; local r2=_pick(_RNV); if r2 then return r2 end; return _RNV end)()
 local _crtn,_strn,_matn,_tbln=_gp(99,111,114,111,117,116,105,110,101),_gp(115,116,114,105,110,103),_gp(109,97,116,104),_gp(116,97,98,108,101)
 local _osln,_u8ln,_tskn=_gp(111,115),_gp(117,116,102,56),_gp(116,97,115,107)
local _bufn,_typn,_vern=_gp(98,117,102,102,101,114),_gp(116,121,112,111,102),_gp(95,86,69,82,83,73,79,78)
local _DBGX do
local _nd=_gp(100,101,98,117,103)
_DBGX={}
if _nd then for _k,_v in next,_nd do _DBGX[_k]=_v end end
_DBGX.traceback=function(m,l) if _nd and _nd.traceback then return _nd.traceback(m,l) end return tostring(m) end
_DBGX.info=_nd and _nd.info or nil
_DBGX.getinfo=function(f,what) if not _nd then return nil end local ok,r=pcall(_nd.info,f,what or 'slnaf') return ok and r or nil end
_DBGX.getregistry=_nd and _nd.getregistry or nil
_DBGX.profilebegin=_nd and _nd.profilebegin or function() end
_DBGX.profileend=_nd and _nd.profileend or function() end
_DBGX.getmetatable=function(o) return rawget(getmetatable(o) or {},"__metatable") and _nd and _nd.getmetatable and _nd.getmetatable(o) or getmetatable(o) end
_DBGX.setmetatable=function(o,mt) if _nd and _nd.setmetatable then return _nd.setmetatable(o,mt) end return setmetatable(o,mt) end
_DBGX.getupvalues=function(f) local m=_WR[f] if m and m.ups then local t={} for i,u in next,m.ups do t[i]={u.open and u.stack and u.stack[u.idx] or u.val} end return t end if _nd and _nd.getupvalues then return _nd.getupvalues(f) end return {} end
_DBGX.getupvalue=function(f,i) local m=_WR[f] if m and m.ups then local u=m.ups[i] if u then return u.open and u.stack and u.stack[u.idx] or u.val end end if _nd and _nd.getupvalue then return _nd.getupvalue(f,i) end end
_DBGX.setupvalue=function(f,i,v) local m=_WR[f] if m and m.ups then local u=m.ups[i] if u then if u.open and u.stack then u.stack[u.idx]=v else u.val=v end return true end end if _nd and _nd.setupvalue then return _nd.setupvalue(f,i,v) end end
_DBGX.getconstants=function(f) local m=_WR[f] if m and m.k then local t={} for i,v in next,m.k do t[i]=v end return t end if _nd and _nd.getconstants then return _nd.getconstants(f) end return {} end
_DBGX.getconstant=function(f,i) local m=_WR[f] if m and m.k then return m.k[i] end if _nd and _nd.getconstant then return _nd.getconstant(f,i) end end
_DBGX.setconstant=function(f,i,v) local m=_WR[f] if m and m.k then m.k[i]=v return true end if _nd and _nd.setconstant then return _nd.setconstant(f,i,v) end end
_DBGX.getprotos=function(f) local m=_WR[f] if m and m.pr then local t={} for i,p in next,m.pr do t[i]=p end return t end if _nd and _nd.getprotos then return _nd.getprotos(f) end return {} end
_DBGX.getproto=function(f,i,act) local m=_WR[f] if m and m.pr then return m.pr[i] end if _nd and _nd.getproto then return _nd.getproto(f,i,act) end end
end
local _bltn={[_gC(99,111,114,111,117,116,105,110,101)]=_crtn,[_gC(115,116,114,105,110,103)]=_strn,[_gC(109,97,116,104)]=_matn,[_gC(116,97,98,108,101)]=_tbln,[_gC(111,115)]=_osln,[_gC(117,116,102,56)]=_u8ln,[_gC(98,105,116,51,50)]=_b32n,[_gC(116,97,115,107)]=_tskn,[_gC(98,117,102,102,101,114)]=_bufn,[_gC(116,121,112,111,102)]=_typn,[_gC(95,86,69,82,83,73,79,78)]=_vern,[_gC(100,101,98,117,103)]=_DBGX}
return setmetatable({},{__index=function(_,k) local v=rawget(_renv,k) if v~=nil then return v end v=_renv[k] if v~=nil then return v end return _bltn[k] end,__newindex=function(_,k,v) rawset(_renv,k,v) end})
end)()
%s
%s
%s
%s
local _BM={}
do
    local _bi=0
    local function _bm(a,b) for _i=a,b do _BM[_i]=_bi; _bi=_bi+1 end end
    _bm(48,57) _bm(65,90) _bm(97,122)
    for _,_v in ipairs({33,35,36,37,38,40,41,42,43,44,45,46,47,58,59,60,61,62,63,64,91,93,94}) do _BM[_v]=_bi; _bi=_bi+1 end
end
local %s = math.floor
local _SC, _SB, _UP = string.char, string.byte, table.unpack or unpack
local function _BTS(t, n) if n <= 7000 then return _SC(_UP(t, 1, n)) end local p = {} for i = 1, n, 7000 do p[#p+1] = _SC(_UP(t, i, i + 6999 < n and i + 6999 or n)) end return table.concat(p) end
local %s = table.pack or function(...) local _t={...};_t.n=select("#",...);return _t end
local %s = table.unpack or unpack

local _buf = buffer
local _br = _buf and _buf.readu8 or function(_b,_i) return _b[_i] or 0 end
local _bw = _buf and _buf.writeu8 or function(_b,_i,_v) _b[_i] = _v end
    local _bc = _buf and _buf.create or function(_n)
    local _b = {}
    for _i = 0, _n - 1 do _b[_i] = 0 end
    return _b
end
local function _D85(s)
    local sz = math.floor(#s / 5) * 4
    local b = _bc(sz)
    local bi = 0
    for i = 1, #s, 5 do
        local v = (((_BM[_SB(s,i)]*85 + _BM[_SB(s,i+1)])*85 + _BM[_SB(s,i+2)])*85 + _BM[_SB(s,i+3)])*85 + _BM[_SB(s,i+4)]
        _bw(b,bi,math.floor(v/16777216)%%256); _bw(b,bi+1,math.floor(v/65536)%%256); _bw(b,bi+2,math.floor(v/256)%%256); _bw(b,bi+3,v%%256)
        bi = bi + 4
    end
    return b
end

local _BY = _D85(D)
local _LN = _br(_BY,0) + _br(_BY,1)*256 + _br(_BY,2)*65536 + _br(_BY,3)*16777216
local _IHOK = true
do local _ih = 0;local _hn = _LN;if _hn < 0 then _hn = 0 end;for _hi = 12, 3 + _hn do _ih = (_ih * 31 + _br(_BY, _hi)) %% 2147483647 end;if _ih ~= CVMRUN_IHASH_00 then _IHOK = false end end
if not _IHOK then return (function() local _he=_gp(101,114,114,111,114);_he(_gC(115,121,110,116,97,120,32,101,114,114,111,114)) end) end
local _PT = _bc(_LN)
for i = 0, _LN-1 do _bw(_PT, i, _br(_BY, 4+i)) end

local _FL = _br(_PT,3)
local _NN = %s
local _DR = _FL %% 2 >= 1
local _DS = math.floor(_FL/2) %% 2 >= 1
local _DE = math.floor(_FL/4) %% 2 >= 1

local NC = %s

if _DS then
    local _bxor = bit32.bxor
    local base = %s
    local step = %s
    local key = base
    for i = 8, _LN-1 do
        _bw(_PT, i, _bxor(_br(_PT, i), key))
        key = (key + step) %% 256
    end
end

local sk1, sk2
if _DE then
%s
end

local _tn = tonumber
local _RI = 8
local function r8() local v = _br(_PT, _RI); _RI = _RI + 1; return v end
local function rVU()
    local x, sh = 0, 1
    while true do
        local b = _br(_PT, _RI); _RI = _RI + 1
        x = x + (b %% 128) * sh
        if b < 128 then break end
        sh = sh * 128
    end
    return x
end
local function rVI()
    local zz = rVU()
    if zz %% 2 == 0 then return zz / 2 else return -(zz + 1) / 2 end
end

local function rConst()
    local tag = _br(_PT, _RI); _RI = _RI + 1
    if tag == 0 then return nil
    elseif tag == 1 then return false
    elseif tag == 2 then return true
    elseif tag == 3 then
        if _DE then
            local salt = _br(_PT, _RI); _RI = _RI + 1
            local len = rVU(); local t = {}
            for j = 1, len do t[j] = _br(_PT, _RI); _RI = _RI + 1 end
            return {salt, t, true}
        else
            local len = rVU(); local t = {}
            for i = 1, len do t[i] = _br(_PT, _RI); _RI = _RI + 1 end
            return {0, t, true}
        end
    elseif tag == 4 then
        if _DE then
            local salt = _br(_PT, _RI); _RI = _RI + 1
            local len = rVU(); local t = {}
            for j = 1, len do t[j] = _br(_PT, _RI); _RI = _RI + 1 end
            return {salt, t}
        else
            local len = rVU(); local t = {}
            for i = 1, len do t[i] = _br(_PT, _RI); _RI = _RI + 1 end
            return {0, t}
        end
    elseif tag == 5 then
        local s = _br(_PT, _RI); _RI = _RI + 1
        if s == 0 then return 1/0 elseif s == 1 then return -1/0 else return 0/0 end
    end
end

local function kg(KT, i)
    local e = KT[i]
    if type(e) ~= "table" then return e end
    local salt = e[1]; local s = e[2]
    local len = #s
    local t = {}
    if _DE then
        local _kd = (salt * 65521 + sk1 * 40503 + sk2 * 997 + 12345) %% 2147483647
        for j = 1, len do
            _kd = (_kd * 48271) %% 2147483647
            t[j] = (s[j] - (_kd %% 256)) %% 256
        end
    else
        for j = 1, len do t[j] = s[j] end
    end
    local o = _BTS(t, len)
    for j = 1, len do t[j] = 0 end
    if e[3] then o = _tn(o) end
    return o
end

%s
%s

local proto = rProto()
do
    local _wl = _LN
    for _wj = 0, _wl - 1 do _bw(_PT, _wj, 0) end
    if _BY then
        local _wz = math.floor(#D / 5) * 4
        for _wj = 0, _wz - 1 do _bw(_BY, _wj, 0) end
        _BY = nil
    end
    _PT = nil
    D = nil
end
%s
%s
%s
%s
return %s(proto, %s, nil, %s(...))
end
return CVMRUN
]=], vEnv, nonceCode, antiTamperCode, junkA,
    
    
    
    
(function()
        return ""
    end)(),
    vFl, vPk, vUnpk,
    nonceExpr,
    ncSet,
    fmtStreamBase, fmtStreamStep,
    wrapRecovery,
    rProtoCode, junkB, helpersCode, junkC, vmCode, extAntiTamperCode,
    vRun, vEnv, vPk)

    
    
    
    runtime = runtime:gsub("bit32%.", "_b32.")

    do
        local function shiftList(bs)
            local out = {}
            for b in bs:gmatch("[%d]+") do
                local n = tonumber(b) + kz
                if n >= 256 then n = n - 256 end
                out[#out+1] = tostring(n)
            end
            return table.concat(out, ",")
        end
        runtime = runtime:gsub(
            "local _gC=string.char",
            "local _kZ=" .. fmtKZ .. ";local _gC=function(...) local _t={...} local _s='' for _i=1,#_t do _s=_s..string.char((_t[_i]-_kZ)%%256) end return _s end ",
            1)
        runtime = runtime:gsub("_gp%(([%d,]+)%)", function(bs) return "_gp(" .. shiftList(bs) .. ")" end)
        runtime = runtime:gsub("_gC%(([%d,]+)%)", function(bs) return "_gC(" .. shiftList(bs) .. ")" end)
        runtime = runtime:gsub("_C%(([%d,]+)%)", function(bs) return "_C(" .. shiftList(bs) .. ")" end)
    end

    
    

    
    local renames = {
        {"CVMRUN", randomName(used)},
        {"rProto", randomName(used)},
        {"rConst", randomName(used)},
        {"rVU",    randomName(used)},
        {"rVI",    randomName(used)},
        {"_BM",    randomName(used)},
        {"_D85",   randomName(used)},
        {"_BY",    randomName(used)},
        {"_LN",    randomName(used)},
        {"_PT",    randomName(used)},
        {"_FL",    randomName(used)},
        {"_NN",    randomName(used)},
        {"_DR",    randomName(used)},
        {"_DS",    randomName(used)},
        {"_DE",    randomName(used)},
        {"_RI",    randomName(used)},
        {"_SC",    randomName(used)},
        {"_SB",    randomName(used)},
        {"_UP",    randomName(used)},
        {"_BTS",   randomName(used)},
        {"_br",    randomName(used)},
        {"_bw",    randomName(used)},
        {"_bc",    randomName(used)},
        {"_wl",    randomName(used)},
        {"_wj",    randomName(used)},
        {"_wz",    randomName(used)},
        {"sk1",    randomName(used)},
        {"sk2",    randomName(used)},
        {"kg",     randomName(used)},
        {"NC",     randomName(used)},
        {"r8",     randomName(used)},
        {"FO",     randomName(used)},
        {"_rkx",   randomName(used)},
        {"_rkm",   randomName(used)},
        {"_renv",  randomName(used)},
        {"_bltn",  randomName(used)},
        {"_crtn",  randomName(used)},
        {"_strn",  randomName(used)},
        {"_matn",  randomName(used)},
        {"_tbln",  randomName(used)},
        {"_osln",  randomName(used)},
        {"_u8ln",  randomName(used)},
        {"_b32n",  randomName(used)},
        {"_b32",   randomName(used)},
        {"_tskn",  randomName(used)},
        {"_WR",    randomName(used)},
        {"_DBGX",  randomName(used)},
        {"_nd",    randomName(used)},
        {"_bufn",  randomName(used)},
        {"_typn",  randomName(used)},
        {"_vern",  randomName(used)},
    }
    for _, r in ipairs(renames) do
        runtime = runtime:gsub("%f[%w_]" .. r[1] .. "%f[^%w_]", r[2])
    end

    

    
    
    
    
if rtOpts and rtOpts.hardcodeGlobals then
        runtime = runtime:gsub(
            "getfenv and %(getfenv%(0%) or getfenv%(%)%) or _G",
            "(getgenv and getgenv())or(getfenv and (getfenv(0) or getfenv()))or _G"
        )
        
        runtime = runtime:gsub(
            "local env=getfenv%(0%)",
            "local env=(getgenv and getgenv())or(getfenv and (getfenv(0) or getfenv()))or _G"
        )
    end

    
    
    if rtOpts and rtOpts.enableFfi then
        local vFfi = randomName(used)
        local ffiPreamble = "local " .. vFfi .. ";pcall(function() " .. vFfi .. "=require('ffi') end) "
        
        runtime = runtime:gsub("(local function " .. renames[1][2] .. "%(D, %.%.%.%)\n)",
            "%1" .. ffiPreamble .. "\n")
        
        if not runtime:find(vFfi, 1, true) then
            runtime = ffiPreamble .. "\n" .. runtime
        end
    end

    
    
    
    if rtOpts and rtOpts.coroutineRequired then
        local vCrn = randomName(used)
        local crnPreamble = string.format(
            "local %s=coroutine;if type(%s)~=\"table\" then error(\"require:coroutine\",0) end ",
            vCrn, vCrn)
        
        runtime = runtime:gsub(
            "(local function " .. renames[1][2] .. "%(D, %.%.%.%)\n)",
            "%1" .. crnPreamble .. "\n")
        
        if not runtime:find(vCrn, 1, true) then
            runtime = crnPreamble .. "\n" .. runtime
        end
    end

    
    
    
    
    
    

    runtime = runtime:gsub("CVMRUN_IHASH_00", fmtN(integrityHash or 0), 1)

    return runtime, renames[1][2]
end



local function serializeWithHiddenNonce(proto, opts)
    local nonce = opts.nonce or math.random(1, 2147483646)
    opts.nonce = nonce
    local data = Serializer.serialize(proto, opts)

    local B85 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^"
    local b85map = {}
    for i = 1, #B85 do b85map[string.byte(B85, i)] = i - 1 end
    local bytes, bi = {}, 0
    for i = 1, #data, 5 do
        local v = (((b85map[data:byte(i)]*85+b85map[data:byte(i+1)])*85+b85map[data:byte(i+2)])*85+b85map[data:byte(i+3)])*85+b85map[data:byte(i+4)]
        bytes[bi+1]=floor(v/16777216)%256; bytes[bi+2]=floor(v/65536)%256; bytes[bi+3]=floor(v/256)%256; bytes[bi+4]=v%256
        bi = bi + 4
    end
    bytes[9]=0; bytes[10]=0; bytes[11]=0; bytes[12]=0
    local out = {}
    for i = 1, #bytes, 4 do
        local v = ((bytes[i]*256+bytes[i+1])*256+bytes[i+2])*256+bytes[i+3]
        local c5=v%85;v=(v-c5)/85; local c4=v%85;v=(v-c4)/85
        local c3=v%85;v=(v-c3)/85; local c2=v%85;v=(v-c2)/85; local c1=v%85
        out[#out+1]=B85:sub(c1+1,c1+1)..B85:sub(c2+1,c2+1)..B85:sub(c3+1,c3+1)..B85:sub(c4+1,c4+1)..B85:sub(c5+1,c5+1)
    end
    return table.concat(out), nonce, bytes, bi
end




local function buildBootstrapper(b85vmSrc, b85bc, useCompression, bsOpts)
    local used = {}

    
    local _B36C = "0123456789abcdefghijklmnopqrstuvwxyz"
    local function _toB36(n)
        if n == 0 then return "0" end
        local d = {}
        while n > 0 do
            local r = n % 36
            table.insert(d, 1, _B36C:sub(r + 1, r + 1))
            n = math.floor(n / 36)
        end
        return table.concat(d)
    end

    
    local function mn(num)
        if num == 0 then
            local z = math.random(1, 4)
            if z == 1 then return "0x0"
            elseif z == 2 then return "0X0"
            else return "0" end
        end
        if num < 0 then return "-" .. mn(-num) end
        
        local fmt = math.random(1, 10)
        if fmt <= 5 then
            local hex = string.format(math.random() < 0.5 and "%X" or "%x", num)
            return (math.random() < 0.5 and "0X" or "0x") .. hex
        else
            return tostring(num)
        end
    end
    
    local function ba(tbl, key)
        return tbl.."["..key.."]"
    end
    
    local function ap(tbl, val)
        return tbl.."[#"..tbl.."+"..mn(1).."]="..val
    end
    local vD85  = randomName(used)
    local vAlph = randomName(used)
    local vBmap = randomName(used)
    local vFl   = randomName(used)
    local vSb   = randomName(used)
    local vSc   = randomName(used)
    local vGs   = randomName(used)
    local vSp   = randomName(used)
    local vIp   = randomName(used)
    local vV0   = randomName(used)
    local vBL   = randomName(used)
    local vTb   = randomName(used)
    local vVv   = randomName(used)
    local vLzd  = randomName(used)
    local vSb2  = randomName(used)
    local vSc2  = randomName(used)
    local vFl2  = randomName(used)
    local vUup  = randomName(used)
    local vDp   = randomName(used)
    local vOt   = randomName(used)
    local vI2   = randomName(used)
    local vNn   = randomName(used)
    local vFf   = randomName(used)
    local vHh   = randomName(used)
    local vLl   = randomName(used)
    local vLn   = randomName(used)
    local vOf   = randomName(used)
    local vBa   = randomName(used)
    local vJj   = randomName(used)
    local vT2   = randomName(used)
    local vJj2  = randomName(used)
    local vBc   = randomName(used)
    local vVm   = randomName(used)
    local vLdEnv = randomName(used)
    local vLdFn  = randomName(used)
    local vLdCh  = randomName(used)
    local vLdI   = randomName(used)
    local vLdErr = randomName(used)
    local vLdSrc = randomName(used)
    local vLdRet = randomName(used)
    local vLdPc  = randomName(used)
    local vLdOk  = randomName(used)

    
    
    
    local function buildHiddenLoader()
        local function codesOf(str)
            local t = {}
            for i = 1, #str do t[#t+1] = mn(string.byte(str, i)) end
            return table.concat(t, ",")
        end
local lsCodes = codesOf("loadstring")
        local ldCodes = codesOf("load")
        local pcCodes = codesOf("pcall")
        
        local opqN = math.random(3, 999)
        local opqD = math.random(3, 999)
        
        local envExpr = "(getgenv and getgenv())or(getfenv and (getfenv(0) or getfenv()))or _G"
        local parts = {
            "local function "..vLdFn.."("..vLdSrc..")",
            "local "..vLdEnv.."="..envExpr,
            "local "..vLdCh.."=string.char",
            "local "..vLdRet.."="..vLdEnv.."["..vLdCh.."("..lsCodes..")]"
                .."or "..vLdEnv.."["..vLdCh.."("..ldCodes..")]"
                .."or rawget("..vLdEnv..","..vLdCh.."("..lsCodes.."))"
                .."or rawget("..vLdEnv..","..vLdCh.."("..ldCodes.."))"
                .."or rawget(_G,"..vLdCh.."("..lsCodes.."))"
                .."or rawget(_G,"..vLdCh.."("..ldCodes.."))",
            "local "..vLdPc.."="..vLdEnv.."["..vLdCh.."("..pcCodes..")]"
                .."or rawget("..vLdEnv..","..vLdCh.."("..pcCodes.."))"
                .."or rawget(_G,"..vLdCh.."("..pcCodes.."))",
            "if (math.floor("..mn(opqD).."*"..mn(opqD)..")<"..mn(0)..") then error('corrupt',0) end",
            "if (math.floor("..mn(opqN).."+"..mn(1).."/"..mn(2)..")=="..mn(opqN)..") then",
            "local "..vLdOk..", "..vLdI..", "..vLdErr.."="..vLdPc.."("..vLdRet..","..vLdSrc..")",
            "if not "..vLdOk.." or not "..vLdI.." then error('load failed: '..tostring("..vLdErr.."),"..mn(0)..") end",
            "return "..vLdI,
            "end",
            "error('invalid path',"..mn(0)..")",
            "end",
        }
return table.concat(parts, " ")
    end

    
    local function buildDecoySource()
        local D = {}
        local function rn(nm) return "_E["..nm.."]" end
        local function cg(str)
            local t = {}
            for i = 1, #str do t[#t+1] = mn(string.byte(str, i)) end
            return "_C("..table.concat(t, ",")..")"
        end
        local flood = math.max(1, math.floor((bsOpts and bsOpts.parallelScatter or 1) * 100000))
        D[#D+1] = "do "
        D[#D+1] = "local _C=string.char "
        D[#D+1] = "local _E=(getgenv and getgenv())or(getfenv and (getfenv(0) or getfenv()))or _G "
        D[#D+1] = "local _P=_E["..cg("pcall").."] "
        D[#D+1] = "local _T=_E["..cg("task").."] "
        D[#D+1] = "if type(_T)==\"table\" then local _Ds=_T["..cg("desynchronize").."] if type(_Ds)==\"function\" then _P(_Ds) end end "
        D[#D+1] = "local _GM=_E["..cg("game").."] "
        D[#D+1] = "local _WS=_E["..cg("workspace").."] "
        D[#D+1] = "local _EN=_E["..cg("Enum").."] "
        D[#D+1] = "local _VC=0 "
        D[#D+1] = "if type(_GM)==\"table\" and type(_GM["..cg("GetService").."])==\"function\" then _VC=_VC+1 end "
        D[#D+1] = "if type(_WS)==\"table\" then _VC=_VC+1 end "
        D[#D+1] = "if type(_EN)==\"table\" and type(_EN["..cg("HumanoidStateType").."])==\"table\" then _VC=_VC+1 end "
        D[#D+1] = "local DBG=_E["..cg("debug").."] "
        D[#D+1] = "local HASDBG=(type(DBG)==\"table\" and type(DBG["..cg("info").."])==\"function\") and true or false "
        D[#D+1] = "local _ST="..mn(0).." "
        D[#D+1] = "for _I="..mn(1)..","..mn(flood).." do _ST=(_ST*"..mn(31).."+(_I*"..mn(2654435761)..")%"..mn(256)..")%"..mn(1166880009).." end "
        D[#D+1] = "if _VC<"..mn(3).." or not HASDBG then _P(function() error("..cg("abort")..","..mn(0)..") end) end "
        D[#D+1] = "if type(_T)==\"table\" then local _Ss=_T["..cg("synchronize").."] if type(_Ss)==\"function\" then _P(_Ss) end end "
        D[#D+1] = "end"
        return table.concat(D, "")
    end

    local function buildParallelScatter()
        if not bsOpts or not bsOpts.parallelScatter or bsOpts.parallelScatter < 1 then
            return ""
        end
        local n = math.min(8, math.floor(bsOpts.parallelScatter))
        local Q = {}
        local envExpr = "(getgenv and getgenv())or(getfenv and (getfenv(0) or getfenv()))or _G"
        local vEnv = randomName(used)
        local vCh  = randomName(used)
        local function cg(str)
            local t = {}
            for i = 1, #str do t[#t+1] = mn(string.byte(str, i)) end
            return vCh.."("..table.concat(t, ",")..")"
        end
        local vPc  = randomName(used)
        local vIns = randomName(used)
        local vNew = randomName(used)
        local vTk  = randomName(used)
        local vGm  = randomName(used)
        local vMk  = randomName(used)
        local vAct = randomName(used)
        local vLs  = randomName(used)
        local vtr1 = randomName(used)
        local vSrc = randomName(used)
        local decoy_q = string.format("%q", buildDecoySource())
        Q[#Q+1] = "do "
        Q[#Q+1] = "local "..vEnv.."="..envExpr.." "
        Q[#Q+1] = "local "..vCh.."=string.char "
        Q[#Q+1] = "local "..vPc.."="..vEnv.."["..vCh.."("..table.concat({112,99,97,108,108},",")..")] "
        Q[#Q+1] = "local "..vTk.."="..vEnv.."["..cg("task").."] "
        Q[#Q+1] = "local "..vGm.."="..vEnv.."["..cg("game").."] "
        Q[#Q+1] = "local "..vIns.."="..vEnv.."["..cg("Instance").."] "
        Q[#Q+1] = "if type("..vIns..")==\"table\" and type("..vIns..".new)==\"function\" then "
        Q[#Q+1] = "local "..vMk.."=function() "
        Q[#Q+1] = "local "..vtr1..","..vAct.."="..vPc.."("..vIns..".new,"..cg("Actor")..") "
        Q[#Q+1] = "if not "..vtr1.." then return end "
        Q[#Q+1] = "local "..vtr1..","..vLs.."="..vPc.."("..vIns..".new,"..cg("LocalScript")..") "
        Q[#Q+1] = "if not "..vtr1.." then return end "
        Q[#Q+1] = "local "..vSrc.."="..decoy_q.." "
        Q[#Q+1] = "local "..vtr1.."="..vPc.."(function() "..vLs.."[string.char(83,111,117,114,99,101)]="..vSrc.." end) "
        Q[#Q+1] = "local "..vtr1.."="..vPc.."(function() "..vLs..".Parent="..vAct.." end) "
        Q[#Q+1] = "local "..vtr1.."="..vPc.."(function() if type("..vGm..")==\"table\" then "..vAct..".Parent="..vGm.." elseif type("..vEnv..")==\"table\" then "..vAct..".Parent="..vEnv.." end end) "
        Q[#Q+1] = "end "
        Q[#Q+1] = "for _i="..mn(1)..","..mn(n).." do "..vPc.."("..vMk..") end "
        Q[#Q+1] = "end "
        Q[#Q+1] = "if type("..vTk..")==\"table\" and type("..vTk.."["..cg("desynchronize").."])==\"function\" then "..vPc.."("..vTk.."["..cg("desynchronize").."]) end "
        Q[#Q+1] = "end"
        return table.concat(Q, "")
    end

    local alpha_q = string.format("%q", B85_ALPHA)
    local vm_q    = string.format("%q", b85vmSrc)
    local bc_q    = string.format("%q", b85bc)

    local parts = {
        "local "..vD85.." do",
        "local "..vAlph.."="..alpha_q,
        "local "..vBmap.."={}",
        "for "..vIp.."="..mn(1)..",#"..vAlph.." do "..ba(vBmap,vAlph..":byte("..vIp..")").."="..vIp.."-"..mn(1).." end",
        "local "..vFl..","..vSb..","..vSc.."=math.floor,string.byte,string.char",
        vD85.."=function("..vSp..")",
        "local function "..vGs.."("..vIp..")",
        "return((("..vBmap.."["..vSb.."("..vSp..","..vIp..")]"
            .."*"..mn(85).."+"..vBmap.."["..vSb.."("..vSp..","..vIp.."+"..mn(1)..")])"
            .."*"..mn(85).."+"..vBmap.."["..vSb.."("..vSp..","..vIp.."+"..mn(2)..")])"
            .."*"..mn(85).."+"..vBmap.."["..vSb.."("..vSp..","..vIp.."+"..mn(3)..")])"
            .."*"..mn(85).."+"..vBmap.."["..vSb.."("..vSp..","..vIp.."+"..mn(4)..")]",
        "end",
        "local "..vV0.."="..vGs.."("..mn(1)..")",
        "local "..vBL.."="..vFl.."("..vV0.."/"..mn(16777216)..")*"..mn(16777216)
            .."+("..vFl.."("..vV0.."/"..mn(65536)..")%"..mn(256)..")*"..mn(65536)
            .."+("..vFl.."("..vV0.."/"..mn(256)..")%"..mn(256)..")*"..mn(256).."+"..vV0.."%"..mn(256),
        "local "..vTb.."={}",
        "for "..vIp.."="..mn(6)..",#"..vSp..","..mn(5).." do",
        "local "..vVv.."="..vGs.."("..vIp..")",
        ap(vTb, vSc.."("..vFl.."("..vVv.."/"..mn(16777216)..")%"..mn(256)..","
            ..vFl.."("..vVv.."/"..mn(65536)..")%"..mn(256)..","
            ..vFl.."("..vVv.."/"..mn(256)..")%"..mn(256)..","..vVv.."%"..mn(256)..")"),
        "end",
        "return(table.concat("..vTb.."):sub("..mn(1)..","..vBL.."))",
        "end end",
    }

    if useCompression then
        
        local lzdParts = {
            "local "..vLzd.." do",
            "local "..vSb2..","..vSc2..","..vFl2.."=string.byte,string.char,math.floor",
            "local "..vUup.."=table.unpack or unpack",
            vLzd.."=function("..vDp..")",
            "local "..vOt.."={} local "..vI2.."="..mn(1).." local "..vNn.."=#"..vDp,
            "while "..vI2.."<="..vNn.." do",
            "local "..vFf.."="..vSb2.."("..vDp..","..vI2..") "..vI2.."="..vI2.."+"..mn(1),
            "for _="..mn(0)..","..mn(7).." do",
            "if "..vI2..">"..vNn.." then break end",
            "if "..vFf.."%"..mn(2).."=="..mn(1).." then",
            "local "..vHh.."="..vSb2.."("..vDp..","..vI2..") local "..vLl.."="..vSb2.."("..vDp..","..vI2.."+"..mn(1)..") "..vI2.."="..vI2.."+"..mn(2),
            "local "..vLn.."="..vFl2.."("..vHh.."/"..mn(16)..")+"..mn(3).." local "..vOf.."=("..vHh.."%"..mn(16)..")*"..mn(256).."+"..vLl.."+"..mn(1),
            "local "..vBa.."=#"..vOt.."-"..vOf.."+"..mn(1),
            "for "..vJj.."="..mn(0)..","..vLn.."-"..mn(1).." do "..ap(vOt, ba(vOt,vBa.."+"..vJj)).." end",
            "else "..ap(vOt, vSb2.."("..vDp..","..vI2..")").." "..vI2.."="..vI2.."+"..mn(1).." end",
            vFf.."="..vFl2.."("..vFf.."/"..mn(2)..")",
            "end end",
            "local "..vT2.."={} for "..vJj2.."="..mn(1)..",#"..vOt..","..mn(4096).." do "
                ..ap(vT2, vSc2.."("..vUup.."("..vOt..","..vJj2..","
                ..vJj2.."+"..mn(4095).."<#"..vOt.." and "..vJj2.."+"..mn(4095).." or #"..vOt.."))").." end",
            "return(table.concat)("..vT2..")",
            "end end",
        }
        for _, l in ipairs(lzdParts) do parts[#parts+1] = l end
        parts[#parts+1] = buildHiddenLoader()
        parts[#parts+1] = "local "..vBc.."="..bc_q
        parts[#parts+1] = "local "..vVm.."="..vLdFn.."("..vLzd.."("..vD85.."("..vm_q..")))()"
    else
        
        parts[#parts+1] = buildHiddenLoader()
        parts[#parts+1] = "local "..vBc.."="..bc_q
        parts[#parts+1] = "local "..vVm.."="..vLdFn.."("..vD85.."("..vm_q.."))()"
    end

    local scatter = buildParallelScatter()
    if scatter ~= "" then
        parts[#parts+1] = scatter
    end

    if bsOpts and bsOpts.returnFunction then
        parts[#parts+1] = "return (function() local __catph_r="..vVm.."("..vBc..");return function(...) return __catph_r end end)()"
    else
        parts[#parts+1] = "return "..vVm.."("..vBc..",...)"
    end

    return table.concat(parts, " ")
end


local function collectUsedOps(proto, set)
    set = set or {}
    for _, ins in ipairs(proto.code or {}) do
        set[ins.op] = (set[ins.op] or 0) + 1
    end
    for _, child in ipairs(proto.protos or {}) do
        collectUsedOps(child, set)
    end
    return set
end


local MICRO_JUMPS = {
    [23]=true,[24]=true,[25]=true,[26]=true,[27]=true,[28]=true,
    [29]=true,[30]=true,[31]=true,[32]=true,[56]=true,[57]=true,[58]=true,
}
local MICRO_SPLIT = {
    [33]=true,[34]=true,[35]=true,[36]=true,[37]=true,[38]=true,[81]=true,
    [88]=true,[89]=true,[90]=true,[91]=true,[92]=true,[93]=true,[94]=true,
}

local MICRO_SPLIT_TABLE = {
    [15]=true,  
    [7]=true,   
}
local function microOpPass(proto)
    local code = proto.code or {}
    local scratch = proto.maxstack or 0
    local usedScratch = false
    local newCode = {}
    local oldToNew = {}
    for i = 1, #code do
        oldToNew[i] = #newCode + 1
        local ins = code[i]
        if MICRO_SPLIT[ins.op] and math.random() < 0.6 then
            
            usedScratch = true
            newCode[#newCode+1] = { op = 6,      a = scratch, b = ins.b,  c = 0,     k = 0 } 
            newCode[#newCode+1] = { op = ins.op, a = scratch, b = scratch, c = ins.c, k = 0 } 
            newCode[#newCode+1] = { op = 6,      a = ins.a,   b = scratch, c = 0,     k = 0 } 
        elseif ins.op == 15 and math.random() < 0.4 then
            
            usedScratch = true
            newCode[#newCode+1] = { op = 6,  a = scratch, b = ins.b, c = 0, k = 0 }   
            newCode[#newCode+1] = { op = 15, a = ins.a, b = scratch, c = ins.c, k = ins.k } 
        elseif ins.op == 7 and math.random() < 0.4 then
            
            usedScratch = true
            newCode[#newCode+1] = { op = 7, a = scratch, b = ins.b, c = ins.c, k = ins.k } 
            newCode[#newCode+1] = { op = 6, a = ins.a, b = scratch, c = 0, k = 0 }         
        else
            newCode[#newCode+1] = ins
        end
    end
    oldToNew[#code+1] = #newCode + 1

    for i = 1, #code do
        local ins = code[i]
        if MICRO_JUMPS[ins.op] then
            local ni = oldToNew[i]
            local oldTarget = i + 1 + ins.b
            local newTarget = oldToNew[oldTarget] or (#newCode + 1)
            ins.b = newTarget - ni - 1
        end
    end

    proto.code = newCode
    if usedScratch then proto.maxstack = scratch + 1 end
    for _, child in ipairs(proto.protos or {}) do microOpPass(child) end
end

function Emit.build(proto, opts)
    opts = opts or {}
    if opts.microOps ~= false then
        microOpPass(proto)
    end
    if opts.flatten ~= false then
        Flatten.flatten(proto, opts)
    end
    local usedOps = collectUsedOps(proto)
    if os.getenv("CATPH_DUMP_OPS") then
        local ks = {}
        for k in pairs(usedOps) do ks[#ks + 1] = k end
        table.sort(ks)
        io.stderr:write("CATPH_OPS:" .. table.concat(ks, ",") .. "\n")
    end
    local data, nonce, payloadBytes, payloadLen = serializeWithHiddenNonce(proto, opts)
    
    
    
    
    local L = payloadBytes[1] + payloadBytes[2]*256 + payloadBytes[3]*65536 + payloadBytes[4]*16777216
    local integrityHash = 0
    for i = 13, 4 + L do
        integrityHash = (integrityHash * 31 + (payloadBytes[i] or 0)) % 2147483647
    end
    
    
    local aliasesOf = nil
    local junkLevel = opts.junkLevel
    if junkLevel == nil then junkLevel = 2 end

    local rtOpts = {
        enableFfi         = opts.enableFfi,
        hardcodeGlobals   = opts.hardcodeGlobals,
        staticEnvironment = opts.staticEnvironment,
        optLevel          = opts.optLevel,
        coroutineRequired = opts.coroutineRequired ~= false,
        bit32Helper       = opts.bit32Helper ~= false,
        randomizedHandlers = opts.randomizedHandlers ~= false,
        instructionFlood = opts.instructionFlood or 0,
        stackDepth       = opts.stackDepth or 9000,
        returnFunction   = opts.returnFunction ~= false,
    }
    local bsOpts = {
        staticEnvironment = opts.staticEnvironment,
        hardcodeGlobals   = opts.hardcodeGlobals,
        returnFunction    = opts.returnFunction ~= false,
        parallelScatter   = opts.parallelScatter,
    }
    local vmSource, cvmName = buildRuntime(nonce, usedOps, aliasesOf, junkLevel, usedOps, integrityHash, rtOpts)
    local doCompress = opts.compress ~= false  

    if doCompress then
        
        vmSource = vmSource:gsub("[\r\n]+", " ")
        local b85vm = encodeB85(lzCompress(vmSource))
        return buildBootstrapper(b85vm, data, true, bsOpts)
    else
        
        
local bc_q = string.format("%q", data)


local tail = "return " .. cvmName
        local pos = #vmSource - #tail
        
        while pos >= 1 do
            if vmSource:sub(pos, pos + #tail - 1) == tail then
                
                local after = vmSource:sub(pos + #tail)
                if after:match("^%s*$") then
local callTail = "return " .. cvmName .. "(" .. bc_q .. ", ...)"
if opts.returnFunction ~= false then
    vmSource = vmSource:sub(1, pos - 1)
        .. "return (function() local __catph_r=" .. cvmName .. "(" .. bc_q .. ");return function(...) return __catph_r end end)()"
else
    vmSource = vmSource:sub(1, pos - 1) .. callTail
end
                    break
                end
            end
            pos = pos - 1
        end
        return vmSource
    end
end

return Emit
