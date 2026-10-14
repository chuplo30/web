local s = 0
for i=1,5 do s += i end
for k,v in ipairs({2,4,6}) do s += k+v end
print('R', s)
