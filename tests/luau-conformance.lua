-- 8XMS Luau conformance corpus
-- This file intentionally exercises syntax/semantics that a hand-written
-- subset parser commonly misses.
type Pair<T> = { first: T, second: T }
export type Result<T> = Pair<T>

local function generic<T>(x: T): T
    return x
end

local function closure(a: number)
    local b = 2
    return function(...): number
        local s = a + b
        for i = 1, select("#", ...) do
            s += tonumber(select(i, ...)) or 0
        end
        return s
    end
end

local obj = setmetatable({x=1}, {
    __index = function(t,k) return rawget(t,k) end,
    __newindex = function(t,k,v) rawset(t,k,v) end,
    __call = function(_,x) return x * 2 end,
})

local f = closure(3)
local ok, value = pcall(function()
    return obj(4) + f(5, 6)
end)

return ok, value, generic<Pair<number>>({first=1, second=2})
