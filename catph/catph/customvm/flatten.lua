




local ISA = require("catph.customvm.isa")
local OP = ISA.OP

local Flatten = {}

local UNCOND = { [OP.JUMP] = true, [OP.JUMPBACK] = true }
local COND = {
    [OP.JUMPIF]=true,[OP.JUMPIFNOT]=true,
    [OP.JUMPIFEQ]=true,[OP.JUMPIFLE]=true,[OP.JUMPIFLT]=true,
    [OP.JUMPIFNOTEQ]=true,[OP.JUMPIFNOTLE]=true,[OP.JUMPIFNOTLT]=true,
}
local FOROP = { [OP.FORNPREP]=true,[OP.FORNLOOP]=true,[OP.FORGLOOP]=true }

local function isJump(op) return UNCOND[op] or COND[op] or FOROP[op] end

local function copyIns(ins)
    return { op=ins.op, a=ins.a, b=ins.b, c=ins.c, k=ins.k, captures=ins.captures }
end

local function shuffle(arr)
    for i = #arr, 2, -1 do local j=math.random(1,i); arr[i],arr[j]=arr[j],arr[i] end
    return arr
end


local function newStateSystem()
    local M = math.random(50000, 99999)
    local K1 = math.random(3, 997)
    local K2 = math.random(3, 997)
    return { M=M, K1=K1, K2=K2 }
end

local function encodeState(sys, s1, s2, s3)
    return (s1 * sys.K1 + s2 * sys.K2 + s3) % sys.M
end

local function genTriple(sys, target, usedTriples)
    local s1, s2, s3
    repeat
        s1 = math.random(1, 9999)
        s2 = math.random(1, 9999)
        s3 = (target - s1 * sys.K1 - s2 * sys.K2) % sys.M
        if s3 < 0 then s3 = s3 + sys.M end
    until not usedTriples[s1..","..s2..","..s3]
    usedTriples[s1..","..s2..","..s3] = true
    return s1, s2, s3
end


local function emitStateAssign(emit, dst, value, tmp)
    local pat = math.random(1, 4)
    if pat == 1 then
        local a = math.random(1, 5000); local b = value - a
        emit({op=OP.LOADN, a=dst, b=a})
        emit({op=OP.LOADN, a=tmp, b=b})
        emit({op=OP.ADD, a=dst, b=dst, c=tmp})
    elseif pat == 2 then
        local a = math.random(1, 5000); local b = value + a
        emit({op=OP.LOADN, a=dst, b=b})
        emit({op=OP.LOADN, a=tmp, b=a})
        emit({op=OP.SUB, a=dst, b=dst, c=tmp})
    elseif pat == 3 then
        local m = math.random(2, 7)
        local q = math.floor(value / m); local r = value - q*m
        emit({op=OP.LOADN, a=dst, b=q})
        emit({op=OP.LOADN, a=tmp, b=m})
        emit({op=OP.MUL, a=dst, b=dst, c=tmp})
        if r ~= 0 then
            emit({op=OP.LOADN, a=tmp, b=r})
            emit({op=OP.ADD, a=dst, b=dst, c=tmp})
        end
    else
        local a = math.random(0, value); local b = value - a
        emit({op=OP.LOADN, a=tmp, b=a})
        emit({op=OP.LOADN, a=dst, b=b})
        emit({op=OP.ADD, a=dst, b=dst, c=tmp})
    end
end


