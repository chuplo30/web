-- SIM NEUTER-ERROR LOGGER: error chi log roi di tiep + hook rawget + debug noi doi
error = function(...)
  print("NEUTERED-ERROR:" .. tostring((...)))
  return nil
end
local _rr = rawget
rawget = function(t, k)
  local s = tostring(k)
  local acc = 0
  for i = 1, 500 do acc = acc + #s end
  if acc == -1 then print("unreachable") end
  return _rr(t, k)
end
local _dbg = debug
debug = setmetatable({ info = function(f, w) return "[C]" end }, { __index = _dbg })
