/**
 * 8XMS Luau binary bytecode decoder + lifter.
 * Targets the serialized Luau bytecode contract described by Luau's
 * Bytecode.h / BytecodeBuilder format. The lifter preserves instruction
 * operands and constants instead of attempting to reconstruct source AST.
 */

export const LBC_VERSION_MIN = 3;
export const LBC_VERSION_MAX = 13;
export const LBC_VERSION_CLASSES = 100;

const OP = [
  "NOP","BREAK","LOADNIL","LOADB","LOADN","LOADK","MOVE","GETGLOBAL","SETGLOBAL","GETUPVAL","SETUPVAL","CLOSEUPVALS","GETIMPORT","GETTABLE","SETTABLE","GETTABLEKS","SETTABLEKS","GETTABLEN","SETTABLEN","NEWCLOSURE","NAMECALL","CALL","RETURN","JUMP","JUMPBACK","JUMPIF","JUMPIFNOT","JUMPIFEQ","JUMPIFLE","JUMPIFLT","JUMPIFNOTEQ","JUMPIFNOTLE","JUMPIFNOTLT","ADD","SUB","MUL","DIV","MOD","POW","ADDK","SUBK","MULK","DIVK","MODK","POWK","AND","OR","ANDK","ORK","CONCAT","NOT","MINUS","LENGTH","NEWTABLE","DUPTABLE","SETLIST","FORNPREP","FORNLOOP","FORGLOOP","FORGPREP_INEXT","FASTCALL3","FORGPREP_NEXT","NATIVECALL","GETVARARGS","DUPCLOSURE","PREPVARARGS","LOADKX","JUMPX","FASTCALL","COVERAGE","CAPTURE","SUBRK","DIVRK","FASTCALL1","FASTCALL2","FASTCALL2K","FORGPREP","JUMPXEQKNIL","JUMPXEQKB","JUMPXEQKN","JUMPXEQKS","IDIV","IDIVK","GETUDATAKS","SETUDATAKS","NAMECALLUDATA","NEWCLASSMEMBER","CALLFB","CMPPROTO","NEWCLASS"
];

export const LUAU_OPCODE_NAMES = Object.freeze(OP);

const AUX = new Set([
  "GETGLOBAL","SETGLOBAL","GETIMPORT","GETTABLEKS","SETTABLEKS","NAMECALL",
  "NEWTABLE","SETLIST","FORGLOOP","FASTCALL3","LOADKX","FASTCALL2","FASTCALL2K",
  "JUMPIFEQ","JUMPIFLE","JUMPIFLT","JUMPIFNOTEQ","JUMPIFNOTLE","JUMPIFNOTLT",
  "JUMPXEQKNIL","JUMPXEQKB","JUMPXEQKN","JUMPXEQKS",
  "GETUDATAKS","SETUDATAKS","NAMECALLUDATA","NEWCLASSMEMBER","CALLFB","NEWCLASS"
]);

const AD = new Set([
  "LOADN","LOADK","JUMP","JUMPBACK","JUMPIF","JUMPIFNOT","JUMPIFEQ","JUMPIFLE","JUMPIFLT",
  "JUMPIFNOTEQ","JUMPIFNOTLE","JUMPIFNOTLT","NEWCLOSURE","DUPTABLE","FORNPREP","FORNLOOP",
  "FORGLOOP","FORGPREP_INEXT","FORGPREP_NEXT","DUPCLOSURE","JUMPXEQKNIL","JUMPXEQKB",
  "JUMPXEQKN","JUMPXEQKS","CMPPROTO"
]);
const E = new Set(["JUMPX","COVERAGE"]);

const CONST = {
  NIL: 0, BOOLEAN: 1, NUMBER: 2, STRING: 3, IMPORT: 4, TABLE: 5,
  CLOSURE: 6, VECTOR: 7, TABLE_WITH_CONSTANTS: 8, INTEGER: 9,
  CLASS_SHAPE: 10, VECTORD: 11
};

class Reader {
  constructor(buf) { this.buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf); this.p = 0; }
  get remaining() { return this.buf.length - this.p; }
  ensure(n) { if (this.p + n > this.buf.length) throw new Error(`Luau bytecode truncated at ${this.p}, need ${n}`); }
  u8() { this.ensure(1); return this.buf[this.p++]; }
  u32() { this.ensure(4); const v = this.buf.readUInt32LE(this.p); this.p += 4; return v >>> 0; }
  i32() { this.ensure(4); const v = this.buf.readInt32LE(this.p); this.p += 4; return v | 0; }
  f32() { this.ensure(4); const v = this.buf.readFloatLE(this.p); this.p += 4; return v; }
  f64() { this.ensure(8); const v = this.buf.readDoubleLE(this.p); this.p += 8; return v; }
  bytes(n) { this.ensure(n); const v = this.buf.subarray(this.p, this.p+n); this.p += n; return v; }
  varint() {
    // Luau's serialized integers use 7 data bits per byte with continuation.
    let v = 0;
    let shift = 0;
    for (;;) {
      const b = this.u8();
      v += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return v;
      shift += 7;
      if (shift > 53) throw new Error("Luau varint exceeds safe JS integer range");
    }
  }
  string() { return this.bytes(this.varint()).toString("utf8"); }
  skip(n) { this.bytes(n); }
}

