/**
 * Multi-proto AST → register bytecode (8xms custom VM).
 *
 * Full Luau compile support:
 *   - local / global / multi-assign / compound-assign (+=, -=, etc.)
 *   - local function + nested function (protos), upvalues (capture)
 *   - if/elseif/else, while, repeat-until, for-num, for-in (full)
 *   - break/continue/return (multi-value)
 *   - call / method call / chained index / tables
 *   - binops with proper precedence, unary, vararg
 *   - Luau compound ops (// , ..=, ^=)
 *
 * Calling convention (matches vm-runtime.js):
 *   CALL A B C:  R[A..A+B-1] = R[A](R[A+1..A+B-1])
 *                B = narg+1 (0 = vararg-from-stack), C = nret+1 (0 = all, 1 = discard, 2 = 1 value)
 *   SELF A B C:  R[A+1] = R[B]; R[A] = R[B][R[C]]   (sets up method call)
 *
 * Multi-value return convention:
 *   RETURN A B:  returns R[A..A+B-1]; B=0 means vararg all from A; B=1 means no values; B=2 means 1 value
 */
import { buildOpcodeMap, packInst, unpackInst } from './vm-isa.js';
import { parse } from './luau-parse.js';

const RESERVED = new Set([
  'game','workspace','script','shared','_G','_ENV','plugin','typeof','type','print','error','assert',
  'pcall','xpcall','pairs','ipairs','next','select','unpack','tonumber','tostring','setmetatable','getmetatable',
  'rawget','rawset','rawequal','require','task','Instance','Vector3','Vector2','CFrame','Color3','Enum','bit32',
  'math','string','table','coroutine','debug','utf8','os','buffer','tick','wait','delay','spawn','getfenv','setfenv',
  'getgenv','getrenv','cloneref','clonereference','warn','Random','DateTime','TweenInfo','NumberRange','UDim','UDim2',
  'Ray','Region3','BrickColor','PhysicalProperties','NumberSequence','ColorSequence','NumberSequenceKeypoint',
  'ColorSequenceKeypoint','Faces','NormalId','Axes','Font',
]);

export function scrambleAst(ast) {
  const map = new Map();
  const used = new Set();
  const alnum = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const nn = () => {
    let s;
    do {
      const pref = ['_','__','l','x','z','q','w','m','v','k'][Math.floor(Math.random()*10)];
      s = pref;
      const len = 5 + Math.floor(Math.random()*6);
      for (let i = 0; i < len; i++) s += alnum[Math.floor(Math.random()*alnum.length)];
      s += Math.floor(Math.random()*0xffff).toString(36);
    } while (used.has(s) || RESERVED.has(s));
    used.add(s);
    return s;
  };
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.type === 'Local') {
      node.names = node.names.map(nm => RESERVED.has(nm) ? nm : (map.has(nm) ? map.get(nm) : (map.set(nm, nn()), map.get(nm))));
      (node.values || []).forEach(walk); return;
    }
    if (node.type === 'LocalFunction' || node.type === 'FunctionExpr') {
      if (node.type === 'LocalFunction' && !RESERVED.has(node.name)) {
        if (!map.has(node.name)) map.set(node.name, nn());
        node.name = map.get(node.name);
      }
      node.params = (node.params || []).map(p => p === '...' || RESERVED.has(p) ? p : (map.has(p) ? map.get(p) : (map.set(p, nn()), map.get(p))));
      walk(node.body); return;
    }
    if (node.type === 'FunctionStmt') { walk(node.body); return; }
    if (node.type === 'Name' && map.has(node.name)) { node.name = map.get(node.name); return; }
    if (node.type === 'ForNum') {
      if (!RESERVED.has(node.name)) { if (!map.has(node.name)) map.set(node.name, nn()); node.name = map.get(node.name); }
      walk(node.a); walk(node.b); walk(node.step); walk(node.body); return;
    }
    if (node.type === 'ForIn') {
      node.names = node.names.map(nm => RESERVED.has(nm) ? nm : (map.has(nm) ? map.get(nm) : (map.set(nm, nn()), map.get(nm))));
      (node.iter || []).forEach(walk); walk(node.body); return;
    }
    for (const k of Object.keys(node)) if (k !== 'type') walk(node[k]);
  }
  walk(ast);
  return ast;
}
export const scrambleOnly = scrambleAst;

function createCtx(parent, map, isVararg) {
  return {
    parent,
    map,
    isVararg: isVararg || false,
    insts: [],
    constants: [],
    kIndex: new Map(),
    locals: new Map(),
    nextReg: 0,
    freeReg: 0,
    maxReg: 0,
    loopStack: [],
    upvalues: new Map(),
    upvalueList: [],
    protos: [],
  };
}

function constIdx(ctx, v) {
  // Distinguish booleans from numbers in the key
  const key = typeof v + ':' + String(v);
  if (ctx.kIndex.has(key)) return ctx.kIndex.get(key);
  const i = ctx.constants.length;
  ctx.constants.push(v);
  ctx.kIndex.set(key, i);
  return i;
}

function op(ctx, name) {
  return ctx.map.toPhys[name] ?? ctx.map.toPhys.NOP ?? 0;
}

function emit(ctx, name, a = 0, b = 0, c = 0) {
  const pc = ctx.insts.length;
  const sk = (ctx.map && ctx.map.streamKey) || 0;
  ctx.insts.push(packInst(op(ctx, name), a, b, c, sk, pc));
  return ctx.insts.length - 1;
}

function allocLocal(ctx, name) {
  // Sync nextReg with freeReg so temps and locals don't collide.
  if (ctx.nextReg < ctx.freeReg) ctx.nextReg = ctx.freeReg;
  const r = ctx.nextReg++;
  ctx.locals.set(name, r);
  if (ctx.freeReg < ctx.nextReg) ctx.freeReg = ctx.nextReg;
  ctx.maxReg = Math.max(ctx.maxReg, ctx.nextReg, ctx.freeReg);
  return r;
}

