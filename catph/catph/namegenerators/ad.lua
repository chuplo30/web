




local util = require("catph.util");
local chararray = util.chararray;

local varNames = {
    
    "_67fuscator",
    "StopSkidding",
    "filebrute",
    "hokmetamethod",
    "fbi",
    "kEy",
    "soloro",
    "djmike",
    
    "getInfo",
    "info",
    "red",
    "key",
    "value",
    "iterator",
    "length",
    "size",
    "term",
    "Il",
    "lI",
    "l1",
    "I1",
    "ted",
    "blue",
    "green",
    "esp",
    "script",
    "loadf",
    "request",
    "result",
    "index",
    "data",
    "buf",
    "tmp",
    "out",
    "src",
    "str",
    "len",
    "pos",
    "num",
    "val",
    "ptr",
    "ref",
    "ctx",
    "env",
    "tab",
    "tbl",
    "obj",
    "cls",
    "fn",
    "cb",
    
    "a","b","c","d","e","f","g","h","I","y","j","k","l",
}

local function generateName(id, scope)
    local d = id % #varNames
    return varNames[d + 1]
end

local function prepare(ast)
    util.shuffle(varNames);
end

return {
    generateName = generateName,
    prepare = prepare,
    nameCount = #varNames,
};