function signed24(x) {
  x &= 0xffffff;
  return (x & 0x800000) ? x - 0x1000000 : x;
}
function sign16(x) { return x & 0x8000 ? x - 0x10000 : x; }
function int64FromParts(sign, lo, hi) {
  const magnitude = BigInt(lo >>> 0) | (BigInt(hi >>> 0) << 32n);
  const value = sign ? -magnitude : magnitude;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : value.toString();
}

function readClassShape(r) {
  // Shape serialization is intentionally decoded into a neutral object so
  // experimental class bytecode can continue through the VM pipeline.
  const name = r.varint();
  const propCount = r.varint();
  const properties = [];
  for (let i=0;i<propCount;i++) properties.push(r.varint());
  const methodCount = r.varint();
  const methods = [];
  for (let i=0;i<methodCount;i++) methods.push(r.varint());
  return { type:"class-shape", name, properties, methods };
}

function readConstant(r, strings, bytecodeVersion) {
  const tag = r.u8();
  switch (tag) {
    case CONST.NIL: return { type:"nil", value:null };
    case CONST.BOOLEAN: return { type:"boolean", value:!!r.u8() };
    case CONST.NUMBER: return { type:"number", value:r.f64() };
    case CONST.STRING: {
      const index = r.varint();
      return { type:"string", index, value:strings[index] ?? "" };
    }
    case CONST.IMPORT: return { type:"import", value:r.u32() };
    case CONST.TABLE: {
      const n = r.varint();
      const keys = [];
      for (let i=0;i<n;i++) keys.push(r.varint());
      return { type:"table", keys };
    }
    case CONST.CLOSURE: return { type:"closure", protoIndex:r.varint() };
    case CONST.VECTOR: return { type:"vector", value:[r.f32(),r.f32(),r.f32(),r.f32()] };
    case CONST.TABLE_WITH_CONSTANTS: {
      const n = r.varint();
      const pairs = [];
      for (let i=0;i<n;i++) pairs.push({key:r.varint(), value:r.i32()});
      return { type:"table-with-constants", pairs };
    }
    case CONST.INTEGER: {
      const sign = r.u8();
      const lo = r.u32(); const hi = r.u32();
      return { type:"integer", value:int64FromParts(sign,lo,hi) };
    }
    case CONST.CLASS_SHAPE: return readClassShape(r);
    case CONST.VECTORD: return { type:"vectord", value:[r.f64(),r.f64(),r.f64(),r.f64()] };
    default: throw new Error(`Unknown Luau constant tag ${tag} at byte ${r.p-1} (version ${bytecodeVersion})`);
  }
}

function skipTypeInfo(r) {
  const size = r.varint();
  if (size > r.remaining) throw new Error(`invalid Luau typeinfo size ${size}`);
  r.skip(size);
}

function readDebugTail(r, strings) {
  const debuglinedefined = r.varint();
  const debugname = r.varint();
  const hasLines = r.u8();
  if (hasLines) {
    // Current Luau line info uses a compact byte stream; for lifting it is
    // sufficient to preserve the raw debug section. The section length is
    // reconstructed from the remaining markers by parsing the known records
    // below when present. For -g0 output this branch is normally absent.
    const lineCount = r.varint();
    r.skip(lineCount * 4);
    const lineGap = r.varint();
    if (lineGap > 0) r.skip(lineGap);
  }
  const hasDebug = r.u8();
  if (hasDebug) {
    const localCount = r.varint();
    for (let i=0;i<localCount;i++) {
      r.varint(); // name string index
      r.varint(); // reg
      r.varint(); // startpc
      r.varint(); // endpc
    }
    const upCount = r.varint();
    for (let i=0;i<upCount;i++) r.varint();
  }
  return {
    debuglinedefined,
    debugname: strings[debugname] ?? null,
    hasLines: !!hasLines,
    hasDebug: !!hasDebug
  };
}

function readFunction(r, ctx, id, options) {
  const start = r.p;
  let frameSize = null;
  if (ctx.version >= 12 && options.assumeFunctionSizes) frameSize = r.varint();
  const maxstacksize = r.u8();
  const numparams = r.u8();
  const numupvalues = r.u8();
  const isvararg = !!r.u8();
  const flags = r.u8();
  let typeinfo = null;
  if (ctx.version >= 4 && ctx.typeVersion) {
    const before = r.p;
    // Header flag bit indicating type information has remained intentionally
    // versioned; when present the field is a length-prefixed opaque blob.
    if (flags & 1) {
      const size = r.varint();
      typeinfo = r.bytes(size);
    }
    if (r.p === before && flags & 2) {
      skipTypeInfo(r);
    }
  }
  const sizecode = r.varint();
  const instructions = new Array(sizecode);
  for (let i=0;i<sizecode;i++) instructions[i] = r.u32();
  const sizek = r.varint();
  const constants = new Array(sizek);
  for (let i=0;i<sizek;i++) constants[i] = readConstant(r, ctx.strings, ctx.version);
  const sizep = r.varint();
  const children = new Array(sizep);
  for (let i=0;i<sizep;i++) children[i] = r.varint();
  const debug = readDebugTail(r, ctx.strings);
  return {
    id, maxstacksize, numparams, numupvalues, isvararg, flags,
    typeinfo: typeinfo ? Buffer.from(typeinfo).toString("base64") : null,
    instructions, constants, children, debug,
    byteStart:start, byteEnd:r.p, frameSize
  };
}