function allocTemp(ctx) {
  // Sync freeReg with nextReg so temps and locals don't collide.
  if (ctx.freeReg < ctx.nextReg) ctx.freeReg = ctx.nextReg;
  const r = ctx.freeReg++;
  ctx.maxReg = Math.max(ctx.maxReg, ctx.freeReg);
  return r;
}

function saveFree(ctx) { return ctx.freeReg; }
function restoreFree(ctx, s) { ctx.freeReg = s; }

function resolveName(ctx, name) {
  if (ctx.locals.has(name)) return { kind: 'local', reg: ctx.locals.get(name) };
  if (ctx.upvalues.has(name)) return { kind: 'upval', idx: ctx.upvalues.get(name) };
  if (ctx.parent) {
    const pl = ctx.parent.locals.get(name);
    if (pl !== undefined) {
      const idx = ctx.upvalueList.length;
      ctx.upvalueList.push({ isLocal: true, index: pl, name });
      ctx.upvalues.set(name, idx);
      return { kind: 'upval', idx };
    }
    const pu = resolveName(ctx.parent, name);
    if (pu.kind === 'upval') {
      const idx = ctx.upvalueList.length;
      ctx.upvalueList.push({ isLocal: false, index: pu.idx, name });
      ctx.upvalues.set(name, idx);
      return { kind: 'upval', idx };
    }
    if (pu.kind === 'local') {
      const idx = ctx.upvalueList.length;
      ctx.upvalueList.push({ isLocal: true, index: pu.reg, name });
      ctx.upvalues.set(name, idx);
      return { kind: 'upval', idx };
    }
  }
  return { kind: 'global', name };
}

function loadName(ctx, name, dest) {
  const r = resolveName(ctx, name);
  if (r.kind === 'local') emit(ctx, 'MOVE', dest, r.reg, 0);
  else if (r.kind === 'upval') emit(ctx, 'GETUPVAL', dest, r.idx, 0);
  else {
    // global: load name as const, then GETGLOBAL
    const ki = constIdx(ctx, name);
    emit(ctx, 'LOADK', dest, ki & 255, (ki >> 8) & 255);
    emit(ctx, 'GETGLOBAL', dest, dest, 0);
  }
}

function storeName(ctx, name, src) {
  const r = resolveName(ctx, name);
  if (r.kind === 'local') emit(ctx, 'MOVE', r.reg, src, 0);
  else if (r.kind === 'upval') emit(ctx, 'SETUPVAL', src, r.idx, 0);
  else {
    const ki = constIdx(ctx, name);
    const tn = allocTemp(ctx);
    emit(ctx, 'LOADK', tn, ki & 255, (ki >> 8) & 255);
    emit(ctx, 'SETGLOBAL', tn, src, 0);
  }
}

/**
 * Compile an expression into register `dest`.
 * For multi-value expressions (calls, vararg) when `multi` is true,
 * the expression may expand to fill R[dest..].
 */
