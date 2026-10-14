/** Anti-tamper fragments — WAN (Roblox client + anti dump-hook). */
export function buildATFragment1() {
  // [0] ExecRunner + fake env + dump API detect + [1-4] core Roblox
  return `local _G2=typeof;local _IG=Instance;local _E=Enum
local function _f1(m)error("[WAN] SEC :: "..tostring(m),0)end
local function _h(s)local h=2166136261 for i=1,#s do h=bit32.bxor(h,string.byte(s,i))h=(h*16777619)%4294967296 end return h end
local execRunner=loadstring or load
-- Hook detect: tostring should look native; do NOT require C (many executors use Lua loadstring)
if type(execRunner)=="function" then
 local s=tostring(execRunner)
 if not (string.find(s,"function",1,true) or string.find(s,"0x",1,true) or string.find(s,"builtin",1,true) or string.find(s,"nil",1,true)) then _f1('x0') end
end
do
 local _e=getfenv and getfenv(0)
 local _gOk=game~=nil and type(game)~="table"
 local _iOk=Instance and type(Instance.new)=="function"
 if not _gOk or not _iOk or not _e then _f1('x1') end
 local _gs=game.GetService
 if type(_gs)~="function" then _f1('x2') end
 local _ok,_p=pcall(_gs,game,"Players")
 if not _ok or _p==nil or type(_p)~=type(game) then _f1('x3') end
 local _db=debug and type(debug)=="table" and debug
 local _info=_db and _db.info
 if _info then
  local _ok2,_src=pcall(function()return _info(pcall,"s")end)
  if _ok2 and _src~="[C]" then _f1('x4') end
 end
end
if _G2==nil or _G2(game)~='Instance' then _f1('e1') end
if _G2(workspace)~='Instance' then _f1('e2') end
if _IG==nil or type(_IG.new)~='function' then _f1('e3') end
if _E==nil then _f1('e4') end
do local ok,cls=pcall(function()return game.ClassName end) if not ok or cls~='DataModel' then _f1('d1') end end
do local ok,p=pcall(function()return game:GetService('Players')end) if not ok or p==nil or _G2(p)~='Instance' then _f1('d2') end end
do local ok,r=pcall(function()return game:GetService('RunService')end) if not ok or r==nil or _G2(r)~='Instance' then _f1('d3') end end
if type(game.GetService)~='function' then _f1('d4') end
do local ok,s=pcall(function()return game:FindFirstChild('__wan_fk__')end) if not ok or s~=nil then _f1('f1') end end
do local ok,o=pcall(function()return workspace:FindFirstChildOfClass('__wan_cl__')end) if not ok or o~=nil then _f1('f2') end end
do local ok=pcall(function()return workspace['__wan_nn__'](workspace)end) if ok then _f1('f3') end end
do local ok,p=pcall(Instance.new,'Part') if not ok or _G2(p)~='Instance' then _f1('n1') end pcall(function()p:Destroy()end) end
`;
}

export function buildATFragment2() {
  return `do local L=loadstring or load
 if type(L)~='function' then _f1('L0') end
 if type(islclosure)=='function' and false then local ok,r=pcall(islclosure,L) if ok and r==true then _f1('L2') end end
 if type(debug)=='table' and type(debug.getinfo)=='function' then local ok,inf=pcall(debug.getinfo,L,'S') if ok and type(inf)=='table' and inf.what=='Lua' then _f1('L4') end end
end
if getfenv and type(getfenv)~='function' then _f1('g1') end
do local B={{'pcall',pcall},{'tostring',tostring},{'type',type},{'pairs',pairs},{'ipairs',ipairs},{'setmetatable',setmetatable},{'getmetatable',getmetatable},{'rawget',rawget},{'rawset',rawset},{'rawequal',rawequal}} for i=1,#B do local n,r=B[i][1],B[i][2] local c=rawget(_G,n) if c~=nil and c~=r then _f1('b:'..n) end end end
do if 1+1~=2 then _f1('c1') end if tostring(1)~='1' then _f1('c2') end if string.char(65)~='A' then _f1('c3') end if #'abc'~=3 then _f1('c4') end if ({'a'})[1]~='a' then _f1('c5') end if bit32==nil then _f1('c6') end if bit32.bxor(255,255)~=0 then _f1('c7') end if math.floor(1.9)~=1 then _f1('c8') end end
do if getfenv and type(getfenv)=='function' then local ok,e=pcall(getfenv,0) if not ok or type(e)~='table' then _f1('g2') end end end
do if type(newproxy)=='function' then local ok,p=pcall(newproxy,true) if ok and p~=nil then local mt=getmetatable(p) if type(mt)=='table' then local b={N='pb'} mt.__index=b mt.__metatable=false if p.N~='pb' then _f1('px') end end end end end
do if type(coroutine)=='table' and type(coroutine.create)=='function' then local co=coroutine.create(function(a,b) coroutine.yield(a+b) return (a+b)*2 end) local ok,v=coroutine.resume(co,3,4) if not ok or v~=7 then _f1('co1') end local ok2,v2=coroutine.resume(co) if not ok2 or v2~=14 then _f1('co2') end if coroutine.status(co)~='dead' then _f1('co3') end end end
do if type(game)=='userdata' or type(game)=='table' then local ok1,a=pcall(function()return game:GetService('RunService')end) local ok2,b=pcall(function()return game:GetService('RunService')end) if ok1 and ok2 and not rawequal(a,b) then _f1('rs') end end end
do if type(debug)=='table' and type(debug.gethook)=='function' then local ok,h=pcall(debug.gethook) if ok and h~=nil then _f1('dh') end end end
`;
}

