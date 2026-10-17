/**
 * 8xms custom ISA — deliberately NOT Clyde-compatible.
 * Layout differs: fields ordered C,B,A,op after XOR stream cipher per-word.
 * Physical opcode map still random per build.
 */

export const LOGICAL = [
  'MOVE','LOADK','LOADN','LOADB','LOADNIL','GETGLOBAL','SETGLOBAL',
  'GETTABLE','SETTABLE','GETFIELD','SETFIELD','SELF',
  // Catph-style first-class ops (full Luau method/table-key path)
  'NAMECALL','NAMECALL2','NAMECALL3','GETTABLEKS','SETTABLEKS','GETTABLEN','SETTABLEN',
  'GETTABLEKS2','SETTABLEKS2','GETTABLEN2','SETTABLEN2',
  'ADD','SUB','MUL','DIV','MOD','POW','IDIV','UNM','NOT','LEN','CONCAT',
  'JMP','EQ','LT','LE','TEST','TESTSET',
  'CALL','TAILCALL','RETURN','CLOSURE','VARARG',
  'FORPREP','FORLOOP','TFORCALL','TFORLOOP',
  'NEWTABLE','SETLIST','CLOSE','LOADKX',
  'BAND','BOR','BXOR','BNOT','SHL','SHR',
  'GETUPVAL','SETUPVAL',
  'EXTRAARG','NOP','HALT',
  'ADDI','SUBI','MULI','DIVI','MODI','EQI','LTI','LEI',
  'MOVE2','MOVE3','LOADK2','LOADK3','LOADN2','LOADN3',
  'GETTABUP','SETTABUP','GETTABLE2','SETTABLE2',
  'CALL1','CALL2','CALL3','CALL4','RETURN0','RETURN1','RETURN2',
  'JMP0','JMP1','JMP2','TEST0','TEST1',
  'ADD2','SUB2','MUL2','DIV2','POW2','CONCAT2','CONCAT3',
  'NEWTABLE0','NEWTABLE1','SETLIST0','SETLIST1',
  'BAND2','BOR2','BXOR2','SHL2','SHR2',
  'NOP0','NOP1','NOP2','NOP3','NOP4','NOP5',
  'DECOY0','DECOY1','DECOY2','DECOY3','DECOY4','DECOY5','DECOY6','DECOY7',
  'DECOY8','DECOY9','DECOY10','DECOY11','DECOY12','DECOY13','DECOY14','DECOY15',
  'TRAP0','TRAP1','TRAP2','TRAP3',
  'LOADSTR','EXECSTR','GETENV','SETENV','RAWGET','RAWSET',
  'TONUMBER','TOSTRING','TYPEOF','PCall','XPCall',
  'SELFB','GETFIELD2','SETFIELD2','LEN2','UNM2','NOT2',
  'FORPREP2','FORLOOP2','TFORLOOP2','CLOSURE2','NEWCLOSURE','GETVARARGS',
];
while (LOGICAL.length < 130) LOGICAL.push('PAD' + LOGICAL.length);

export function buildOpcodeMap(rng = Math.random) {
  const phys = [];
  for (let i = 0; i < 130; i++) phys.push(i);
  for (let i = 129; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = phys[i]; phys[i] = phys[j]; phys[j] = t;
  }
  const toPhys = {};
  const toLog = {};
  for (let i = 0; i < 130; i++) {
    const name = LOGICAL[i] || ('PAD' + i);
    toPhys[name] = phys[i];
    toLog[phys[i]] = name;
  }
  // stream key for instruction scrambling (not Clyde-style plain words)
  const streamKey = (Math.floor(rng() * 0x0fffff) ^ 0x5A17C3) >>> 0;
  return { toPhys, toLog, physOrder: phys, streamKey };
}

/**
 * Pack: raw fields → 32-bit word with NON-standard field order:
 *   bits 0..7   = op
 *   bits 8..15  = C
 *   bits 16..23 = B
 *   bits 24..31 = A
 * then XOR with (streamKey + pc * 0x9E3779B9)
 * Different from Clyde and from old 8xms (op<<24|A<<16|B<<8|C).
 */
export function packInst(op, a = 0, b = 0, c = 0, streamKey = 0, pc = 0) {
  const raw =
    ((a & 255) << 24) |
    ((b & 255) << 16) |
    ((c & 255) << 8) |
    (op & 255);
  const k = (streamKey + Math.imul(pc, 0x9E3779B9)) >>> 0;
  return (raw ^ k) >>> 0;
}

/** Decode helper for JS tests */
export function unpackInst(word, streamKey = 0, pc = 0) {
  const k = (streamKey + Math.imul(pc, 0x9E3779B9)) >>> 0;
  const raw = (word ^ k) >>> 0;
  return {
    op: raw & 255,
    c: (raw >>> 8) & 255,
    b: (raw >>> 16) & 255,
    a: (raw >>> 24) & 255,
  };
}

export function encodeBytecodeBlob(insts, constants, protoMeta) {
  return { insts, constants, protoMeta };
}
