/**
 * 8XMS State Compiler v1
 *
 * Official Luau bytecode -> lifted instructions -> state-machine IR -> VM words.
 * This is a real lowering pass, not the old source wrapper transform:
 *   - one micro-state per instruction PC
 *   - basic-block discovery and block ids
 *   - explicit CFG successors
 *   - randomized opaque state tokens
 *   - keyed integrity checks for state records
 *   - randomized hash buckets for runtime dispatch
 *   - unreachable decoy states (never on the valid CFG)
 *
 * The runtime can therefore dispatch by state token instead of directly using
 * the bytecode PC as its primary control variable.
 */

export const STATE_IR_VERSION = 1;

function u32(x) { return x >>> 0; }
function mix32(a, b) {
  let x = u32((a ^ b) >>> 0);
  x = Math.imul(u32(x ^ 0x9e3779b9), 0x85ebca6b) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 13;
  return u32(x);
}

function nextPc(inst, next) {
  const op = inst.op;
  const fall = next == null ? null : next;
  if (op === 'LU_RETURN' || op === 'LU_FUSE_LOADK_RETURN' || op === 'LU_FUSE_MOVE_RETURN') return [];
  if (op === 'LU_JUMP' || op === 'LU_JUMPBACK' || op === 'LU_JUMPX') {
    return inst.target != null ? [inst.target] : [fall].filter(v => v != null);
  }
  if (op === 'LU_JUMPIF' || op === 'LU_JUMPIFNOT' || op.startsWith('LU_JUMPIFEQ') ||
      op.startsWith('LU_JUMPIFLE') || op.startsWith('LU_JUMPIFLT') ||
      op.startsWith('LU_JUMPIFNOTEQ') || op.startsWith('LU_JUMPIFNOTLE') ||
      op.startsWith('LU_JUMPIFNOTLT') || op.startsWith('LU_JUMPXEQ')) {
    return [inst.target, fall].filter((v, i, a) => v != null && a.indexOf(v) === i);
  }
  if (op === 'LU_FORNPREP' || op === 'LU_FORNLOOP' || op === 'LU_FORGLOOP' ||
      op === 'LU_FORGPREP' || op === 'LU_FORGPREP_INEXT' || op === 'LU_FORGPREP_NEXT') {
    return [inst.target, fall].filter((v, i, a) => v != null && a.indexOf(v) === i);
  }
  return fall == null ? [] : [fall];
}

function buildBlocks(instructions) {
  const pcs = instructions.map(x => x.pc);
  const pcSet = new Set(pcs);
  const starts = new Set();
  if (pcs.length) starts.add(pcs[0]);
  for (let i = 0; i < instructions.length; i++) {
    const ins = instructions[i];
    if (ins.target != null && pcSet.has(ins.target)) starts.add(ins.target);
    const fall = instructions[i + 1]?.pc;
    if ((ins.target != null || /JUMP|FOR/.test(ins.op) || ins.op === 'LU_RETURN') && fall != null) starts.add(fall);
  }
  const sorted = [...starts].sort((a, b) => a - b);
  const blockOfPc = new Map();
  const blocks = [];
  for (let bi = 0; bi < sorted.length; bi++) {
    const start = sorted[bi];
    const endLimit = bi + 1 < sorted.length ? sorted[bi + 1] : Infinity;
    const member = instructions.filter(ins => ins.pc >= start && ins.pc < endLimit);
    const id = bi;
    for (const ins of member) blockOfPc.set(ins.pc, id);
    blocks.push({ id, startPc: start, endPc: member.length ? member[member.length - 1].pc : start, instructionCount: member.length });
  }
  return { blocks, blockOfPc };
}

function makeTokenFactory(seed, fid) {
  const used = new Set();
  let serial = 0;
  return function token(pc, extra = 0) {
    let t = mix32(seed ^ Math.imul(fid + 1, 0x45d9f3b), Math.imul((pc + 1) >>> 0, 0x9e3779b1) ^ extra ^ serial++);
    while (t === 0 || used.has(t)) t = mix32(t, 0x27d4eb2d ^ serial++);
    used.add(t);
    return t >>> 0;
  };
}

