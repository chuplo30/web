




















local Step      = require("catph.step")
local Parser    = require("catph.parser")
local Unparser  = require("catph.unparser")
local Enums     = require("catph.enums")
local Vmcodec   = require("catph.vmcodec")
local logger    = require("logger")

local VmEncryption = Step:extend()
VmEncryption.Name = "VM Encryption"
VmEncryption.Description =
    "Applies a stream-cipher encryption layer over the emitted program and " ..
    "injects a runtime decryptor stub. Extreme security layer — prevents " ..
    "static analysis of the plaintext source."

VmEncryption.SettingsDescriptor = {
    Enabled = {
        type    = "boolean",
        default = true,
        description = "Master switch. When false the step is a no-op.",
    },
    KeyLength = {
        type    = "number",
        default = 64,
        min     = 16,
        max     = 256,
        description = "Length of the random encryption key in bytes (16-256).",
    },
    SplitParts = {
        type    = "number",
        default = 4,
        min     = 2,
        max     = 8,
        description = "Number of parts to split the encrypted blob into (for structural variation).",
    },
}

function VmEncryption:init(settings) end



local _ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
local _ALNUM = _ALPHA .. "0123456789"
local _KW = {["and"]=1,["break"]=1,["do"]=1,["else"]=1,["elseif"]=1,
             ["end"]=1,["false"]=1,["for"]=1,["function"]=1,["goto"]=1,
             ["if"]=1,["in"]=1,["local"]=1,["nil"]=1,["not"]=1,
             ["or"]=1,["repeat"]=1,["return"]=1,["then"]=1,["true"]=1,
             ["until"]=1,["while"]=1,["continue"]=1}