function compileExpr(ctx, node, dest, multi) {
  if (!node) { emit(ctx, 'LOADNIL', dest); return; }
  switch (node.type) {
    case 'Number': {
      const ki = constIdx(ctx, node.value);
      emit(ctx, 'LOADN', dest, ki & 255, (ki >> 8) & 255);
      break;
    }
    case 'String': {
      const ki = constIdx(ctx, node.value);
      emit(ctx, 'LOADK', dest, ki & 255, (ki >> 8) & 255);
      break;
    }
    case 'Nil': emit(ctx, 'LOADNIL', dest); break;
    case 'Bool': emit(ctx, 'LOADB', dest, node.value ? 1 : 0, 0); break;
    case 'Name': loadName(ctx, node.name, dest); break;
    case 'Bin': compileBin(ctx, node, dest); break;
    case 'Un': {
      const s = saveFree(ctx);
      const rb = allocTemp(ctx);
      compileExpr(ctx, node.arg, rb, false);
      if (node.op === 'not') emit(ctx, 'NOT', dest, rb, 0);
      else if (node.op === '-') emit(ctx, 'UNM', dest, rb, 0);
      else if (node.op === '#') emit(ctx, 'LEN', dest, rb, 0);
      restoreFree(ctx, s);
      break;
    }
    case 'Call': {
      compileExpr(ctx, node.callee, dest, false);
      const args = node.args || [];
      let narg = args.length;
      let isVarargCall = false;
      for (let i = 0; i < args.length; i++) {
        const isLast = i === args.length - 1;
        const isMultiArg = isLast && (args[i].type === 'Call' || args[i].type === 'MethodCall' || args[i].type === 'Vararg');
        compileExpr(ctx, args[i], dest + 1 + i, isMultiArg);
        if (isMultiArg) isVarargCall = true;
      }
      const nret = multi ? (typeof multi === 'number' ? multi : 8) : 1;
      ctx.freeReg = Math.max(ctx.freeReg, dest + 1 + args.length, dest + nret);
      ctx.maxReg = Math.max(ctx.maxReg, ctx.freeReg);
      const C = multi ? (typeof multi === 'number' ? multi + 1 : 0) : 2;
      emit(ctx, 'CALL', dest, isVarargCall ? 0 : (narg + 1), C);
      break;
    }
    case 'MethodCall': {
      // MethodCall: obj:method(args)
      // SELF must not clobber method-name reg: runtime saves R[C] first.
      // Reserve dest..dest+1 for method+self; put temps at dest+2+.
      const s = saveFree(ctx);
      ctx.freeReg = Math.max(ctx.freeReg, dest + 2);
      const robj = allocTemp(ctx);
      compileExpr(ctx, node.obj, robj, false);
      const rmethod = allocTemp(ctx);
      const km = constIdx(ctx, node.method);
      emit(ctx, 'LOADK', rmethod, km & 255, (km >> 8) & 255);
      emit(ctx, 'SELF', dest, robj, rmethod);
      // Now R[dest] = method, R[dest+1] = obj. Args go at R[dest+2..]
      const args = node.args || [];
      let isVarargCall = false;
      for (let i = 0; i < args.length; i++) {
        const isLast = i === args.length - 1;
        const isMulti = isLast && (args[i].type === 'Call' || args[i].type === 'MethodCall' || args[i].type === 'Vararg');
        compileExpr(ctx, args[i], dest + 2 + i, isMulti);
        if (isMulti) isVarargCall = true;
      }
      ctx.freeReg = Math.max(ctx.freeReg, dest + 2 + args.length);
      ctx.maxReg = Math.max(ctx.maxReg, ctx.freeReg);
      // CALL dest, narg+2 (self + args), multi?0:2
      emit(ctx, 'CALL', dest, isVarargCall ? 0 : (args.length + 2), multi ? 0 : 2);
      restoreFree(ctx, s);
      break;
    }
    case 'Index': {
      const s = saveFree(ctx);
      const ro = allocTemp(ctx), rk = allocTemp(ctx);
      compileExpr(ctx, node.obj, ro, false);
      compileExpr(ctx, node.key, rk, false);
      emit(ctx, 'GETTABLE', dest, ro, rk);
      restoreFree(ctx, s);
      break;
    }
    case 'Table': {
      emit(ctx, 'NEWTABLE', dest, 0, 0);
      let arrIdx = 1;
      for (const f of node.fields || []) {
        const s = saveFree(ctx);
        if (f.key == null) {
          // array part: use SETLIST-style with index, or fall back to SETTABLE
          const rv = allocTemp(ctx), rk = allocTemp(ctx);
          compileExpr(ctx, f.value, rv, false);
          // Last array field may be multi (call/vararg) → expand
          const isLast = f === node.fields[node.fields.length - 1];
          if (isLast && (f.value.type === 'Call' || f.value.type === 'MethodCall' || f.value.type === 'Vararg')) {
            // SETLIST with C=0 means fill to vararg
            emit(ctx, 'SETLIST', dest, rv, 0);
            // skip remaining (SETLIST consumed all)
            arrIdx = -1;
          } else {
            const ki = constIdx(ctx, arrIdx++);
            emit(ctx, 'LOADN', rk, ki & 255, (ki >> 8) & 255);
            emit(ctx, 'SETTABLE', dest, rk, rv);
          }
        } else {
          const rk = allocTemp(ctx), rv = allocTemp(ctx);
          compileExpr(ctx, f.key, rk, false);
          compileExpr(ctx, f.value, rv, false);
          emit(ctx, 'SETTABLE', dest, rk, rv);
        }
        restoreFree(ctx, s);
        if (arrIdx === -1) break;
      }
      break;
    }
    case 'FunctionExpr': {
      const protoIdx = compileFunction(ctx, node.params || [], node.body, false);
      emit(ctx, 'CLOSURE', dest, protoIdx & 255, (protoIdx >> 8) & 255);
      break;
    }
    case 'Vararg': {
      // VARARG A B: B=0 means all, B=2 means 1 value
      emit(ctx, 'VARARG', dest, multi ? 0 : 2);
      break;
    }
    case 'IfExpr': {
      // if cond then a else b  →  compile as: TEST cond; if false JMP to else; load then; JMP end; else: load else
      const s = saveFree(ctx);
      const rc = allocTemp(ctx);
      compileExpr(ctx, node.cond, rc, false);
      const testPc = emit(ctx, 'TEST', rc, 0, 0);
      compileExpr(ctx, node.then, dest, false);
      const jmpPc = emit(ctx, 'JMP', 0, 0, 0);
      const elsePc = ctx.insts.length;
      if (node.else) compileExpr(ctx, node.else, dest, false);
      else emit(ctx, 'LOADNIL', dest);
      const endPc = ctx.insts.length;
      // patch test: if not cond, skip to elsePc
      patchTest(ctx, testPc, elsePc - testPc - 1);
      // patch jmp: skip to endPc
      patchJmp(ctx, jmpPc, endPc - jmpPc - 1);
      restoreFree(ctx, s);
      break;
    }
    default:
      emit(ctx, 'LOADNIL', dest);
  }
}

function compileBin(ctx, node, dest) {
  // short-circuit and/or (TEST: C bit0 = invert, offset in B+(C>>1)*256)
  if (node.op === 'and' || node.op === 'or') {
    const s = saveFree(ctx);
    compileExpr(ctx, node.left, dest, false);
    const inv = node.op === 'or' ? 1 : 0;
    const testPc = emit(ctx, 'TEST', dest, 0, inv);
    compileExpr(ctx, node.right, dest, false);
    const endPc = ctx.insts.length;
    // re-pack with correct skip
    let r = (endPc - testPc - 1) | 0;
    if (r < -16384) r = -16384;
    if (r > 16383) r = 16383;
    const u = r < 0 ? r + 32768 : r;
    const b = u & 255;
    const hi = (u >> 8) & 127;
    const cEnc = (hi << 1) | inv;
    ctx.insts[testPc] = packInst(op(ctx, 'TEST'), dest, b, cEnc, (ctx.map && ctx.map.streamKey) || 0, testPc);
    restoreFree(ctx, s);
    return;
  }
  // comparison → bool
  const cmp = { '==': 'EQ', '~=': 'EQ', '<': 'LT', '<=': 'LE', '>': 'LT', '>=': 'LE' };
  if (cmp[node.op]) {
    const s = saveFree(ctx);
    const rb = allocTemp(ctx), rc = allocTemp(ctx);
    compileExpr(ctx, node.left, rb, false);
    compileExpr(ctx, node.right, rc, false);
    if (node.op === '~=' || node.op === '>') {
      // invert: a~=b → not (a==b); a>b → b<a
      if (node.op === '>') emit(ctx, 'LT', dest, rc, rb);
      else { emit(ctx, cmp[node.op], dest, rb, rc); emit(ctx, 'NOT', dest, dest, 0); }
    } else if (node.op === '>=') {
      emit(ctx, 'LE', dest, rc, rb); // a>=b → b<=a
    } else {
      emit(ctx, cmp[node.op], dest, rb, rc);
    }
    restoreFree(ctx, s);
    return;
  }
  // arithmetic / concat
  const binOp = {
    '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV', '%': 'MOD', '^': 'POW',
    '..': 'CONCAT', '//': 'IDIV',
    '&': 'BAND', '|': 'BOR', // bit ops if present in ISA
  };
  const s = saveFree(ctx);
  const rb = allocTemp(ctx), rc = allocTemp(ctx);
  compileExpr(ctx, node.left, rb, false);
  compileExpr(ctx, node.right, rc, false);
  const on = binOp[node.op] || 'ADD';
  // Prefer ISA op if mapped, else fall back ADD
  if (ctx.map && ctx.map.toPhys && ctx.map.toPhys[on] !== undefined) {
    emit(ctx, on, dest, rb, rc);
  } else if (on === 'BAND' || on === 'BOR') {
    // soft: leave as ADD if no bit op (rare)
    emit(ctx, 'ADD', dest, rb, rc);
  } else {
    emit(ctx, on, dest, rb, rc);
  }
  restoreFree(ctx, s);
}

