import assert from 'node:assert/strict';
import { generatePhysicalISA, encodeWideInstruction } from '../js/protection/vm-polymorph.js';
import { emitLuauVMRuntime } from '../js/runtime/luau-vm-runtime.js';

const logical=['LU_NOP','LU_BREAK','LU_LOADNIL','LU_LOADB','LU_LOADN','LU_LOADK','LU_MOVE','LU_GETGLOBAL','LU_SETGLOBAL','LU_GETUPVAL','LU_SETUPVAL','LU_CLOSEUPVALS','LU_GETIMPORT','LU_GETTABLE','LU_SETTABLE','LU_GETTABLEKS','LU_SETTABLEKS','LU_GETTABLEN','LU_SETTABLEN','LU_NEWCLOSURE','LU_NAMECALL','LU_CALL','LU_RETURN','LU_JUMP','LU_JUMPBACK','LU_JUMPIF','LU_JUMPIFNOT','LU_JUMPIFEQ','LU_JUMPIFLE','LU_JUMPIFLT','LU_JUMPIFNOTEQ','LU_JUMPIFNOTLE','LU_JUMPIFNOTLT','LU_ADD','LU_SUB','LU_MUL','LU_BAND','LU_BOR','LU_BXOR','LU_BNOT','LU_SHL','LU_SHR','LU_DIV','LU_MOD','LU_POW','LU_ADDK','LU_SUBK','LU_MULK','LU_DIVK','LU_MODK','LU_POWK','LU_AND','LU_OR','LU_ANDK','LU_ORK','LU_CONCAT','LU_NOT','LU_MINUS','LU_LENGTH','LU_NEWTABLE','LU_DUPTABLE','LU_SETLIST','LU_FORNPREP','LU_FORNLOOP','LU_FORGLOOP','LU_FORGPREP_INEXT','LU_FASTCALL3','LU_FORGPREP_NEXT','LU_NATIVECALL','LU_GETVARARGS','LU_DUPCLOSURE','LU_PREPVARARGS','LU_LOADKX','LU_JUMPX','LU_FASTCALL','LU_COVERAGE','LU_CAPTURE','LU_SUBRK','LU_DIVRK','LU_FASTCALL1','LU_FASTCALL2','LU_FASTCALL2K','LU_FORGPREP','LU_JUMPXEQKNIL','LU_JUMPXEQKB','LU_JUMPXEQKN','LU_JUMPXEQKS','LU_IDIV','LU_IDIVK','LU_GETUDATAKS','LU_SETUDATAKS','LU_NAMECALLUDATA','LU_NEWCLASSMEMBER','LU_CALLFB','LU_CMPPROTO','LU_NEWCLASS','LU_FUSE_LOADK_RETURN','LU_FUSE_MOVE_RETURN','LU_FUSE_GETGLOBAL_CALL','LU_FUSE_GETTABLEKS_CALL'];
const isa=generatePhysicalISA([...logical,...Array.from({length:8},(_,i)=>`LU_DECOY_${i.toString(16).padStart(2,'0')}`)],0xabc12345);
const strings=[{type:'xstring',n:5,key:1,data:[100,102,115,115,98]}];
const f={id:0,maxstack:2,numparams:0,numupvalues:0,isvararg:false,flags:0,key:0x1234,guard:0,constants:strings,children:[],code:[]};
f.code.push(...encodeWideInstruction({op:'LU_LOADK',a:0,d:0},isa,0));
f.code.push(...encodeWideInstruction({op:'LU_RETURN',a:0,b:2,c:0},isa,1));
let h=2166136261>>>0; for(const w of f.code){h^=w>>>0; h=Math.imul(h,16777619)>>>0;} f.guard=h>>>0;
for(let i=0;i<f.code.length;i++) f.code[i]=(f.code[i]^((f.key+Math.imul(i,0x9e3779b9))>>>0))>>>0;
// guard must reflect encrypted stream; recompute.
h=2166136261>>>0; for(const w of f.code){h^=w>>>0; h=Math.imul(h,16777619)>>>0;} f.guard=h>>>0;
const code=emitLuauVMRuntime({isa,functions:[f],mainFunction:0},{entry:true,returnResults:true});
assert.match(code,/bytecode integrity failure/);
assert.match(code,/xstring/);
assert.ok(code.length>10000);
console.log('vm3 emitter smoke: PASS');
