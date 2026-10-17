
local Step = require("catph.step")
local Ast = require("catph.ast")
local Scope = require("catph.scope")
local RandomStrings = require("catph.randomStrings")
local Parser = require("catph.parser")
local Enums = require("catph.enums")
local logger = require("logger")
local visitast = require("catph.visitast");
local util     = require("catph.util")
local AstKind = Ast.AstKind;

local EncryptStrings = Step:extend()
EncryptStrings.Description = "This Step will encrypt strings within your Program."
EncryptStrings.Name = "Encrypt Strings"

EncryptStrings.SettingsDescriptor = {
    EncryptNumbers = {
        name = "EncryptNumbers",
        description = "Also encrypt number literals as strings, decoded at runtime with tonumber(). Much harder to reverse than math expressions.",
        type = "boolean",
        default = true,
    },
    Layers = {
        name = "Layers",
        description = "Number of nested string-encryption layers applied at runtime. Each layer adds an extra stream-cipher + base85 pass.",
        type = "number",
        default = 1,
        min = 1,
        max = 3,
    },
}

function EncryptStrings:init(settings) end


function EncryptStrings:CreateEncrypionService()
    local usedSeeds = {};

    local secret_key_6 = math.random(0, 63) 
    local secret_key_7 = math.random(0, 127) 
    local secret_key_44 = math.random(0, 17592186044415) 
    local secret_key_8 = math.random(0, 255); 

    
    
    
    
    
    local seed_offset = math.random(1, 2 ^ 20);

    
    
    
    
    
    local env_const = 0;
    local env_expr;
    do
        local builders = {
            function()
                local n = math.random(1, 60)
                return n, "tonumber(\"" .. n .. "\")"
            end,
            function()
                local n = math.random(1, 60)
                return n, "math.floor(" .. n .. ")"
            end,
            function()
                local n = math.random(1, 60)
                return n, "string.byte(string.char(" .. n .. "))"
            end,
            function()
                local n = math.random(1, 60)
                return n, "((" .. n .. "+0))"
            end,
        };
        local terms = {};
        for i = 1, math.random(2, 3) do
            local val, expr = builders[math.random(1, #builders)]();
            env_const = (env_const + val) % 256;
            terms[#terms + 1] = expr;
        end
        env_expr = table.concat(terms, " + ");
    end

    
    
    
    
    
    
    
    
    local XK_LEN = 8;
    local extra_seed_bytes = {};
    
    
    
    for i = 1, math.random(4, 8) do
        extra_seed_bytes[i] = math.random(0, 255);
    end
    local extra_seed = string.char(unpack(extra_seed_bytes));

    
    local function compute_xk(seed_str)
        local key = {};
        local state = 17;
        for i = 1, XK_LEN do
            for j = 1, string.len(seed_str) do
                state = (state * 31 + string.byte(seed_str, j) + i * 7) % 65536;
            end
            key[i] = state % 256;
        end
        return key;
    end
    local extra_key = compute_xk(extra_seed);

    
    
    local function escapeLuaString(s)
        local out = {};
        for i = 1, #s do
            out[i] = string.format("\\%d", string.byte(s, i));
        end
        return '"' .. table.concat(out) .. '"';
    end
    local extra_seed_literal = escapeLuaString(extra_seed);

    
    
    local _B85 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^"
    local function encodeB85(s)
        local pad = (4 - #s % 4) % 4
        s = s .. string.rep("\0", pad)
        local out = {}
        local fl = math.floor
        for i = 1, #s, 4 do
            local b1, b2, b3, b4 = string.byte(s, i, i + 3)
            local v = ((b1 * 256 + b2) * 256 + b3) * 256 + b4
            local c5 = v % 85; v = fl((v - c5) / 85)
            local c4 = v % 85; v = fl((v - c4) / 85)
            local c3 = v % 85; v = fl((v - c3) / 85)
            local c2 = v % 85; v = fl((v - c2) / 85)
            local c1 = v % 85
            out[#out + 1] = _B85:sub(c1+1,c1+1).._B85:sub(c2+1,c2+1).._B85:sub(c3+1,c3+1).._B85:sub(c4+1,c4+1).._B85:sub(c5+1,c5+1)
        end
        return table.concat(out)
    end

    local floor = math.floor

    local function primitive_root_257(idx)
        local g, m, d = 1, 128, 2 * idx + 1
        repeat
            g, m, d = g * g * (d >= m and 3 or 1) % 257, m / 2, d % m
        until m < 1
        return g
    end

    local param_mul_8 = primitive_root_257(secret_key_7)
    local param_mul_45 = secret_key_6 * 4 + 1
    local param_add_45 = secret_key_44 * 2 + 1

    local state_45 = 0
    local state_8 = 2

    local prev_values = {}
    local function set_seed(seed_53)
        state_45 = seed_53 % 35184372088832
        state_8 = seed_53 % 255 + 2
        prev_values = {}
    end

    local function gen_seed()
        local seed;
        repeat
            seed = math.random(0, 35184372088832);
        until not usedSeeds[seed];
        usedSeeds[seed] = true;
        return seed;
    end

    local function get_random_32()
        state_45 = (state_45 * param_mul_45 + param_add_45) % 35184372088832
        repeat
            state_8 = state_8 * param_mul_8 % 257
        until state_8 ~= 1
        local r = state_8 % 32
        local n = floor(state_45 / 2 ^ (13 - (state_8 - r) / 32)) % 2 ^ 32 / 2 ^ r
        return floor(n % 1 * 2 ^ 32) + floor(n)
    end

    local function get_next_pseudo_random_byte()
        if #prev_values == 0 then
            local rnd = get_random_32() 
            local low_16 = rnd % 65536
            local high_16 = (rnd - low_16) / 65536
            local b1 = low_16 % 256
            local b2 = (low_16 - b1) / 256
            local b3 = high_16 % 256
            local b4 = (high_16 - b3) / 256
            prev_values = { b1, b2, b3, b4 }
        end
        
        return table.remove(prev_values)
    end

    local function encrypt(str)
        local seed = gen_seed();
        set_seed(seed)
        local len = string.len(str)
        local out = {}
        local salt = math.random(0, 255);
        local prevVal = (secret_key_8 + salt + env_const) % 256;
        for i = 1, len do
            
            
            local byte = (string.byte(str, i) + extra_key[((i - 1) % XK_LEN) + 1]) % 256;
            out[i] = string.char((byte - (get_next_pseudo_random_byte() + prevVal)) % 256);
            prevVal = byte;
        end
        
        return table.concat(out), seed + seed_offset, salt;
    end

local function genCode(layers)
        layers = layers or 1;
        local params = { "str", "seed", "salt", "n", "_f" };
        local shellParts = {};
        for k = 2, layers do
            params[#params + 1] = "seed" .. k;
            params[#params + 1] = "salt" .. k;
            params[#params + 1] = "n" .. k;
            shellParts[#shellParts + 1] =
                "\n        if seed" .. k .. " then\n" ..
                "        str=_db(str,n" .. k .. ");\n" ..
                "        seed" .. k .. "=seed" .. k .. "-" .. tostring(seed_offset) .. ";\n" ..
                "        pv={};\n" ..
                "        st45=seed" .. k .. "%35184372088832\n" ..
                "        st8=seed" .. k .. "%255+2\n" ..
                "        local t" .. k .. "={};\n" ..
                "        local p=(" .. tostring(secret_key_8) .. "+salt" .. k .. "+_ek)%256;\n" ..
                "        for i=1,n" .. k .. " do\n" ..
                "            p=(sb(str,i)+gnb()+p)%256\n" ..
                "            t" .. k .. "[i]=cm[((p-_xk[((i-1)%" .. tostring(XK_LEN) .. ")+1])%256)+1];\n" ..
                "        end\n" ..
                "        str=cc(t" .. k .. ");\n" ..
                "        end";
        end
        local decryptBody = [[
    function DECRYPT(]] .. table.concat(params, ",") .. [[)
        local _key=str
        do local _c=_mc[_key]; if _c~=nil then return _c end end
]] .. table.concat(shellParts, "\n") .. [[
        str=_db(str,n);
        pv={};
        seed=seed-]] .. tostring(seed_offset) .. [[;
        st45=seed%35184372088832
        st8=seed%255+2
        local r={};
        local p=(]] .. tostring(secret_key_8) .. [[+salt+_ek)%256;
        for i=1,n do
            p=(sb(str,i)+gnb()+p)%256
            r[i]=cm[((p-_xk[((i-1)%]] .. tostring(XK_LEN) .. [[)+1])%256)+1];
        end
local _r=_f and _tn(cc(r)) or cc(r);
        _mc[_key]=_r
        return _r;
    end]];

        local localDecls = {
            "local f=math.floor;",
            "local rm=table.remove;",
            "local cc=table.concat;",
            "local ch=string.char;",
            "local sb=string.byte;",
"local sl=string.len;",
            "local _tn=tonumber;",
        };

        
        local charmapInit = [[
    local cm={};
    for i=0,255 do cm[i+1]=ch(i) end]];

        
local prngBody = [[
            local b1=rnd%256
            local b2=f(rnd/256)%256
            local b3=f(rnd/65536)%256
            local b4=f(rnd/16777216)%256
            pv={b1,b2,b3,b4}]];

        local code = "do\n\t" .. table.concat(localDecls, "\n\t") .. [[

    local st45=0
    local st8=2
]] .. charmapInit .. [[

    local _b="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^"
    local _bm={}
    for i=1,#_b do _bm[sb(_b,i)]=i-1 end
    local function _db(s,n)
        local t={}
        for i=1,#s,5 do
            local v=(((_bm[sb(s,i)]*85+_bm[sb(s,i+1)])*85+_bm[sb(s,i+2)])*85+_bm[sb(s,i+3)])*85+_bm[sb(s,i+4)]
            t[#t+1]=ch(f(v/16777216)%256)
            t[#t+1]=ch(f(v/65536)%256)
            t[#t+1]=ch(f(v/256)%256)
            t[#t+1]=ch(v%256)
        end
        return string.sub(cc(t),1,n)
    end
    local _xs=]] .. extra_seed_literal .. [[;
    local _xk={};
    do
        local s=17;
        for i=1,]] .. tostring(XK_LEN) .. [[ do
            for j=1,sl(_xs) do
                s=(s*31+sb(_xs,j)+i*7)%65536;
            end
            _xk[i]=s%256;
        end
    end
    _xs=nil;

    local _ek=(]] .. env_expr .. [[)%256;

    local pv={}
    local _mc={}
    local function gnb()
        if #pv==0 then
            st45=(st45*]] .. tostring(param_mul_45) .. [[+]] .. tostring(param_add_45) .. [[)%35184372088832
            repeat
                st8=st8*]] .. tostring(param_mul_8) .. [[%257
            until st8~=1
            local r=st8%32
            local n=f(st45/2^(13-(st8-r)/32))%2^32/2^r
            local rnd=f(n%1*2^32)+f(n)
]] .. prngBody .. [[

        end
        return rm(pv)
    end

]] .. decryptBody .. [[

end]]

        return code;
    end

    return {
        encrypt = encrypt,
        encodeB85 = encodeB85,
        param_mul_45 = param_mul_45,
        param_mul_8 = param_mul_8,
        param_add_45 = param_add_45,
        secret_key_8 = secret_key_8,
        genCode = genCode,
    }
end

function EncryptStrings:apply(ast, pipeline)
    local Encryptor = self:CreateEncrypionService();
    local layers = math.max(1, math.floor(self.Layers or 1));

    local code = Encryptor.genCode(layers);
    local newAst = Parser:new({ LuaVersion = Enums.LuaVersion.Lua51 }):parse(code);
    local doStat = newAst.body.statements[1];

    local scope = ast.body.scope;
    local decryptVar = scope:addVariable();

    local buildCache = {};
    local function buildCall(plain, plainLen, useTonumber)
        local Lmax = useTonumber and 1 or layers;
        local cacheKey = (useTonumber and "n\0" or "s\0") .. plain;
        local entry = buildCache[cacheKey];
        if not entry then
            local c1, s1, k1 = Encryptor.encrypt(plain);
            local blob = Encryptor.encodeB85(c1);
            local blobs, seeds, salts, lens = { blob }, { s1 }, { k1 }, { plainLen };
            for L = 2, Lmax do
                local cL, sL, kL = Encryptor.encrypt(blobs[L - 1]);
                blob = Encryptor.encodeB85(cL);
                blobs[L] = blob;
                seeds[L] = sL;
                salts[L] = kL;
                lens[L] = #blobs[L - 1];
            end
            entry = { blob = blobs[Lmax], seeds = seeds, salts = salts, lens = lens, Lmax = Lmax };
            buildCache[cacheKey] = entry;
        end
        local args = {
            Ast.StringExpression(entry.blob),
            Ast.NumberExpression(entry.seeds[1]), Ast.NumberExpression(entry.salts[1]), Ast.NumberExpression(entry.lens[1]),
            Ast.BooleanExpression(useTonumber),
        };
        for L = 2, entry.Lmax do
            args[#args + 1] = Ast.NumberExpression(entry.seeds[L]);
            args[#args + 1] = Ast.NumberExpression(entry.salts[L]);
            args[#args + 1] = Ast.NumberExpression(entry.lens[L]);
        end
        return Ast.FunctionCallExpression(Ast.VariableExpression(scope, decryptVar), args);
    end

    doStat.body.scope:setParent(ast.body.scope);

    visitast(newAst, nil, function(node, data)
        if(node.kind == AstKind.FunctionDeclaration) then
            if(node.scope:getVariableName(node.id) == "DECRYPT") then
                data.scope:removeReferenceToHigherScope(node.scope, node.id);
                data.scope:addReferenceToHigherScope(scope, decryptVar);
                node.scope = scope;
                node.id    = decryptVar;
            end
        end
    end)

    
    

    visitast(ast, nil, function(node, data)
        if(node.kind == AstKind.StringExpression) then
            
            local canReach = false
            local s = data.scope
            while s do
                if s == scope then canReach = true; break end
                if s.isGlobal then break end
                s = s.parentScope
            end
            if not canReach then return end
            data.scope:addReferenceToHigherScope(scope, decryptVar);
            local origLen = #node.value;
            return buildCall(node.value, origLen, false);
        end
        if self.EncryptNumbers and node.kind == AstKind.NumberExpression then
            local numStr = tostring(node.value);
            if tonumber(numStr) ~= node.value then return end
            local canReach = false
            local s = data.scope
            while s do
                if s == scope then canReach = true; break end
                if s.isGlobal then break end
                s = s.parentScope
            end
            if not canReach then return end
            data.scope:addReferenceToHigherScope(scope, decryptVar);
            local numLen = #numStr;
            return buildCall(numStr, numLen, true);
        end
    end)


    
    table.insert(ast.body.statements, 1, doStat);
    table.insert(ast.body.statements, 1, Ast.LocalVariableDeclaration(scope, { decryptVar }, {}));
    return ast
end

return EncryptStrings