local function rname(used)
    local n
    repeat
        local first = math.random(1, #_ALPHA)
        n = _ALPHA:sub(first, first)
        for _ = 2, math.random(3, 6) do
            local k = math.random(1, #_ALNUM)
            n = n .. _ALNUM:sub(k, k)
        end
    until not used[n] and not _KW[n]
    used[n] = true
    return n
end


local function buildKeyStream(key, salt, length)
    local keylen = #key
    local ks = {}
    for i = 1, length do
        ks[i] = (key[((i - 1) % keylen) + 1] * salt + i * 7 + salt) % 256
    end
    return ks
end






local function encryptBytes(src, key, salt)
    local keyStream = buildKeyStream(key, salt, #src)
    local cipher = {}
    for i = 1, #src do
        cipher[i] = (string.byte(src, i) + keyStream[i]) % 256
    end
    return cipher
end


local B85 = Vmcodec and Vmcodec.B85 or "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^"
local function encodeBytes(bytes)
    
    local t = {}
    for i = 1, #bytes do
        t[i] = string.format("%02X", bytes[i])
    end
    return table.concat(t)
end


local function splitBlob(hexStr, nParts)
    local parts = {}
    local len = #hexStr
    local pos = 1
    for p = 1, nParts do
        local rem = nParts - p
        local sz
        if rem == 0 then
            sz = len - pos + 1
        else
            local avg = math.floor((len - pos + 1) / (rem + 1))
            local jitter = math.floor(avg * 0.25)
            sz = math.max(2, avg + math.random(-jitter, jitter))
            
            if sz % 2 ~= 0 then sz = sz + 1 end
        end
        
        sz = math.min(sz, len - pos + 1)
        if sz % 2 ~= 0 then sz = sz - 1 end
        if sz <= 0 then sz = 2 end
        parts[p] = string.format("%q", hexStr:sub(pos, pos + sz - 1))
        pos = pos + sz
    end
    return parts
end

function VmEncryption:apply(ast, pipeline)
    if not self.Enabled then
        logger:info("VM Encryption: disabled, skipping.")
        return ast
    end

    local luaVersion = pipeline.LuaVersion or Enums.LuaVersion.LuaU

    
    local unparser = Unparser:new({ LuaVersion = luaVersion })
    local fullSrc  = unparser:unparse(ast)
    logger:info(string.format("VM Encryption: encrypting %d bytes of source.", #fullSrc))

    
    local keyLen = self.KeyLength or 64
    if keyLen < 16 then keyLen = 16 end
    if keyLen > 256 then keyLen = 256 end

    local key  = {}
    for i = 1, keyLen do key[i] = math.random(0, 255) end
    local salt = math.random(1, 253)  

    
    local cipherBytes = encryptBytes(fullSrc, key, salt)
    local hexBlob     = encodeBytes(cipherBytes)

    
    local nParts = self.SplitParts or 4
    if nParts < 2 then nParts = 2 end
    if nParts > 8 then nParts = 8 end

    local blobParts = splitBlob(hexBlob, nParts)
    local blobExpr  = table.concat(blobParts, "..")

    local used = {}
    local vBlob  = rname(used)
    local vKey   = rname(used)
    local vSalt  = rname(used)
    local vLen   = rname(used)
    local vDec   = rname(used)
    local vI     = rname(used)
    local vByte  = rname(used)
    local vKS    = rname(used)
    local vKL    = rname(used)
    local vChar  = rname(used)
    local vCat   = rname(used)
    local vFloor = rname(used)
    local vLoad  = rname(used)
    local vPc    = rname(used)
    local vOk    = rname(used)
    local vFn    = rname(used)

    
    local mask = math.random(1, 127)
    local maskedKey = {}
    for i = 1, keyLen do
        maskedKey[i] = (key[i] + mask) % 256
    end
    
    local keyIndices = {}
    for i = 1, keyLen do keyIndices[i] = i end
    for i = keyLen, 2, -1 do
        local j = math.random(1, i)
        keyIndices[i], keyIndices[j] = keyIndices[j], keyIndices[i]
    end
    local keyEntries = {}
    for _, idx in ipairs(keyIndices) do
        keyEntries[#keyEntries + 1] = string.format("[%d]=0x%02X", idx, maskedKey[idx])
    end

    
    local saltA = math.random(1, salt - 1)
    local saltB = salt - saltA

    local stubLines = {
        "local " .. vChar  .. "=string.char",
        "local " .. vFloor .. "=math.floor",
        "local " .. vCat   .. "=table.concat",
        
        "local " .. vBlob  .. "=" .. blobExpr,
        
        "local " .. vKey   .. "={" .. table.concat(keyEntries, ",") .. "}",
        string.format("local %s=%d", vSalt, saltA) .. string.format("+%d", saltB),
        "local " .. vLen   .. "=#" .. vBlob .. "/2",
        "local " .. vDec   .. "={}",
        "local " .. vKL    .. "=" .. keyLen,
        
        
        
        
        
        string.format(
            "for %s=1,%s do " ..
            "local %s=tonumber(%s:sub((%s-1)*2+1,%s*2),16)" ..
            " local %s=((%s[(%s-1)%%%s+1]-0x%02X)*%s+%s*7+%s)%%256" ..
            " %s[%s]=%s((%s-%s+512)%%256) end",
            vI, vLen,
            vByte, vBlob, vI, vI,
            vKS, vKey, vI, vKL, mask, vSalt, vI, vSalt,
            vDec, vI, vChar, vByte, vKS
        ),
        "local " .. vLoad  .. "=loadstring or load",
        "local " .. vPc    .. "=pcall",
        "local " .. vOk    .. "," .. vFn .. "=" .. vPc .. "(" .. vLoad .. "," .. vCat .. "(" .. vDec .. "))",
        "if " .. vOk .. " and " .. vFn .. " then " .. vFn .. "() end",
    }

    local stubSrc = table.concat(stubLines, "\n")

    logger:info(string.format(
        "VM Encryption: stub %d B (source was %d B, key %d bytes, salt %d).",
        #stubSrc, #fullSrc, keyLen, salt))

    
    local newAst = Parser:new({ LuaVersion = luaVersion }):parse(stubSrc)
    return newAst
end

return VmEncryption
