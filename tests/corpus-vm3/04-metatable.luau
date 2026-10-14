local t = setmetatable({x=2}, {__index={y=3}, __add=function(a,b) return a.x+b.x end})
local u = setmetatable({x=5}, getmetatable(t))
print('R', t.y, (t+u))
