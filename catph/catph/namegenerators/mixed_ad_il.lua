local util = require("catph.util");
local ad = require("catph.namegenerators.ad");
local il = require("catph.namegenerators.Il");

local function generateName(id, scope)
    if id < ad.nameCount then
        return ad.generateName(id, scope)
    else
        return il.generateName(id - ad.nameCount, scope)
    end
end

local function prepare(ast)
    ad.prepare(ast)
    il.prepare(ast)
end

return {
    generateName = generateName,
    prepare = prepare
};
