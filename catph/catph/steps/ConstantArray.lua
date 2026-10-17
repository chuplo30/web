







local Step = require("catph.step");
local Ast = require("catph.ast");
local Scope = require("catph.scope");
local visitast = require("catph.visitast");
local util     = require("catph.util")
local Parser   = require("catph.parser");
local enums = require("catph.enums")

local LuaVersion = enums.LuaVersion;
local AstKind = Ast.AstKind;

local ConstantArray = Step:extend();
ConstantArray.Description = "This Step will Extract all Constants and put them into an Array at the beginning of the script";
ConstantArray.Name = "Constant Array";

ConstantArray.SettingsDescriptor = {
	Treshold = {
		name = "Treshold",
		description = "The relative amount of nodes that will be affected",
		type = "number",
		default = 1,
		min = 0,
		max = 1,
	},
	StringsOnly = {
		name = "StringsOnly",
		description = "Wether to only Extract Strings",
		type = "boolean",
		default = false,
	},
	Shuffle = {
		name = "Shuffle",
		description = "Wether to shuffle the order of Elements in the Array",
		type = "boolean",
		default = true,
	},
	Rotate = {
		name = "Rotate",
		description = "Wether to rotate the String Array by a specific (random) amount. This will be undone on runtime.",
		type = "boolean",
		default = true,
	},
	LocalWrapperTreshold = {
		name = "LocalWrapperTreshold",
		description = "The relative amount of nodes functions, that will get local wrappers",
		type = "number",
		default = 1,
		min = 0,
		max = 1,
	},
	LocalWrapperCount = {
		name = "LocalWrapperCount",
		description = "The number of Local wrapper Functions per scope. This only applies if LocalWrapperTreshold is greater than 0",
		type = "number",
		min = 0,
		max = 512,
		default = 0,
	},
	LocalWrapperArgCount = {
		name = "LocalWrapperArgCount",
		description = "The number of Arguments to the Local wrapper Functions",
		type = "number",
		min = 1,
		default = 10,
		max = 200,
	};
	MaxWrapperOffset = {
		name = "MaxWrapperOffset",
		description = "The Max Offset for the Wrapper Functions",
		type = "number",
		min = 0,
		default = 65535,
	};
	Encoding = {
		name = "Encoding",
		description = "The Encoding to use for the Constants",
		type = "enum",
		default = "b85",
		values = {
			"none",
			"base64",
			"b85",
		},
	},
	MaxStringLen = {
		name = "MaxStringLen",
		description = "Strings longer than this are skipped (already-encoded payloads, etc.). 0 = no limit.",
		type = "number",
		default = 4096,
		min = 0,
		max = 2147483647,
	},
}

local function callNameGenerator(generatorFunction, ...)
	if(type(generatorFunction) == "table") then
		generatorFunction = generatorFunction.generateName;
	end
	return generatorFunction(...);
end

function ConstantArray:init(settings)
	
end

function ConstantArray:createArray()
	local entries = {};
	for i, v in ipairs(self.constants) do
		if type(v) == "string" then
			local encoded = self:encode(v);
			if encoded ~= nil then v = encoded end
		end
		entries[i] = Ast.TableEntry(Ast.ConstantNode(v));
	end
	return Ast.TableConstructorExpression(entries);
end


function ConstantArray:createArrayChunk(chunkValues)
	local entries = {};
	for i, v in ipairs(chunkValues) do
		if type(v) == "string" then
			local encoded = self:encode(v);
			if encoded ~= nil then v = encoded end
		end
		entries[i] = Ast.TableEntry(Ast.ConstantNode(v));
	end
	return Ast.TableConstructorExpression(entries);
end





function ConstantArray:splitConstants(nChunks)
	local total = #self.constants;
	if total == 0 then return {{}} end
	nChunks = math.max(1, math.min(nChunks, total));
	local chunks = {};
	local pos = 1;
	for i = 1, nChunks do
		chunks[i] = {};
		local remainingPieces = nChunks - i + 1;
		local remainingItems = total - pos + 1;
		local sz = math.floor(remainingItems / remainingPieces);
		if i < nChunks then
			local maxJitter = math.min(remainingItems - remainingPieces, math.floor(sz * 0.5));
			if maxJitter > 0 then
				sz = sz + math.random(-maxJitter, maxJitter);
			end
			sz = math.max(1, sz);
		else
			sz = remainingItems;
		end
		for j = 1, sz do
			chunks[i][j] = self.constants[pos];
			pos = pos + 1;
		end
	end
	return chunks;
