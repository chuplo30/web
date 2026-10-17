












local function makeInterp()
    local floor = math.floor
    local sbyte = string.byte
    local pack = table.pack or function(...) local t={...}; t.n=select("#",...); return t end
    local tunpack = table.unpack or unpack
    local tcreate = table.create  

    
    local B85 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^"
    local b85map = {}
    for i = 1, #B85 do b85map[sbyte(B85, i)] = i - 1 end
    local function decodeCode(s)
        local words, nw = {}, 0
        local len = #s
        local i = 1
        while i + 3 <= len do
            local c1,c2,c3,c4,c5 = sbyte(s, i, i + 4)
            local n = (((b85map[c1]*85+b85map[c2])*85+b85map[c3])*85+b85map[c4])*85+b85map[c5 or sbyte(B85,85)]
            local b1 = floor(n/16777216)%256
            local b2 = floor(n/65536)%256
            local b3 = floor(n/256)%256
            local b4 = n%256
            nw = nw + 1
            words[nw] = b1 + b2*256 + b3*65536 + b4*16777216
            i = i + 5
        end
        return words
    end

    local function getOpen(openuv, R, reg)
        for i = 1, #openuv do
            local uv = openuv[i]
            if uv.open and uv.idx == reg then return uv end
        end
        local uv = { open=true, stack=R, idx=reg }
        openuv[#openuv+1] = uv
        return uv
    end

    local function closeFrom(openuv, R, a)
        for i = 1, #openuv do
            local uv = openuv[i]
            if uv.open and uv.idx >= a then
                uv.val=R[uv.idx]; uv.open=false; uv.stack=nil
            end
        end
    end

    local function fillCaptures(code, pc, childproto, ups, R, upvals, openuv, roff)
        roff = roff or 0
        for u = 1, childproto[3] do
            local cap = code[pc]; pc = pc+1
            local ct = floor(cap/256)%256
            local cs = floor(cap/65536)%256
            if ct == 0 then
                ups[u] = { open=false, val=R[cs+roff] }
            elseif ct == 1 then
                ups[u] = getOpen(openuv, R, cs+roff)
            else
                ups[u] = upvals[cs+1]
            end
        end
        return pc
    end

    local run

    
    local function makeClosure(bc, proto, env, ups)
        return function(...)
            local n = select("#",...)
            if n == 0 then
                return run(bc,proto,env,ups,0)
            elseif n == 1 then
                local a1=...
                return run(bc,proto,env,ups,1,a1)
            elseif n == 2 then
                local a1,a2=...
                return run(bc,proto,env,ups,2,a1,a2)
            elseif n == 3 then
                local a1,a2,a3=...
                return run(bc,proto,env,ups,3,a1,a2,a3)
            elseif n == 4 then
                local a1,a2,a3,a4=...
                return run(bc,proto,env,ups,4,a1,a2,a3,a4)
            elseif n == 5 then
                local a1,a2,a3,a4,a5=...
                return run(bc,proto,env,ups,5,a1,a2,a3,a4,a5)
            else
                return run(bc,proto,env,ups,pack(...))
            end
        end
    end

    
    
    
    function run(bc, proto, env, upvals, packedArgs, a1, a2, a3, a4, a5)
        if not proto[10] then
            local c = proto[5]
            if type(c) == "string" then c = decodeCode(c) end
            if bc[4] then
                local bkey,bstep = bc[4],bc[5]
                local key = bkey+bstep
                for i = 1,#c do c[i]=(c[i]-key)%4294967296; key=key+bstep end
                
                
                
                
                
                local KVp,KTp = proto[6],proto[8]
                local schar,tconcat = string.char, table.concat
                local ckey = bkey % 256
                local cstep = (bstep % 255) + 1
                local cstep2 = (floor(bkey/256) % 255) + 1
                for i = 1,#KTp do
                    local tg = KTp[i]
                    if tg == 3 or tg == 2 then
                        local s = KVp[i]
                        if type(s) == "string" then
                            local base = (ckey + i*cstep) % 256
                            local buf = {}
                            for j = 1,#s do
                                local k2 = (base + j*cstep2) % 256
                                buf[j] = schar((sbyte(s,j) - k2) % 256)
                            end
                            local dec = tconcat(buf)
                            KVp[i] = (tg == 2) and tonumber(dec) or dec
                        end
                    end
                end
            end
            proto[5]=c; proto[10]=true
        end
        local code  = proto[5]
        local opmap = bc[3]
        local numparams = proto[2]
        
        local KV   = proto[6]
        local KT   = proto[8]
        local Kraw = proto[9]
        local childprotos = proto[7]  
        local protos = bc[2]          
        local R = tcreate and tcreate(proto[1]) or {}
        local pc=1; local top=0; local openuv={}
        local nargs
        local isFast = type(packedArgs)=="number"
        if isFast then
            nargs=packedArgs
            if nargs>=1 then R[0]=a1 end
            if nargs>=2 then R[1]=a2 end
            if nargs>=3 then R[2]=a3 end
            if nargs>=4 then R[3]=a4 end
            if nargs>=5 then R[4]=a5 end
        else
            nargs=packedArgs.n or #packedArgs
            for i=1,numparams do R[i-1]=packedArgs[i] end
        end
        local varargs,nva=nil,0
        if proto[4]==1 and nargs > numparams then
            varargs={}
            if isFast then
                
                
                local va={a1,a2,a3,a4,a5}
                for i=numparams+1,nargs do nva=nva+1; varargs[nva]=va[i] end
            else
                for i=numparams+1,nargs do nva=nva+1; varargs[nva]=packedArgs[i] end
            end
        end

        while true do
            local insn=code[pc]; pc=pc+1
            local op=opmap[insn%256]
            local a=floor(insn/256)%256
            local hw=floor(insn/65536)
            local b=hw%256
            local c=floor(hw/256)
            local d=hw>=32768 and hw-65536 or hw

            if op==6 then R[a]=R[b]
            elseif op==15 then local aux=code[pc];pc=pc+1; R[a]=R[b][KV[aux+1]]
            elseif op==20 then
                local aux=code[pc];pc=pc+1
                local self=R[b]; R[a+1]=self; R[a]=self[KV[aux+1]]
            elseif op==21 or op==87 then
                if op==87 then pc=pc+1 end
                local na=b==0 and top-a-1 or b-1
                local f=R[a]; local nc=c
                if nc==2 then
                    if na==0 then R[a]=f()
                    elseif na==1 then R[a]=f(R[a+1])
                    elseif na==2 then R[a]=f(R[a+1],R[a+2])
                    elseif na==3 then R[a]=f(R[a+1],R[a+2],R[a+3])
                    elseif na==4 then R[a]=f(R[a+1],R[a+2],R[a+3],R[a+4])
                    elseif na==5 then R[a]=f(R[a+1],R[a+2],R[a+3],R[a+4],R[a+5])
                    else local args={} for k=1,na do args[k]=R[a+k] end; R[a]=f(tunpack(args,1,na)) end
                elseif nc==1 then
                    if na==0 then f()
                    elseif na==1 then f(R[a+1])
                    elseif na==2 then f(R[a+1],R[a+2])
                    elseif na==3 then f(R[a+1],R[a+2],R[a+3])
                    elseif na==4 then f(R[a+1],R[a+2],R[a+3],R[a+4])
                    elseif na==5 then f(R[a+1],R[a+2],R[a+3],R[a+4],R[a+5])
                    else local args={} for k=1,na do args[k]=R[a+k] end; f(tunpack(args,1,na)) end
                elseif nc==3 then
                    if na==0 then R[a],R[a+1]=f()
                    elseif na==1 then R[a],R[a+1]=f(R[a+1])
                    elseif na==2 then R[a],R[a+1]=f(R[a+1],R[a+2])
                    elseif na==3 then R[a],R[a+1]=f(R[a+1],R[a+2],R[a+3])
                    elseif na==4 then R[a],R[a+1]=f(R[a+1],R[a+2],R[a+3],R[a+4])
                    elseif na==5 then R[a],R[a+1]=f(R[a+1],R[a+2],R[a+3],R[a+4],R[a+5])
                    else local args={} for k=1,na do args[k]=R[a+k] end; R[a],R[a+1]=f(tunpack(args,1,na)) end
                else
                    local res
                    if na==0 then res=pack(f())
                    elseif na==1 then res=pack(f(R[a+1]))
                    elseif na==2 then res=pack(f(R[a+1],R[a+2]))
                    elseif na==3 then res=pack(f(R[a+1],R[a+2],R[a+3]))
                    elseif na==4 then res=pack(f(R[a+1],R[a+2],R[a+3],R[a+4]))
                    elseif na==5 then res=pack(f(R[a+1],R[a+2],R[a+3],R[a+4],R[a+5]))
                    else local args={} for k=1,na do args[k]=R[a+k] end; res=pack(f(tunpack(args,1,na))) end
                    if nc==0 then for k=1,res.n do R[a+k-1]=res[k] end; top=a+res.n
                    else for k=1,nc-1 do R[a+k-1]=res[k] end end
                end
            elseif op==16 then local aux=code[pc];pc=pc+1; R[b][KV[aux+1]]=R[a]
            elseif op==33 then R[a]=R[b]+R[c]
            elseif op==34 then R[a]=R[b]-R[c]
            elseif op==35 then R[a]=R[b]*R[c]
            elseif op==36 then R[a]=R[b]/R[c]
            elseif op==37 then R[a]=R[b]%R[c]
            elseif op==81 then R[a]=floor(R[b]/R[c])
            elseif op==5  then R[a]=KV[hw+1]
            elseif op==4  then R[a]=d
            elseif op==12 then
                local aux=code[pc];pc=pc+1
                local count=floor(aux/1073741824)%4
                local p0=floor(aux/1048576)%1024
                local v=env[KV[p0+1]]
                if count>=2 and v~=nil then v=v[KV[(floor(aux/1024)%1024)+1]] end
                if count>=3 and v~=nil then v=v[KV[(aux%1024)+1]] end
                R[a]=v
            elseif op==7  then local aux=code[pc];pc=pc+1; R[a]=env[KV[aux+1]]
            elseif op==13 then R[a]=R[b][R[c]]
            elseif op==14 then R[b][R[c]]=R[a]
            elseif op==17 then R[a]=R[b][c+1]
            elseif op==18 then R[b][c+1]=R[a]
            elseif op==57 then
                local a=a; local limit,step=R[a],R[a+1]
                local idx=R[a+2]+step; R[a+2]=idx
                if (step>0 and idx<=limit) or (step<=0 and idx>=limit) then R[a+3]=idx; pc=pc+d end
            elseif op==56 then
                local a=a; local limit,step,idx=R[a],R[a+1],R[a+2]
                if (step>0 and idx<=limit) or (step<=0 and idx>=limit) then R[a+3]=idx else pc=pc+d end
            elseif op==58 then
                local aux=code[pc];pc=pc+1
                local varcount=aux%256; local gen=R[a]
                if type(gen)=="function" then
                    if varcount<=2 then
                        local v1,v2=gen(R[a+1],R[a+2])
                        if v1~=nil then R[a+2]=v1;R[a+3]=v1; if varcount==2 then R[a+4]=v2 end; pc=pc+d-1 end
                    else
                        local res=pack(gen(R[a+1],R[a+2]))
                        if res[1]~=nil then R[a+2]=res[1]; for k=1,varcount do R[a+2+k]=res[k] end; pc=pc+d-1 end
                    end
                else
                    local key,val=next(gen,R[a+2])
                    if key~=nil then R[a+2]=key;R[a+3]=key; if varcount>=2 then R[a+4]=val end; pc=pc+d-1 end
                end
            elseif op==23 then pc=pc+d
            elseif op==24 then pc=pc+d
            elseif op==25 then if R[a] then pc=pc+d end
            elseif op==26 then if not R[a] then pc=pc+d end
            elseif op==27 then local aux=code[pc];pc=pc+1; if R[a]==R[aux] then pc=pc+d-1 end
            elseif op==28 then local aux=code[pc];pc=pc+1; if R[a]<=R[aux] then pc=pc+d-1 end
            elseif op==29 then local aux=code[pc];pc=pc+1; if R[a]<R[aux]  then pc=pc+d-1 end
            elseif op==30 then local aux=code[pc];pc=pc+1; if R[a]~=R[aux] then pc=pc+d-1 end
            elseif op==31 then local aux=code[pc];pc=pc+1; if not(R[a]<=R[aux]) then pc=pc+d-1 end
            elseif op==32 then local aux=code[pc];pc=pc+1; if not(R[a]<R[aux])  then pc=pc+d-1 end
            elseif op==22 then
                local nb=b
                if nb==2 then return R[a]
                elseif nb==3 then return R[a],R[a+1]
                elseif nb==4 then return R[a],R[a+1],R[a+2]
                elseif nb==5 then return R[a],R[a+1],R[a+2],R[a+3]
                elseif nb==6 then return R[a],R[a+1],R[a+2],R[a+3],R[a+4]
                elseif nb==1 then return
                else
                    local out,n={},0
                    if nb==0 then for r=a,top-1 do n=n+1;out[n]=R[r] end
                    else for r=a,a+nb-2 do n=n+1;out[n]=R[r] end end
                    return tunpack(out,1,n)
                end
            elseif op==39 then R[a]=R[b]+KV[c+1]
            elseif op==40 then R[a]=R[b]-KV[c+1]
            elseif op==41 then R[a]=R[b]*KV[c+1]
            elseif op==42 then R[a]=R[b]/KV[c+1]
            elseif op==43 then R[a]=R[b]%KV[c+1]
            elseif op==44 then R[a]=R[b]^KV[c+1]
            elseif op==38 then R[a]=R[b]^R[c]
            elseif op==82 then R[a]=floor(R[b]/KV[c+1])
            elseif op==71 then R[a]=KV[b+1]-R[c]
            elseif op==72 then R[a]=KV[b+1]/R[c]
            elseif op==49 then local s=R[b]; for r=b+1,c do s=s..R[r] end; R[a]=s
            elseif op==50 then R[a]=not R[b]
            elseif op==51 then R[a]=-R[b]
            elseif op==52 then R[a]=#R[b]
            elseif op==45 then local bv=R[b]; if bv then R[a]=R[c] else R[a]=bv end
            elseif op==46 then local bv=R[b]; if bv then R[a]=bv else R[a]=R[c] end
            elseif op==47 then local bv=R[b]; if bv then R[a]=KV[c+1] else R[a]=bv end
            elseif op==48 then local bv=R[b]; if bv then R[a]=bv else R[a]=KV[c+1] end
            elseif op==66 then local aux=code[pc];pc=pc+1; R[a]=KV[aux+1]
            elseif op==3  then R[a]=b~=0; if c~=0 then pc=pc+c end
            elseif op==2  then R[a]=nil
            elseif op==8  then local aux=code[pc];pc=pc+1; env[KV[aux+1]]=R[a]
            elseif op==9  then local uv=upvals[b+1]; if uv.open then R[a]=uv.stack[uv.idx] else R[a]=uv.val end
            elseif op==10 then local uv=upvals[b+1]; if uv.open then uv.stack[uv.idx]=R[a] else uv.val=R[a] end
            elseif op==11 then closeFrom(openuv,R,a)
            elseif op==53 then pc=pc+1; R[a]={}
            elseif op==54 then
                local tmpl=Kraw[hw+1]; local t={}
                if tmpl[1]==5 then for i=1,#tmpl[2] do t[KV[tmpl[2][i]+1]]=0 end
                elseif tmpl[1]==8 then for i=1,#tmpl[2] do local e=tmpl[2][i]; local kv2=KV[e[1]+1]; if e[2]>=0 then t[kv2]=KV[e[2]+1] end end end
                R[a]=t
            elseif op==55 then
                local aux=code[pc];pc=pc+1; local t=R[a]; local cnt=c
                if cnt==0 then cnt=top-b else cnt=cnt-1 end
                for k=0,cnt-1 do t[aux+k]=R[b+k] end
            elseif op==19 then
                local cp=protos[childprotos[hw+1]+1]; local ups={}
                R[a]=makeClosure(bc,cp,env,ups)
                pc=fillCaptures(code,pc,cp,ups,R,upvals,openuv)
            elseif op==64 then
                local cp=protos[KV[hw+1]+1]; local ups={}
                R[a]=makeClosure(bc,cp,env,ups)
                pc=fillCaptures(code,pc,cp,ups,R,upvals,openuv)
            elseif op==70 then
            elseif op==63 then
                local a=a; local nb=b
                if nb==0 then for k=1,nva do R[a+k-1]=varargs[k] end; top=a+nva
                else for k=1,nb-1 do R[a+k-1]=varargs[k] end end
            elseif op==65 or op==0 or op==1 or op==69 or op==62 or op==68 or op==73 then
            elseif op==74 or op==75 or op==60 then pc=pc+1
            elseif op==67 then
                local e=floor(insn/256)%16777216; if e>=8388608 then e=e-16777216 end; pc=pc+e
            elseif op==77 then
                local aux=code[pc];pc=pc+1
                local notf=floor(aux/2147483648)%2==1; local cmp=R[a]==nil
                if notf then cmp=not cmp end; if cmp then pc=pc+d-1 end
            elseif op==78 then
                local aux=code[pc];pc=pc+1
                local notf=floor(aux/2147483648)%2==1; local kv2=(aux%2)==1; local cmp=R[a]==kv2
                if notf then cmp=not cmp end; if cmp then pc=pc+d-1 end
            elseif op==79 or op==80 then
                local aux=code[pc];pc=pc+1
                local notf=floor(aux/2147483648)%2==1; local cmp=R[a]==KV[aux%16777216+1]
                if notf then cmp=not cmp end; if cmp then pc=pc+d-1 end
            elseif op==76 or op==61 or op==59 then pc=pc+d
            elseif op==83 then local aux=code[pc];pc=pc+1; R[a]=R[b][KV[aux%65536+1]]
            elseif op==84 then local aux=code[pc];pc=pc+1; R[b][KV[aux%65536+1]]=R[a]
            elseif op==85 then local aux=code[pc];pc=pc+1; local self=R[b]; R[a+1]=self; R[a]=self[KV[aux%65536+1]]
            elseif op==86 then pc=pc+1
            elseif op==88 then pc=pc+1; pc=pc+hw
            else error("interp: unimplemented opcode "..op.." at pc "..(pc-1)) end
        end
        
    end

    
    return function(bc, env, ...)
        env = env or (getfenv and getfenv()) or _G
        return run(bc, bc[2][bc[1]+1], env, nil, pack(...))
    end
    
end
return makeInterp
