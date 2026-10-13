/**
 * 8XMS VM v3: official Luau bytecode -> lifted VM -> polymorphic runtime.
 * This is the first pipeline in the project that does not reconstruct an AST
 * after the official compiler; it executes the compiler's bytecode semantics.
 */
import crypto from "node:crypto";
import { compileFullLuau, requireOfficialBackend } from "./backend/luau-backend.js";
import { decodeAndLiftLuauBytecode } from "./backend/luau-bytecode.js";
import { generatePhysicalISA, encodeWideInstruction } from "./protection/vm-polymorph.js";
import { emitLuauVMRuntime } from "./runtime/luau-vm-runtime.js";
import { fuseProgram } from "./ir/vm-fuser.js";
import { compileStateProgram, STATE_IR_VERSION } from "./ir/state-ir.js";

export const VM3_VERSION = "3.1.0-state";

const ALL_LOGICAL = Object.freeze([
  "LU_NOP","LU_BREAK","LU_LOADNIL","LU_LOADB","LU_LOADN","LU_LOADK","LU_MOVE",
  "LU_GETGLOBAL","LU_SETGLOBAL","LU_GETUPVAL","LU_SETUPVAL","LU_CLOSEUPVALS","LU_GETIMPORT",
  "LU_GETTABLE","LU_SETTABLE","LU_GETTABLEKS","LU_SETTABLEKS","LU_GETTABLEN","LU_SETTABLEN",
  "LU_NEWCLOSURE","LU_NAMECALL","LU_CALL","LU_RETURN","LU_JUMP","LU_JUMPBACK","LU_JUMPIF",
  "LU_JUMPIFNOT","LU_JUMPIFEQ","LU_JUMPIFLE","LU_JUMPIFLT","LU_JUMPIFNOTEQ","LU_JUMPIFNOTLE",
  "LU_JUMPIFNOTLT","LU_ADD","LU_SUB","LU_MUL","LU_DIV","LU_MOD","LU_POW","LU_BAND","LU_BOR","LU_BXOR","LU_BNOT","LU_SHL","LU_SHR","LU_ADDK","LU_SUBK",
  "LU_MULK","LU_DIVK","LU_MODK","LU_POWK","LU_AND","LU_OR","LU_ANDK","LU_ORK","LU_CONCAT",
  "LU_NOT","LU_MINUS","LU_LENGTH","LU_NEWTABLE","LU_DUPTABLE","LU_SETLIST","LU_FORNPREP",
  "LU_FORNLOOP","LU_FORGLOOP","LU_FORGPREP_INEXT","LU_FASTCALL3","LU_FORGPREP_NEXT","LU_NATIVECALL",
  "LU_GETVARARGS","LU_DUPCLOSURE","LU_PREPVARARGS","LU_LOADKX","LU_JUMPX","LU_FASTCALL","LU_COVERAGE",
  "LU_CAPTURE","LU_SUBRK","LU_DIVRK","LU_FASTCALL1","LU_FASTCALL2","LU_FASTCALL2K","LU_FORGPREP",
  "LU_JUMPXEQKNIL","LU_JUMPXEQKB","LU_JUMPXEQKN","LU_JUMPXEQKS","LU_IDIV","LU_IDIVK","LU_GETUDATAKS",
  "LU_SETUDATAKS","LU_NAMECALLUDATA","LU_NEWCLASSMEMBER","LU_CALLFB","LU_CMPPROTO","LU_NEWCLASS"
]);

function checksum(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0,32);
}

function mix32(a,b){ let x=(a^b)>>>0; x=Math.imul(x^0x9e3779b9,0x85ebca6b)>>>0; x^=x>>>16; x=Math.imul(x,0xc2b2ae35)>>>0; x^=x>>>13; return x>>>0; }

