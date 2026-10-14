local ok, v = pcall(function() return 4 + 5 end)
local ok2 = pcall(function() error('x') end)
print('R', ok, v, ok2)