local function emitOpaquePredicate(emit, regA, tmp, labelTrue)
    local variant = math.random(1, 4)
    if variant == 1 then
        
        emit({op=OP.LOADN, a=tmp, b=0})
        emit({op=OP.MUL, a=tmp, b=regA, c=tmp})
        emit({op=OP.LOADN, a=regA, b=1})
        emit({op=OP.ADD, a=tmp, b=tmp, c=regA})
        emit({op=OP.LOADN, a=regA, b=0})
        return {op=OP.JUMPIFLT, a=regA, b=0, c=tmp, _to=labelTrue}
    elseif variant == 2 then
        
        local k = math.random(2, 9999)
        emit({op=OP.LOADN, a=regA, b=k})
        emit({op=OP.MUL, a=tmp, b=regA, c=regA})
        emit({op=OP.LOADN, a=regA, b=0})
        return {op=OP.JUMPIFLE, a=regA, b=0, c=tmp, _to=labelTrue}
    elseif variant == 3 then
        
        local k = math.random(1, 9999)
        emit({op=OP.LOADN, a=regA, b=0})
        emit({op=OP.LOADN, a=tmp, b=k})
        emit({op=OP.MUL, a=regA, b=regA, c=tmp})
        emit({op=OP.ADD, a=regA, b=regA, c=tmp})
        return {op=OP.JUMPIFEQ, a=regA, b=0, c=tmp, _to=labelTrue}
    else
        
        local k = math.random(100, 9999)
        emit({op=OP.LOADN, a=regA, b=k})
        emit({op=OP.LOADN, a=tmp, b=k})
        emit({op=OP.SUB, a=regA, b=regA, c=tmp})
        emit({op=OP.LOADN, a=tmp, b=0})
        return {op=OP.JUMPIFEQ, a=regA, b=0, c=tmp, _to=labelTrue}
    end
end


local INTENSITY = {
    low    = { nDisp=3, fakeBlocks=3, deadStates=5 },
    medium = { nDisp=4, fakeBlocks=6, deadStates=8 },
    high   = { nDisp=5, fakeBlocks=9, deadStates=12 },
    max    = { nDisp=6, fakeBlocks=14, deadStates=18 },
}