function compileFunction(parentCtx, params, body, isLocalName) {
  const isVararg = params.includes('...');
  const ctx = createCtx(parentCtx, parentCtx.map, isVararg);
  for (let i = 0; i < params.length; i++) {
    if (params[i] !== '...') allocLocal(ctx, params[i]);
  }
  compileBlock(ctx, body);
  emit(ctx, 'RETURN', 0, 0, 0);
  const proto = {
    insts: ctx.insts,
    constants: ctx.constants,
    maxReg: Math.max(ctx.maxReg, 4),
    nparams: params.filter(p => p !== '...').length,
    isVararg,
    upvalues: ctx.upvalueList,
    protos: ctx.protos,
  };
  const idx = parentCtx.protos.length;
  parentCtx.protos.push(proto);
  return idx;
}

function patchTest(ctx, testPc, skip) {
  const ins = ctx.insts[testPc];
  const A = (ins >>> 16) & 255;
  const inv = (ins >>> 0) & 1; // preserve invert bit
  let r = skip | 0;
  if (r < -16384) r = -16384;
  if (r > 16383) r = 16383;
  const u = r < 0 ? r + 32768 : r;
  const b = u & 255;
  const hi = (u >> 8) & 127;
  const c = (hi << 1) | inv;
  ctx.insts[testPc] = packInst(op(ctx, 'TEST'), A, b, c, (ctx.map && ctx.map.streamKey) || 0, testPc);
}

function patchJmp(ctx, jmpPc, rel) {
  let r = rel | 0;
  if (r < -32768) r = -32768;
  if (r > 32767) r = 32767;
  const u = r < 0 ? r + 65536 : r;
  ctx.insts[jmpPc] = packInst(op(ctx, 'JMP'), 0, u & 255, (u >> 8) & 255, (ctx.map && ctx.map.streamKey) || 0, jmpPc);
}

function compileBlock(ctx, block) {
  const body = (block && block.body) || block || [];
  for (const st of body) compileStmt(ctx, st);
}

