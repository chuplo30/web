/**
 * 8XMS VM IR v2
 * Normalized, versioned intermediate representation between Luau bytecode
 * and the polymorphic virtual ISA.
 */
export const IR_VERSION = 2;

export const LUAU_IR_OPS = Object.freeze([
  "LU_NOP","LU_BREAK","LU_LOADNIL","LU_LOADB","LU_LOADN","LU_LOADK","LU_MOVE",
  "LU_GETGLOBAL","LU_SETGLOBAL","LU_GETUPVAL","LU_SETUPVAL","LU_CLOSEUPVALS","LU_GETIMPORT",
  "LU_GETTABLE","LU_SETTABLE","LU_GETTABLEKS","LU_SETTABLEKS","LU_GETTABLEN","LU_SETTABLEN",
  "LU_NEWCLOSURE","LU_NAMECALL","LU_CALL","LU_RETURN","LU_JUMP","LU_JUMPBACK","LU_JUMPIF","LU_JUMPIFNOT",
  "LU_JUMPIFEQ","LU_JUMPIFLE","LU_JUMPIFLT","LU_JUMPIFNOTEQ","LU_JUMPIFNOTLE","LU_JUMPIFNOTLT",
  "LU_ADD","LU_SUB","LU_MUL","LU_DIV","LU_MOD","LU_POW","LU_ADDK","LU_SUBK","LU_MULK","LU_DIVK",
  "LU_MODK","LU_POWK","LU_AND","LU_OR","LU_ANDK","LU_ORK","LU_CONCAT","LU_NOT","LU_MINUS","LU_LENGTH",
  "LU_NEWTABLE","LU_DUPTABLE","LU_SETLIST","LU_FORNPREP","LU_FORNLOOP","LU_FORGLOOP","LU_FORGPREP_INEXT",
  "LU_FASTCALL3","LU_FORGPREP_NEXT","LU_NATIVECALL","LU_GETVARARGS","LU_DUPCLOSURE","LU_PREPVARARGS","LU_LOADKX",
  "LU_JUMPX","LU_FASTCALL","LU_COVERAGE","LU_CAPTURE","LU_SUBRK","LU_DIVRK","LU_FASTCALL1","LU_FASTCALL2",
  "LU_FASTCALL2K","LU_FORGPREP","LU_JUMPXEQKNIL","LU_JUMPXEQKB","LU_JUMPXEQKN","LU_JUMPXEQKS","LU_IDIV",
  "LU_IDIVK","LU_GETUDATAKS","LU_SETUDATAKS","LU_NAMECALLUDATA","LU_NEWCLASSMEMBER","LU_CALLFB","LU_CMPPROTO","LU_NEWCLASS","LU_FUSE_LOADK_RETURN","LU_FUSE_MOVE_RETURN","LU_FUSE_GETGLOBAL_CALL","LU_FUSE_GETTABLEKS_CALL"
]);

export const IR_OP = Object.freeze([
  "MOVE","LOADK","LOADBOOL","LOADNIL","GETGLOBAL","SETGLOBAL","GETTABLE","SETTABLE","GETUPVAL","SETUPVAL",
  "GETIMPORT","GETTABUP","SETTABUP","NEW_TABLE","SETLIST","SELF","ADD","SUB","MUL","DIV","MOD","POW",
  "IDIV","UNM","NOT","LEN","CONCAT","BAND","BOR","BXOR","BNOT","SHL","SHR","EQ","LT","LE","JMP",
  "JMPIF","JMPIFNOT","TESTSET","CALL","NAMECALL","RETURN","TAILCALL","CLOSURE","DUPCLOSURE","CAPTURE",
  "CLOSEUPVALS","VARARG","FORNPREP","FORNLOOP","FORGLOOP","FORGPREP","FORGPREP_INEXT","FORGPREP_NEXT",
  "FASTCALL","FASTCALL1","FASTCALL2","FASTCALL2K","GETPROP","SETPROP","GETTABLEKS","SETTABLEKS","CHECKTYPE",
  "BREAK","COVERAGE","NOP",...LUAU_IR_OPS
]);


export function makeIRFunction({
  id = 0, maxstack = 0, numparams = 0, isvararg = false,
  constants = [], instructions = [], children = [], upvalues = [],
  lineinfo = []
} = {}) {
  return {
    version: IR_VERSION, id, maxstack, numparams, isvararg: !!isvararg,
    constants: [...constants], instructions: [...instructions],
    children: [...children], upvalues: [...upvalues], lineinfo: [...lineinfo]
  };
}

export function irInst(op, a=0,b=0,c=0,d=0,extra=null) {
  if (!IR_OP.includes(op)) throw new Error(`unknown IR opcode: ${op}`);
  return {op,a,b,c,d,extra};
}

export function verifyIR(fn) {
  if (!fn || fn.version !== IR_VERSION) throw new Error("IR version mismatch");
  if (!Array.isArray(fn.instructions)) throw new Error("IR instructions missing");
  for (const i of fn.instructions) {
    if (!i || !IR_OP.includes(i.op)) throw new Error("invalid IR instruction");
    for (const k of ["a","b","c","d"]) {
      if (!Number.isInteger(i[k])) throw new Error(`IR ${i.op}: ${k} is not integer`);
    }
  }
  for (const c of fn.children || []) verifyIR(c);
  return true;
}

/* Deterministic structural fingerprint; used to bind generated runtime to IR. */
export function fingerprintIR(fn) {
  let s = JSON.stringify(fn);
  let h = 2166136261 >>> 0;
  for (let i=0;i<s.length;i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8,"0");
}
