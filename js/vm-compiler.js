/**
 * 8xms compile pipeline — VM-first (Clyde-style), execstr only on failure.
 * Structure differs from Clyde (scrambled ISA + stream XOR).
 */
import { buildOpcodeMap, packInst } from './vm-isa.js';
import { parse } from './luau-parse.js';
import { compileAstToVMWithMap, scrambleAst } from './luau-compile.js';
import { printAst } from './luau-print.js';

function execstrPath(src, map, mode = 'execstr') {
  const k = [src];
  const insts = [];
  const op = (n) => map.toPhys[n] ?? map.toPhys.NOP;
  const sk = map.streamKey || 0;
  let pc = 0;
  insts.push(packInst(op('LOADK'), 0, 0, 0, sk, pc++));
  for (let i = 0; i < 12; i++) {
    const d = map.toPhys['DECOY' + (i % 16)] ?? map.toPhys.NOP;
    insts.push(packInst(d, i & 255, (i * 3) & 255, (i * 7) & 255, sk, pc++));
  }
  insts.push(packInst(op('EXECSTR'), 0, 0, 0, sk, pc++));
  insts.push(packInst(op('HALT'), 0, 0, 0, sk, pc++));
  return { ok: true, mode, map, insts, constants: k, maxReg: 8, protos: [] };
}

export function compileToVM(source, rng = Math.random) {
  const map = buildOpcodeMap(rng);
  let src = String(source).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Bare URL → loader
  const trimmed = src.trim();
  if (/^https?:\/\/\S+$/.test(trimmed)) {
    src = `local _u=${JSON.stringify(trimmed)};local _src=(game and game.HttpGet and game:HttpGet(_u,true)) or "";local _fn=(loadstring or load)(_src);if _fn then return _fn() end`;
  } else {
    const lines = src.split('\n');
    let firstNonEmpty = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim()) { firstNonEmpty = i; break; }
    }
    if (firstNonEmpty >= 0) {
      const firstLine = lines[firstNonEmpty].trim();
      if (/^https?:\/\/\S+$/.test(firstLine)) {
        lines[firstNonEmpty] = `local _u=${JSON.stringify(firstLine)};local _src=(game and game.HttpGet and game:HttpGet(_u,true)) or "";local _fn=(loadstring or load)(_src);if _fn then _fn() end`;
        src = lines.join('\n');
      }
    }
  }

  src = src.trim();
  if (!src) return execstrPath('return', map);

  let printed = null;
  try {
    const ast = parse(src);
    scrambleAst(ast);
    printed = printAst(ast);
  } catch (e) {
    console.warn('[8xms] parse fail → execstr-raw:', String(e.message || e));
    return execstrPath(src, map, 'execstr-raw');
  }

  // VM-FIRST: try full register bytecode on scrambled source (all scripts, including Roblox)
  try {
    const r = compileAstToVMWithMap(printed || src, map);
    if (r && r.ok && r.insts && r.insts.length > 1) {
      r.mode = 'vm-ast';
      r.map = map;
      console.log('[8xms] mode=vm-ast inst=' + r.insts.length + ' (VM→SM, scrambled)');
      return r;
    }
    if (r && r.error) console.warn('[8xms] bytecode fail:', r.error);
  } catch (e) {
    console.warn('[8xms] bytecode exception:', String(e));
  }

  // Fallback only when VM compile cannot represent the program
  if (printed && printed.trim()) {
    console.log('[8xms] mode=execstr-scrambled (VM compile failed → fallback)');
    return execstrPath(printed, map, 'execstr-scrambled');
  }
  return execstrPath(src, map, 'execstr-raw');
}

export function scrambleHandlerOrder(map, rng = Math.random) {
  const order = [];
  for (let i = 0; i < 130; i++) order.push(i);
  for (let i = 129; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  return order;
}
