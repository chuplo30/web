













































































































































local Step      = require("catph.step")
local Ast       = require("catph.ast")
local Scope     = require("catph.scope")
local visitast  = require("catph.visitast")
local logger    = require("logger")
local Parser    = require("catph.parser")
local Enums     = require("catph.enums")
local Unparser  = require("catph.unparser")
local EncryptStrings = require("catph.steps.EncryptStrings")
local bit32     = require("catph.bit").bit32

local AstKind   = Ast.AstKind





local KNOWN_MACROS = {
    FUS_OBFUSCATED       = true,
    FUS_CRASH            = true,
    FUS_ENCSTR           = true,
    FUS_ENCNUM           = true,
    FUS_ENCFUNC          = true,
    FUS_NO_VIRTUALIZE    = true,
    FUS_LINE             = true,
    FUS_OPAQUE           = true,
    FUS_INLINE           = true,
    
    LPH_OBFUSCATED       = true,
    LPH_CRASH            = true,
    LPH_ENCSTR           = true,
    LPH_ENCNUM           = true,
    LPH_ENCFUNC          = true,
    LPH_NO_VIRTUALIZE    = true,
    LPH_LINE             = true,
    
    
    LPH_NO_UPVALUES      = true,
    LPH_JIT              = true,
    LPH_JIT_MAX          = true,
    
    SADOXPH_NO_VIRTUALIZE = true,
    
    
    
    
    
    CATPH_JIT            = true,
    CATPH_JIT_ULTRA      = true,
    CATPH_ENCFUNC        = true,
}



local RESERVED_PREFIXES = { "FUS_", "LPH_", "SADOXPH_", "CATPH_" }



local function normalizeMacro(name)
    if not name then return nil end
    if name:sub(1, 4) == "FUS_" then return name end
    if name:sub(1, 4) == "LPH_" then return "FUS_" .. name:sub(5) end
    
    
    if name:sub(1, 8) == "SADOXPH_" then return "FUS_" .. name:sub(9) end
    
    
    
    if name == "CATPH_JIT_ULTRA" then return "FUS_NO_VIRTUALIZE" end
    if name == "CATPH_ENCFUNC"   then return "FUS_ENCFUNC" end
    if name:sub(1, 6) == "CATPH_" then return name end
    return nil  
end