function compileStmt(ctx, st) {
  if (!st) return;
  switch (st.type) {
    case 'Local': {
      // Multi-value local: a, b = f()  →  f may return 2 values
      const names = st.names;
      const values = st.values || [];
      if (values.length === 0) {
        for (let i = 0; i < names.length; i++) {
          const r = allocLocal(ctx, names[i]);
          emit(ctx, 'LOADNIL', r);
        }
        break;
      }
      // Allocate locals first
      const regs = [];
      for (let i = 0; i < names.length; i++) regs.push(allocLocal(ctx, names[i]));
      // Compile values into the local regs
      if (values.length > 0 && names.length > values.length && (
        values[values.length - 1].type === 'Call' ||
        values[values.length - 1].type === 'MethodCall' ||
        values[values.length - 1].type === 'Vararg'
      )) {
        // prefix values
        for (let i = 0; i < values.length - 1; i++) {
          if (i < names.length) compileExpr(ctx, values[i], regs[i], false);
        }
        // last multi into consecutive regs[prefix..]
        const prefix = values.length - 1;
        const nret = names.length - prefix;
        if (prefix < names.length) {
          compileExpr(ctx, values[values.length - 1], regs[prefix], nret);
          // copy consecutive returns if CALL filled R[base..base+nret)
          for (let j = 1; j < nret; j++) {
            if (regs[prefix + j] !== regs[prefix] + j) {
              emit(ctx, 'MOVE', regs[prefix + j], regs[prefix] + j, 0);
            }
          }
        }
      } else {
        for (let i = 0; i < values.length; i++) {
          if (i < names.length) {
            compileExpr(ctx, values[i], regs[i], false);
          } else {
            const s = saveFree(ctx);
            const t = allocTemp(ctx);
            compileExpr(ctx, values[i], t, false);
            restoreFree(ctx, s);
          }
        }
      }
      // If fewer values than names, nil-fill the rest — BUT only if the
      // last value was NOT multi (multi-value calls/varargs already fill
      // the remaining slots).
      const lastIsMulti = values.length > 0 && (
        values[values.length - 1].type === 'Call' ||
        values[values.length - 1].type === 'MethodCall' ||
        values[values.length - 1].type === 'Vararg'
      );
      if (!lastIsMulti) {
        for (let i = values.length; i < names.length; i++) {
          emit(ctx, 'LOADNIL', regs[i]);
        }
      }
      break;
    }
    case 'LocalFunction': {
      // Pre-allocate the local slot BEFORE compiling the body so the
      // function can reference itself (recursion) and capture itself
      // as an upvalue.
      const r = allocLocal(ctx, st.name);
      const protoIdx = compileFunction(ctx, st.params || [], st.body, true);
      emit(ctx, 'CLOSURE', r, protoIdx & 255, (protoIdx >> 8) & 255);
      break;
    }
    case 'FunctionStmt': {
      // function a.b.c:d(params) ... end
      // For dotted names, we need to: load a.b.c, then SETFIELD with method name
      const protoIdx = compileFunction(ctx, st.params || [], st.body, false);
      const tmp = allocTemp(ctx);
      emit(ctx, 'CLOSURE', tmp, protoIdx & 255, (protoIdx >> 8) & 255);
      const parts = st.name.split('.');
      if (st.method) {
        // a.b.c:d → load a.b.c into tmp2, then SETFIELD tmp2 d tmp
        const s = saveFree(ctx);
        let baseReg;
        if (parts.length === 1) {
          baseReg = allocTemp(ctx);
          loadName(ctx, parts[0], baseReg);
        } else {
          baseReg = allocTemp(ctx);
          loadName(ctx, parts[0], baseReg);
          for (let i = 1; i < parts.length; i++) {
            const rk = allocTemp(ctx);
            const ki = constIdx(ctx, parts[i]);
            emit(ctx, 'LOADK', rk, ki & 255, (ki >> 8) & 255);
            emit(ctx, 'GETTABLE', baseReg, baseReg, rk);
          }
        }
        const rk = allocTemp(ctx);
        const ki = constIdx(ctx, st.method);
        emit(ctx, 'LOADK', rk, ki & 255, (ki >> 8) & 255);
        emit(ctx, 'SETTABLE', baseReg, rk, tmp);
        restoreFree(ctx, s);
      } else if (parts.length === 1) {
        storeName(ctx, parts[0], tmp);
      } else {
        // a.b.c = closure → load a.b, SETFIELD c tmp
        const s = saveFree(ctx);
        const baseReg = allocTemp(ctx);
        loadName(ctx, parts[0], baseReg);
        for (let i = 1; i < parts.length - 1; i++) {
          const rk = allocTemp(ctx);
          const ki = constIdx(ctx, parts[i]);
          emit(ctx, 'LOADK', rk, ki & 255, (ki >> 8) & 255);
          emit(ctx, 'GETTABLE', baseReg, baseReg, rk);
        }
        const rk = allocTemp(ctx);
        const ki = constIdx(ctx, parts[parts.length - 1]);
        emit(ctx, 'LOADK', rk, ki & 255, (ki >> 8) & 255);
        emit(ctx, 'SETTABLE', baseReg, rk, tmp);
        restoreFree(ctx, s);
      }
      break;
    }
    case 'Assign': {
      // Multi-assign with multi-value RHS
      const vars = st.vars;
      const values = st.values || [];
      // For simple case with compound op, handle separately
      if (st.op && st.op !== '=') {
        const v = vars[0];
        const s = saveFree(ctx);
        const left = allocTemp(ctx);
        const right = allocTemp(ctx);
        if (v.type === 'Name') loadName(ctx, v.name, left);
        else if (v.type === 'Index') {
          const ro = allocTemp(ctx), rk = allocTemp(ctx);
          compileExpr(ctx, v.obj, ro, false);
          compileExpr(ctx, v.key, rk, false);
          emit(ctx, 'GETTABLE', left, ro, rk);
        }
        compileExpr(ctx, values[0], right, false);
        const bin = { '+=': 'ADD', '-=': 'SUB', '*=': 'MUL', '/=': 'DIV', '%=': 'MOD', '^=': 'POW', '..=': 'CONCAT', '//=': 'IDIV' };
        emit(ctx, bin[st.op] || 'ADD', right, left, right);
        if (v.type === 'Name') storeName(ctx, v.name, right);
        else if (v.type === 'Index') {
          const ro = allocTemp(ctx), rk = allocTemp(ctx);
          compileExpr(ctx, v.obj, ro, false);
          compileExpr(ctx, v.key, rk, false);
          emit(ctx, 'SETTABLE', ro, rk, right);
        }
        restoreFree(ctx, s);
        break;
      }
      // Multi-value assignment: evaluate all RHS first into temps, then store
      const tmpRegs = [];
      const s = saveFree(ctx);
      for (let i = 0; i < values.length; i++) {
        const isLast = i === values.length - 1;
        const isMulti = isLast && (values[i].type === 'Call' || values[i].type === 'MethodCall' || values[i].type === 'Vararg') && vars.length > values.length;
        const t = allocTemp(ctx);
        compileExpr(ctx, values[i], t, isMulti);
        tmpRegs.push(t);
      }
      // For multi-value expansion: if last RHS is multi and vars > values,
      // the call/vararg already filled tmpRegs[last]..tmpRegs[last]+N.
      // For simplicity, just assign vars[i] = tmpRegs[i] for i < values.length,
      // and nil for the rest — but skip nil-fill if last was multi (already filled).
      const lastIsMulti = values.length > 0 && vars.length > values.length && (
        values[values.length - 1].type === 'Call' ||
        values[values.length - 1].type === 'MethodCall' ||
        values[values.length - 1].type === 'Vararg'
      );
      for (let i = 0; i < vars.length; i++) {
        const v = vars[i];
        const srcReg = i < tmpRegs.length ? tmpRegs[i] : null;
        if (v.type === 'Name') {
          if (srcReg !== null) storeName(ctx, v.name, srcReg);
          else if (!lastIsMulti) {
            const t = allocTemp(ctx);
            emit(ctx, 'LOADNIL', t);
            storeName(ctx, v.name, t);
          }
        } else if (v.type === 'Index') {
          const ro = allocTemp(ctx), rk = allocTemp(ctx);
          compileExpr(ctx, v.obj, ro, false);
          compileExpr(ctx, v.key, rk, false);
          if (srcReg !== null) emit(ctx, 'SETTABLE', ro, rk, srcReg);
          else if (!lastIsMulti) {
            const t = allocTemp(ctx);
            emit(ctx, 'LOADNIL', t);
            emit(ctx, 'SETTABLE', ro, rk, t);
          }
        }
      }
      restoreFree(ctx, s);
      break;
    }
    case 'CallStmt': {
      const s = saveFree(ctx);
      const t = allocTemp(ctx);
      compileExpr(ctx, st.expr, t, false);
      restoreFree(ctx, s);
      break;
    }
    case 'Return': {
      const values = st.values || [];
      if (values.length === 0) {
        emit(ctx, 'RETURN', 0, 0, 0);
        break;
      }
      // Place return values in consecutive registers
      const s = saveFree(ctx);
      const base = allocTemp(ctx);
      for (let i = 0; i < values.length; i++) {
        const isLast = i === values.length - 1;
        const isMulti = isLast && (values[i].type === 'Call' || values[i].type === 'MethodCall' || values[i].type === 'Vararg');
        compileExpr(ctx, values[i], base + i, isMulti);
      }
      // RETURN A B:  B = nvalues+1 for fixed, B = 0 for vararg (last is multi)
      const lastIsMulti = values.length > 0 && (
        values[values.length - 1].type === 'Call' ||
        values[values.length - 1].type === 'MethodCall' ||
        values[values.length - 1].type === 'Vararg'
      );
      emit(ctx, 'RETURN', base, lastIsMulti ? 0 : (values.length + 1), 0);
      restoreFree(ctx, s);
      break;
    }
    case 'If': {
      const endJumps = [];
      for (const arm of st.arms) {
        const s = saveFree(ctx);
        const rc = allocTemp(ctx);
        compileExpr(ctx, arm.cond, rc, false);
        const testPc = emit(ctx, 'TEST', rc, 0, 0);
        compileBlock(ctx, arm.body);
        endJumps.push(emit(ctx, 'JMP', 0, 0, 0));
        const skip = ctx.insts.length - testPc - 1;
        patchTest(ctx, testPc, skip);
        restoreFree(ctx, s);
      }
      if (st.elseBody) compileBlock(ctx, st.elseBody);
      const endPc = ctx.insts.length;
      for (const jp of endJumps) patchJmp(ctx, jp, endPc - jp - 1);
      break;
    }
    case 'While': {
      const start = ctx.insts.length;
      const s = saveFree(ctx);
      const rc = allocTemp(ctx);
      compileExpr(ctx, st.cond, rc, false);
      const testPc = emit(ctx, 'TEST', rc, 0, 0);
      ctx.loopStack.push({ breaks: [], continues: [], start });
      compileBlock(ctx, st.body);
      const contPc = ctx.insts.length;
      for (const cp of ctx.loopStack[ctx.loopStack.length - 1].continues) patchJmp(ctx, cp, start - cp - 1);
      const back = start - (ctx.insts.length + 1);
      { let r=back|0; if(r<-32768)r=-32768; if(r>32767)r=32767; const u=r<0?r+65536:r; emit(ctx,'JMP',0,u&255,(u>>8)&255); }
      const after = ctx.insts.length;
      patchTest(ctx, testPc, after - testPc - 1);
      for (const bp of ctx.loopStack[ctx.loopStack.length - 1].breaks) patchJmp(ctx, bp, after - bp - 1);
      ctx.loopStack.pop();
      restoreFree(ctx, s);
      break;
    }
    case 'Repeat': {
      // repeat-until: body executes at least once, condition checked after.
      // 'break' exits; 'continue' jumps to the condition check.
      const start = ctx.insts.length;
      ctx.loopStack.push({ breaks: [], continues: [], start, isRepeat: true });
      compileBlock(ctx, st.body);
      const contPc = ctx.insts.length;
      const s = saveFree(ctx);
      const rc = allocTemp(ctx);
      compileExpr(ctx, st.cond, rc, false);
      // if cond true → exit (skip jmp back); else jump back to start
      // TEST: if not R[A] then PC += B. So if cond true (R[A] truthy), don't skip → fall through to JMP back.
      // Wait, we want: if cond true → exit (skip the jmp back). So invert: if R[A] (cond true), skip jmp.
      // Our TEST skips when NOT R[A]. So emit NOT first, then TEST.
      emit(ctx, 'NOT', rc, rc, 0);
      const testPc = emit(ctx, 'TEST', rc, 0, 0);
      // patchTest: if NOT R[A] = if not (not cond) = if cond → skip jmp
      const skipJmp = 1; // skip the JMP back
      patchTest(ctx, testPc, skipJmp);
      const back = start - (ctx.insts.length + 1);
      { let r=back|0; if(r<-32768)r=-32768; if(r>32767)r=32767; const u=r<0?r+65536:r; emit(ctx,'JMP',0,u&255,(u>>8)&255); }
      const after = ctx.insts.length;
      for (const bp of ctx.loopStack[ctx.loopStack.length - 1].breaks) patchJmp(ctx, bp, after - bp - 1);
      // continues in repeat-until jump to the condition check
      for (const cp of ctx.loopStack[ctx.loopStack.length - 1].continues) patchJmp(ctx, cp, contPc - cp - 1);
      ctx.loopStack.pop();
      restoreFree(ctx, s);
      break;
    }
    case 'ForNum': {
      const s = saveFree(ctx);
      const base = allocTemp(ctx);
      allocTemp(ctx); // base+1 (limit)
      allocTemp(ctx); // base+2 (step)
      compileExpr(ctx, st.a, base);
      compileExpr(ctx, st.b, base + 1);
      if (st.step) compileExpr(ctx, st.step, base + 2);
      else { const ki = constIdx(ctx, 1); emit(ctx, 'LOADN', base + 2, ki & 255, (ki >> 8) & 255); }
      const ri = allocLocal(ctx, st.name);
      const prepPc = emit(ctx, 'FORPREP', base, 0, 0);
      const loopStart = ctx.insts.length;
      emit(ctx, 'MOVE', ri, base, 0);
      ctx.loopStack.push({ breaks: [], continues: [], start: loopStart });
      compileBlock(ctx, st.body);
      for (const cp of ctx.loopStack[ctx.loopStack.length - 1].continues) patchJmp(ctx, cp, ctx.insts.length - cp - 1);
      const back = loopStart - (ctx.insts.length + 1);
      {
        let r = back | 0;
        if (r < -32768) r = -32768;
        if (r > 32767) r = 32767;
        const u = r < 0 ? r + 65536 : r;
        emit(ctx, 'FORLOOP', base, u & 255, (u >> 8) & 255);
      }
      const after = ctx.insts.length;
      {
        let r = (after - prepPc - 1) | 0;
        if (r < -32768) r = -32768;
        if (r > 32767) r = 32767;
        const u = r < 0 ? r + 65536 : r;
        ctx.insts[prepPc] = packInst(op(ctx, 'FORPREP'), base, u & 255, (u >> 8) & 255, (ctx.map && ctx.map.streamKey) || 0, prepPc);
      }
      for (const bp of ctx.loopStack[ctx.loopStack.length - 1].breaks) patchJmp(ctx, bp, after - bp - 1);
      ctx.loopStack.pop();
      restoreFree(ctx, s);
      break;
    }
    case 'ForIn': {
      // Standard Lua generic for:
      //   for v1, v2, ... in iter1, iter2, ... do ... end
      // Compiles to:
      //   R[base] = iter, R[base+1] = state, R[base+2] = ctrl
      //   loop: TFORCALL base nvars+1  → R[base+3..base+3+nvars-1] = R[base](R[base+1], R[base+2])
      //         if R[base+3] == nil then jmp end
      //         v1 = R[base+3]; v2 = R[base+4]; ...
      //         R[base+2] = R[base+3]  (advance control)
      //         ...body...
      //         jmp loop
      //   end:
      const s = saveFree(ctx);
      const base = allocTemp(ctx);
      allocTemp(ctx); // state (base+1)
      allocTemp(ctx); // ctrl (base+2)
      const iter = st.iter || [];
      // Compile each iterator expression. The LAST one is multi-value
      // (so a call like ipairs(t) returns 3 values: f, state, ctrl).
      for (let i = 0; i < iter.length; i++) {
        const isLast = i === iter.length - 1;
        // For the last iter expr, if it's a Call/MethodCall/Vararg, request multi-value.
        const isMulti = isLast && (iter[i].type === 'Call' || iter[i].type === 'MethodCall' || iter[i].type === 'Vararg');
        compileExpr(ctx, iter[i], base + i, isMulti);
      }
      // If fewer than 3 iter exprs AND the last wasn't multi, nil-fill the rest.
      // (If the last was multi, the call already filled them.)
      const lastIsMulti = iter.length > 0 && (
        iter[iter.length - 1].type === 'Call' ||
        iter[iter.length - 1].type === 'MethodCall' ||
        iter[iter.length - 1].type === 'Vararg'
      );
      if (!lastIsMulti) {
        for (let i = iter.length; i < 3; i++) emit(ctx, 'LOADNIL', base + i);
      }

      const loopStart = ctx.insts.length;
      // TFORCALL base, nvars+1, 0 → calls R[base](R[base+1], R[base+2]) and puts results in R[base+3..]
      const nvars = st.names.length;
      emit(ctx, 'TFORCALL', base, nvars + 1, 0);
      // Test if R[base+3] is nil → exit
      const testPc = emit(ctx, 'TEST', base + 3, 0, 0);
      // Allocate locals for the loop variables. These are SEPARATE registers
      // (not base+3+i directly, because we need to preserve base..base+2
      // for the next TFORCALL iteration).
      const varRegs = [];
      for (let i = 0; i < nvars; i++) {
        const ln = allocLocal(ctx, st.names[i]);
        varRegs.push(ln);
        emit(ctx, 'MOVE', ln, base + 3 + i, 0);
      }
      // Advance control: R[base+2] = R[base+3] (first loop var value)
      emit(ctx, 'MOVE', base + 2, base + 3, 0);
      ctx.loopStack.push({ breaks: [], continues: [], start: loopStart });
      compileBlock(ctx, st.body);
      for (const cp of ctx.loopStack[ctx.loopStack.length - 1].continues) patchJmp(ctx, cp, loopStart - cp - 1);
      const back = loopStart - (ctx.insts.length + 1);
      { let r=back|0; if(r<-32768)r=-32768; if(r>32767)r=32767; const u=r<0?r+65536:r; emit(ctx,'JMP',0,u&255,(u>>8)&255); }
      const after = ctx.insts.length;
      patchTest(ctx, testPc, after - testPc - 1);
      for (const bp of ctx.loopStack[ctx.loopStack.length - 1].breaks) patchJmp(ctx, bp, after - bp - 1);
      ctx.loopStack.pop();
      restoreFree(ctx, s);
      break;
    }
    case 'Do':
      compileBlock(ctx, st.body);
      break;
    case 'Break': {
      if (ctx.loopStack.length) {
        const jp = emit(ctx, 'JMP', 0, 0, 0);
        ctx.loopStack[ctx.loopStack.length - 1].breaks.push(jp);
      }
      break;
    }
    case 'Continue': {
      if (ctx.loopStack.length) {
        const jp = emit(ctx, 'JMP', 0, 0, 0);
        ctx.loopStack[ctx.loopStack.length - 1].continues.push(jp);
      }
      break;
    }
    case 'Goto':
    case 'Label':
      // Goto/label not fully supported — emit NOP (best-effort)
      emit(ctx, 'NOP', 0, 0, 0);
      break;
    default:
      break;
  }
}

