local BODIES={}
BODIES[0]=[=[X[Inst.A] = X[Inst.B];]=]
BODIES[1]=[=[X[Inst.A] = (type(Inst.D) == "number" and Inst.D % 1 == 0) and math.floor(Inst.D) or Inst.D]=]
BODIES[2]=[=[
        X[Inst.A] = Inst.B ~= 0
        if Inst.C ~= 0 then z = z + 1 end;
        ]=]
BODIES[3]=[=[
        for i = Inst.A, Inst.B do X[i] = nil end;
        ]=]
BODIES[4]=[=[
        local Uv = n[Inst.B]
        X[Inst.A] = Uv.M[Uv.N]
        ]=]
BODIES[5]=[=[
        X[Inst.A] = Env[Inst.D]
        ]=]
BODIES[6]=[=[
        local N
        if Inst.a then
            N = Inst.R
        else
            N = X[Inst.C]
        end
        X[Inst.A] = X[Inst.B][N]
        ]=]
BODIES[7]=[=[
        Env[Inst.D] = X[Inst.A]
        ]=]
BODIES[8]=[=[
        local Uv = n[Inst.B]
        Uv.M[Uv.N] = X[Inst.A]
        ]=]
BODIES[9]=[=[
        local N, m
        if Inst.s then
            N = Inst.L
        else
            N = X[Inst.B]
        end
        if Inst.a then
            m = Inst.R
        else
            m = X[Inst.C]
        end
        X[Inst.A][N] = m
        ]=]
BODIES[10]=[=[
        X[Inst.A] = {}
        ]=]
BODIES[11]=[=[
        local A = Inst.A
        local B = Inst.B
        local N;
        if Inst.a then
            N = Inst.R
        else
            N = X[Inst.C]
        end
        X[A + 1] = X[B]
        X[A] = X[B][N]
        ]=]
BODIES[12]=[=[
        local Lhs, Rhs;
        if Inst.s then
            Lhs = Inst.L
        else
            Lhs = X[Inst.B]
        end
        if Inst.a then
            Rhs = Inst.R
        else
            Rhs = X[Inst.C]
        end
        X[Inst.A] = NormalizeNumber(Lhs + Rhs)
        ]=]
BODIES[13]=[=[
        local Lhs, Rhs;
        if Inst.s then
            Lhs = Inst.L
        else
            Lhs = X[Inst.B]
        end
        if Inst.a then
            Rhs = Inst.R
        else
            Rhs = X[Inst.C]
        end
        X[Inst.A] = NormalizeNumber(Lhs - Rhs)
        ]=]
BODIES[14]=[=[
        local Lhs, Rhs;
        if Inst.s then
            Lhs = Inst.L
        else
            Lhs = X[Inst.B]
        end
        if Inst.a then
            Rhs = Inst.R
        else
            Rhs = X[Inst.C]
        end
        X[Inst.A] = NormalizeNumber(Lhs * Rhs)
        ]=]
BODIES[15]=[=[
        local Lhs, Rhs;
        if Inst.s then
            Lhs = Inst.L
        else
            Lhs = X[Inst.B]
        end
        if Inst.a then
            Rhs = Inst.R
        else
            Rhs = X[Inst.C]
        end
        X[Inst.A] = NormalizeNumber(Lhs / Rhs)
        ]=]
BODIES[16]=[=[
        local Lhs, Rhs;
        if Inst.s then
            Lhs = Inst.L
        else
            Lhs = X[Inst.B]
        end
        if Inst.a then
            Rhs = Inst.R
        else
            Rhs = X[Inst.C]
        end
        X[Inst.A] = NormalizeNumber(Lhs % Rhs)
        ]=]
BODIES[17]=[=[
        local Lhs, Rhs;
        if Inst.s then
            Lhs = Inst.L
        else
            Lhs = X[Inst.B]
        end
        if Inst.a then
            Rhs = Inst.R
        else
            Rhs = X[Inst.C]
        end
        X[Inst.A] = NormalizeNumber(Lhs ^ Rhs)
        ]=]
BODIES[18]=[=[
        X[Inst.A] = NormalizeNumber(-X[Inst.B])
        ]=]
BODIES[19]=[=[
        X[Inst.A] = not X[Inst.B]
        ]=]