end





function ConstantArray:addAppendChunkCode(ast, chunkValues)
	local code = [[
do
	for _, v in ipairs(CHUNK) do ARR[#ARR + 1] = v end
end
]];
	local parser = Parser:new({LuaVersion = LuaVersion.Lua51});
	local newAst = parser:parse(code);
	local doStat = newAst.body.statements[1];
	doStat.body.scope:setParent(ast.body.scope);

	local chunkLiteral = self:createArrayChunk(chunkValues);

	visitast(newAst, nil, function(node, data)
		if node.kind == AstKind.VariableExpression then
			local name = node.scope:getVariableName(node.id);
			if name == "ARR" then
				data.scope:removeReferenceToHigherScope(node.scope, node.id);
				data.scope:addReferenceToHigherScope(self.rootScope, self.arrId);
				node.scope = self.rootScope;
				node.id    = self.arrId;
			elseif name == "CHUNK" then
				data.scope:removeReferenceToHigherScope(node.scope, node.id);
				return chunkLiteral;
			end
		end
	end);

	table.insert(ast.body.statements, 1, doStat);
end

function ConstantArray:indexing(index, data)
	if self.LocalWrapperCount > 0 and data.functionData.local_wrappers then
		local wrappers = data.functionData.local_wrappers;
		local wrapper = wrappers[math.random(#wrappers)];

		local args = {};
		local ofs = index - self.wrapperOffset - wrapper.offset;
		for i = 1, self.LocalWrapperArgCount, 1 do
			if i == wrapper.arg then
				args[i] = Ast.NumberExpression(ofs);
			else
				args[i] = Ast.NumberExpression(math.random(ofs - 1024, ofs + 1024));
			end
		end

		data.scope:addReferenceToHigherScope(wrappers.scope, wrappers.id);
		return Ast.FunctionCallExpression(Ast.IndexExpression(
			Ast.VariableExpression(wrappers.scope, wrappers.id),
			Ast.StringExpression(wrapper.index)
		), args);
	else
		data.scope:addReferenceToHigherScope(self.rootScope,  self.wrapperId);
		return Ast.FunctionCallExpression(Ast.VariableExpression(self.rootScope, self.wrapperId), {
			Ast.NumberExpression(index - self.wrapperOffset);
		});
	end
end

function ConstantArray:getConstant(value, data)
	if(self.lookup[value]) then
		return self:indexing(self.lookup[value], data)
	end
	local idx = #self.constants + 1;
	self.constants[idx] = value;
	self.lookup[value] = idx;
	return self:indexing(idx, data);
end

function ConstantArray:addConstant(value)
	if(self.lookup[value]) then
		return
	end
	local idx = #self.constants + 1;
	self.constants[idx] = value;
	self.lookup[value] = idx;
end

local function reverse(t, i, j)
	while i < j do
	  t[i], t[j] = t[j], t[i]
	  i, j = i+1, j-1
	end
end
  
local function rotate(t, d, n)
	n = n or #t
	d = (d or 1) % n
	reverse(t, 1, n)
	reverse(t, 1, d)
	reverse(t, d+1, n)
end

local rotateCode = [=[
	for i, v in ipairs({{1, LEN}, {1, SHIFT}, {SHIFT + 1, LEN}}) do
		while v[1] < v[2] do
			ARR[v[1]], ARR[v[2]], v[1], v[2] = ARR[v[2]], ARR[v[1]], v[1] + 1, v[2] - 1
		end
	end
]=];

function ConstantArray:addRotateCode(ast, shift)
	local parser = Parser:new({
		LuaVersion = LuaVersion.Lua51;
	});

	local newAst = parser:parse(string.gsub(string.gsub(rotateCode, "SHIFT", tostring(shift)), "LEN", tostring(#self.constants)));
	local forStat = newAst.body.statements[1];
	forStat.body.scope:setParent(ast.body.scope);
	visitast(newAst, nil, function(node, data)
		if(node.kind == AstKind.VariableExpression) then
			if(node.scope:getVariableName(node.id) == "ARR") then
				data.scope:removeReferenceToHigherScope(node.scope, node.id);
				data.scope:addReferenceToHigherScope(self.rootScope, self.arrId);
				node.scope = self.rootScope;
				node.id    = self.arrId;
			end
		end
	end)

	table.insert(ast.body.statements, 1, forStat);
end

function ConstantArray:addDecodeCode(ast)
	if self.Encoding == "base64" then
		local base64DecodeCode = [[
	do ]] .. table.concat(util.shuffle{
		"local lookup = LOOKUP_TABLE;",
		"local len = string.len;",
		"local sub = string.sub;",
		"local floor = math.floor;",
		"local strchar = string.char;",
		"local insert = table.insert;",
		"local concat = table.concat;",
		"local type = type;",
		"local arr = ARR;",
	}) .. [[
		for i = 1, #arr do
			local data = arr[i];
			if type(data) == "string" then
				local length = len(data)
				local parts = {}
				local index = 1
				local value = 0
				local count = 0
				while index <= length do
					local char = sub(data, index, index)
					local code = lookup[char]
					if code then
						value = value + code * (64 ^ (3 - count))
						count = count + 1
						if count == 4 then
							count = 0
							local c1 = floor(value / 65536)
							local c2 = floor(value % 65536 / 256)
							local c3 = value % 256
							insert(parts, strchar(c1, c2, c3))
							value = 0
						end
					elseif char == "=" then
						insert(parts, strchar(floor(value / 65536)));
						if index >= length or sub(data, index + 1, index + 1) ~= "=" then
							insert(parts, strchar(floor(value % 65536 / 256)));
						end
						break
					end
					index = index + 1
				end
				arr[i] = concat(parts)
			end
		end
	end
]];

		local parser = Parser:new({
			LuaVersion = LuaVersion.Lua51;
		});

		local newAst = parser:parse(base64DecodeCode);
		local forStat = newAst.body.statements[1];
		forStat.body.scope:setParent(ast.body.scope);

		visitast(newAst, nil, function(node, data)
			if(node.kind == AstKind.VariableExpression) then
				if(node.scope:getVariableName(node.id) == "ARR") then
					data.scope:removeReferenceToHigherScope(node.scope, node.id);
					data.scope:addReferenceToHigherScope(self.rootScope, self.arrId);
					node.scope = self.rootScope;
					node.id    = self.arrId;
				end

				if(node.scope:getVariableName(node.id) == "LOOKUP_TABLE") then
					data.scope:removeReferenceToHigherScope(node.scope, node.id);
					return self:createBase64Lookup();
				end
			end
		end)
	
		table.insert(ast.body.statements, 1, forStat);
	end
end

function ConstantArray:createBase64Lookup()
	local entries = {};
	local i = 0;
	for char in string.gmatch(self.base64chars, ".") do
		table.insert(entries, Ast.KeyedTableEntry(Ast.StringExpression(char), Ast.NumberExpression(i)));
		i = i + 1;
	end
	util.shuffle(entries);
	return Ast.TableConstructorExpression(entries);
end

local B85_EXCLUDED = {
	[34] = true, [39] = true, [61] = true, [91] = true,
	[92] = true, [93] = true, [96] = true, [123] = true, [125] = true,
}

function ConstantArray:generateB85Alphabet()
	local base = {}
	for i = 33, 126 do
		if not B85_EXCLUDED[i] then
			base[#base + 1] = string.char(i)
		end
	end
	self.b85seed = math.random(1, 2147483646)
	local seed = self.b85seed
	for i = #base, 2, -1 do
		seed = (seed * 16807) % 2147483647
		local j = seed % i + 1
		base[i], base[j] = base[j], base[i]
	end
	self.b85alphabet = table.concat(base)
end

function ConstantArray:serializeConstants()
	local bytes = {}
	local bi = 0  
	local n = #self.constants
	bi = bi + 1; bytes[bi] = n % 256
	bi = bi + 1; bytes[bi] = math.floor(n / 256) % 256
	bi = bi + 1; bytes[bi] = math.floor(n / 65536) % 256
	bi = bi + 1; bytes[bi] = math.floor(n / 16777216) % 256
	for i = 1, n do
		local v = self.constants[i]
		local t = type(v)
		if t == "boolean" then
			bi = bi + 1; bytes[bi] = v and 1 or 0
		elseif t == "number" then
			bi = bi + 1; bytes[bi] = 2
			local s = tostring(v)
			local slen = #s
			bi = bi + 1; bytes[bi] = slen % 256
			bi = bi + 1; bytes[bi] = math.floor(slen / 256) % 256
			bi = bi + 1; bytes[bi] = math.floor(slen / 65536) % 256
			bi = bi + 1; bytes[bi] = math.floor(slen / 16777216) % 256
			for j = 1, slen do
				bi = bi + 1; bytes[bi] = string.byte(s, j)
			end
		elseif t == "string" then
			bi = bi + 1; bytes[bi] = 3
			local slen = #v
			bi = bi + 1; bytes[bi] = slen % 256
			bi = bi + 1; bytes[bi] = math.floor(slen / 256) % 256
			bi = bi + 1; bytes[bi] = math.floor(slen / 65536) % 256
			bi = bi + 1; bytes[bi] = math.floor(slen / 16777216) % 256
			
			local CHUNK = 4096
			for start = 1, slen, CHUNK do
				local tend = math.min(start + CHUNK - 1, slen)
				local sub = {string.byte(v, start, tend)}
				for _, b in ipairs(sub) do
					bi = bi + 1; bytes[bi] = b
				end
			end
		end
	end
	while bi % 4 ~= 0 do
		bi = bi + 1; bytes[bi] = 0
	end
	return bytes
end

function ConstantArray:b85Encode(bytes)
	local alpha = self.b85alphabet
	local encoded = {}
	local ei = 0
	for i = 1, #bytes, 4 do
		local val = bytes[i] * 16777216 + bytes[i + 1] * 65536 + bytes[i + 2] * 256 + bytes[i + 3]
		local c5 = val % 85; val = math.floor(val / 85)
		local c4 = val % 85; val = math.floor(val / 85)
		local c3 = val % 85; val = math.floor(val / 85)
		local c2 = val % 85; val = math.floor(val / 85)
		local c1 = val % 85
		ei = ei + 1
		encoded[ei] = alpha:sub(c1+1,c1+1) .. alpha:sub(c2+1,c2+1) .. alpha:sub(c3+1,c3+1) .. alpha:sub(c4+1,c4+1) .. alpha:sub(c5+1,c5+1)
	end
	return table.concat(encoded)
end

function ConstantArray:addB85DecodeCode(ast)
	local alpha = self.b85alphabet

	
	
	local groups = {}
	local pos = 1
	while pos <= 85 do
		local sz = math.min(math.random(7, 14), 85 - pos + 1)
		local key = math.random(30, 200)
		local vals = {}
		for i = 0, sz - 1 do
			vals[#vals + 1] = tostring(string.byte(alpha, pos + i) + key)
		end
		groups[#groups + 1] = {key = key, vals = vals}
		pos = pos + sz
	end

	
	local keyDecls = {}
	local charFrags = {}
	for gi, g in ipairs(groups) do
		local kname = "_k" .. gi
		keyDecls[#keyDecls + 1] = "local " .. kname .. " = " .. tostring(g.key)
		local args = {}
		for _, v in ipairs(g.vals) do
			args[#args + 1] = v .. " - " .. kname
		end
		charFrags[#charFrags + 1] = "_sc(" .. table.concat(args, ",") .. ")"
	end

	local shuffledLocals = table.concat(util.shuffle({
		"local _sc = string.char;",
		"local _sb = string.byte;",
		"local _flr = math.floor;",
		"local _num = tonumber;",
		"local _cat = table.concat;",
	}), " ")

	local code = "do " .. shuffledLocals .. " "
		.. table.concat(keyDecls, " ") .. " "
		.. "local _a = " .. table.concat(charFrags, " .. ") .. " "
		.. "local _lk = {} for _i = 1, 85 do _lk[_sb(_a, _i)] = _i - 1 end "
		.. "local _tu = table.unpack or unpack "
		
		
		.. "local _mv = table.move or function(_src,_from,_to,_target,_dst) "
		.. "_dst = _dst or _src "
		.. "if _to < _from then return _dst end "
		.. "if _dst == _src and _target > _from then "
		.. "for _j = _to,_from,-1 do _dst[_target+_j-_from] = _src[_j] end "
		.. "else "
		.. "for _j = _from,_to do _dst[_target+_j-_from] = _src[_j] end "
		.. "end return _dst end "
		
		
		.. "local _scratch = {} "
		.. "local function _bts(bytes, pos, len) "
		.. "if len <= 200 then "
		.. "_mv(bytes, pos, pos + len - 1, 1, _scratch) "
		.. "return _sc(_tu(_scratch, 1, len)) "
		.. "else "
		.. "local _parts = {} local _pi = 0 local _i = pos "
		.. "while _i < pos + len do "
		.. "local _chunk = math.min(200, pos + len - _i) "
		.. "_mv(bytes, _i, _i + _chunk - 1, 1, _scratch) "
		.. "_pi = _pi + 1 _parts[_pi] = _sc(_tu(_scratch, 1, _chunk)) "
		.. "_i = _i + _chunk end "
		.. "return table.concat(_parts) end end "
		.. "local _data = ARR local _len = #_data local _bytes = {} local _bi = 0 local _idx = 5 "
		
		.. "while _idx + 4 <= _len do "
		.. "local _c1,_c2,_c3,_c4,_c5 = _sb(_data, _idx, _idx+4) "
		.. "local _v = ((((_lk[_c1] * 85 + _lk[_c2]) * 85 + _lk[_c3]) * 85 + _lk[_c4]) * 85 + _lk[_c5]) "
		.. "_bi = _bi + 1 _bytes[_bi] = _flr(_v / 16777216) % 256 "
		.. "_bi = _bi + 1 _bytes[_bi] = _flr(_v / 65536) % 256 "
		.. "_bi = _bi + 1 _bytes[_bi] = _flr(_v / 256) % 256 "
		.. "_bi = _bi + 1 _bytes[_bi] = _v % 256 "
		.. "_idx = _idx + 5 end "
		.. "local _pos = 1 "
		.. "local _cnt = _bytes[_pos] + _bytes[_pos+1]*256 + _bytes[_pos+2]*65536 + _bytes[_pos+3]*16777216 "
		.. "_pos = _pos + 4 "
		.. "local _res = {} "
		.. "for _i = 1, _cnt do "
		.. "local _tag = _bytes[_pos] _pos = _pos + 1 "
		.. "if _tag == 0 then _res[_i] = false "
		.. "elseif _tag == 1 then _res[_i] = true "
		.. "elseif _tag == 2 then "
		.. "local _sl = _bytes[_pos] + _bytes[_pos+1]*256 + _bytes[_pos+2]*65536 + _bytes[_pos+3]*16777216 "
		.. "_pos = _pos + 4 "
		.. "_res[_i] = _num(_bts(_bytes, _pos, _sl)) _pos = _pos + _sl "
		.. "elseif _tag == 3 then "
		.. "local _sl = _bytes[_pos] + _bytes[_pos+1]*256 + _bytes[_pos+2]*65536 + _bytes[_pos+3]*16777216 "
		.. "_pos = _pos + 4 "
		.. "_res[_i] = _bts(_bytes, _pos, _sl) _pos = _pos + _sl "
		.. "end end "
		.. "ARR = _res "
		.. "end"

	local parser = Parser:new({LuaVersion = LuaVersion.Lua51})
	local newAst = parser:parse(code)
	local doStat = newAst.body.statements[1]
	doStat.body.scope:setParent(ast.body.scope)

	visitast(newAst, nil, function(node, data)
		if node.kind == AstKind.VariableExpression or node.kind == AstKind.AssignmentVariable then
			if node.scope:getVariableName(node.id) == "ARR" then
				data.scope:removeReferenceToHigherScope(node.scope, node.id)
				data.scope:addReferenceToHigherScope(self.rootScope, self.arrId)
				node.scope = self.rootScope
				node.id = self.arrId
			end
		end
	end)

	table.insert(ast.body.statements, 1, doStat)
end

function ConstantArray:encode(str)
	if self.Encoding == "base64" then
		return ((str:gsub('.', function(x) 
			local r,b='',x:byte()
			for i=8,1,-1 do r=r..(b%2^i-b%2^(i-1)>0 and '1' or '0') end
			return r;
		end)..'0000'):gsub('%d%d%d?%d?%d?%d?', function(x)
			if (#x < 6) then return '' end
			local c=0
			for i=1,6 do c=c+(x:sub(i,i)=='1' and 2^(6-i) or 0) end
			return self.base64chars:sub(c+1,c+1)
		end)..({ '', '==', '=' })[#str%3+1]);
	end
end

function ConstantArray:addWrapperFunction(ast)
	local funcScope = Scope:new(self.rootScope);
	funcScope:addReferenceToHigherScope(self.rootScope, self.arrId);

	local arg = funcScope:addVariable();
	local addSubArg;

	if self.wrapperOffset < 0 then
		addSubArg = Ast.SubExpression(Ast.VariableExpression(funcScope, arg), Ast.NumberExpression(-self.wrapperOffset));
	else
		addSubArg = Ast.AddExpression(Ast.VariableExpression(funcScope, arg), Ast.NumberExpression(self.wrapperOffset));
	end

	table.insert(ast.body.statements, 1, Ast.LocalFunctionDeclaration(self.rootScope, self.wrapperId, {
		Ast.VariableExpression(funcScope, arg)
	}, Ast.Block({
		Ast.ReturnStatement({
			Ast.IndexExpression(
				Ast.VariableExpression(self.rootScope, self.arrId),
				addSubArg
			)
		});
	}, funcScope)));
end

function ConstantArray:apply(ast, pipeline)
	self.rootScope = ast.body.scope;
	self.arrId     = self.rootScope:addVariable();

	if self.Encoding == "base64" then
		self.base64chars = table.concat(util.shuffle{
			"A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
			"a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
			"0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
			"+", "/",
		});
	elseif self.Encoding == "b85" then
		self:generateB85Alphabet();
	end

	self.constants = {};
	self.lookup    = {};

	
	local maxLen = self.MaxStringLen or 4096
	visitast(ast, nil, function(node, data)
		if math.random() <= self.Treshold then
			if node.kind == AstKind.StringExpression then
				
				if maxLen > 0 and #node.value > maxLen then
					return  
				end
				node.__apply_constant_array = true;
				self:addConstant(node.value)
			elseif not self.StringsOnly then
				if node.isConstant then
					if node.value ~= nil then
						node.__apply_constant_array = true;
						self:addConstant(node.value);
					end
				end
			end
		end
	end);

	
	if self.Shuffle then
		self.constants = util.shuffle(self.constants);
		self.lookup    = {};
		for i, v in ipairs(self.constants) do
			self.lookup[v] = i;
		end
	end

	
	self.wrapperOffset = math.random(-self.MaxWrapperOffset, self.MaxWrapperOffset);
	self.wrapperId     = self.rootScope:addVariable();

	visitast(ast, function(node, data)
		
		if self.LocalWrapperCount > 0 and node.kind == AstKind.Block and node.isFunctionBlock and math.random() <= self.LocalWrapperTreshold then
			local id = node.scope:addVariable()
			data.functionData.local_wrappers = {
				id = id;
				scope = node.scope,
			};
			local nameLookup = {};
			for i = 1, self.LocalWrapperCount, 1 do
				local name;
				repeat
					name = callNameGenerator(pipeline.namegenerator, math.random(1, self.LocalWrapperArgCount * 16));
				until not nameLookup[name];
				nameLookup[name] = true;

				local offset = math.random(-self.MaxWrapperOffset, self.MaxWrapperOffset);
				local argPos = math.random(1, self.LocalWrapperArgCount);

				data.functionData.local_wrappers[i] = {
					arg   = argPos,
					index = name,
					offset =  offset,
				};
				data.functionData.__used = false;
			end
		end
		if node.__apply_constant_array then
			data.functionData.__used = true;
		end
	end, function(node, data)
		
		if node.__apply_constant_array then
			if node.kind == AstKind.StringExpression then
				return self:getConstant(node.value, data);
			elseif not self.StringsOnly then
				if node.isConstant then
					return node.value ~= nil and self:getConstant(node.value, data);
				end
			end
			node.__apply_constant_array = nil;
		end

		
		if self.LocalWrapperCount > 0 and node.kind == AstKind.Block and node.isFunctionBlock and data.functionData.local_wrappers and data.functionData.__used then
			data.functionData.__used = nil;
			local elems = {};
			local wrappers = data.functionData.local_wrappers;
			for i = 1, self.LocalWrapperCount, 1 do
				local wrapper = wrappers[i];
				local argPos = wrapper.arg;
				local offset = wrapper.offset;
				local name   = wrapper.index;

				local funcScope = Scope:new(node.scope);

				local arg = nil;
				local args = {};

				for i = 1, self.LocalWrapperArgCount, 1 do
					args[i] = funcScope:addVariable();
					if i == argPos then
						arg = args[i];
					end
				end

				local addSubArg;

				if offset < 0 then
					addSubArg = Ast.SubExpression(Ast.VariableExpression(funcScope, arg), Ast.NumberExpression(-offset));
				else
					addSubArg = Ast.AddExpression(Ast.VariableExpression(funcScope, arg), Ast.NumberExpression(offset));
				end

				funcScope:addReferenceToHigherScope(self.rootScope, self.wrapperId);
				local callArg = Ast.FunctionCallExpression(Ast.VariableExpression(self.rootScope, self.wrapperId), {
					addSubArg
				});

				local fargs = {};
				for i, v in ipairs(args) do
					fargs[i] = Ast.VariableExpression(funcScope, v);
				end

				elems[i] = Ast.KeyedTableEntry(
					Ast.StringExpression(name),
					Ast.FunctionLiteralExpression(fargs, Ast.Block({
						Ast.ReturnStatement({
							callArg
						});
					}, funcScope))
				)
			end
			table.insert(node.statements, 1, Ast.LocalVariableDeclaration(node.scope, {
				wrappers.id
			}, {
				Ast.TableConstructorExpression(elems)
			}));
		end
	end);

	if self.Encoding == "b85" then
		

		
		local shift = 0
		if self.Rotate and #self.constants > 1 then
			shift = math.random(1, #self.constants - 1);
			rotate(self.constants, -shift);
		end

		
		local binaryData = self:serializeConstants()
		local b85String = "67fs" .. self:b85Encode(binaryData)

		
		

		
		self:addWrapperFunction(ast);

		
		if shift > 0 then
			self:addRotateCode(ast, shift);
		end

		
		self:addB85DecodeCode(ast);

		
		
		
		
		do
			local CS = 120
			local parts = {}
			for ci = 1, #b85String, CS do
				parts[#parts+1] = Ast.StringExpression(b85String:sub(ci, ci+CS-1))
			end
			local function foldConcat(lo, hi)
				if lo == hi then return parts[lo] end
				local mid = math.floor((lo + hi) / 2)
				return Ast.StrCatExpression(foldConcat(lo, mid), foldConcat(mid + 1, hi))
			end
			local arrExpr = foldConcat(1, #parts)
			table.insert(ast.body.statements, 1, Ast.LocalVariableDeclaration(
				self.rootScope, {self.arrId}, {arrExpr}
			));
		end
	else
		
		self:addDecodeCode(ast);

		local steps = util.shuffle({
			function() self:addWrapperFunction(ast) end,
			function()
				if self.Rotate and #self.constants > 1 then
					local shift = math.random(1, #self.constants - 1);
					rotate(self.constants, -shift);
					self:addRotateCode(ast, shift);
				end
			end,
		});

		for i, f in ipairs(steps) do
			f();
		end

		local nChunks;
		if #self.constants <= 1 then
			nChunks = 1;
		else
			nChunks = math.min(math.random(2, 4), #self.constants);
		end
		local chunks = self:splitConstants(nChunks);
		for i = #chunks, 2, -1 do
			self:addAppendChunkCode(ast, chunks[i]);
		end
		table.insert(ast.body.statements, 1, Ast.LocalVariableDeclaration(self.rootScope, {self.arrId}, {self:createArrayChunk(chunks[1])}));
	end

	self.rootScope = nil;
	self.arrId     = nil;

	self.constants = nil;
	self.lookup    = nil;
end

return ConstantArray;