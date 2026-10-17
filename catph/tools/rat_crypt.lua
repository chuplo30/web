-- tools/rat_crypt.lua : self-test RC4-KSAx3 + b85 glue (no Roblox APIs needed).
local RatCrypt = require("catph.ratcrypt");

local function toHex(t)
    local p = {};
    for i = 1, #t do p[i] = string.format("%02x", t[i]) end
    return table.concat(p);
end

-- random key + random data round-trip
local key = {};
local seed = 123456789;
local function rnd(n)
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
end
for i = 1, 64 do key[i] = rnd(256) end
local data = {};
for i = 1, 5000 do data[i] = rnd(256) end
data[1] = 0; data[2] = 255; data[5000] = 0;

local st1 = RatCrypt.ksa3(key);
local cipher = RatCrypt.crypt(st1, data);
local st2 = RatCrypt.ksa3(key);
local back = RatCrypt.crypt(st2, cipher);
assert(#back == #data, "len mismatch");
for i = 1, #data do
    assert(back[i] == data[i], "round-trip mismatch at " .. i);
end

-- determinism: same input -> same cipher
local st3 = RatCrypt.ksa3(key);
local cipher2 = RatCrypt.crypt(st3, data);
assert(toHex(cipher) == toHex(cipher2), "not deterministic");

-- b85 length multiple of 5 + sane size
local e = RatCrypt.b85encode({ 1, 2, 3 });
assert(#e == 5, "b85 len");
local e2 = RatCrypt.b85encode(data);
assert((#e2 % 5) == 0, "b85 pad");

print("rat_crypt SELFTEST OK bytes=" .. #data);