export function decodeLuauBytecode(buffer, {
  assumeFunctionSizes = undefined,
  maxFunctions = 65535,
} = {}) {
  const r = new Reader(buffer);
  const version = r.u8();
  const typeVersion = r.u8();
  if (version < LBC_VERSION_MIN || (version > LBC_VERSION_MAX && version !== LBC_VERSION_CLASSES)) {
    throw new Error(`Unsupported Luau bytecode version ${version}; supported ${LBC_VERSION_MIN}-${LBC_VERSION_MAX}, ${LBC_VERSION_CLASSES}`);
  }
  const stringCount = r.varint();
  if (stringCount > 1e6) throw new Error(`invalid string table size ${stringCount}`);
  const strings = new Array(stringCount);
  for (let i=0;i<stringCount;i++) strings[i] = r.string();
  const userdataCount = r.varint();
  const userdata = new Array(userdataCount);
  for (let i=0;i<userdataCount;i++) userdata[i] = { name: strings[r.varint()] ?? "" };
  const functionCount = r.varint();
  if (functionCount <= 0 || functionCount > maxFunctions) throw new Error(`invalid Luau function count ${functionCount}`);
  const ctx = { version, typeVersion, strings, userdata };
  const useSizes = assumeFunctionSizes === undefined ? version >= 12 : !!assumeFunctionSizes;
  const functions = new Array(functionCount);
  for (let i=0;i<functionCount;i++) functions[i] = readFunction(r, ctx, i, {assumeFunctionSizes:useSizes});
  const mainFunction = r.varint();
  if (mainFunction >= functions.length) throw new Error(`invalid Luau main function ${mainFunction}`);
  return {
    version, typeVersion, strings, userdata, functions, mainFunction,
    trailingBytes:r.remaining,
    rawBytes:Buffer.from(buffer)
  };
}

function decodeWord(word) {
  const u = word >>> 0;
  return { opcode:u & 255, op:OP[u & 255], a:(u>>>8)&255, b:(u>>>16)&255, c:(u>>>24)&255, d:sign16(u>>>16), e:signed24(u>>>8) };
}

function jumpTarget(pc, inst, auxPresent) {
  if (inst.op === "JUMPX") return pc + 1 + inst.e;
  return pc + 1 + inst.d + (auxPresent ? 1 : 0);
}

function decodeInstruction(words, pc) {
  const head = decodeWord(words[pc]);
  if (!head.op) throw new Error(`Unknown Luau opcode ${head.opcode} at pc ${pc}`);
  const len = AUX.has(head.op) ? 2 : 1;
  const out = { pc, len, ...head };
  if (len === 2) out.aux = words[pc+1] >>> 0;
  if (out.op.startsWith("JUMP") || out.op === "FORNPREP" || out.op === "FORNLOOP" || out.op === "FORGLOOP" || out.op.startsWith("FORGPREP") || out.op === "CMPPROTO") {
    out.target = jumpTarget(pc, out, len===2);
  }
  return out;
}

export function liftFunction(fn, allFunctions) {
  const instructions = [];
  for (let pc=0; pc<fn.instructions.length;) {
    const ins = decodeInstruction(fn.instructions, pc);
    instructions.push({
      op:`LU_${ins.op}`,
      a:ins.a, b:ins.b, c:ins.c, d:ins.d, e:ins.e,
      aux:ins.aux ?? 0,
      pc:ins.pc, len:ins.len, target:ins.target ?? null
    });
    pc += ins.len;
  }
  return {
    id:fn.id,
    maxstack:fn.maxstacksize,
    numparams:fn.numparams,
    numupvalues:fn.numupvalues,
    isvararg:fn.isvararg,
    flags:fn.flags,
    constants:fn.constants,
    instructions,
    children:fn.children.map(i=>allFunctions[i]?.id ?? i),
    upvalues:[],
    debug:fn.debug
  };
}

export function liftLuauBytecode(decoded) {
  const functions = decoded.functions.map(fn => liftFunction(fn, decoded.functions));
  return {
    kind:"8xms-lifted-luau-bytecode",
    version:1,
    luauBytecodeVersion:decoded.version,
    luauTypeVersion:decoded.typeVersion,
    strings:decoded.strings,
    userdata:decoded.userdata,
    functions,
    mainFunction:decoded.mainFunction,
    opcodeCount:OP.length
  };
}

export function decodeAndLiftLuauBytecode(buffer, options={}) {
  return liftLuauBytecode(decodeLuauBytecode(buffer, options));
}