export function buildATFragment3() {
  return `do if type(buffer)=='table' and type(buffer.create)=='function' then local ok,b=pcall(buffer.create,16) if ok and type(b)=='buffer' then buffer.writeu16(b,0,0xFEDC) buffer.writei16(b,2,-12345) buffer.writeu32(b,4,0xDEADBEEF) buffer.writef32(b,8,1.25) if buffer.readu16(b,0)~=0xFEDC then _f1('bf1') end if buffer.readi16(b,2)~=-12345 then _f1('bf2') end if buffer.readu32(b,4)~=0xDEADBEEF then _f1('bf3') end if buffer.readf32(b,8)~=1.25 then _f1('bf4') end if buffer.len(b)~=16 then _f1('bf5') end end end end
do if type(buffer)=='table' and type(buffer.create)=='function' then local b=buffer.create(6) buffer.writeu16(b,0,0x1234) buffer.writeu32(b,2,0x89ABCDEF) local out=buffer.tostring(b) if out~=string.char(0x34,0x12,0xEF,0xCD,0xAB,0x89) then _f1('be') end end end
do if math.floor(-1.25)~=-2 then _f1('m1') end if math.abs(-17)~=17 then _f1('m2') end if (-17%5)~=3 then _f1('m3') end local nan=0/0 if nan==nan then _f1('m4') end if math.huge<=1e308 then _f1('m5') end if math.sqrt(16)~=4 then _f1('m6') end end
do local bin='A\\0z' if string.byte(bin,1)~=65 then _f1('s1') end if string.byte(bin,2)~=0 then _f1('s2') end if string.char(65,0,122)~=bin then _f1('s3') end if string.sub('abcdef',2,-2)~='bcde' then _f1('s4') end if string.reverse('abc\\0')~='\\0cba' then _f1('s5') end if #'a\\0b'~=3 then _f1('s6') end end
do if bit32.bxor(0x55AA55AA,0x0F0F0F0F)~=0x5AA55AA5 then _f1('b32a') end if bit32.band(0x12345678,0x00FF00FF)~=0x00340078 then _f1('b32b') end if bit32.bor(0x12003478,0x00345600)~=0x12347678 then _f1('b32c') end if bit32.lrotate(0x12345678,8)~=0x34567812 then _f1('b32d') end end
`;
}

export function buildATFragment4() {
  return `do if type(Enum)=='userdata' then if typeof(Enum)~='Enums' then _f1('en1') end if getmetatable(Enum)~='The metatable is locked' then _f1('en2') end local et=Enum.HumanoidRigType if typeof(et)=='Enum' then local a=et:FromName('R6') local b=et:FromName('R6') if a~=b then _f1('en3') end if et.R6~=a then _f1('en4') end if a.Name~='R6' then _f1('en5') end if a.Value~=0 then _f1('en6') end if typeof(a)~='EnumItem' then _f1('en7') end end end end
do local t={4,1,3} table.insert(t,2,2) if table.concat(t,',')~='4,2,1,3' then _f1('t1') end if table.remove(t,1)~=4 then _f1('t2') end table.sort(t) if table.concat(t,',')~='1,2,3' then _f1('t3') end end
do if _IG and type(_IG.new)=='function' then local names={'Part','Folder','Model','StringValue','NumberValue','BoolValue'} for i=1,#names do local ok,o=pcall(_IG.new,names[i]) if not ok or _G2(o)~='Instance' then _f1('ic'..i) end if o.ClassName~=names[i] then _f1('ic'..i..'c') end pcall(function()o:Destroy()end) end end end
do if _IG and type(_IG.new)=='function' then local ok,f=pcall(_IG.new,'Folder') if ok then local sig=f.ChildAdded if sig==nil then _f1('sg1') end local c=sig:Connect(function()end) if c.Connected~=true then _f1('sg2') end c:Disconnect() if c.Connected~=false then _f1('sg3') end pcall(function()f:Destroy()end) end end end
do if type(identifyexecutor)=='function' then local ok,n=pcall(identifyexecutor) if ok and type(n)=='string' and #n>0 then local BL={} for _,x in ipairs({'solara','wave','krnl','fluxus','hydrogen','argon','codex','sirhurt','trigon','wearedevs','swift','synapse','script-ware','electron'}) do BL[_h(string.lower(x))]=true end if BL[_h(string.lower(n))] then _f1('bl:'..n) end end end end
`;
}
