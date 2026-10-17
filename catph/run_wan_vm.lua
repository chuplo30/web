--[[ WAN bridge: run Catph CustomVM only, stop after CustomVM emit ]]
if not setfenv then function setfenv(fn, env) return fn end end
if not getfenv then function getfenv() return _ENV end end
if not unpack then unpack = table.unpack end
if not loadstring then loadstring = load end
if not newproxy then
  newproxy = function(arg)
    if arg then return setmetatable({}, {}) end
    return {}
  end
end
if not bit32 then
  bit32 = {}
  local function band(a,b)
    a,b=math.floor(a or 0),math.floor(b or 0)
    local r,p=0,1
    for _=1,32 do
      local x,y=a%2,b%2
      if x==1 and y==1 then r=r+p end
      a,b,p=math.floor(a/2),math.floor(b/2),p*2
    end
    return r
  end
  local function bor(a,b)
    a,b=math.floor(a or 0),math.floor(b or 0)
    local r,p=0,1
    for _=1,32 do
      local x,y=a%2,b%2
      if x==1 or y==1 then r=r+p end
      a,b,p=math.floor(a/2),math.floor(b/2),p*2
    end
    return r
  end
  local function bxor(a,b)
    a,b=math.floor(a or 0),math.floor(b or 0)
    local r,p=0,1
    for _=1,32 do
      local x,y=a%2,b%2
      if x~=y then r=r+p end
      a,b,p=math.floor(a/2),math.floor(b/2),p*2
    end
    return r
  end
  bit32.band, bit32.bor, bit32.bxor = band, bor, bxor
  function bit32.bnot(a) return bxor(a or 0, 0xFFFFFFFF) end
  function bit32.lshift(a,n) return math.floor((a or 0) * 2^(n or 0)) % 2^32 end
  function bit32.rshift(a,n) return math.floor((a or 0) % 2^32 / 2^(n or 0)) end
  function bit32.arshift(a,n) return bit32.rshift(a,n) end
end

local root = arg[1]
local inFile = arg[2]
local outFile = arg[3]
local presetName = arg[4] or "customvm_max"

package.path = root .. "/?.lua;" .. root .. "/?/init.lua;" .. package.path

local Obf = require("catph")
Obf.Logger.logLevel = Obf.Logger.LogLevel.Error
Obf.colors.enabled = false

local src = assert(io.open(inFile, "rb")):read("*a")
local preset = Obf.Presets[presetName]
if not preset then
  -- fallback customvm
  preset = Obf.Presets["customvm"] or Obf.Presets["Catph"]
end
assert(preset, "no preset")

local steps = {}
for _, s in ipairs(preset.Steps) do
  local n = s.Name
  if n == "EncryptStrings" or n == "DummyStep" or n == "ConstantArray"
     or n == "ChecksumChunk" or n == "Watermark2zvh" then
    -- skip post-VM AST rewrites that break self-contained emit
  else
    steps[#steps + 1] = s
  end
  if n == "CustomVM" then
    break
  end
end

-- Ensure CustomVM is present
local hasCvm = false
for _, s in ipairs(steps) do if s.Name == "CustomVM" then hasCvm = true end end
if not hasCvm then
  steps[#steps + 1] = {
    Name = "CustomVM",
    Settings = {
      OptLevel = 2, Compress = true, MicroOps = true, Flatten = true,
      FlattenIntensity = "high", JunkLevel = 2, VmCompression = true,
      EnableFfiLibrary = false, StaticEnvironment = false, HardcodeGlobals = false,
    }
  }
end

local conf = {
  LuaVersion = preset.LuaVersion or "Lua51",
  PrettyPrint = false,
  VarNamePrefix = "",
  NameGenerator = preset.NameGenerator or "MangledShuffled",
  Seed = (os.time() * 1000 + (math.random(0, 999))) % 2147483647,
  Steps = steps,
}

local pipeline = Obf.Pipeline:fromConfig(conf)
local out = pipeline:apply(src, inFile)

-- Brand scrub Catph → WAN
out = out
  :gsub("[Cc]atph", "WAN")
  :gsub("CATPH", "WAN")
  :gsub("discord%.gg/uHU98Z3E8z", "WAN")
  :gsub("Protected By WAN[^\n]*", "Protected By WAN OBFUSCATE")

assert(io.open(outFile, "wb")):write(out):close()
io.stderr:write(string.format("WAN-CVM OK bytes=%d steps=%d\n", #out, #steps))
