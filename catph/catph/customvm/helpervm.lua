




local HelperVM = {}


local CAT_ARITH = 1
local CAT_TABLE = 2
local CAT_CALL  = 3
local CAT_FLOW  = 4

local CATEGORY = {}

for _, op in ipairs({33,34,35,36,37,38,81,49,50,51,52}) do CATEGORY[op] = CAT_ARITH end
for _, op in ipairs({88,89,90,91,92,93,94}) do CATEGORY[op] = CAT_ARITH end
for _, op in ipairs({59,61,62,65,67,68,69,70,71,72}) do CATEGORY[op] = CAT_ARITH end

for _, op in ipairs({13,14,15,16,17,18,53,55}) do CATEGORY[op] = CAT_TABLE end
for _, op in ipairs({103,104,105,106,107,108,109,110,111}) do CATEGORY[op] = CAT_TABLE end
for _, op in ipairs({43,48,54,76,77}) do CATEGORY[op] = CAT_TABLE end

for _, op in ipairs({9,10,11,19,20,21,22,63}) do CATEGORY[op] = CAT_CALL end
for _, op in ipairs({112,113,114,115,116,117,118,119,125,126}) do CATEGORY[op] = CAT_CALL end
for _, op in ipairs({44,45,46,47,77,78}) do CATEGORY[op] = CAT_CALL end

for _, op in ipairs({9,10,11,19,20,21,22,63}) do CATEGORY[op] = CAT_CALL end

for _, op in ipairs({2,3,4,5,6,7,8,23,24,25,26,27,28,29,30,31,32,56,57,58}) do CATEGORY[op] = CAT_FLOW end

for _, op in ipairs({82,83}) do CATEGORY[op] = CAT_ARITH end   
for _, op in ipairs({84,85}) do CATEGORY[op] = CAT_TABLE end   

HelperVM.CATEGORY = CATEGORY
HelperVM.CAT_ARITH = CAT_ARITH
HelperVM.CAT_TABLE = CAT_TABLE
HelperVM.CAT_CALL  = CAT_CALL
HelperVM.CAT_FLOW  = CAT_FLOW


function HelperVM.splitHandlers(handlers)
    local cats = { [CAT_ARITH]={}, [CAT_TABLE]={}, [CAT_CALL]={}, [CAT_FLOW]={} }
    for _, hd in ipairs(handlers) do
        local cat = CATEGORY[hd.op] or CAT_FLOW  
        cats[cat][#cats[cat]+1] = hd
    end
    return cats
end


function HelperVM.categoryOf(op)
    return CATEGORY[op] or CAT_FLOW
end

return HelperVM
