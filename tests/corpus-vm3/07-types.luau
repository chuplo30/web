type Pair<T> = {T,T}
local p: Pair<number> = {10, 20}
local function sum<T>(x:T, y:T): T
    return x + y
end
print('R', sum(p[1],p[2]))