function serializeProtos(protos) {
  return protos.map(p => ({
    insts: p.insts,
    constants: p.constants,
    maxReg: p.maxReg,
    nparams: p.nparams,
    isVararg: p.isVararg || false,
    upvalues: p.upvalues,
    protos: serializeProtos(p.protos || []),
  }));
}


/* ========== Bytecode hardening (junk + opaque + const encrypt) ========== */
function signedOff(b, c) {
  let off = (b & 255) + ((c & 255) << 8);
  if (off > 32767) off -= 65536;
  return off;
}
function encodeOff(off) {
  if (off < 0) off += 65536;
  return { b: off & 255, c: (off >> 8) & 255 };
}

const BRANCH_OPS = new Set([
  'JMP','TEST','TESTSET','FORPREP','FORLOOP','TFORLOOP',
  'JMP0','JMP1','JMP2','TEST0','TEST1','FORPREP2','FORLOOP2','TFORLOOP2',
]);
const NO_JUNK_AFTER = new Set(['HALT','RETURN','TAILCALL','RETURN0','RETURN1','RETURN2', ...BRANCH_OPS]);

/** Insert NOP/DECOY/opaque MOVE between ops; fix relative jumps; re-pack with new PC keys */
function hardenInstStream(insts, map, rng = Math.random) {
  if (!insts || insts.length < 1) return insts || [];
  const sk = (map && map.streamKey) || 0;
  const toLog = (map && map.toLog) || {};
  const toPhys = (map && map.toPhys) || {};
  const nopOp = toPhys.NOP ?? toPhys.NOP0 ?? 0;
  const moveOp = toPhys.MOVE ?? 0;
  const decoyOps = [];
  for (let i = 0; i < 16; i++) {
    if (toPhys['DECOY' + i] != null) decoyOps.push(toPhys['DECOY' + i]);
  }

  const unpacked = [];
  for (let pc = 0; pc < insts.length; pc++) {
    const u = unpackInst(insts[pc], sk, pc);
    u.name = toLog[u.op] || 'NOP';
    unpacked.push(u);
  }

  const expanded = [];
  const oldToNew = new Array(unpacked.length);
  for (let i = 0; i < unpacked.length; i++) {
    oldToNew[i] = expanded.length;
    expanded.push({ op: unpacked[i].op, a: unpacked[i].a, b: unpacked[i].b, c: unpacked[i].c, name: unpacked[i].name, origIdx: i });
    const name = unpacked[i].name;
    if (!NO_JUNK_AFTER.has(name)) {
      const nJunk = 1 + Math.floor(rng() * 2); // 1..2
      for (let j = 0; j < nJunk; j++) {
        if (decoyOps.length && rng() < 0.55) {
          expanded.push({ op: decoyOps[Math.floor(rng() * decoyOps.length)], a: 0, b: 0, c: 0, name: 'DECOY' });
        } else {
          expanded.push({ op: nopOp, a: 0, b: 0, c: 0, name: 'NOP' });
        }
      }
      // Opaque: MOVE r,r on high dead register (never used by real code under typical maxReg)
      if (rng() < 0.3) {
        const r = 20 + Math.floor(rng() * 4);
        expanded.push({ op: moveOp, a: r, b: r, c: 0, name: 'MOVE' });
      }
    }
  }

  // Fix relative branch offsets (offset is from instruction AFTER branch)
  for (let i = 0; i < expanded.length; i++) {
    const u = expanded[i];
    if (u.origIdx === undefined) continue;
    if (!BRANCH_OPS.has(u.name)) continue;
    const oldI = u.origIdx;
    let off, inv = 0;
    if (u.name === 'TEST' || u.name === 'TEST0' || u.name === 'TEST1' || u.name === 'TESTSET') {
      inv = u.c & 1;
      off = (u.b & 255) + ((u.c >> 1) & 127) * 256;
      if (off > 16383) off -= 32768;
    } else {
      off = signedOff(u.b, u.c);
    }
    const oldTarget = oldI + 1 + off;
    let newTarget;
    if (oldTarget <= 0) newTarget = 0;
    else if (oldTarget >= unpacked.length) newTarget = expanded.length;
    else newTarget = oldToNew[oldTarget];
    let newOff = newTarget - (i + 1);
    if (u.name === 'TEST' || u.name === 'TEST0' || u.name === 'TEST1' || u.name === 'TESTSET') {
      if (newOff < -16384) newOff = -16384;
      if (newOff > 16383) newOff = 16383;
      const uu = newOff < 0 ? newOff + 32768 : newOff;
      u.b = uu & 255;
      u.c = (((uu >> 8) & 127) << 1) | inv;
    } else {
      const enc = encodeOff(newOff);
      u.b = enc.b;
      u.c = enc.c;
    }
  }

  return expanded.map((u, pc) => packInst(u.op, u.a, u.b, u.c, sk, pc));
}