BODIES[20]=[=[X[Inst.A] = #X[Inst.B]]=]
BODIES[21]=[=[
        local B, C = Inst.B, Inst.C;
        local Str = "";
        for i = B, C do
            local v = X[i];
            if type(v) == "number" then
                if v % 1 == 0 then
                    Str = Str .. string.format("%d", v)
                else
                    Str = Str .. string.format("%g", v)
                end
            else
                Str = Str .. tostring(v)
            end
        end
        X[Inst.A] = Str;
    ]=]
BODIES[22]=[=[z = z + Inst.f]=]
BODIES[23]=[=[
        local Lhs, Rhs;
        if Inst.s then
            Lhs = Inst.L
        else
            Lhs = X[Inst.B]
        end
        if Inst.a then
            Rhs = Inst.R
        else
            Rhs = X[Inst.C]
        end
        if (Lhs == Rhs) == (Inst.A ~= 0) then z = z + x[z].f end;
        z = z + 1
        ]=]
BODIES[24]=[=[
        local Lhs, Rhs;
        if Inst.s then
            Lhs = Inst.L
        else
            Lhs = X[Inst.B]
        end
        if Inst.a then
            Rhs = Inst.R
        else
            Rhs = X[Inst.C]
        end
        if (Lhs < Rhs) == (Inst.A ~= 0) then z = z + x[z].f end;
        z = z + 1
        ]=]
BODIES[25]=[=[
        local Lhs, Rhs;
        if Inst.s then
            Lhs = Inst.L
        else
            Lhs = X[Inst.B]
        end
        if Inst.a then
            Rhs = Inst.R
        else
            Rhs = X[Inst.C]
        end
        if (Lhs <= Rhs) == (Inst.A ~= 0) then z = z + x[z].f end;
        z = z + 1
        ]=]
BODIES[26]=[=[
        if (not X[Inst.A]) ~= (Inst.C ~= 0) then z = z + x[z].f end
        z = z + 1
        ]=]
BODIES[27]=[=[
        local A = Inst.A
        local B = Inst.B;
        if (not X[B]) ~= (Inst.C ~= 0) then
            X[A] = X[B]
            z = z + x[z].f
        end;
        z = z + 1
        ]=]
BODIES[28]=[=[
        local A = Inst.A;
        local B = Inst.B;
        local Params;
        if B == 0 then
            Params = Top - A;
        else
            Params = B - 1;
        end;
        local RetB = Pack(X[A](Unpack(X, A + 1, A + Params)))
        local RetNum = RetB.n;
        if C == 0 then
            Top = A + RetNum - 1;
        else
            RetNum = C - 1;
        end;
        Move(RetB, 1, RetNum, A, X)
        ]=]
BODIES[29]=[=[
        local A = Inst.A;
        local B = Inst.B;
        local Params;
        if B == 0 then
            Params = Top - A;
        else
            Params = B - 1;
        end;
        CloseLuaUpvalues(SenB, 0)
        return X[A](Unpack(X, A + 1, A + Params))
        ]=]
BODIES[30]=[=[
        local A = Inst.A;
        local b = Inst.B;
        if B == 0 then        
            b = Top - A + 1;
        else
            b = B - 1;
        end;
        CloseLuaUpvalues(SenB, 0)
        return Unpack(X, A, A + b - 1)
        ]=]
BODIES[31]=[=[
        local A = Inst.A;
        local Step = X[A + 2]
        local N = X[A] + Step;
        local Limit = X[A + 1]
        local Loops
        if Step == math.abs(Step) then
            Loops = N <= Limit;
        else
            Loops = N >= Limit;
        end;
        if Loops then
            X[A] = N;
            X[A + 3] = N;
            z = z + Inst.f;
        end;
        ]=]
BODIES[32]=[=[
        local A = Inst.A;
        local Init, Limit, Step;
        Init = tonumber(X[A])
        Limit = tonumber(X[A + 1])
        Step = tonumber(X[A + 2])
        X[A] = Init - Step;
        X[A + 1] = Limit;
        X[A + 2] = Step;
        z = z + Inst.f;
        ]=]
BODIES[33]=[=[
        local A = Inst.A;
        local Base = A + 3;
        local Vals = {X[A](X[A + 1], X[A + 2])}
        Move(Vals, 1, Inst.C, Base, X)
        if X[Base] ~= nil then
            X[A + 2] = X[Base]
            z = z + x[z].f;
        end;
        z = z + 1
        ]=]
BODIES[34]=[=[
        local A = Inst.A
        local C = Inst.C
        local b = Inst.B;
        local Tab = X[A]
        local Offset;
        if b == 0 then b = Top - A end
        if C == 0 then
            C = x[z].m;
            z = z + 1
        end;
        Offset = (C - 1) * FIELDS_PER_FLUSH
        Move(X, A + 1, A + b, Offset + 1, Tab)
        ]=]
BODIES[35]=[=[CloseLuaUpvalues(SenB, Inst.A)]=]
BODIES[36]=[=[
        local Sub = V[Inst.F]
        local Nups = Sub.n;
        local UvB;
        if Nups ~= 0 then
            UvB = CreateTbl(Nups - 1)
            for i = 1, Nups do
                local Pseudo = x[z + i - 1]
                if (Pseudo.S == 0) then
                    UvB[i - 1] = SenLuaUpvalue(SenB, Pseudo.B, X)
                elseif (Pseudo.S == 4) then
                    UvB[i - 1] = n[Pseudo.B]
                end;
            end;
            z = z + Nups
        end;
        X[Inst.A] = WrapState(Sub, Env, UvB)
        ]=]
BODIES[37]=[=[
        local A = Inst.A;
        local b = Inst.B;
        if (b == 0) then
            b = v.b;
            Top = A + b - 1;
        end;
        Move(v.B, 1, b, A, X)
        ]=]
local SYN={[38]=0,[39]=1,[40]=2,[41]=3,[42]=4,[43]=5,[44]=6,[45]=7,[46]=8,[47]=9,[48]=10,[49]=11,[50]=12,[51]=13,[52]=14,[53]=15,[54]=16,[55]=17,[56]=18,[57]=19,[58]=20,[59]=21,[60]=22,[61]=23,[62]=24,[63]=25,[64]=26,[65]=27,[66]=28,[67]=29,[68]=30,[69]=12}
for p,l in pairs(SYN) do BODIES[p]=BODIES[l] end
BODIES[70]=[=[local a=math.floor(tonumber(X[Inst.B]) or 0); local b=math.floor(tonumber(X[Inst.C]) or 0); if bit32 and bit32.band then X[Inst.A]=bit32.band(a,b) else X[Inst.A]=BAnd(a,b) end]=]
BODIES[71]=[=[local a=math.floor(tonumber(X[Inst.B]) or 0); local b=math.floor(tonumber(X[Inst.C]) or 0); if bit32 and bit32.bor then X[Inst.A]=bit32.bor(a,b) else X[Inst.A]=BOr(a,b) end]=]
BODIES[72]=[=[local a=math.floor(tonumber(X[Inst.B]) or 0); local b=math.floor(tonumber(X[Inst.C]) or 0); if bit32 and bit32.bxor then X[Inst.A]=bit32.bxor(a,b) else local r,p=0,1 while a>0 or b>0 do local ab,bb=a%2,b%2 if ab~=bb then r=r+p end a,b,p=math.floor(a/2),math.floor(b/2),p*2 end X[Inst.A]=r end]=]
BODIES[73]=[=[local a=math.floor(tonumber(X[Inst.B]) or 0); if bit32 and bit32.bnot then X[Inst.A]=bit32.bnot(a) else X[Inst.A]=(-1-a) end]=]
BODIES[74]=[=[local a=math.floor(tonumber(X[Inst.B]) or 0); local n=math.floor(tonumber(X[Inst.C]) or 0); if bit32 and bit32.lshift then X[Inst.A]=bit32.lshift(a,n) else X[Inst.A]=LShift(a,n) end]=]
BODIES[75]=[=[local a=math.floor(tonumber(X[Inst.B]) or 0); local n=math.floor(tonumber(X[Inst.C]) or 0); if bit32 and bit32.rshift then X[Inst.A]=bit32.rshift(a,n) else X[Inst.A]=RShift(a,n) end]=]
BODIES[76]=[=[local Lhs,Rhs=tonumber(X[Inst.B]) or 0, tonumber(X[Inst.C]) or 1; if Rhs==0 then X[Inst.A]=0 else X[Inst.A]=math.floor(Lhs/Rhs) end]=]
BODIES[77]=[=[X[Inst.A]=math.floor(tonumber(X[Inst.B]) or 0)]=]
BODIES[78]=[=[X[Inst.A]=math.ceil(tonumber(X[Inst.B]) or 0)]=]
BODIES[79]=[=[local v=tonumber(X[Inst.B]) or 0; X[Inst.A]=(v<0) and -v or v]=]
BODIES[80]=[=[X[Inst.A]=0]=]
BODIES[81]=[=[X[Inst.A]=1]=]
BODIES[82]=[=[X[Inst.A]=true]=]
BODIES[83]=[=[X[Inst.A]=false]=]
BODIES[84]=[=[X[Inst.A]=""]=]
BODIES[85]=[=[local t=X[Inst.A]; X[Inst.A]=X[Inst.B]; X[Inst.B]=t]=]
BODIES[86]=[=[X[Inst.B]=X[Inst.A]]=]
BODIES[87]=[=[X[Inst.A]=(X[Inst.B]==nil)]=]
BODIES[88]=[=[X[Inst.A]=(X[Inst.B]~=nil)]=]
BODIES[89]=[=[X[Inst.A]=type(X[Inst.B])]=]
BODIES[90]=[=[X[Inst.A]=tonumber(X[Inst.B])]=]
BODIES[91]=[=[X[Inst.A]=tostring(X[Inst.B])]=]
BODIES[92]=[=[if (X[Inst.B]==X[Inst.C])~=(Inst.A~=0) then z=z+x[z].f end]=]
BODIES[93]=[=[if (X[Inst.B]~=X[Inst.C])~=(Inst.A~=0) then z=z+x[z].f end]=]
BODIES[94]=[=[if (X[Inst.B]>X[Inst.C])~=(Inst.A~=0) then z=z+x[z].f end]=]
BODIES[95]=[=[if (X[Inst.B]>=X[Inst.C])~=(Inst.A~=0) then z=z+x[z].f end]=]
BODIES[96]=[=[local b=X[Inst.B]; X[Inst.A]=b and X[Inst.C]]=]
BODIES[97]=[=[local b=X[Inst.B]; X[Inst.A]=b or X[Inst.C]]=]
BODIES[98]=[=[do local _=Inst.A end]=]
BODIES[99]=[=[local Lhs=X[Inst.B]; local off=Inst.C or 0; if type(Lhs)=="number" then X[Inst.A]=NormalizeNumber(Lhs+off) else X[Inst.A]=Lhs end]=]
function GetOpcodeCode(S) return BODIES[S] or BODIES[98] end
return GetOpcodeCode