export function compileStateFunction(fn, seed, options = {}) {
  const instructions = Array.isArray(fn.instructions) ? fn.instructions : [];
  const { blocks, blockOfPc } = buildBlocks(instructions);
  const count = instructions.length;
  const makeToken = makeTokenFactory(seed >>> 0, fn.id || 0);
  const stateByPc = new Map();
  const states = [];

  const epochMul = (u32(mix32(seed, (fn.id + 11) * 0x6d2b79f5)) | 1) >>> 0;
  const stateMask = mix32(seed ^ 0xa5a5a5a5, (fn.id + 7) * 0x27d4eb2d);
  const stateKey = mix32(seed ^ 0x5a5a5a5a, (fn.id + 3) * 0x9e3779b9);

  for (let i = 0; i < count; i++) {
    const ins = instructions[i];
    const token = makeToken(ins.pc, i + 1);
    stateByPc.set(ins.pc, token);
  }

  for (let i = 0; i < count; i++) {
    const ins = instructions[i];
    const nextIns = instructions[i + 1] ?? null;
    const fall = ins.fusedWith && nextIns ? (nextIns.pc + (nextIns.len || 1)) : (nextIns?.pc ?? null);
    const succPcs = nextPc(ins, fall);
    const token = stateByPc.get(ins.pc);
    const block = blockOfPc.get(ins.pc) ?? 0;
    const check = mix32(stateKey, mix32(token, ins.pc >>> 0));
    states.push({
      token,
      pc: ins.pc,
      block,
      op: ins.op,
      succPcs,
      succTokens: succPcs.map(pc => stateByPc.get(pc) ?? 0),
      check,
      route: mix32(token, stateKey),
      live: true,
    });
  }

  const decoyCount = options.decoys ?? (12 + Math.floor((instructions.length + (fn.id || 0)) % 17));
  for (let i = 0; i < decoyCount; i++) {
    const token = makeToken(-100000 - i, 0xdec0 + i);
    states.push({
      token,
      pc: -1,
      block: -1,
      op: 'STATE_DECOY',
      succPcs: [],
      succTokens: [],
      check: mix32(stateKey, token ^ 0xd15ea5e),
      route: mix32(token, stateKey ^ 0x91e10da5),
      live: false,
    });
  }

  // Dispatch buckets: token low byte chooses a bucket, then records are compared
  // by full token. This avoids a direct token->pc JSON/object mapping in the
  // generated Lua runtime and keeps average lookup O(1).
  const bucketCount = 256;
  const buckets = Array.from({ length: bucketCount }, () => []);
  for (const s of states) buckets[s.token & 255].push([s.token >>> 0, s.pc, s.check >>> 0, s.block]);

  // PC -> token table is dense in bytecode-PC space, represented as an array.
  const maxPc = instructions.reduce((m, x) => Math.max(m, x.pc), 0);
  const pcState = new Array(maxPc + 1).fill(0);
  for (const [pc, token] of stateByPc.entries()) pcState[pc] = token >>> 0;

  const entryPc = instructions[0]?.pc ?? 0;
  const entryToken = stateByPc.get(entryPc) ?? 0;
  const stateCount = count + decoyCount;
  return {
    version: STATE_IR_VERSION,
    entryToken,
    stateMask: stateMask >>> 0,
    epochMul,
    stateKey: stateKey >>> 0,
    bucketCount,
    buckets,
    pcState,
    blocks,
    stateCount,
    liveStateCount: count,
    decoyStateCount: decoyCount,
  };
}

export function compileStateProgram(program, seed, options = {}) {
  if (!program || !Array.isArray(program.functions)) throw new Error('invalid program for state compiler');
  return {
    ...program,
    stateIRVersion: STATE_IR_VERSION,
    functions: program.functions.map(fn => ({
      ...fn,
      stateMachine: compileStateFunction(fn, seed, options),
    })),
  };
}
