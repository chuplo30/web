local Step = require("catph.step")
local Parser = require("catph.parser")
local Enums = require("catph.enums")
local Unparser = require("catph.unparser")
local RatCrypt = require("catph.ratcrypt")
local logger = require("logger")

local RATAntiTamper = Step:extend()
RATAntiTamper.Name = "RATAntiTamper"
RATAntiTamper.Description = "Wraps final code in the rAT env-fingerprint module (key-bound RC4 payload). Executor-only."
RATAntiTamper.SettingsDescriptor = {
    KeyHex = {
        type = "string";
        default = "";
        description = "Hex of keyBytes captured on executor via rat_keydump.lua. Empty = skip (no-op).";
    };
}

function RATAntiTamper:init() end

local RAT_MODULE = [=====[
local Instance = Instance
local Vector3, Vector2, CFrame = Vector3, Vector2, CFrame
local UDim2, Enum, Random = UDim2, Enum, Random
local Path2DControlPoint = Path2DControlPoint
local game, workspace = game, workspace

local getfenv, setfenv = getfenv, setfenv
local getmetatable, setmetatable, rawget = getmetatable, setmetatable, rawget
local pcall, xpcall, type, typeof, select = pcall, xpcall, type, typeof, select
local tostring = tostring
local debugInfo = debug.info
local stringByte, stringPack, stringUnpack = string.byte, string.pack, string.unpack
local stringGmatch = string.gmatch
local bxor, band, lshift, rshift = bit32.bxor, bit32.band, bit32.lshift, bit32.rshift
local tableMove, tableUnpack, tablePack = table.move, table.unpack, table.pack
local bufferCreate, bufferLen = buffer.create, buffer.len
local bufferReadU8, bufferWriteU8 = buffer.readu8, buffer.writeu8
local bufferReadI32 = buffer.readi32
local coroutineCreate, coroutineResume = coroutine.create, coroutine.resume
local coroutineStatus, coroutineClose = coroutine.status, coroutine.close
local coroutineWrap = coroutine.wrap
local taskSpawn, taskDefer, taskDelay, taskWait = task.spawn, task.defer, task.delay, task.wait

local keyBytes = {}
local keyLength = 0

local function pushByte(value)
	keyLength += 1
	keyBytes[keyLength] = value % 256
end

local function pushBytes(value, count)
	for _ = 1, count do
		local low = value % 256
		value = (value - low) // 256
		keyLength += 1
		keyBytes[keyLength] = low
	end
end

local sameProbe = setmetatable({}, { __mode = "k" })
local function same(expected, actual)
	sameProbe[expected] = true
	local matched = sameProbe[actual] == true
	sameProbe[expected] = nil
	return matched
end

local POISON = 411563790
local function crash()
	pushBytes(POISON, 4)
	while true do
	end
end

local function expect(condition, tagByte)
	if condition then
		pushByte(tagByte)
	else
		crash()
	end
end

local function checkLibraryTable(library)
	if type(library) ~= "table" then
		crash()
	end
	if getmetatable(library) ~= "The metatable is locked" then
		crash()
	end
	local writable = pcall(setmetatable, library, {})
	if writable then
		crash()
	end
end

local FNV_OFFSET = 2166136261
local FNV_PRIME = 16777619
local FNV_FINAL = 1130359231
local function fnv1a(text)
	local hash = FNV_OFFSET
	local bytes = { stringByte(text, 1, -1) }
	for index = 1, #bytes do
		hash = bxor(hash, bytes[index])
		hash = (hash * FNV_PRIME) % 4294967296
	end
	return bxor(hash, FNV_FINAL)
end

local function hashCheck(library, requiredNameHashes)
	local missing = {}
	for hash in pairs(requiredNameHashes) do
		missing[hash] = true
	end
	for name in pairs(library) do
		if type(name) == "string" then
			missing[fnv1a(name)] = nil
		end
	end
	if next(missing) ~= nil then
		crash()
	end
end

local iscclosure = iscclosure
local islclosure = islclosure

local function checkFunction(fn, expectedName)
	if type(fn) ~= "function" then
		crash()
	end
	if not iscclosure(fn) then
		crash()
	end
	if islclosure(fn) then
		crash()
	end
	local changed, message = pcall(setfenv, fn, getfenv())
	if changed then
		crash()
	end
	if not same(message, "'setfenv' cannot change environment of given object") then
		crash()
	end
	local source, currentLine, name, _numParams, isVararg = debugInfo(fn, "slnaf")
	if not same(source, "[C]") then
		crash()
	end
	if not same(currentLine, -1) then
		crash()
	end
	if not same(isVararg, true) then
		crash()
	end
	if not same(name, expectedName) then
		crash()
	end
end

local function errorHandler()
	error("re-entrant")
end

local function expectError(fn, ...)
	local ok, message = xpcall(fn, errorHandler, ...)
	if ok then
		crash()
	end
	if not same(message, "error in error handling") then
		crash()
	end
end

local function checkErrorMessage(triggerValue, expectedMessage)
	local ok, message = pcall(function()
		return #triggerValue
	end)
	if ok then
		crash()
	end
	if not same(message, expectedMessage) then
		crash()
	end
end

local function checkInstanceTree(instance, expectedClassName, expectedParent)
	if typeof(instance) ~= "Instance" then
		crash()
	end
	if instance.ClassName ~= expectedClassName then
		crash()
	end
	if expectedParent ~= nil and not same(instance.Parent, expectedParent) then
		crash()
	end
end

local fingerprintStateA = 0
local fingerprintStateB = 0

local function runApiFingerprint()
	local n = 0.5
	local buf = bufferCreate(256)

	assert(true)
	getfenv(0)
	type(n)
	typeof(n)
	select("#", n, n, n)
	tonumber(n)
	tostring(n)
	rawequal(scratch, scratch)

	local probe = {}
	next(probe)
	for _ in pairs(probe) do end
	for _ in ipairs(probe) do end
	rawlen(probe)
	rawget(probe, n)
	rawset(probe, n, n)
	getmetatable(probe)
	setmetatable(probe, probe)
	setmetatable(probe, nil)

	bit32.bor(1, 1)
	bxor(1, 1)
	band(1, 1)
	bit32.bnot(1)
	lshift(1, 1)
	rshift(1, 1)
	bit32.lrotate(1, 1)
	bit32.rrotate(1, 1)
	bit32.countlz(1)
	bit32.countrz(1)

	bufferLen(buf)
	buffer.fromstring("")
	buffer.tostring(buf)
	buffer.readi8(buf, 0)
	bufferReadU8(buf, 0)
	buffer.readi16(buf, 0)
	buffer.readu16(buf, 0)
	bufferReadI32(buf, 0)
	buffer.readu32(buf, 0)
	buffer.readf32(buf, 0)
	buffer.readf64(buf, 0)
	buffer.writei8(buf, 0, 0)
	bufferWriteU8(buf, 0, 0)
	buffer.writei16(buf, 0, 0)
	buffer.writeu16(buf, 0, 0)
	buffer.writei32(buf, 0, 0)
	buffer.writeu32(buf, 0, 0)
	buffer.writef32(buf, 0, 0)
	buffer.writef64(buf, 0, 0)
	buffer.readstring(buf, 0, 1)
	buffer.writestring(buf, 0, "Luraph")
	buffer.readbits(buf, 0, 1)
	buffer.writebits(buf, 0, 1, 0)
	buffer.copy(buf, 0, buf, 0, 1)
	buffer.fill(buf, 0, 0, 1)

	local randomProbe = Random.new()
	randomProbe:NextInteger(0, 1)
	randomProbe:NextNumber(0, 1)
	randomProbe:NextUnitVector()
	randomProbe:NextNumber()
	randomProbe:Shuffle({})
	randomProbe:Clone()

	local vecA = vector.create(n, n, n)
	local vecB = vector.create(n, n, n)
	local axisX, axisY, axisZ = vector.create(1, 0, 0), vector.create(0, 1, 0), vector.create(0, 0, 1)
	vecA:Abs(); vecA:Ceil(); vecA:Floor(); vecA:Sign()
	vecA:Dot(vecB); vecA:Cross(vecB); vecA:Angle(vecB); vecA:FuzzyEq(vecB)
	vecA:Lerp(vecB, n); vecA:Max(vecB); vecA:Min(vecB)
	local _ = vecA.X + vecA.Y + vecA.Z + vecA.Magnitude
	_ = (vecA + vecB) - (vecA * vecB)
	_ = (vecA / vecB) + (-vecA)
	_ = vecA.Unit
	Vector3.FromAxis(Enum.Axis.X)
	Vector3.FromNormalId(Enum.NormalId.Top)

	local identity = CFrame.new()
	local shifted = CFrame.new(vecA)
	CFrame.Angles(n, n, n)
	CFrame.new(vecA, vecB)
	CFrame.new(n, n, n, 0, 0, 0, 1)
	CFrame.new(n, n, n, 1, 0, 0, 0, 1, 0, 0, 0, 1)
	CFrame.lookAt(vecA, vecB, axisY)
	CFrame.lookAlong(vecA, vecB, axisY)
	CFrame.fromEulerAnglesXYZ(n, n, n)
	CFrame.fromEulerAnglesYXZ(n, n, n)
	CFrame.fromOrientation(n, n, n)
	CFrame.fromAxisAngle(axisX, n)
	CFrame.fromRotationBetweenVectors(axisX, axisY)
	CFrame.fromMatrix(vecA, axisX, axisY, axisZ)
	CFrame.fromEulerAngles(n, n, n, Enum.RotationOrder.XYZ)
	identity:Inverse(); identity:Orthonormalize(); identity:Lerp(shifted, n)
	identity:ToWorldSpace(shifted); identity:ToObjectSpace(shifted)
	identity:ToEulerAnglesXYZ(); identity:ToEulerAnglesYXZ()
	identity:PointToWorldSpace(vecA); identity:PointToObjectSpace(vecA)
	identity:VectorToWorldSpace(vecB); identity:VectorToObjectSpace(vecB)
	identity:ToEulerAngles(Enum.RotationOrder.XYZ)
	identity:GetComponents(); identity:ToOrientation(); identity:ToAxisAngle()
	identity:FuzzyEq(shifted); identity:AngleBetween(shifted)
	_ = identity.Position + identity.LookVector + identity.RightVector + identity.UpVector
	_ = identity.X + identity.Y + identity.Z
	_ = (identity * shifted) + axisX

	local vec2A = Vector2.new(n, n)
	local vec2B = Vector2.new(n, n)
	vec2A:Abs(); vec2A:Ceil(); vec2A:Floor(); vec2A:Sign()
	vec2A:Dot(vec2B); vec2A:Cross(vec2B); vec2A:Angle(vec2B); vec2A:FuzzyEq(vec2B)
	vec2A:Lerp(vec2B, n); vec2A:Max(vec2B); vec2A:Min(vec2B)
	_ = vec2A.X + vec2A.Y + vec2A.Magnitude
	_ = (vec2A + vec2B) - (vec2A * vec2B)
	_ = (vec2A / vec2B) + (-vec2A)
	_ = vec2A.Unit

	local udimA = UDim.new(n, 0)
	local udimB = UDim.new(n, 0)
	_ = udimA.Scale + udimA.Offset
	_ = (udimA + udimB) - udimA
	local udim2A = UDim2.new(n, 0, n, 0)
	local udim2B = UDim2.new(n, 0, n, 0)
	UDim2.fromScale(n, n)
	UDim2.fromOffset(0, 0)
	udim2A:Lerp(udim2B, n)
	_ = (udim2A + udim2B) - udim2A
	_ = udim2A.X.Scale + udim2A.Y.Scale + udim2A.Width.Scale + udim2A.Height.Scale

	local normalIdType = Enum.NormalId
	local item = normalIdType:FromName("Bottom")
	item.EnumType:GetEnumItems()
	item.EnumType:FromName(item.Name)
	item.EnumType:FromValue(item.Value)

	local controlA = Path2DControlPoint.new(UDim2.new(n, 0, n, 0))
	local controlB = Path2DControlPoint.new(UDim2.new(n, 0, n, 0))
	local probePath = Instance.new("Path2D")
	probePath:Lerp(controlA, controlB, n)
	probePath:SetControlPoints({ controlA, controlB })
	probePath:GetControlPoints()
	probePath:GetControlPoint(1)
	probePath:GetLength()
	probePath:GetBoundingRect()
	probePath:GetMaxControlPoints()
	probePath:GetPositionOnCurve(n)
	probePath:GetPositionOnCurveArcLength(n)
	probePath:GetTangentOnCurve(n)
	probePath:GetTangentOnCurveArcLength(n)
	probePath:UpdateControlPoint(1, controlA)
	probePath:InsertControlPoint(2, controlB)
	probePath:RemoveControlPoint(2)

	local sampleText = utf8.char(121, 643, 357079)
	utf8.codepoint(sampleText, 1, #sampleText)
	utf8.len(sampleText)
	utf8.offset(sampleText, 3)
	utf8.offset(sampleText, -3)
	for _, _ in utf8.codes(sampleText) do end
	utf8.nfcnormalize(sampleText)
	utf8.nfdnormalize(sampleText)
	for _ in utf8.graphemes(sampleText, 1, #sampleText) do end

	fingerprintStateA = (576739 * fingerprintStateA + 88327651) % 268435456
	fingerprintStateB = (1 * fingerprintStateB + 112596332) % 268435456
end

local STACK_PROBE_LIMIT = 198
local function makeStackDepthProbe()
	local metatable = {}
	local depth = 0
	local sentinel = setmetatable({}, metatable)
	local function descend()
		depth += 1
		if depth == STACK_PROBE_LIMIT then
			fingerprintStateA = (1 * fingerprintStateA + 266475874) % 268435456
			fingerprintStateB = (586507 * fingerprintStateB + 237326973) % 268435456
			return
		end
		return sentinel[depth]
	end
	metatable.__index = descend
	metatable.__newindex = descend
	return sentinel, descend
end

local BLACKLISTED_GLOBAL_HASHES = {
	[4054277589] = 324, [2226045243] = 81, [1242357987] = 324, [3225300577] = 324,
	[1582669312] = 81, [3613460652] = 81, [1813569791] = 162, [3372828208] = 324,
	[2702538947] = 324, [4082325875] = 81, [1747615007] = 324, [2776356969] = 81,
	[1138619741] = 324, [1118112946] = 81, [2939653183] = 324, [3047858663] = 81,
	[27922227] = 324, [2077978559] = 81, [322070949] = 324, [1102990847] = 324,
	[148437406] = 324, [2715901866] = 324, [239720448] = 81, [582326279] = 162,
	[4202609169] = 324, [1462615801] = 324, [3198860002] = 81, [4029027107] = 324,
	[2162883303] = 81, [4287790819] = 324, [457612053] = 324, [3014317913] = 81,
}

local ENVIRONMENT_SCAN_LIMIT = 50
local function scanEnvironmentForExecutor()
	local pending = { getfenv() }
	local visited = setmetatable({}, { __mode = "k" })
	local hashed = {}
	local examined = 0
	local cursor = 1
	while pending[cursor] ~= nil do
		local current = pending[cursor]
		cursor += 1
		if type(current) == "table" and not visited[current] then
			visited[current] = true
			for key in pairs(current) do
				if type(key) == "string" then
					local hash = fnv1a(key)
					if not hashed[hash] then
						hashed[hash] = true
						if BLACKLISTED_GLOBAL_HASHES[hash] ~= nil then
							crash()
						end
						examined += 1
						if examined > ENVIRONMENT_SCAN_LIMIT then
							break
						end
					end
				end
				local value = current[key]
				if type(value) == "table" and not visited[value] then
					pending[#pending + 1] = value
				end
			end
			local metatable = getmetatable(current)
			if type(metatable) == "table" then
				local index = rawget(metatable, "__index")
				if type(index) == "table" and not visited[index] then
					pending[#pending + 1] = index
				end
			end
		end
	end
end

local KEY_SCHEDULE_PASSES = 3
local function deriveKeyState(keyTable, keyCount)
	local state = {}
	for index = 0, 255 do
		state[index] = index
	end
	local swap = 0
	local counter = 0
	for _ = 1, KEY_SCHEDULE_PASSES do
		for index = 0, 255 do
			swap = (swap + state[index] + keyTable[(counter % keyCount) + 1]) % 256
			state[index], state[swap] = state[swap], state[index]
			counter += 1
		end
	end
	return state
end

local function decryptPayload(cipher, cipherLength, keyState)
	local plain = bufferCreate(cipherLength)
	local i, j = 0, 0
	for position = 0, cipherLength - 1 do
		i = (i + 1) % 256
		j = (j + keyState[i]) % 256
		keyState[i], keyState[j] = keyState[j], keyState[i]
		local keyStreamByte = keyState[(keyState[i] + keyState[j]) % 256]
		local cipherByte = bufferReadU8(cipher, position)
		bufferWriteU8(plain, position, bxor(cipherByte, keyStreamByte))
	end
	return plain
end

local FROZEN_LIBRARIES = { Instance, Vector3, Vector2, CFrame, Random }

local GLOBAL_FUNCTION_CHECKS = {
	{ getmetatable, "getmetatable" }, { setmetatable, "setmetatable" }, { tonumber, "tonumber" },
	{ tostring, "tostring" }, { rawset, "rawset" }, { rawget, "rawget" }, { select, "select" },
	{ xpcall, "xpcall" }, { assert, "assert" }, { error, "error" }, { pcall, "pcall" },
	{ type, "type" }, { next, "next" }, { getfenv, "getfenv" }, { setfenv, "setfenv" }, { typeof, "typeof" },
	{ string.gmatch, "gmatch" }, { string.format, "format" }, { string.match, "match" }, { string.find, "find" },
	{ string.char, "char" }, { string.byte, "byte" }, { string.gsub, "gsub" }, { string.sub, "sub" },
	{ string.rep, "rep" }, { string.unpack, "unpack" }, { string.pack, "pack" },
	{ table.concat, "concat" }, { table.insert, "insert" }, { table.pack, "pack" }, { table.clear, "clear" },
	{ table.create, "create" }, { table.move, "move" },
	{ bit32.bor, "bor" }, { bit32.bnot, "bnot" }, { bit32.bxor, "bxor" }, { bit32.band, "band" },
	{ bit32.lshift, "lshift" }, { bit32.rshift, "rshift" }, { bit32.rrotate, "rrotate" }, { bit32.lrotate, "lrotate" },
	{ bit32.countlz, "countlz" }, { bit32.countrz, "countrz" },
	{ buffer.len, "len" }, { buffer.fill, "fill" }, { buffer.copy, "copy" }, { buffer.create, "create" },
	{ buffer.tostring, "tostring" }, { buffer.fromstring, "fromstring" }, { buffer.readstring, "readstring" },
	{ buffer.writestring, "writestring" }, { buffer.readi8, "readi8" }, { buffer.readu8, "readu8" },
	{ buffer.readi16, "readi16" }, { buffer.readu16, "readu16" }, { buffer.readi32, "readi32" },
	{ buffer.readu32, "readu32" }, { buffer.readf32, "readf32" }, { buffer.readf64, "readf64" },
	{ buffer.writei8, "writei8" }, { buffer.writeu8, "writeu8" }, { buffer.writei16, "writei16" },
	{ buffer.writeu16, "writeu16" }, { buffer.writei32, "writei32" }, { buffer.writeu32, "writeu32" },
	{ buffer.writef32, "writef32" }, { buffer.writef64, "writef64" }, { buffer.readbits, "readbits" },
	{ buffer.writebits, "writebits" },
	{ coroutine.isyieldable, "isyieldable" }, { coroutine.running, "running" }, { coroutine.create, "create" },
	{ coroutine.status, "status" }, { coroutine.yield, "yield" }, { coroutine.close, "close" },
	{ coroutine.resume, "resume" }, { coroutine.wrap, "wrap" },
	{ task.cancel, "cancel" }, { task.spawn, "spawn" }, { task.defer, "defer" }, { task.delay, "delay" },
	{ task.wait, "wait" }, { unpack, "unpack" }, { debug.info, "info" }, { debug.traceback, "traceback" },
	{ Instance.new, "new" }, { Vector3.new, "new" }, { Vector2.new, "new" }, { Color3.new, "new" },
	{ Rect.new, "new" }, { Vector3.FromAxis, "FromAxis" }, { UDim2.new, "new" }, { UDim.new, "new" },
	{ Path2DControlPoint.new, "new" }, { Random.new, "new" },
}

local function rAT(encryptedPayload, payloadLength)
	for _, library in ipairs(FROZEN_LIBRARIES) do
		checkLibraryTable(library)
	end
	for _, entry in ipairs(GLOBAL_FUNCTION_CHECKS) do
		checkFunction(entry[1], entry[2])
	end

	hashCheck(utf8, { [3245763734] = 1300424521, [1580185250] = 756925187, [2871118673] = 453021782 })
	hashCheck(math, { [1699574985] = 316179989, [4075563477] = 282327979, [1710487655] = 1115669566 })
	hashCheck(debug, {
		[2095218007] = 1080458674, [601092564] = 553161844, [3614180856] = 1382511578,
		[3607018220] = 712404421, [1212069259] = 1592113891,
	})
	hashCheck(task, { [1031309186] = 685500911, [2352420759] = 547216265 })

	coroutineWrap(runApiFingerprint)()

	local stackSentinel, descend = makeStackDepthProbe()
	pcall(descend)

	local firstWaiter = coroutineCreate(taskWait)
	coroutineResume(firstWaiter, 0)
	expect(same("suspended", coroutineStatus(firstWaiter)), 88)
	pcall(coroutineClose, firstWaiter)

	taskSpawn(function()
		coroutineClose(coroutine.running())
	end)
	taskDefer(function()
		crash()
	end)
	taskDelay(786, function()
		crash()
	end)

	for _, entry in ipairs(GLOBAL_FUNCTION_CHECKS) do
		expectError(entry[1])
	end

	scanEnvironmentForExecutor()

	for name in stringGmatch("DataModel Workspace", "%a+") do
		local _ = name
	end
	checkInstanceTree(game, "DataModel")
	checkInstanceTree(workspace, "Workspace", game)
	expect(same(workspace.Parent, game), 40)

	local probeFolder = Instance.new("Folder")
	checkInstanceTree(probeFolder, "Folder")
	probeFolder:Destroy()

	local httpService = game:GetService("HttpService")
	checkInstanceTree(httpService, "HttpService", game)
	local runService = game:GetService("RunService")
	checkInstanceTree(runService, "RunService", game)

	checkFunction(runService.IsStudio, "IsStudio")
	checkFunction(runService.IsClient, "IsClient")
	checkFunction(runService.IsServer, "IsServer")
	expectError(runService.IsStudio)
	expectError(runService.IsClient)
	expectError(runService.IsServer)

	expect(type(Enum) == "userdata", 47)
	expect(typeof(Enum) == "Enums", 103)
	expect(same(getmetatable(Enum), "The metatable is locked"), 252)

	local sampleItem = Enum.HumanoidDisplayDistanceType.Subject.EnumType.None
	expect(type(sampleItem) == "userdata", 54)
	expect(typeof(sampleItem) == "EnumItem", 235)
	expect(same(getmetatable(sampleItem), "The metatable is locked"), 66)
	checkFunction(sampleItem.IsA, "IsA")
	expectError(sampleItem.IsA)
	expect(type(sampleItem.Name) == "string", 128)
	expect(type(sampleItem.Value) == "number", 163)
	expect(same(sampleItem, sampleItem.EnumType[sampleItem.Name]), 44)
	expect(type(sampleItem.EnumType) == "userdata", 183)
	expect(typeof(sampleItem.EnumType) == "Enum", 206)
	expect(same(getmetatable(sampleItem.EnumType), "The metatable is locked"), 220)
	checkFunction(sampleItem.EnumType.FromName, "FromName")
	checkFunction(sampleItem.EnumType.FromValue, "FromValue")
	expectError(sampleItem.EnumType.FromName)
	expectError(sampleItem.EnumType.FromValue)
	expect(same(sampleItem, sampleItem.EnumType:FromName(sampleItem.Name)), 114)
	expect(same(sampleItem, sampleItem.EnumType:FromValue(sampleItem.Value)), 246)

	checkFunction(Random.new, "new")
	expectError(Random.new, {})
	local randomShape = Random.new(628902471)
	expect(type(randomShape) == "userdata", 120)
	expect(typeof(randomShape) == "Random", 216)
	checkFunction(randomShape.NextUnitVector, "NextUnitVector")
	checkFunction(randomShape.NextInteger, "NextInteger")
	checkFunction(randomShape.NextNumber, "NextNumber")
	checkFunction(randomShape.Shuffle, "Shuffle")
	checkFunction(randomShape.Clone, "Clone")

	local function floatToKeyBytes(value, packFormat, unpackFormat)
		pushBytes(stringUnpack(unpackFormat, stringPack(packFormat, value)), 4)
	end

	local axisVector = Vector3.FromAxis(Enum.Axis.Y)
	expect(type(axisVector) == "vector", 157)
	local normalVector = Vector3.FromNormalId(Enum.NormalId.Back)
	expect(type(normalVector) == "vector", 187)
	pushBytes(normalVector.Y * 2871532381, 4)
	pushBytes(normalVector.Z * 3265937131, 4)

	local NFC_INPUT = "\225\132\146\225\133\180\225\134\180\198\183\204\140\225\132\140\225\133\169\225\135\130\225\132\144\225\133\175\225\135\128\225\132\129\225\133\175\225\134\173\225\132\136\225\133\174\225\134\177\225\132\134\225\133\174\225\134\189\225\132\136\225\133\176\225\134\185\225\132\145\225\133\181\225\134\181"
	local NFD_INPUT = "\237\147\161\235\180\149\234\187\152\236\181\140\234\188\187\236\161\165"
	local NORMALIZED_BYTE_ORDER = {
		1, 21, 35, 32, 19, 44, 16, 13, 46, 20, 49, 9, 50, 17, 22, 20, 24, 31, 40, 26,
		33, 27, 10, 37, 11, 47, 5, 18, 51, 1, 36, 2, 45, 4, 41, 4, 23, 6, 9, 7,
		25, 12, 15, 26, 23, 17, 12, 16, 5, 48, 24, 15, 3, 38, 21, 28, 2, 14, 29, 39,
		8, 43, 13, 34, 10, 22, 25, 14, 18, 42, 7, 19, 3, 11, 6, 30,
	}
	local normalizedBytes = {}
	local nfc = utf8.nfcnormalize(NFC_INPUT)
	local nfd = utf8.nfdnormalize(NFD_INPUT)
	tableMove({ stringByte(nfc, 1, -1) }, 1, #nfc, 1, normalizedBytes)
	tableMove({ stringByte(nfd, 1, -1) }, 1, #nfd, #normalizedBytes + 1, normalizedBytes)
	for _, index in ipairs(NORMALIZED_BYTE_ORDER) do
		pushByte(normalizedBytes[index])
	end

	local PATH_CONTROL_POINTS = {
		{ UDim2.new(0.0625, -10, 0.0625, 4), UDim2.new(0, 5, 0, -2), UDim2.new(0, -8, 0, -5) },
		{ UDim2.new(0.3125, -2, 0.125, 5), UDim2.new(-0.125, -2, 0, 6), UDim2.new(0, 0, 0, 0) },
		{ UDim2.new(0, 0, 0.125, 2), UDim2.new(0, -2, -0.0625, -2), UDim2.new(0, -6, -0.125, 5) },
		{ UDim2.new(0, 0, 0, -4), UDim2.new(0, 3, 0, -7), UDim2.new(0, 0, 0, 0) },
		{ UDim2.new(0, -9, 0.25, 7), UDim2.new(-0.125, 2, 0, 7), UDim2.new(0, 1, -0.125, -4) },
	}
	local POSITION_SAMPLES = {
		{ 0.93333333730697632, ">f", "<I4", ">f", "<I4" },
		{ 0.23076923191547394, ">f", ">I4", ">f", "<I4" },
		{ 0.85714286565780640, ">f", ">I4", ">f", "<I4" },
		{ 0.37500000000000000, "<f", ">I4", ">f", "<I4" },
	}
	local TANGENT_SAMPLES = {
		{ 0.75000000000000000, ">f", ">I4", "<f", ">I4" },
		{ 0.31250000000000000, ">f", ">I4", ">f", ">I4" },
		{ 0.33333334326744080, ">f", "<I4", "<f", ">I4" },
		{ 0.45454546809196472, ">f", ">I4", "<f", "<I4" },
	}
	local POSITION_ARC_SAMPLES = {
		{ 0.16666667163372040, ">f", ">I4", ">f", ">I4" },
		{ 0.46666666865348816, ">f", ">I4", "<f", "<I4" },
		{ 0.18181818723678589, ">f", ">I4", "<f", "<I4" },
	}
	local TANGENT_ARC_SAMPLES = {
		{ 0.37500000000000000, "<f", "<I4", "<f", ">I4" },
		{ 0.66666668653488159, ">f", "<I4", ">f", "<I4" },
	}

	local measureGui = Instance.new("ScreenGui")
	local measureFrame = Instance.new("Frame")
	measureFrame.Position = UDim2.new(0, 0, 0, 0)
	measureFrame.Size = UDim2.new(0, 280, 0, 144)
	measureFrame.Parent = measureGui
	local measurePath = Instance.new("Path2D")
	measurePath.Parent = measureFrame
	local controlObjects = {}
	for pointIndex, parts in ipairs(PATH_CONTROL_POINTS) do
		controlObjects[pointIndex] = Path2DControlPoint.new(parts[1], parts[2], parts[3])
	end
	measurePath:SetControlPoints(controlObjects)

	floatToKeyBytes(measurePath:GetLength(), ">f", "<I4")
	for _, sample in ipairs(POSITION_SAMPLES) do
		local point = measurePath:GetPositionOnCurve(sample[1])
		floatToKeyBytes(point.X.Scale, sample[2], sample[3])
		floatToKeyBytes(point.Y.Scale, sample[4], sample[5])
	end
	for _, sample in ipairs(TANGENT_SAMPLES) do
		local tangent = measurePath:GetTangentOnCurve(sample[1])
		floatToKeyBytes(tangent.X, sample[2], sample[3])
		floatToKeyBytes(tangent.Y, sample[4], sample[5])
	end
	for _, sample in ipairs(POSITION_ARC_SAMPLES) do
		local point = measurePath:GetPositionOnCurveArcLength(sample[1])
		floatToKeyBytes(point.X.Scale, sample[2], sample[3])
		floatToKeyBytes(point.Y.Scale, sample[4], sample[5])
	end
	for _, sample in ipairs(TANGENT_ARC_SAMPLES) do
		local tangent = measurePath:GetTangentOnCurveArcLength(sample[1])
		floatToKeyBytes(tangent.X, sample[2], sample[3])
		floatToKeyBytes(tangent.Y, sample[4], sample[5])
	end
	measureGui:Destroy()

	local deterministicRandom = Random.new(594143689)
	local randomGenerator = deterministicRandom:Clone()
	floatToKeyBytes(randomGenerator:NextNumber(), ">f", "<I4")
	pushBytes(randomGenerator:NextInteger(864, 1510), 4)
	pushBytes(randomGenerator:NextInteger(602, 1478), 4)
	pushBytes(randomGenerator:NextInteger(728, 803), 4)
	pushBytes(randomGenerator:NextInteger(561, 856), 4)
	pushBytes(randomGenerator:NextInteger(988, 1567), 4)
	randomGenerator = deterministicRandom:Clone()
	floatToKeyBytes(randomGenerator:NextNumber(), "<f", ">I4")
	pushBytes(randomGenerator:NextInteger(149, 682), 4)
	pushBytes(randomGenerator:NextInteger(478, 872), 4)
	randomGenerator = deterministicRandom:Clone()
	pushBytes(randomGenerator:NextInteger(393, 1205), 4)
	randomGenerator = deterministicRandom:Clone()
	pushBytes(randomGenerator:NextInteger(601, 928), 4)
	pushBytes(randomGenerator:NextInteger(478, 1179), 4)
	randomGenerator = deterministicRandom:Clone()
	pushBytes(randomGenerator:NextInteger(294, 597), 4)

	local SALT_TABLE = {
		60972, 460096266, 3962068832, 52332040, 1549054100,
		2613069128, 922763774, 1075417252, 196617657,
	}
	for _, salt in ipairs(SALT_TABLE) do
		pushBytes(salt, 4)
	end

	local derivedState = deriveKeyState(keyBytes, keyLength)
	local plain = decryptPayload(encryptedPayload, payloadLength, derivedState)
	return plain
end

return rAT
]=====]

local B85D = [[
local function _b85d(s, alpha)
    local lk = {}
    for _i = 1, #alpha do lk[string.byte(alpha, _i)] = _i - 1 end
    local out = {}
    local oi = 0
    local n = #s
    local p = 1
    while p + 4 <= n do
        local c1, c2, c3, c4, c5 = string.byte(s, p, p + 4)
        local v = (((lk[c1] * 85 + lk[c2]) * 85 + lk[c3]) * 85 + lk[c4]) * 85 + lk[c5]
        oi = oi + 1 out[oi] = math.floor(v / 16777216) % 256
        oi = oi + 1 out[oi] = math.floor(v / 65536) % 256
        oi = oi + 1 out[oi] = math.floor(v / 256) % 256
        oi = oi + 1 out[oi] = v % 256
        p = p + 5
    end
    return out
end
]]

function RATAntiTamper.wrapSource(sourceText, keyHex)
    local key = RatCrypt.hexToBytes(keyHex)
    local data = RatCrypt.bytesOf(sourceText)
    local st = RatCrypt.ksa3(key)
    local cipher = RatCrypt.crypt(st, data)
    local b85 = RatCrypt.b85encode(cipher)
    local parts = {}
    for i = 1, #b85, 180 do
        local piece = b85:sub(i, math.min(i + 179, #b85))
        assert(not piece:find('[%z\1-\8\11\12\14-\31"\\]'), "b85 unsafe char")
        parts[#parts + 1] = '"' .. piece .. '"'
    end
    return {
        blobExpr = "(" .. table.concat(parts, "..") .. ")",
        alpha = RatCrypt.ALPHA,
        len = #sourceText,
    }
end

function RATAntiTamper:apply(ast, pipeline)
    if os.getenv("CATPH_SKIP_RAT") then return ast end
    local keyHex = self.KeyHex or ""
    if keyHex == "" then
        logger:warn("RATAntiTamper: KeyHex empty, skipping (set key to activate)");
        return ast
    end
    local ok, key = pcall(RatCrypt.hexToBytes, keyHex)
    if not ok or #key < 16 then
        logger:warn("RATAntiTamper: bad KeyHex, skipping");
        return ast
    end
    local Unparser = require("catph.unparser")
    local src = Unparser:new({ LuaVersion = Enums.LuaVersion.LuaU }):unparse(ast)
    local w = RATAntiTamper.wrapSource(src, keyHex)
    local code = "local _rATfn = (function()\n" .. RAT_MODULE .. "\nend)()\n"
        .. "local _alpha = \"" .. w.alpha .. "\"\n"
        .. B85D .. "\n"
        .. "local _bytes = _b85d(" .. w.blobExpr .. ", _alpha)\n"
        .. "local _cb = buffer.create(" .. w.len .. ")\n"
        .. "for _i = 1, " .. w.len .. " do buffer.writeu8(_cb, _i - 1, _bytes[_i]) end\n"
        .. "local _plain = _rATfn(_cb, " .. w.len .. ")\n"
        .. "local _ld = loadstring or load\n"
        .. "return (assert(_ld(buffer.tostring(_plain))))(...)\n"
    local ok2, parsed = pcall(function()
        return Parser:new({ LuaVersion = Enums.LuaVersion.LuaU }):parse(code)
    end)
    if not ok2 or not parsed then
        logger:warn("RATAntiTamper: wrapper parse failed, skipping");
        return ast
    end
    return parsed
end

return RATAntiTamper