function guard32(code) { let h=2166136261>>>0; for(const w of code){h^=w>>>0; h=Math.imul(h,16777619)>>>0;} return h>>>0; }
const B94='!"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
function base94(bytes) {
  let out="";
  for(let i=0;i<bytes.length;i+=3) {
    const n=bytes[i]<<16 | ((i+1<bytes.length?bytes[i+1]:0)<<8) | (i+2<bytes.length?bytes[i+2]:0);
    let x=n;
    const chars=[0,0,0,0];
    for(let j=3;j>=0;j--){ chars[j]=x%94; x=Math.floor(x/94); }
    out += chars.map(x=>B94[x]).join("");
  }
  return out;
}
function xstring(value, key) {
  const bytes=Buffer.from(String(value),"utf8");
  const parts=[];
  const CHUNK=48;
  for(let off=0;off<bytes.length;off+=CHUNK) {
    const n=Math.min(CHUNK,bytes.length-off);
    const enc=Buffer.alloc(n);
    const partKey=mix32(key>>>0,Math.floor(off/CHUNK)+0x7f4a7c15);
    for(let i=0;i<n;i++) enc[i]=bytes[off+i]^((partKey+Math.imul(off+i,0x9e3779b9))>>>0 & 255);
    parts.push({k:partKey>>>0,o:off,n,data:base94(enc)});
  }
  return {type:"xpack94",n:bytes.length,parts};
}
function protectConstants(constants, seed, fid) {
  return constants.map((c,index)=>{
    if(c && c.type==="string") return xstring(c.value,mix32(seed>>>0,((fid+1)*0x45d9f3b)^(index*0x27d4eb2d)));
    return c;
  });
}

function packFunction(fn, isa, seed) {
  const code=[];
  for (const inst of fn.instructions) {
    const words=encodeWideInstruction(inst,isa,inst.pc);
    for (const w of words) code.push(w>>>0);
  }
  const key=mix32(seed>>>0,(fn.id+1)*0x45d9f3b);
  for(let i=0;i<code.length;i++) code[i]=(code[i]^((key+Math.imul(i,0x9e3779b9))>>>0))>>>0;
  return {
    id:fn.id,
    maxstack:fn.maxstack,
    numparams:fn.numparams,
    numupvalues:fn.numupvalues,
    isvararg:fn.isvararg,
    flags:fn.flags,
    key,
    guard:guard32(code),
    constants:protectConstants(fn.constants,seed,fn.id),
    children:fn.children,
    state:fn.stateMachine || null,
    code
  };
}

export function compileLuauToVM(source, {seed = Date.now(), optimizationLevel = 1, debugLevel = 0} = {}) {
  requireOfficialBackend();
  const official=compileFullLuau(source,{optimizationLevel,debugLevel});
  const lifted=decodeAndLiftLuauBytecode(official.bytecode,{assumeFunctionSizes:undefined});
  const fused=fuseProgram(lifted);
  // Real state compiler stage: lifted Luau -> CFG/micro-state IR -> VM words.
  const stated=compileStateProgram(fused,seed,{decoys:24});
  const logical=[...ALL_LOGICAL,"LU_FUSE_LOADK_RETURN","LU_FUSE_MOVE_RETURN","LU_FUSE_GETGLOBAL_CALL","LU_FUSE_GETTABLEKS_CALL"];
  const isa=generatePhysicalISA([...logical,...Array.from({length:64},(_,i)=>`LU_DECOY_${i.toString(16).padStart(2,"0")}`)],seed);
  const functions=stated.functions.map(fn=>packFunction(fn,isa,seed));
  const program={
    vmVersion:VM3_VERSION,
    stateIRVersion:STATE_IR_VERSION,
    frontend:"official-luau-bytecode",
    luauBytecodeVersion:lifted.luauBytecodeVersion,
    luauTypeVersion:lifted.luauTypeVersion,
    mainFunction:lifted.mainFunction,
    strings:lifted.strings,
    userdata:lifted.userdata,
    isa,
    functions
  };
  program.integrity=checksum({
    vmVersion:program.vmVersion,mainFunction:program.mainFunction,
    luauBytecodeVersion:program.luauBytecodeVersion,functions:program.functions,isa:program.isa
  });
  return program;
}

export function emitVM3(source, options={}) {
  return emitLuauVMRuntime(compileLuauToVM(source,options),{entry:true,returnResults:true});
}

export function buildVM3(source, options={}) {
  const program=compileLuauToVM(source,options);
  return {program,code:emitLuauVMRuntime(program,{entry:true,returnResults:true})};
}