/** XOR string constants with stream key — LOADK decrypts at runtime */
function encryptConstants(constants, sk) {
  if (!constants || !constants.length) return constants || [];
  sk = (sk >>> 0) || 0;
  return constants.map((c) => {
    if (typeof c !== 'string' || c.length === 0) return c;
    let out = '';
    for (let i = 0; i < c.length; i++) {
      const b = c.charCodeAt(i) & 255;
      const k = ((sk + (i + 1) * 31) >>> 0) % 256;
      out += String.fromCharCode(b ^ k);
    }
    return out;
  });
}

function hardenProtoTree(proto, map, rng) {
  if (!proto) return proto;
  if (proto.insts) proto.insts = hardenInstStream(proto.insts, map, rng);
  if (proto.constants) proto.constants = encryptConstants(proto.constants, (map && map.streamKey) || 0);
  if (Array.isArray(proto.protos)) {
    for (let i = 0; i < proto.protos.length; i++) {
      proto.protos[i] = hardenProtoTree(proto.protos[i], map, rng);
    }
  }
  return proto;
}


export function compileAstToVM(src, rng = Math.random) {
  const map = buildOpcodeMap(rng);
  return compileAstToVMWithMap(src, map);
}

export function compileAstToVMWithMap(src, map) {
  let ast;
  try {
    ast = parse(src);
  } catch (e) {
    return { ok: false, error: String(e.message || e), map };
  }
  scrambleAst(ast);
  const ctx = createCtx(null, map, true);
  try {
    compileBlock(ctx, { body: ast.body || [] });
    emit(ctx, 'HALT', 0, 0, 0);
  } catch (e) {
    return { ok: false, error: String(e.message || e), map };
  }
  if (ctx.insts.length < 1) return { ok: false, error: 'empty', map };
  // Harden: junk ops + opaque MOVE + encrypted string constants
  const hardenedInsts = hardenInstStream(ctx.insts, map, Math.random);
  const hardenedConsts = encryptConstants(ctx.constants, (map && map.streamKey) || 0);
  let protoBlob = serializeProtos(ctx.protos);
  // Harden nested protos
  if (Array.isArray(protoBlob)) {
    protoBlob = protoBlob.map((p) => hardenProtoTree(p, map, Math.random));
  }
  return {
    ok: true,
    mode: 'vm-ast',
    map,
    insts: hardenedInsts,
    constants: hardenedConsts,
    maxReg: Math.max(ctx.maxReg + 8, 24), // room for opaque high regs
    protos: protoBlob,
    hardened: true,
  };
}