local function flattenProto(proto, opts)
    local code = proto.code
    local n = #code
    if n < 2 then return false end

    local intName = opts.flattenIntensity or "high"
    local params = INTENSITY[intName] or INTENSITY.high
    local minBlocks = opts.flattenMinBlocks or 3
    local chance = opts.flattenChance or 1.0

    
    local leader = {}; leader[1] = true
    for i = 1, n do
        local op = code[i].op
        if op == OP.RETURN then
            if i+1<=n then leader[i+1]=true end
        elseif isJump(op) then
            local t = i+1+(code[i].b or 0)
            if t>=1 and t<=n then leader[t]=true end
            if i+1<=n then leader[i+1]=true end
        end
    end

    local leaders = {}
    for i=1,n do if leader[i] then leaders[#leaders+1]=i end end
    local blocks = {}
    for bi=1,#leaders do
        local s=leaders[bi]; local e=(leaders[bi+1] and leaders[bi+1]-1) or n
        blocks[bi]={start=s, finish=e}
    end

    if #blocks < minBlocks then return false end
    if chance < 1.0 and math.random() > chance then return false end
    
    if (proto.maxstack or 0) > 25 then return false end

    local startToBlock = {}
    for bi, blk in ipairs(blocks) do startToBlock[blk.start] = bi end

    local exitIdx = #blocks + 1
    blocks[exitIdx] = { isExit = true }

    local function blockOf(idx)
        if idx == n+1 then return exitIdx end
        return startToBlock[idx] or exitIdx
    end

    local nReal = #blocks

    
    local sys = newStateSystem()
    local usedTriples = {}
    local usedCombined = {}
    local blockState = {} 
    for bi = 1, nReal do
        local combined
        repeat combined = math.random(1, sys.M - 1) until not usedCombined[combined]
        usedCombined[combined] = true
        local s1, s2, s3 = genTriple(sys, combined, usedTriples)
        blockState[bi] = {s1=s1, s2=s2, s3=s3, combined=combined}
    end

    local deadStateValues = {}
    for _ = 1, params.deadStates do
        local v; repeat v = math.random(1, sys.M-1) until not usedCombined[v]
        usedCombined[v] = true
        deadStateValues[#deadStateValues+1] = v
    end

    local fakeBlocks = {}
    for f = 1, params.fakeBlocks do
        local combined
        repeat combined = math.random(1, sys.M - 1) until not usedCombined[combined]
        usedCombined[combined] = true
        local s1, s2, s3 = genTriple(sys, combined, usedTriples)
        fakeBlocks[f] = {s1=s1, s2=s2, s3=s3, combined=combined, idx=nReal+f}
        blockState[nReal+f] = fakeBlocks[f]
    end

    local nDisp = math.min(params.nDisp, math.max(2, math.floor(nReal / 2)))
    local owner = {}
    for bi = 1, nReal do owner[bi] = math.random(1, nDisp) end
    for _, fb in ipairs(fakeBlocks) do owner[fb.idx] = math.random(1, nDisp) end

    
    
    
    local M = (proto.maxstack or 0) + 12
    local S1, S2, S3 = M, M+1, M+2
    local H, tA, tB = M+3, M+4, M+5

    
    local out = {}
    local labelPos = {}
    local function emit(ins) out[#out+1]=ins; return #out end
    local function emitLabel(label) labelPos[label] = #out+1 end

    local function routeTo(targetIdx)
        local bs = blockState[targetIdx]
        emitStateAssign(emit, S1, bs.s1, tA)
        emitStateAssign(emit, S2, bs.s2, tA)
        emitStateAssign(emit, S3, bs.s3, tA)
        out[#out+1] = {op=OP.JUMP, a=0, b=0, _to="DISP"..owner[targetIdx]}
    end

    routeTo(1)

    
    local dispOrder = {}
    for d=1,nDisp do dispOrder[d]=d end
    shuffle(dispOrder)

    local dispBlocks = {}
    for d=1,nDisp do dispBlocks[d]={} end
    for bi=1,nReal do dispBlocks[owner[bi]][#dispBlocks[owner[bi]]+1]=bi end
    for _,fb in ipairs(fakeBlocks) do dispBlocks[owner[fb.idx]][#dispBlocks[owner[fb.idx]]+1]=fb.idx end

    local allPieces = {}  
    for _,d in ipairs(dispOrder) do allPieces[#allPieces+1]={type="disp", id=d} end

    local blockLayout = {}
    for bi=1,nReal do blockLayout[#blockLayout+1]=bi end
    for _,fb in ipairs(fakeBlocks) do blockLayout[#blockLayout+1]=fb.idx end
    shuffle(blockLayout)
    for _,bi in ipairs(blockLayout) do allPieces[#allPieces+1]={type="block", id=bi} end
    shuffle(allPieces)

    for _, piece in ipairs(allPieces) do
        if piece.type == "disp" then
            local d = piece.id
            emitLabel("DISP"..d)
            emit({op=OP.LOADN, a=tA, b=sys.K1})
            emit({op=OP.MUL, a=H, b=S1, c=tA})
            emit({op=OP.LOADN, a=tA, b=sys.K2})
            emit({op=OP.MUL, a=tA, b=S2, c=tA})
            emit({op=OP.ADD, a=H, b=H, c=tA})
            emit({op=OP.ADD, a=H, b=H, c=S3})
            emit({op=OP.LOADN, a=tA, b=sys.M})
            emit({op=OP.MOD, a=H, b=H, c=tA})

            local entries = {}
            for _, bi in ipairs(dispBlocks[d]) do entries[#entries+1]=bi end
            for _, ds in ipairs(deadStateValues) do
                if math.random() < 0.3 then
                    entries[#entries+1] = {dead=true, val=ds}
                end
            end
            shuffle(entries)

            for _, e in ipairs(entries) do
                if type(e) == "number" then
                    local bs = blockState[e]
                    emit({op=OP.LOADN, a=tB, b=bs.combined})
                    out[#out+1]={op=OP.JUMPIFEQ, a=H, b=0, c=tB, _to="BLK"..e}
                else
                    emit({op=OP.LOADN, a=tB, b=e.val})
                    out[#out+1]={op=OP.JUMPIFEQ, a=H, b=0, c=tB, _to="EXIT"}
                end
            end
            routeTo(exitIdx)

        elseif piece.type == "block" then
            local bi = piece.id
            emitLabel("BLK"..bi)

            if bi > nReal then
                local fakeKind = math.random(1, 4)
                if fakeKind == 1 then
                    local junk = math.random(2, 5)
                    for _=1,junk do
                        emit({op=OP.LOADN, a=tB, b=math.random(1,9999)})
                        emit({op=OP.ADD, a=S1, b=S1, c=tB})
                    end
                elseif fakeKind == 2 then
                    local k1 = math.random(2, 99); local k2 = math.random(100, 999)
                    emit({op=OP.LOADN, a=tA, b=k1})
                    emit({op=OP.LOADN, a=tB, b=k2})
                    emit({op=OP.MUL, a=H, b=tA, c=tB})
                    emit({op=OP.SUB, a=S2, b=S2, c=H})
                    emit({op=OP.ADD, a=S2, b=S2, c=H})
                elseif fakeKind == 3 then
                    local k = math.random(1, 9999)
                    emit({op=OP.LOADN, a=H, b=k})
                    emit({op=OP.MOVE, a=tA, b=H})
                    emit({op=OP.MOVE, a=H, b=tB})
                    emit({op=OP.MOVE, a=tB, b=tA})
                else
                    local km = math.random(100, 9999)
                    emit({op=OP.LOADN, a=tB, b=math.random(1,9999)})
                    emit({op=OP.ADD, a=S3, b=S3, c=tB})
                    emit({op=OP.LOADN, a=tA, b=km})
                    emit({op=OP.MOD, a=S3, b=S3, c=tA})
                end
                routeTo(exitIdx)
            elseif blocks[bi].isExit then
                emitLabel("EXIT")
                emit({op=OP.RETURN, a=0, b=1})
            else
                local blk = blocks[bi]
                local term = code[blk.finish]
                local op = term.op

                if op == OP.RETURN then
                    for i=blk.start, blk.finish do emit(copyIns(code[i])) end
                elseif UNCOND[op] then
                    for i=blk.start, blk.finish-1 do emit(copyIns(code[i])) end
                    routeTo(blockOf(blk.finish+1+(term.b or 0)))
                elseif COND[op] then
                    for i=blk.start, blk.finish-1 do emit(copyIns(code[i])) end
                    local takenBlk = blockOf(blk.finish+1+(term.b or 0))
                    local fallBlk = blockOf(blk.finish+1)
                    local Ltaken = "TAKEN"..bi
                    out[#out+1]={op=op, a=term.a, b=0, c=term.c, k=term.k, _to=Ltaken}
                    routeTo(fallBlk)
                    
                    emitLabel(Ltaken)
                    routeTo(takenBlk)
                elseif FOROP[op] then
                    for i=blk.start, blk.finish-1 do emit(copyIns(code[i])) end
                    local takenBlk = blockOf(blk.finish+1+(term.b or 0))
                    local fallBlk = blockOf(blk.finish+1)
                    local Ltaken = "TAKEN"..bi
                    out[#out+1]={op=op, a=term.a, b=0, c=term.c, k=term.k, _to=Ltaken}
                    routeTo(fallBlk)
                    emitLabel(Ltaken)
                    routeTo(takenBlk)
                else
                    for i=blk.start, blk.finish do emit(copyIns(code[i])) end
                    routeTo(blockOf(blk.finish+1))
                end

                if math.random() < 0.55 and bi < nReal then
                    local noiseKind = math.random(1, 3)
                    if noiseKind == 1 then
                        emit({op=OP.LOADN, a=tA, b=math.random(1,9999)})
                        emit({op=OP.ADD, a=S2, b=S2, c=tA})
                    elseif noiseKind == 2 then
                        local kn = math.random(2, 99)
                        emit({op=OP.LOADN, a=tA, b=kn})
                        emit({op=OP.MUL, a=tB, b=S1, c=tA})
                        emit({op=OP.LOADN, a=tA, b=sys.M})
                        emit({op=OP.MOD, a=tB, b=tB, c=tA})
                    else
                        emit({op=OP.LOADN, a=tB, b=math.random(1,9999)})
                        emit({op=OP.SUB, a=S3, b=S3, c=tB})
                        emit({op=OP.ADD, a=S3, b=S3, c=tB})
                    end
                end
            end
        end
    end

    for idx, ins in ipairs(out) do
        if ins._to then
            local pos = labelPos[ins._to]
            if not pos then
                pos = labelPos["EXIT"] or #out
            end
            ins.b = pos - (idx + 1)
            ins._to = nil
        end
    end

    proto.code = out
    proto.maxstack = tB + 1
    return true
end

function Flatten.flatten(proto, opts)
    opts = opts or {}
    flattenProto(proto, opts)
    for _, child in ipairs(proto.protos or {}) do
        Flatten.flatten(child, opts)
    end
    return proto
end

return Flatten
