local function f(a, ...)
  local x,y = ...
  return a, x, y, select('#', ...)
end
local a,b,c,n = f(5,6,7,8)
print('R', a,b,c,n)
