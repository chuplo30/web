local function make()
  local n = 3
  return function(x) n += x; return n end
end
local f = make()
print('R', f(2), f(4))
