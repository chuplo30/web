local namegenerators = {
        Mangled = require("catph.namegenerators.mangled");
        MangledShuffled = require("catph.namegenerators.mangled_shuffled");
        Il = require("catph.namegenerators.Il");
        
        
        Ad = require("catph.namegenerators.ad");
        mixed_ad_il = require("catph.namegenerators.mixed_ad_il");
        shortrand = require("catph.namegenerators.shortrand");
        ib1 = require("catph.namegenerators.ib1");
}

local keys = {}
for key in pairs(namegenerators) do
    table.insert(keys, key)
end
return setmetatable({
        Random = namegenerators[keys[math.random(1, #keys)]]
}, { __index = namegenerators })
