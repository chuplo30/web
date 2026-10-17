local Step = require("catph.step")
local Ast = require("catph.ast")
local Scope = require("catph.scope")
local Parser = require("catph.parser")
local Enums = require("catph.enums")
local visitast = require("catph.visitast")
local AstKind = Ast.AstKind

local MemeString = Step:extend()
MemeString.Name = "MemeString"
MemeString.Description = "Injects meme strings (junk pool) and randomly references them - Luraph meme style."
MemeString.SettingsDescriptor = {
    Intensity = {
        name = "Intensity",
        description = "Meme injection intensity 0..1",
        type = "number",
        default = 0.6,
        min = 0,
        max = 1,
    },
}

function MemeString:init(settings) end

local MEMES = {
    "skibidi","rizz","gyatt","sigma","ohio","mewing","fanum tax","kai cenat","duke dennis",
    "livvy dunne","baby gronk","freddy fazbear","whopper whopper whopper","chopped","dripping",
    "sussy baka","amogus","uganda knuckles","do you know de wae","john pork","tim cheese",
    "chicken jockey","tralalero tralala","bombardino crocodilo","baller","dom dom yes yes",
    "grimace shake","sus","poggers","based","cringe","goofy ahh","osal","brainrot","level 10 gyatt",
    "rizzler","beta","alpha","side eye","pookie","aura","negative aura","twin","chat is this real",
    "what the sigma","only in ohio","freddy fazbear jumpscare","ligma","johnson","mog","looksmaxxing",
}

local function pickMemes(n)
    local t={}
    for i=1,n do t[i]=MEMES[math.random(1,#MEMES)] end
    return t
end

function MemeString:apply(ast, pipeline)
    local mainBlock = ast.body
    local mainScope = mainBlock.scope

    
    local memeCount = math.random(8, 14)
    local memes = pickMemes(memeCount)
    local entries = {}
    for _, m in ipairs(memes) do
        entries[#entries+1] = Ast.TableEntry(Ast.StringExpression(m))
    end
    local memeId = mainScope:addVariable()
    local memeDecl = Ast.LocalVariableDeclaration(mainScope, {memeId}, {
        Ast.TableConstructorExpression(entries)
    })
    table.insert(mainBlock.statements, 1, memeDecl)

    
    visitast(ast, nil, function(node, data)
        if node.kind == AstKind.Block and node.statements and #node.statements>0 then
            if math.random() <= self.Intensity * 0.5 then
                local scope = node.scope or mainScope
                local dv = scope:addVariable()
                
                local idx = math.random(1, memeCount)
                local memeRef = Ast.IndexExpression(Ast.VariableExpression(mainScope, memeId), Ast.NumberExpression(idx))
                local decl = Ast.LocalVariableDeclaration(scope, {dv}, {memeRef})
                
                local maxPos = #node.statements + 1
                local lastKind = node.statements[#node.statements] and node.statements[#node.statements].kind
                if lastKind == AstKind.ReturnStatement or lastKind == AstKind.BreakStatement then
                    maxPos = #node.statements
                end
                if maxPos >= 1 then
                    local pos = math.random(1, maxPos)
                    table.insert(node.statements, pos, decl)
                    
                    if not data.scope.isGlobal then
                        data.scope:addReferenceToHigherScope(mainScope, memeId)
                    end
                end
            end
        end
    end)

    
    
    
    visitast(ast, nil, function(node, data)
        if node.kind == AstKind.StringExpression then
            if math.random() < 0.15 then
                local s = node.value
                if #s < 80 and #s > 0 then
                    local memeIdx = math.random(1, memeCount)
                    
                    local concat = Ast.StrCatExpression(Ast.StringExpression(s), Ast.IndexExpression(Ast.VariableExpression(mainScope, memeId), Ast.NumberExpression(memeIdx)))
                    
                    
                    
                end
            end
        end
    end)

    return ast
end

return MemeString
