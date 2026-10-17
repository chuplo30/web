local srcDir = arg[0]:match("(.*/)") or "./"
local herSrc = srcDir .. "../hercules/src/"
package.path = herSrc .. "?.lua;" .. herSrc .. "?/init.lua;" .. package.path
if not math.ldexp then math.ldexp = function(x,n) return x * 2^n end end
if not math.frexp then
  math.frexp = function(x)
    if x == 0 then return 0, 0 end
    local exp = math.floor(math.log(math.abs(x)) / math.log(2)) + 1
    return x / 2^exp, exp
  end
end
local input, output = arg[1], arg[2] or (arg[1] .. ".vm.lua")
local f = assert(io.open(input, "r"))
local src = f:read("*a"); f:close()
local VM = require("modules/VMGenerator")
local ok, out = pcall(VM.process, src)
if not ok then io.stderr:write("VM error: "..tostring(out).."\n"); os.exit(2) end
if type(out) ~= "string" or #out < 50 then io.stderr:write("empty VM\n"); os.exit(3) end
assert(io.open(output, "w")):write(out):close()
io.write("OK "..#out.."\n")