local function hasReservedPrefix(name)
    if not name then return false end
    for _, pfx in ipairs(RESERVED_PREFIXES) do
        if name:sub(1, #pfx) == pfx then return true end
    end
    return false
end






local HINT_MACROS = {
    LPH_NO_UPVALUES      = true,
    LPH_JIT              = true,
    LPH_JIT_MAX          = true,
    FUS_ENCFUNC          = true,
    FUS_NO_VIRTUALIZE    = true,
    LPH_ENCFUNC          = true,
    LPH_NO_VIRTUALIZE    = true,
    
    SADOXPH_NO_VIRTUALIZE = true,
    
    
    
    
    CATPH_JIT            = true,
}




local function isConst(node)
    return node and node.isConstant == true
end



local function foldBinary(node)
    if not (isConst(node.lhs) and isConst(node.rhs)) then return nil end
    local l, r = node.lhs.value, node.rhs.value
    local kind  = node.kind
    if kind == AstKind.AndExpression then
        local v = l and r; return Ast.ConstantNode(v)
    elseif kind == AstKind.OrExpression then
        local v = l or r;  return Ast.ConstantNode(v)
    elseif kind == AstKind.EqualsExpression then
        return Ast.ConstantNode(l == r)
    elseif kind == AstKind.NotEqualsExpression then
        return Ast.ConstantNode(l ~= r)
    end
    return nil
end


local function foldUnary(node)
    if not isConst(node.rhs) then return nil end
    if node.kind == AstKind.NotExpression then
        return Ast.ConstantNode(not node.rhs.value)
    end
    return nil
end



local MacroExpand = Step:extend()
MacroExpand.Name        = "MacroExpand"
MacroExpand.Description = "Expands compile-time macros (FUS_OBFUSCATED, FUS_CRASH, FUS_ENCSTR, FUS_ENCNUM, FUS_ENCFUNC, FUS_NO_VIRTUALIZE) and folds dead branches."
MacroExpand.SettingsDescriptor = {}

function MacroExpand:init()
    
    
    
    self._encryptor    = nil   
    self._decryptVar   = nil   
    self._decryptScope = nil   
    self._decryptInjected = false

    
    
    self._encfuncUsedKeys = {}
end













local LETTERS = "abcdefghijklmnopqrstuvwxyz"
local function randIdent(len)
    len = len or math.random(4, 8)
    local s = "_"
    for _ = 1, len do
        s = s .. LETTERS:sub(math.random(1, #LETTERS), math.random(1, #LETTERS))
    end
    return s
end


local function makeYieldLoop(parentScope)
    local innerScope = Scope:new(parentScope)
    local coScope, coId = innerScope:resolve("coroutine")
    local coRef         = Ast.VariableExpression(coScope, coId)
    local yieldExpr     = Ast.IndexExpression(coRef, Ast.StringExpression("yield"))
    local yieldCall     = Ast.FunctionCallStatement(yieldExpr, {})
    local loopScope     = Scope:new(innerScope)
    local loopBody      = Ast.Block({ yieldCall }, loopScope)
    local whileStat     = Ast.WhileStatement(loopBody, Ast.BooleanExpression(true), innerScope)
    return whileStat, innerScope
end

function MacroExpand:buildCrashNode(parentScope)
    local whileStat, innerScope = makeYieldLoop(parentScope)
    local block = Ast.Block({ whileStat }, innerScope)
    return Ast.DoStatement(block)
end


function MacroExpand:buildCrashExpression(refScope)
    local whileStat, innerScope = makeYieldLoop(refScope)
    local fnBody = Ast.Block({ whileStat }, innerScope)
    local fnLit  = Ast.FunctionLiteralExpression({}, fnBody)
    return Ast.FunctionCallExpression(fnLit, {})
end




























function MacroExpand:buildOpaqueNode(innerExpr, refScope)
    
    local n1 = math.random(1, 0x7FFFF)
    local variant = math.random(1, 5)

    local predicateSrc
    if variant == 1 then
        predicateSrc = string.format("bit32.bxor(%d,%d)==0", n1, n1)
    elseif variant == 2 then
        predicateSrc = string.format("bit32.band(%d,0)==0", n1)
    elseif variant == 3 then
        predicateSrc = string.format("bit32.bor(0,%d)==%d", n1, n1)
    elseif variant == 4 then
        predicateSrc = string.format("(%d*0+1)~=0", n1)
    else
        predicateSrc = string.format("math.floor(%d)==%d", n1, n1)
    end

    local wrapSrc = "local _ = " .. predicateSrc
    local wrapAst = Parser:new({ LuaVersion = Enums.LuaVersion.Lua51 }):parse(wrapSrc)
    local predExpr = wrapAst.body.statements[1].expressions[1]
    wrapAst.body.scope:setParent(refScope)

    
    
    
    
    
    
    
    
    
    
    return Ast.OrExpression(
        Ast.AndExpression(Ast.AndExpression(innerExpr, predExpr), innerExpr),
        innerExpr
    )
end





function MacroExpand:ensureEncryptor(ast)
    if self._decryptInjected then return end

    
    local svc = EncryptStrings:new({})
    self._encryptor = svc:CreateEncrypionService()

    
    local code   = self._encryptor.genCode()
    local newAst = Parser:new({ LuaVersion = Enums.LuaVersion.Lua51 }):parse(code)
    local doStat = newAst.body.statements[1]

    local scope = ast.body.scope
    local decryptVar = scope:addVariable()
    self._decryptVar   = decryptVar
    self._decryptScope = scope

    
    doStat.body.scope:setParent(scope)

    
    visitast(newAst, nil, function(node, data)
        if node.kind == AstKind.FunctionDeclaration then
            if node.scope:getVariableName(node.id) == "DECRYPT" then
                data.scope:removeReferenceToHigherScope(node.scope, node.id)
                data.scope:addReferenceToHigherScope(scope, decryptVar)
                node.scope = scope
                node.id    = decryptVar
            end
        end
    end)

    
    
    
    table.insert(ast.body.statements, 1, doStat)
    table.insert(ast.body.statements, 1,
        Ast.LocalVariableDeclaration(scope, { decryptVar }, {}))

    self._decryptInjected = true
end



function MacroExpand:buildEncstrNode(plaintext, callScope, ast)
    self:ensureEncryptor(ast)

    local encrypted, seed, salt = self._encryptor.encrypt(plaintext)
    local dScope = self._decryptScope
    local dVar   = self._decryptVar

    
    callScope:addReferenceToHigherScope(dScope, dVar)

    return Ast.FunctionCallExpression(
        Ast.VariableExpression(dScope, dVar),
        {
            Ast.StringExpression(encrypted),
            Ast.NumberExpression(seed),
            Ast.NumberExpression(salt),
        }
    )
end





function MacroExpand:buildEncnumNode(value, callScope, ast)
    self:ensureEncryptor(ast)

    
    local numStr = tostring(value)

    local encrypted, seed, salt = self._encryptor.encrypt(numStr)
    local dScope = self._decryptScope
    local dVar   = self._decryptVar

    callScope:addReferenceToHigherScope(dScope, dVar)

    
    local tnScope, tnId = callScope:resolve("tonumber")

    
    return Ast.FunctionCallExpression(
        Ast.VariableExpression(tnScope, tnId),
        {
            Ast.FunctionCallExpression(
                Ast.VariableExpression(dScope, dVar),
                {
                    Ast.StringExpression(encrypted),
                    Ast.NumberExpression(seed),
                    Ast.NumberExpression(salt),
                }
            )
        }
    )
end






























local function hexDecode(hex)
    assert(#hex == 64, "FUS_ENCFUNC: encKey must be exactly 64 hex characters")
    local bytes = {}
    for i = 1, 64, 2 do
        local hi = tonumber(hex:sub(i, i), 16)
        local lo = tonumber(hex:sub(i + 1, i + 1), 16)
        if not hi or not lo then
            error("FUS_ENCFUNC: encKey contains non-hex character at position " .. i)
        end
        bytes[#bytes + 1] = hi * 16 + lo
    end
    return bytes   
end


local function escapeBinary(s)
    local out = {}
    for i = 1, #s do
        out[i] = string.format("\\%d", string.byte(s, i))
    end
    return '"' .. table.concat(out) .. '"'
end

function MacroExpand:buildEncfuncNode(funcNode, encKey, decKeyNode, callScope, ast, pipeline)
    
    
    local unparser = Unparser:new({ LuaVersion = Enums.LuaVersion.LuaU })
    local funcSrc = "return " .. unparser:unparseExpression(funcNode)

    
    local keyBytes = hexDecode(encKey)
    local keyLen   = #keyBytes   

    
    local srcBytes = { string.byte(funcSrc, 1, #funcSrc) }
    local encBytes = {}
    for i = 1, #srcBytes do
        local kb = keyBytes[((i - 1) % keyLen) + 1]
        encBytes[i] = string.char(bit32.bxor(srcBytes[i], kb))
    end
    local ciphertext = table.concat(encBytes)

    
    
    
    local vDk  = randIdent()  
    local vCt  = randIdent()  
    local vR   = randIdent()  
    local vKl  = randIdent()  
    local vI   = randIdent()  
    local vB32 = randIdent()  
    local vSB  = randIdent()  
    local vSC  = randIdent()  
    local vTC  = randIdent()  
    local vLS  = randIdent()  
    local vPc  = randIdent()  
    local vOk  = randIdent()  
    local vRes = randIdent()  
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    local vHi = randIdent()  
    local vKB = randIdent()  

    local wrapSrc = string.format(
        "local _ = (function(%s)" ..
        " local %s=loadstring" ..
        " local %s=pcall" ..
        " local %s=string.byte" ..
        " local %s=string.char" ..
        " local %s=table.concat" ..
        " local %s=(type(bit32)=='table' and type(bit32.bxor)=='function' and bit32.bxor) or " ..
        "(type(bit)=='table' and type(bit.bxor)=='function' and bit.bxor) or function(_a,_b)" ..
        " local _p,_c=1,0;_a=tonumber(_a) or 0;_b=tonumber(_b) or 0;" ..
        " while _a>0 or _b>0 do local _ra,_rb=_a%%2,_b%%2;" ..
        " if _ra~=_rb then _c=_c+_p end;" ..
        " _a=math.floor(_a/2);_b=math.floor(_b/2);_p=_p*2 end;return _c end" ..
        " local %s=%s" ..
        " local %s={}" ..
        " for %s=1,#%s,2 do %s[#%s+1]=tonumber(%s:sub(%s,%s),16)*16+tonumber(%s:sub(%s+1,%s+1),16) end" ..
        " local %s=#%s" ..
        " local %s={}" ..
        " for %s=1,#%s do %s[%s]=%s(%s(%s(%s,%s),%s[(%s-1)%%%s+1])) end" ..
        " local %s,%s=%s(%s,%s(%s))" ..
        " if not %s or not %s then return nil end" ..
        " return %s" ..
        " end)(nil)",
        
        vDk,                                          
        
        vLS,                                          
        vPc,                                          
        vSB,                                          
        vSC,                                          
        vTC,                                          
        vB32,                                         
        
        vCt, escapeBinary(ciphertext),                
        
        vKB,                                          
        
        vHi, vDk, vKB, vKB, vDk, vHi, vHi, vDk, vHi, vHi,  
        
        vKl, vKB,                                     
        
        vR,                                           
        
        vI, vCt, vR, vI, vSC, vB32, vSB, vCt, vI, vKB, vI, vKl,  
        
        vOk, vRes, vPc, vLS, vTC, vR,
        
        vOk, vRes,
        
        vRes)                                 

    local wrapAst = Parser:new({ LuaVersion = Enums.LuaVersion.Lua51 }):parse(wrapSrc)

    
    
    local resultExpr
    visitast(wrapAst, nil, function(node, _data)
        if resultExpr then return end
        if node.kind == AstKind.FunctionCallExpression then
            
            if #node.args == 1 and node.args[1].kind == AstKind.NilExpression then
                node.args[1] = decKeyNode
                resultExpr = node
            end
        end
    end)

    if not resultExpr then
        logger:error("MacroExpand: FUS_ENCFUNC internal error — could not locate decoder IIFE in parsed AST.")
    end

    
    
    
    wrapAst.body.scope:setParent(callScope)

    return resultExpr
end

function MacroExpand:apply(ast, pipeline)
    local _ast = ast  

    
    
    
    
    
    
    
    
    local needsEncryptor = false
    visitast(ast, function(node, data)
        if needsEncryptor then return node, true end
        if node.kind == AstKind.FunctionCallExpression or
           node.kind == AstKind.FunctionCallStatement then
            local base = node.base
            if base and base.kind == AstKind.VariableExpression then
                local name = base.scope and base.scope:getVariableName(base.id)
                local norm = normalizeMacro(name)
                if norm == "FUS_ENCSTR" or norm == "FUS_ENCNUM" then
                    needsEncryptor = true
                end
            end
        end
    end)
    if needsEncryptor then
        self:ensureEncryptor(ast)
    end

    
    visitast(ast, function(node, data)

        
        
        if node.kind == AstKind.VariableExpression or
           node.kind == AstKind.AssignmentVariable then
            local name = node.scope and node.scope:getVariableName(node.id)
            if hasReservedPrefix(name) then
                if not KNOWN_MACROS[name] and not KNOWN_MACROS[normalizeMacro(name)] and not HINT_MACROS[name] then
                    logger:error(string.format(
                        "MacroExpand: identifier '%s' uses the reserved %s prefix but is not a known macro.",
                        name, name:sub(1,4)))
                end
            end
        end

        if node.kind == AstKind.LocalVariableDeclaration then
            
            local scope = node.scope
            for _, id in ipairs(node.ids) do
                local name = scope and scope:getVariableName(id)
                if hasReservedPrefix(name) and not HINT_MACROS[name] then
                    logger:error(string.format(
                        "MacroExpand: local variable '%s' uses the reserved %s prefix.",
                        name, name:sub(1,4)))
                end
            end
        end

        
        if node.kind == AstKind.FunctionCallExpression or
           node.kind == AstKind.FunctionCallStatement then
            local base = node.base
            if base and (base.kind == AstKind.VariableExpression or base.kind == AstKind.AssignmentVariable) then
                local rawName = base.scope and base.scope:getVariableName(base.id)
                
                if rawName and HINT_MACROS[rawName] then return end
                local name = normalizeMacro(rawName)
                if name == "FUS_OBFUSCATED" then
                    logger:error("MacroExpand: " .. rawName .. " is a boolean constant, not a function — do not call it.")
                end
                
                if name == "FUS_LINE" then
                    logger:error("MacroExpand: " .. rawName .. " is a number constant (current line), not a function — do not call it.")
                end
                
                if name == "FUS_OPAQUE" then
                    local args = node.args
                    if #args ~= 1 then
                        logger:error("MacroExpand: " .. rawName .. "() requires exactly one argument, got " .. #args .. ".")
                    end
                end
                
                if name == "FUS_ENCSTR" then
                    local args = node.args
                    if #args == 0 then
                        logger:error("MacroExpand: " .. rawName .. "() requires exactly one string literal argument.")
                    end
                    if #args > 1 then
                        logger:error("MacroExpand: " .. rawName .. "() takes exactly one argument, got " .. #args .. ".")
                    end
                    local arg = args[1]
                    if not arg or (arg.kind ~= AstKind.StringExpression and arg.kind ~= AstKind.LongStringExpression) then
                        logger:error("MacroExpand: " .. rawName .. "() argument must be a string literal constant, not a variable or expression.")
                    end
                end
                
                if name == "FUS_ENCNUM" then
                    local args = node.args
                    if #args == 0 then
                        logger:error("MacroExpand: " .. rawName .. "() requires exactly one number literal argument.")
                    end
                    if #args > 1 then
                        logger:error("MacroExpand: " .. rawName .. "() takes exactly one argument, got " .. #args .. ".")
                    end
                    local arg = args[1]
                    if not arg or arg.kind ~= AstKind.NumberExpression then
                        logger:error("MacroExpand: " .. rawName .. "() argument must be a number literal constant, not a variable or expression.")
                    end
                end
                
                if name == "FUS_ENCFUNC" then
                    local args = node.args
                    if #args ~= 3 then
                        logger:error("MacroExpand: " .. rawName .. "() requires exactly 3 arguments: (function, encKey, decKey).")
                    end
                    
                    local arg1 = args[1]
                    if not arg1 or arg1.kind ~= AstKind.FunctionLiteralExpression then
                        logger:error("MacroExpand: " .. rawName .. "() first argument must be a constant function literal (e.g. function() ... end).")
                    end
                    
                    local arg2 = args[2]
                    if not arg2 or (arg2.kind ~= AstKind.StringExpression and arg2.kind ~= AstKind.LongStringExpression) then
                        logger:error("MacroExpand: " .. rawName .. "() second argument (encKey) must be a string literal constant.")
                    end
                    local encKey = arg2.value
                    if type(encKey) ~= "string" or #encKey ~= 64 then
                        logger:error(string.format(
                            "MacroExpand: " .. rawName .. "() encKey must be a 64-character hex string, got %d characters.",
                            type(encKey) == "string" and #encKey or 0))
                    end
                    if encKey:find("[^0-9a-fA-F]") then
                        logger:error("MacroExpand: " .. rawName .. "() encKey must contain only hex characters (0-9, a-f, A-F).")
                    end
                    local arg3 = args[3]
                    if not arg3 then
                        logger:error("MacroExpand: " .. rawName .. "() third argument (decKey) must be a runtime variable/expression.")
                    end
                    if arg3.isConstant then
                        logger:error("MacroExpand: " .. rawName .. "() decKey (third argument) must be a runtime variable, not a string/number constant.")
                    end
                    if self._encfuncUsedKeys[encKey] then
                        logger:error("MacroExpand: " .. rawName .. "() the same encKey was used in multiple call sites. Each call must use a unique key.")
                    end
                    self._encfuncUsedKeys[encKey] = true
                end
                
                if name == "FUS_NO_VIRTUALIZE" then
                    local args = node.args
                    if #args ~= 1 then
                        logger:error("MacroExpand: " .. rawName .. "() requires exactly one argument, got " .. #args .. ".")
                    end
                    local arg1 = args[1]
                    if not arg1 or arg1.kind ~= AstKind.FunctionLiteralExpression then
                        logger:error("MacroExpand: " .. rawName .. "() argument must be a constant function literal (e.g. function() ... end), not a variable or other expression.")
                    end
                end
                
                if name == "FUS_INLINE" then
                    local args = node.args
                    if #args ~= 1 then
                        logger:error("MacroExpand: " .. rawName .. "() requires exactly one argument, got " .. #args .. ".")
                    end
                    local arg1 = args[1]
                    if not arg1 or arg1.kind ~= AstKind.FunctionLiteralExpression then
                        logger:error("MacroExpand: " .. rawName .. "() argument must be a constant function literal (e.g. function() ... end).")
                    end
                end
            end
        end

    end, function(node, data)
        

        
        
        
        if node.kind == AstKind.FunctionCallExpression or
           node.kind == AstKind.FunctionCallStatement then
            local base = node.base
            if base and (base.kind == AstKind.VariableExpression or base.kind == AstKind.AssignmentVariable) then
                local rawName = base.scope and base.scope:getVariableName(base.id)
                if rawName and HINT_MACROS[rawName] then
                    if node.kind == AstKind.FunctionCallExpression then
                        
                        
                        if node.args and node.args[1] then
                            return node.args[1]
                        end
                        return Ast.NilExpression()
                    else
                        
                        return Ast.NopStatement()
                    end
                end
            end
        end

        
        if node.kind == AstKind.VariableExpression then
            local name = normalizeMacro(node.scope and node.scope:getVariableName(node.id))
            if name == "FUS_OBFUSCATED" then
                return Ast.BooleanExpression(true)
            end
        end

        
        if node.kind == AstKind.FunctionCallExpression then
            local base = node.base
            if base and (base.kind == AstKind.VariableExpression) then
                local name = normalizeMacro(base.scope and base.scope:getVariableName(base.id))
                if name == "FUS_CRASH" then
                    return self:buildCrashExpression(base.scope)
                end
            end
        end

        
        if node.kind == AstKind.FunctionCallStatement then
            local base = node.base
            if base and (base.kind == AstKind.VariableExpression) then
                local name = normalizeMacro(base.scope and base.scope:getVariableName(base.id))
                if name == "FUS_CRASH" then
                    return self:buildCrashNode(base.scope)
                end
            end
        end

        
        if node.kind == AstKind.FunctionCallExpression then
            local base = node.base
            if base and base.kind == AstKind.VariableExpression then
                local name = normalizeMacro(base.scope and base.scope:getVariableName(base.id))
                if name == "FUS_OPAQUE" then
                    return self:buildOpaqueNode(node.args[1], data.scope)
                end
            end
        end
        
        if node.kind == AstKind.FunctionCallStatement then
            local base = node.base
            if base and base.kind == AstKind.VariableExpression then
                local name = normalizeMacro(base.scope and base.scope:getVariableName(base.id))
                if name == "FUS_OPAQUE" then
                    logger:error("MacroExpand: FUS_OPAQUE() used as a bare statement — result is discarded. Wrap in a condition or assignment.")
                end
            end
        end

        
        if node.kind == AstKind.FunctionCallExpression then
            local base = node.base
            if base and (base.kind == AstKind.VariableExpression) then
                local name = normalizeMacro(base.scope and base.scope:getVariableName(base.id))
                if name == "FUS_ENCSTR" then
                    local plaintext = node.args[1].value
                    return self:buildEncstrNode(plaintext, data.scope, _ast)
                end
            end
        end
        if node.kind == AstKind.FunctionCallStatement then
            local base = node.base
            if base and (base.kind == AstKind.VariableExpression) then
                local name = normalizeMacro(base.scope and base.scope:getVariableName(base.id))
                if name == "FUS_ENCSTR" then
                    logger:warn("MacroExpand: ENCSTR macro used as a statement — result is discarded.")
                    return Ast.NopStatement()
                end
            end
        end

        
        if node.kind == AstKind.FunctionCallExpression then
            local base = node.base
            if base and (base.kind == AstKind.VariableExpression) then
                local name = normalizeMacro(base.scope and base.scope:getVariableName(base.id))
                if name == "FUS_ENCNUM" then
                    local value = node.args[1].value
                    return self:buildEncnumNode(value, data.scope, _ast)
                end
            end
        end
        if node.kind == AstKind.FunctionCallStatement then
            local base = node.base
            if base and (base.kind == AstKind.VariableExpression) then
                local name = normalizeMacro(base.scope and base.scope:getVariableName(base.id))
                if name == "FUS_ENCNUM" then
                    logger:warn("MacroExpand: ENCNUM macro used as a statement — result is discarded.")
                    return Ast.NopStatement()
                end
            end
        end

        
        if node.kind == AstKind.FunctionCallExpression then
            local base = node.base
            if base and (base.kind == AstKind.VariableExpression) then
                local name = normalizeMacro(base.scope and base.scope:getVariableName(base.id))
                if name == "FUS_ENCFUNC" then
                    local funcNode   = node.args[1]
                    local encKeyNode = node.args[2]
                    local decKeyNode = node.args[3]
                    return self:buildEncfuncNode(
                        funcNode, encKeyNode.value, decKeyNode,
                        data.scope, _ast, pipeline)
                end
            end
        end
        if node.kind == AstKind.FunctionCallStatement then
            local base = node.base
            if base and (base.kind == AstKind.VariableExpression) then
                local name = normalizeMacro(base.scope and base.scope:getVariableName(base.id))
                if name == "FUS_ENCFUNC" then
                    logger:error("MacroExpand: ENCFUNC macro does not automatically call the passed function — assign it to a local and call it explicitly.")
                end
            end
        end

        
        
        
        if node.kind == AstKind.FunctionCallExpression then
            local base = node.base
            if base and (base.kind == AstKind.VariableExpression) then
                local macroName = normalizeMacro(base.scope and base.scope:getVariableName(base.id))
                if macroName == "FUS_INLINE" then
                    local fnNode = node.args[1]
                    if fnNode and fnNode.kind == AstKind.FunctionLiteralExpression then
                        fnNode.__fus_inline = true
                    end
                    return fnNode
                end
            end
        end
        if node.kind == AstKind.FunctionCallStatement then
            local base = node.base
            if base and base.kind == AstKind.VariableExpression then
                local name = normalizeMacro(base.scope and base.scope:getVariableName(base.id))
                if name == "FUS_INLINE" then
                    logger:warn("MacroExpand: INLINE macro used as a bare statement — append () to call the function, or assign it to a local.")
                    return Ast.NopStatement()
                end
            end
        end

        
        
        
        
        
        
        
        if node.kind == AstKind.FunctionCallExpression then
            local base = node.base
            if base and (base.kind == AstKind.VariableExpression) then
                local macroName = normalizeMacro(base.scope and base.scope:getVariableName(base.id))
                if macroName == "FUS_NO_VIRTUALIZE" then
                    local fnNode = node.args[1]
                    local fnScope = fnNode.body and fnNode.body.scope

                    
                    local upvalNames = {}   
                    local upvalSeen  = {}   
                    if fnScope then
                        visitast(fnNode, nil, function(inner, _)
                            if inner.kind == AstKind.VariableExpression then
                                local vs = inner.scope
                                if vs and not vs.isGlobal then
                                    if vs.level and fnScope.level and vs.level < fnScope.level then
                                        local vname = vs:getVariableName(inner.id)
                                        if vname and not upvalSeen[vname] then
                                            upvalSeen[vname] = true
                                            upvalNames[#upvalNames + 1] = { name = vname, scope = vs, id = inner.id }
                                        end
                                    end
                                end
                            end
                        end)
                    end

                    if #upvalNames == 0 then
                        
                        fnNode.__fus_no_virt = true
                        return fnNode
                    end

                    
                    
                    
                    
                    
                    
                    
                    
                    
                    
                    
                    
                    
                    
                    
                    

                    
                    local unp = Unparser:new({ LuaVersion = Enums.LuaVersion.LuaU })

                    
                    local destructLines = {}
                    local tableEntries  = {}
                    for _, uv in ipairs(upvalNames) do
                        destructLines[#destructLines + 1] = "local " .. uv.name .. " = _u." .. uv.name
                        tableEntries[#tableEntries + 1]  = uv.name .. " = " .. uv.name
                    end

                    
                    
                    
                    
                    
                    
                    local fullFnSrc = unp:unparseExpression(fnNode)
                    local destructBlock = table.concat(destructLines, " ") .. " "

                    
                    
                    local factorySrc = string.format(
                        "(function(_u) %s return %s end)({%s})",
                        destructBlock,
                        fullFnSrc,
                        table.concat(tableEntries, ", ")
                    )

                    
                    
                    
                    
                    local function obfuscateStringLiterals(src)
                        local function encodeChar(c)
                            local b = string.byte(c)
                            local r = math.random(4)
                            if r == 1 then
                                return string.format("\\%d", b)           
                            elseif r == 2 then
                                return string.format("\\x%02x", b)        
                            elseif r == 3 then
                                return string.format("\\u{%x}", b)        
                            else
                                return c                                   
                            end
                        end
                        
                        
                        local out = {}
                        local i = 1
                        local n = #src
                        while i <= n do
                            local c = src:sub(i, i)
                            
                            if c == '"' or c == "'" then
                                local q = c
                                out[#out+1] = q
                                i = i + 1
                                while i <= n do
                                    local sc = src:sub(i, i)
                                    if sc == '\\' then
                                        
                                        out[#out+1] = src:sub(i, i+1)
                                        i = i + 2
                                    elseif sc == q then
                                        out[#out+1] = q
                                        i = i + 1
                                        break
                                    else
                                        out[#out+1] = encodeChar(sc)
                                        i = i + 1
                                    end
                                end
                            else
                                out[#out+1] = c
                                i = i + 1
                            end
                        end
                        return table.concat(out)
                    end

                    factorySrc = obfuscateStringLiterals(factorySrc)

                    
                    local ok, factoryAst = pcall(function()
                        return Parser:new({ LuaVersion = Enums.LuaVersion.LuaU }):parse(
                            "local __nv = " .. factorySrc)
                    end)

                    if not ok then
                        
                        logger:warn("MacroExpand: FUS_NO_VIRTUALIZE: could not rewrite upvalue function for native extraction, leaving in VM.")
                        return fnNode
                    end

                    
                    local factoryExpr = factoryAst.body.statements[1].expressions[1]
                    if not factoryExpr then
                        return fnNode
                    end

                    
                    local factoryFn = factoryExpr.base
                    if factoryFn and factoryFn.kind == AstKind.FunctionLiteralExpression then
                        factoryFn.__fus_no_virt = true
                    end

                    
                    factoryAst.body.scope:setParent(data.scope)

                    return factoryExpr
                end
            end
        end
        if node.kind == AstKind.FunctionCallStatement then
            local base = node.base
            if base and (base.kind == AstKind.VariableExpression) then
                local name = normalizeMacro(base.scope and base.scope:getVariableName(base.id))
                if name == "FUS_NO_VIRTUALIZE" then
                    logger:warn("MacroExpand: NO_VIRTUALIZE macro used as a bare statement — append () to call the function, or assign it to a local.")
                    return Ast.NopStatement()
                end
            end
        end

        
        
        
        
        
        if node.kind == AstKind.FunctionCallStatement then
            local base = node.base
            if base and base.kind == AstKind.VariableExpression then
                local name = base.scope and base.scope:getVariableName(base.id)
                if name and HINT_MACROS[name] then
                    return Ast.NopStatement()
                end
            end
        end
        if node.kind == AstKind.FunctionCallExpression then
            local base = node.base
            if base and base.kind == AstKind.VariableExpression then
                local name = base.scope and base.scope:getVariableName(base.id)
                if name and HINT_MACROS[name] then
                    
                    
                    if node.args and node.args[1] then
                        return node.args[1]
                    end
                    return Ast.NilExpression()
                end
            end
        end

        
        if node.kind == AstKind.NotExpression then
            local folded = foldUnary(node)
            if folded then return folded end
        end

        
        if node.kind == AstKind.AndExpression or
           node.kind == AstKind.OrExpression  or
           node.kind == AstKind.EqualsExpression or
           node.kind == AstKind.NotEqualsExpression then
            local folded = foldBinary(node)
            if folded then return folded end
        end

        
        if node.kind == AstKind.AndExpression then
            if isConst(node.lhs) then
                if node.lhs.value then
                    return node.rhs  
                else
                    return Ast.BooleanExpression(false)  
                end
            end
        end
        if node.kind == AstKind.OrExpression then
            if isConst(node.lhs) then
                if node.lhs.value then
                    return Ast.BooleanExpression(true)   
                else
                    return node.rhs  
                end
            end
        end

    end)

    
    
    
    
    
    
    if next(self._encfuncUsedKeys) then
        visitast(ast, nil, function(node, _data)
            if node.kind == AstKind.StringExpression or node.kind == AstKind.LongStringExpression then
                local v = node.value
                if type(v) == "string" then
                    for encKey, _ in pairs(self._encfuncUsedKeys) do
                        if v:find(encKey, 1, true) or v:find(encKey:lower(), 1, true) then
                            logger:error(string.format(
                                "MacroExpand: FUS_ENCFUNC security violation — the encKey '%s' appears verbatim in another string constant in the script. " ..
                                "For security purposes obfuscation will fail. Remove or rename that string.",
                                encKey))
                        end
                    end
                end
            end
        end)
    end

    
    
    
    
    visitast(ast, nil, function(node, data)

        if node.kind == AstKind.IfStatement then
            return self:foldIf(node, data)
        end

        if node.kind == AstKind.WhileStatement then
            if isConst(node.condition) and not node.condition.value then
                
                return Ast.NopStatement()
            end
        end

        if node.kind == AstKind.RepeatStatement then
            
            if isConst(node.condition) and node.condition.value then
                return Ast.DoStatement(node.body)
            end
        end

    end)

    return ast
end



function MacroExpand:foldIf(node, data)
    
    if isConst(node.condition) then
        if node.condition.value then
            
            
            return Ast.DoStatement(node.body)
        else
            
            
            if node.elseifs and #node.elseifs > 0 then
                local first = table.remove(node.elseifs, 1)
                node.condition = first.condition
                node.body      = first.body
                
                return self:foldIf(node, data)
            elseif node.elsebody then
                return Ast.DoStatement(node.elsebody)
            else
                return Ast.NopStatement()
            end
        end
    end

    
    
    if node.elseifs then
        local newElseifs = {}
        for _, eif in ipairs(node.elseifs) do
            if isConst(eif.condition) then
                if eif.condition.value then
                    
                    
                    node.elseifs = newElseifs
                    node.elsebody = eif.body
                    break
                end
                
            else
                table.insert(newElseifs, eif)
            end
        end
        node.elseifs = newElseifs
    end

    return node
end

return MacroExpand
