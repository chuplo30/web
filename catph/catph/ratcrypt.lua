-- catph/ratcrypt.lua : pure-Lua RC4-KSAx3 + crypt + b85, mirror EXACTLY the
-- deriveKeyState/decryptPayload math of the rAT module. No Roblox APIs.
-- b85 alphabet must match on both sides (no '"', no backslash, no newline).

local RatCrypt = {}

RatCrypt.ALPHA = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^_{|}~";
assert(#RatCrypt.ALPHA >= 85, "b85 alphabet too short");
RatCrypt.ALPHA = RatCrypt.ALPHA:sub(1, 85);

function RatCrypt.hexToBytes(hex)
    assert(type(hex) == "string" and (#hex % 2) == 0 and #hex > 0, "bad KeyHex");
    local out = {};
    for i = 1, #hex, 2 do
        local b = tonumber(hex:sub(i, i + 1), 16);
        assert(b, "bad KeyHex char");
        out[#out + 1] = b;
    end
    return out;
end

function RatCrypt.ksa3(key)
    local keyCount = #key;
    assert(keyCount > 0, "empty key");
    local state = {};
    for index = 0, 255 do state[index] = index end
    local swap = 0
    local counter = 0
    for _ = 1, 3 do
        for index = 0, 255 do
            swap = (swap + state[index] + key[(counter % keyCount) + 1]) % 256
            state[index], state[swap] = state[swap], state[index]
            counter = counter + 1
        end
    end
    return state;
end

local function bxorByte(a, b)
    local r, bit = 0, 1
    while a > 0 or b > 0 do
        local abit = a % 2
        local bbit = b % 2
        if abit ~= bbit then r = r + bit end
        a = math.floor(a / 2)
        b = math.floor(b / 2)
        bit = bit * 2
    end
    return r;
end

function RatCrypt.crypt(state, data)
    local st = {};
    for i = 0, 255 do st[i] = state[i] end
    local i, j = 0, 0
    local out = {};
    for pos = 1, #data do
        i = (i + 1) % 256
        j = (j + st[i]) % 256
        st[i], st[j] = st[j], st[i]
        out[pos] = bxorByte(data[pos], st[(st[i] + st[j]) % 256]);
    end
    return out;
end

function RatCrypt.bytesOf(str)
    local out = {};
    for i = 1, #str do out[i] = string.byte(str, i) end
    return out;
end

function RatCrypt.b85encode(bytes)
    local alpha = RatCrypt.ALPHA;
    local parts = {};
    local n = #bytes;
    local pad = (4 - (n % 4)) % 4;
    for i = 1, pad do bytes[n + i] = 0 end
    n = n + pad;
    for i = 1, n, 4 do
        local val = bytes[i] * 16777216 + bytes[i + 1] * 65536 + bytes[i + 2] * 256 + bytes[i + 3];
        local c = {};
        for k = 5, 1, -1 do
            c[k] = alpha:sub((val % 85) + 1, (val % 85) + 1);
            val = math.floor(val / 85);
        end
        parts[#parts + 1] = table.concat(c);
    end
    for _ = 1, pad do bytes[#bytes] = nil end
    return table.concat(parts);
end

return RatCrypt;
