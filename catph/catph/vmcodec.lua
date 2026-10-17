


































local Vmcodec = {}


local B85 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^"
Vmcodec.B85 = B85









local LZW_RESET = 256
local LZW_FIRST = 257
local LZW_MAX   = 32768  


function Vmcodec.lzwCompress(input)
    local dict = {}
    local codes = {}
    local nextCode = LZW_FIRST
    local w = -1

    
    local function resetDict()
        for k in pairs(dict) do dict[k] = nil end
        nextCode = LZW_FIRST
    end

    for i = 1, #input do
        local byte = string.byte(input, i)
        if w == -1 then
            w = byte
        else
            local key = w * 256 + byte
            local existing = dict[key]
            if existing then
                w = existing
            else
                codes[#codes + 1] = w
                if nextCode < LZW_MAX then
                    dict[key] = nextCode
                    nextCode = nextCode + 1
                else
                    
                    codes[#codes + 1] = LZW_RESET
                    resetDict()
                end
                w = byte
            end
        end
    end
    if w ~= -1 then codes[#codes + 1] = w end
    return codes
end


function Vmcodec.bytesFromCodes(codes)
    local bytes = {}
    local n = 0
    for i = 1, #codes do
        local code = codes[i]
        bytes[n + 1] = code % 256
        bytes[n + 2] = math.floor(code / 256) % 256
        n = n + 2
    end
    return bytes
end


function Vmcodec.stringToBytes(s)
    local bytes = {}
    for i = 1, #s do bytes[i] = string.byte(s, i) end
    return bytes
end









function Vmcodec.b85Encode(bytes)
    local n = #bytes
    local data = {
        n % 256,
        math.floor(n / 256) % 256,
        math.floor(n / 65536) % 256,
        math.floor(n / 16777216) % 256,
    }
    for i = 1, n do data[#data + 1] = bytes[i] end
    while #data % 4 ~= 0 do data[#data + 1] = 0 end

    local out = {}
    for i = 1, #data, 4 do
        local v = ((data[i] * 256 + data[i + 1]) * 256 + data[i + 2]) * 256 + data[i + 3]
        local c5 = v % 85; v = math.floor(v / 85)
        local c4 = v % 85; v = math.floor(v / 85)
        local c3 = v % 85; v = math.floor(v / 85)
        local c2 = v % 85; v = math.floor(v / 85)
        local c1 = v % 85
        out[#out + 1] = string.sub(B85, c1 + 1, c1 + 1)
            .. string.sub(B85, c2 + 1, c2 + 1)
            .. string.sub(B85, c3 + 1, c3 + 1)
            .. string.sub(B85, c4 + 1, c4 + 1)
            .. string.sub(B85, c5 + 1, c5 + 1)
    end
    return table.concat(out)
end



local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
Vmcodec.B64 = B64




function Vmcodec.base64Encode(bytes)
    local n = #bytes
    local data = {
        n % 256,
        math.floor(n / 256) % 256,
        math.floor(n / 65536) % 256,
        math.floor(n / 16777216) % 256,
    }
    for i = 1, n do data[#data + 1] = bytes[i] end

    local out = {}
    local total = #data
    for i = 1, total, 3 do
        local b1 = data[i] or 0
        local b2 = data[i + 1] or 0
        local b3 = data[i + 2] or 0
        local trip = b1 * 65536 + b2 * 256 + b3
        local c1 = math.floor(trip / 262144) % 64
        local c2 = math.floor(trip / 4096) % 64
        local c3 = math.floor(trip / 64) % 64
        local c4 = trip % 64
        local rem = total - i + 1
        out[#out + 1] = string.sub(B64, c1 + 1, c1 + 1)
            .. string.sub(B64, c2 + 1, c2 + 1)
            .. (rem >= 2 and string.sub(B64, c3 + 1, c3 + 1) or "=")
            .. (rem >= 3 and string.sub(B64, c4 + 1, c4 + 1) or "=")
    end
    return table.concat(out)
end



function Vmcodec.encode(source, algorithm, encoding)
    local bytes
    if algorithm == "none" then
        bytes = Vmcodec.stringToBytes(source)
    else
        bytes = Vmcodec.bytesFromCodes(Vmcodec.lzwCompress(source))
    end
    if encoding == "base64" then
        return Vmcodec.base64Encode(bytes)
    end
    return Vmcodec.b85Encode(bytes)
end







local _LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
local _ALNUM   = _LETTERS .. "0123456789"
local _RESERVED = {
    ["and"]=true,["break"]=true,["do"]=true,["else"]=true,["elseif"]=true,
    ["end"]=true,["false"]=true,["for"]=true,["function"]=true,["goto"]=true,
    ["if"]=true,["in"]=true,["local"]=true,["nil"]=true,["not"]=true,
    ["or"]=true,["repeat"]=true,["return"]=true,["then"]=true,["true"]=true,
    ["until"]=true,["while"]=true,["continue"]=true,
}
local function _rname(used)
    local n
    repeat
        local first = math.random(1, #_LETTERS)
        n = _LETTERS:sub(first, first)
        for _ = 2, math.random(2, 4) do
            local k = math.random(1, #_ALNUM)
            n = n .. _ALNUM:sub(k, k)
        end
    until not used[n] and not _RESERVED[n]
    used[n] = true
    return n
end





function Vmcodec.buildLoaderSource(encText, algorithm, encoding, chunkName)
    chunkName = chunkName or "=(compressed)"
    local used = {}
    
    local vA    = _rname(used)  
    local vSub  = _rname(used)
    local vByte = _rname(used)
    local vChar = _rname(used)
    local vFlr  = _rname(used)
    local vCat  = _rname(used)
    local vLut  = _rname(used)
    local vBytes= _rname(used)
    local vNb   = _rname(used)
    local vDlen = _rname(used)
    local vSrc  = _rname(used)
    local vI    = _rname(used)
    local vV    = _rname(used)
    local vLoadf= _rname(used)
    local vPc   = _rname(used)
    local vLok  = _rname(used)
    local vChunk= _rname(used)

    
    local blobLen = #encText
    local nParts = math.random(3, 5)
    local parts = {}
    local pos = 1
    for p = 1, nParts do
        local rem = nParts - p
        local sz
        if rem == 0 then
            sz = blobLen - pos + 1
        else
            local avg = math.floor((blobLen - pos + 1) / (rem + 1))
            sz = math.max(1, avg + math.random(-math.floor(avg * 0.3), math.floor(avg * 0.3)))
        end
        parts[p] = string.format("%q", encText:sub(pos, pos + sz - 1))
        pos = pos + sz
    end
    local blobExpr = table.concat(parts, "..")

    
    
    
    local lines = {}
    local function L(s) lines[#lines + 1] = s end

    
    local stdLocals = {
        "local " .. vSub  .. "=string.sub",
        "local " .. vChar .. "=string.char",
        "local " .. vFlr  .. "=math.floor",
        "local " .. vCat  .. "=table.concat",
    }
    
    for i = #stdLocals, 2, -1 do
        local j = math.random(1, i)
        stdLocals[i], stdLocals[j] = stdLocals[j], stdLocals[i]
    end
    for _, s in ipairs(stdLocals) do L(s) end

    
    L("local " .. vA .. "=" .. blobExpr)

    if encoding == "b85" then
        
        local keyA = math.random(10, 120)
        local keyB = math.random(1, 9)
        local key  = keyA + keyB
        local lutEntries = {}
        for i = 1, #B85 do
            
            lutEntries[#lutEntries + 1] = string.format("[0x%X]=0x%X", string.byte(B85, i), i - 1)
        end
        
        for i = #lutEntries, 2, -1 do
            local j = math.random(1, i)
            lutEntries[i], lutEntries[j] = lutEntries[j], lutEntries[i]
        end
        L("local " .. vLut  .. "={" .. table.concat(lutEntries, ",") .. "}")
        L("local " .. vBytes .. "={}")
        L("local " .. vNb .. "=0")
        
        local vBI = _rname(used)
        L("for " .. vI .. "=1,#" .. vA .. ",5 do")
        L("local " .. vBI .. "=string.byte(" .. vA .. "," .. vI .. "," .. vI .. "+4)")
        
        local c1,c2,c3,c4,c5 = _rname(used),_rname(used),_rname(used),_rname(used),_rname(used)
        
        
        
        lines[#lines] = nil 
        L("local " .. c1 .. "," .. c2 .. "," .. c3 .. "," .. c4 .. "," .. c5
            .. "=string.byte(" .. vA .. "," .. vI .. "," .. vI .. "+4)")
        L("local " .. vV .. "=((((" .. vLut .. "[" .. c1 .. "]*85+" .. vLut .. "[" .. c2 .. "])*85+"
            .. vLut .. "[" .. c3 .. "])*85+" .. vLut .. "[" .. c4 .. "])*85+" .. vLut .. "[" .. c5 .. "])")
        L(vBytes .. "[" .. vNb .. "+1]=" .. vFlr .. "(" .. vV .. "/16777216)%256")
        L(vBytes .. "[" .. vNb .. "+2]=" .. vFlr .. "(" .. vV .. "/65536)%256")
        L(vBytes .. "[" .. vNb .. "+3]=" .. vFlr .. "(" .. vV .. "/256)%256")
        L(vBytes .. "[" .. vNb .. "+4]=" .. vV .. "%256")
        L(vNb .. "=" .. vNb .. "+4")
        L("end")
    else
        
        local vBuf  = _rname(used)
        local vBits = _rname(used)
        local vD    = _rname(used)
        
        local lutEntries = {}
        for i = 1, #B64 do
            lutEntries[#lutEntries + 1] = string.format("[0x%X]=0x%X", string.byte(B64, i), i - 1)
        end
        for i = #lutEntries, 2, -1 do
            local j = math.random(1, i)
            lutEntries[i], lutEntries[j] = lutEntries[j], lutEntries[i]
        end
        L("local " .. vLut  .. "={" .. table.concat(lutEntries, ",") .. "}")
        L("local " .. vBytes .. "={}")
        L("local " .. vNb .. "=0")
        L("local " .. vBuf .. "=0")
        L("local " .. vBits .. "=0")
        L("for " .. vI .. "=1,#" .. vA .. " do")
        L("local " .. vD .. "=" .. vLut .. "[string.byte(" .. vA .. "," .. vI .. ")]")
        L("if " .. vD .. " then")
        L(vBuf .. "=" .. vBuf .. "*64+" .. vD)
        L(vBits .. "=" .. vBits .. "+6")
        L("if " .. vBits .. ">=8 then")
        L(vBits .. "=" .. vBits .. "-8")
        L(vNb .. "=" .. vNb .. "+1")
        L(vBytes .. "[" .. vNb .. "]=" .. vFlr .. "(" .. vBuf .. "/(2^" .. vBits .. "))%256")
        L(vBuf .. "=" .. vBuf .. "%(2^" .. vBits .. ")")
        L("end end end")
    end

    
    L("local " .. vDlen .. "=" .. vBytes .. "[1]+" .. vBytes .. "[2]*256+"
        .. vBytes .. "[3]*65536+" .. vBytes .. "[4]*16777216")

    
    
    if algorithm == "none" then
        local vParts = _rname(used)
        local vJ     = _rname(used)
        L("local " .. vParts .. "={}")
        L("for " .. vJ .. "=1," .. vDlen .. " do " .. vParts .. "[" .. vJ .. "]=" .. vChar .. "(" .. vBytes .. "[4+" .. vJ .. "]) end")
        L("local " .. vSrc .. "=" .. vCat .. "(" .. vParts .. ")")
    else
        
        local vCodes = _rname(used)
        local vNc    = _rname(used)
        local vP     = _rname(used)
        local vDict  = _rname(used)
        local vNextc = _rname(used)
        local vOut   = _rname(used)
        local vPrev  = _rname(used)
        local vCode  = _rname(used)
        local vEntry = _rname(used)
        local vJ     = _rname(used)
        L("local " .. vCodes .. "={}")
        L("local " .. vNc .. "=0")
        L("local " .. vP .. "=5")
        L("while " .. vP .. "<=4+" .. vDlen .. " do")
        L(vNc .. "=" .. vNc .. "+1")
        L(vCodes .. "[" .. vNc .. "]=" .. vBytes .. "[" .. vP .. "]+" .. vBytes .. "[" .. vP .. "+1]*256")
        L(vP .. "=" .. vP .. "+2")
        L("end")
        L("local " .. vSrc)
        L("if " .. vNc .. "==0 then " .. vSrc .. "=\"\"")
        L("else")
        
        L("local " .. vDict .. "={}")
        L("for " .. vJ .. "=0,255 do " .. vDict .. "[" .. vJ .. "]=" .. vChar .. "(" .. vJ .. ") end")
        L("local " .. vNextc .. "=257")
        L("local " .. vOut .. "={}")
        L("local " .. vPrev .. "=nil")
        
        L("for " .. vJ .. "=1," .. vNc .. " do")
        L("local " .. vCode .. "=" .. vCodes .. "[" .. vJ .. "]")
        
        L("if " .. vCode .. "==256 then")
        L(vDict .. "={}")
        L("for _r=0,255 do " .. vDict .. "[_r]=" .. vChar .. "(_r) end")
        L(vNextc .. "=257")
        L(vPrev .. "=nil")
        L("else")
        L("local " .. vEntry .. "=" .. vDict .. "[" .. vCode .. "]")
        L("if not " .. vEntry .. " then " .. vEntry .. "=" .. vPrev .. ".." .. vSub .. "(" .. vPrev .. ",1,1) end")
        L(vOut .. "[#" .. vOut .. "+1]=" .. vEntry)
        L("if " .. vPrev .. " and " .. vNextc .. "<65536 then")
        L(vDict .. "[" .. vNextc .. "]=" .. vPrev .. ".." .. vSub .. "(" .. vEntry .. ",1,1)")
        L(vNextc .. "=" .. vNextc .. "+1")
        L("end")
        L(vPrev .. "=" .. vEntry)
        L("end")  
        L("end")  
        L(vSrc .. "=" .. vCat .. "(" .. vOut .. ")")
        L("end")
    end

    
    
    
    local vEnv = _rname(used)
    local vSc2 = _rname(used)
    local function _codesOf(str)
        local t = {}
        for i = 1, #str do t[#t+1] = tostring(string.byte(str, i)) end
        return table.concat(t, ",")
    end
    local lsCodes = _codesOf("loadstring")
    local ldCodes = _codesOf("load")
    L("local " .. vEnv  .. "=(getfenv and getfenv())or _G")
    L("local " .. vSc2  .. "=string.char")
    L("local " .. vLoadf .. "=" .. vEnv .. "[" .. vSc2 .. "(" .. lsCodes .. ")]"
        .. "or " .. vEnv .. "[" .. vSc2 .. "(" .. ldCodes .. ")]")
    L("local " .. vPc  .. "=" .. vEnv .. "[" .. vSc2 .. "(" .. _codesOf("pcall") .. ")]"
        .. "or rawget(_G," .. vSc2 .. "(" .. _codesOf("pcall") .. "))")
    L("local " .. vLok .. "," .. vChunk .. "=" .. vPc .. "(" .. vLoadf .. "," .. vSrc .. ")")
    L("if not " .. vLok .. " or not " .. vChunk .. " then error('load failed',0) end")
    L("return " .. vChunk .. "(...)")

    return table.concat(lines, "\n") .. "\n"
end

return Vmcodec
