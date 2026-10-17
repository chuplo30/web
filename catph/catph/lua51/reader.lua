












local Reader = {}
local floor = math.floor

local function makeStream(blob, sizeTSize, littleEndian)
    local pos = 1
    local s = {}

    local function readUnsigned(width)
        local value = 0
        if littleEndian then
            for i = 0, width - 1 do
                value = value + (string.byte(blob, pos + i) or 0) * 2^(8 * i)
            end
        else
            for i = 0, width - 1 do
                value = value * 256 + (string.byte(blob, pos + i) or 0)
            end
        end
        pos = pos + width
        return value
    end

    function s.byte()
        local b = string.byte(blob, pos) or 0
        pos = pos + 1
        return b
    end

    function s.int()
        local v = readUnsigned(4)
        if not littleEndian then
            
        end
        if v >= 2147483648 then v = v - 4294967296 end
        return v
    end

    function s.uint()
        return readUnsigned(4)
    end

    function s.instr()
        
        return readUnsigned(4)
    end

    function s.double()
        
        local by = {string.byte(blob, pos, pos + 7)}
        pos = pos + 8
        for i = 1, 8 do by[i] = by[i] or 0 end
        local lo = by[1] + by[2]*256 + by[3]*65536 + by[4]*16777216
        local hi = by[5] + by[6]*256 + by[7]*65536 + by[8]*16777216
        local sign = (hi >= 2147483648) and -1 or 1
        local hi2 = hi % 2147483648
        local exp = floor(hi2 / 1048576)        
        local mant_hi = hi2 % 1048576            
        if exp == 2047 then
            if mant_hi == 0 and lo == 0 then return sign * math.huge end
            return 0/0  
        elseif exp == 0 then
            
            local m = (mant_hi * 4294967296 + lo) / (2^52)
            return sign * m * 2^(-1022)
        else
            local m = 1.0 + (mant_hi * 4294967296 + lo) / (2^52)
            return sign * m * 2^(exp - 1023)
        end
    end

    function s.str()
        
        
        local size = readUnsigned(sizeTSize)
        if size == 0 then return nil end
        
        local sv = blob:sub(pos, pos + size - 2)
        pos = pos + size
        return sv
    end

    function s.skip(n)
        pos = pos + n
    end

    return s
end

local function loadProto(s)
    local proto = {}
    proto.source           = s.str()
    proto.linedefined      = s.int()
    proto.lastlinedefined  = s.int()
    proto.nups             = s.byte()
    proto.numparams        = s.byte()
    proto.is_vararg        = s.byte()
    proto.maxstacksize     = s.byte()

    
    local ncode = s.int()
    proto.code = {}
    for i = 1, ncode do
        proto.code[i] = s.instr()
    end

    
    local nk = s.int()
    proto.k = {}
    for i = 1, nk do
        local t = s.byte()
        if     t == 0 then  
            proto.k[i] = { tag = "nil",    value = nil   }
        elseif t == 1 then  
            proto.k[i] = { tag = "bool",   value = s.byte() ~= 0 }
        elseif t == 3 then  
            proto.k[i] = { tag = "number", value = s.double() }
        elseif t == 4 then  
            proto.k[i] = { tag = "string", value = s.str() or "" }
        else
            error("lua51.reader: unknown constant type " .. t .. " at k[" .. i .. "]")
        end
    end

    
    local np = s.int()
    proto.protos = {}
    for i = 1, np do
        proto.protos[i] = loadProto(s)
    end

    
    local nlines = s.int()
    s.skip(nlines * 4)   

    local nlocals = s.int()
    for _ = 1, nlocals do
        s.str()   
        s.int()   
        s.int()   
    end

    local nupnames = s.int()
    for _ = 1, nupnames do
        s.str()   
    end

    return proto
end


function Reader.parse(blob)
    if blob:sub(1, 4) ~= "\27Lua" then
        error("lua51.reader: not a Lua bytecode file (bad signature)")
    end
    local version = string.byte(blob, 5)
    if version ~= 0x51 then
        error(string.format("lua51.reader: expected Lua 5.1 (0x51), got 0x%02X", version))
    end
    
    
    
    
    
    local endian = string.byte(blob, 7)
    local intSize = string.byte(blob, 8)
    local sizeTSize = string.byte(blob, 9)
    local instrSize = string.byte(blob, 10)
    local numberSize = string.byte(blob, 11)
    local integralFlag = string.byte(blob, 12)
    if endian ~= 1 then
        error("lua51.reader: big-endian bytecode is not supported")
    end
    if intSize ~= 4 or instrSize ~= 4 or numberSize ~= 8 or integralFlag ~= 0 then
        error(string.format(
            "lua51.reader: unsupported Lua 5.1 bytecode layout (int=%s, size_t=%s, instr=%s, number=%s, integral=%s)",
            tostring(intSize), tostring(sizeTSize), tostring(instrSize),
            tostring(numberSize), tostring(integralFlag)))
    end
    if sizeTSize ~= 4 and sizeTSize ~= 8 then
        error("lua51.reader: unsupported size_t width " .. tostring(sizeTSize))
    end
    local s = makeStream(blob, sizeTSize, true)
    s.skip(12)
    return loadProto(s)
end

return Reader
