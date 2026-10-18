/** Soft anti-hook: detect common executor hooks without false-positive on Delta. */
export const AT_STAGE_SOFT_HOOK = `
do
  local bad = false
  -- classic table tostring probe (user exact style)
  local a = string.sub(tostring({}), 8, 15)
  local b = string.sub(tostring({}), 8, 15)
  if a == b and type(game) == "nil" then bad = true end
  -- debug.getinfo integrity
  local d = rawget(_G, "debug")
  if type(d) == "table" and type(d.getinfo) == "function" then
    local ok, info = pcall(d.getinfo, function() end, "S")
    if ok and type(info) == "table" and info.what ~= nil and info.what ~= "C" and info.what ~= "Lua" then
      bad = true
    end
  end
  -- hooked namecall / index on game (optional soft)
  if type(getrawmetatable) == "function" and type(game) == "userdata" then
    local ok, mt = pcall(getrawmetatable, game)
    if ok and type(mt) == "table" then
      local ni = rawget(mt, "__namecall")
      if type(ni) == "function" then
        local ok2, info2 = pcall(function()
          return d and d.getinfo and d.getinfo(ni, "S")
        end)
        if ok2 and type(info2) == "table" and info2.what == "Lua" then
          -- Lua-level __namecall often means hooked
          bad = true
        end
      end
    end
  end
  if bad then
    _G._wan_at = 1
    return
  end
end
`;

export const AT_STAGE_ENVCRACK = `
do
  if type(getfenv) == "function" then
    local ok, e = pcall(getfenv, 1)
    if ok and type(e) == "table" then
      local mt = getmetatable(e)
      if mt ~= nil and type(mt) == "table" and type(rawget(mt, "__index")) == "function" then
        local f = rawget(mt, "__index")
        if type(debug) == "table" and type(debug.getinfo) == "function" then
          local ok2, info = pcall(debug.getinfo, f, "S")
          if ok2 and type(info) == "table" and info.what == "Lua" then
            _G._wan_at = 1
            return
          end
        end
      end
    end
  end
end
`;

export const AT_STAGE_STRONG = `
do
  if _G._wan_at then return end
  -- stack depth probe
  local depth = 0
  local function rec()
    depth = depth + 1
    if depth < 8 then return rec() end
  end
  pcall(rec)
  if depth < 3 then
    _G._wan_at = 1
    return
  end
end
`;
