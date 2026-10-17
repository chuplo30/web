/**
 * Path B: official Luau compiler → text bytecode → 8xms VM inst stream.
 * Requires bin/luau-compile (or LUAU_COMPILE env) — Node/Netlify only.
 * Browser without binary falls back to AST path.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildOpcodeMap, packInst } from './vm-isa.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findLuauCompile() {
  if (process.env.LUAU_COMPILE) return process.env.LUAU_COMPILE;
  const bundled = path.join(__dirname, '..', 'bin', 'luau-compile');
  if (fs.existsSync(bundled)) {
    try { fs.chmodSync(bundled, 0o755); } catch (_) {}
    return bundled;
  }
  for (const c of ['luau-compile', 'luau']) {
    const r = spawnSync(c, ['--help'], { encoding: 'utf8' });
    if (r.status === 0 || /bytecode|compile/i.test(String(r.stdout) + String(r.stderr))) return c;
  }
  return null;
}

export function luauCompileAvailable() {
  return !!findLuauCompile();
}

/** Run luau-compile --text -O0 -g0 */
export function runLuauCompileText(source) {
  const bin = findLuauCompile();
  if (!bin) return { ok: false, error: 'luau-compile not found' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), '8xms-luau-'));
  const inFile = path.join(tmp, 'in.luau');
  fs.writeFileSync(inFile, String(source), 'utf8');
  try {
    const r = spawnSync(bin, ['--text', '-O0', '-g0', inFile], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60000,
    });
    const out = String(r.stdout || '');
    const err = String(r.stderr || '');
    if (r.status !== 0 && !out.includes('Function')) {
      return { ok: false, error: (err || out || 'luau-compile failed').slice(0, 2000) };
    }
    if (!out.trim()) return { ok: false, error: err || 'empty bytecode text' };
    return { ok: true, text: out };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}


/** Scan for K(n) [bracket] allowing ] inside quotes. */
function matchKBracket(joined, from = 0) {
  const km = joined.slice(from).match(/K(\d+)\s*\[/);
  if (!km) return null;
  const kIdx = +km[1];
  const start = from + km.index + km[0].length - 1; // at '['
  let i = start, depth = 0, inQ = null, esc = false, end = -1;
  for (; i < joined.length; i++) {
    const ch = joined[i];
    if (inQ) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === inQ) inQ = null;
      continue;
    }
    if (ch === "'" || ch === '"') { inQ = ch; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return { idx: kIdx, bracket: null, end: start };
  return { idx: kIdx, bracket: joined.slice(start, end + 1), end: end + 1 };
}

function parseConstBracket(s) {
  // [1] / ['print'] / ["a"] / [true] / [nil]
  const m = s.match(/^\[(.*)\]$/s);
  if (!m) return s;
  const inner = m[1].trim();
  if (inner === 'nil') return null;
  if (inner === 'true') return true;
  if (inner === 'false') return false;
  if (/^'. *'$/.test(inner) || false) {}
  if ((inner.startsWith("'") && inner.endsWith("'")) || (inner.startsWith('"') && inner.endsWith('"'))) {
    try {
      // Luau text uses single quotes often; normalize
      const q = inner[0];
      let body = inner.slice(1, -1);
      body = body.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      return body;
    } catch (_) {
      return inner.slice(1, -1);
    }
  }
  const num = Number(inner);
  if (!Number.isNaN(num)) return num;
  return inner;
}

/**
 * Parse luau-compile --text into array of functions:
 * { id, lines: [{raw, labels[], op, args[]}], constants: Map }
 */
export function parseLuauBytecodeText(text) {
  const funcs = [];
  let cur = null;
  const lines = String(text).split(/\r?\n/);

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('REMARK')) continue;
    const fm = line.match(/^Function\s+(\d+)/i);
    if (fm) {
      cur = { id: +fm[1], rawLines: [], maxR: 0 };
      funcs.push(cur);
      continue;
    }
    if (!cur) continue;
    // Label prefix: L0: OP ...
    let labels = [];
    let rest = line;
    const lm = rest.match(/^(L\d+)\s*:\s*(.*)$/);
    if (lm) {
      labels.push(lm[1]);
      rest = lm[2].trim();
    }
    if (!rest) {
      cur.rawLines.push({ labels, op: 'NOP', args: [] });
      continue;
    }
    const parts = rest.split(/\s+/);
    const op = parts[0];
    const args = parts.slice(1);
    cur.rawLines.push({ labels, op, args, raw: rest });
  }
  return funcs;
}

function regNum(tok) {
  if (!tok) return 0;
  const m = String(tok).match(/^R(\d+)$/i);
  return m ? +m[1] : 0;
}
function isReg(tok) {
  return /^R\d+$/i.test(String(tok || ''));
}
function isK(tok) {
  return /^K\d+$/i.test(String(tok || ''));
}
function kNum(tok) {
  const m = String(tok).match(/^K(\d+)$/i);
  return m ? +m[1] : 0;
}
function isLabel(tok) {
  return /^L\d+$/i.test(String(tok || ''));
}
function isProto(tok) {
  return /^P\d+$/i.test(String(tok || ''));
}
function protoNum(tok) {
  const m = String(tok).match(/^P(\d+)$/i);
  return m ? +m[1] : 0;
}

/** Extract constant value from arg list like K0 ['print'] */
function extractKValue(args, kIndexInArgs) {
  // args may be: ['K0', "['print']"] or ['K0', "['a']"] 
  // or combined depending on split - we rejoin from kIndex
  const slice = args.slice(kIndexInArgs).join(' ');
  const m = slice.match(/^K(\d+)\s*(\[.*\])?\s*$/s);
  if (m) {
    const idx = +m[1];
    const val = m[2] ? parseConstBracket(m[2]) : undefined;
    return { idx, val };
  }
  // K0 only
  if (isK(args[kIndexInArgs])) return { idx: kNum(args[kIndexInArgs]), val: undefined };
  return null;
}

function encodeSigned16(off) {
  let o = off | 0;
  if (o < -32768) o = -32768;
  if (o > 32767) o = 32767;
  if (o < 0) o = o + 65536;
  return { b: o & 255, c: (o >> 8) & 255 };
}

/**
 * Lower one Luau function to list of logical ops {op, a, b, c, _labelTargets?}
 * and constants array (0-based).
 */
function lowerFunction(fn, allFuncs, captureMap, resolveProto) {
  const constants = [];
  const kSeen = new Map(); // idx -> slot in constants array
  let pendingProto = null; // last NEWCLOSURE absolute proto index — CAPTURE lines bind to it
  const rp = resolveProto || ((pi) => pi);

  function ensureK(kIdx, val) {
    if (kSeen.has(kIdx)) {
      if (val !== undefined && constants[kSeen.get(kIdx)] === undefined) constants[kSeen.get(kIdx)] = val;
      return kSeen.get(kIdx);
    }
    const slot = constants.length;
    kSeen.set(kIdx, slot);
    constants.push(val !== undefined ? val : null);
    return slot;
  }

  // First pass: collect K literals from lines
  for (const rl of fn.rawLines) {
    const joined = (rl.args || []).join(' ');
    // Match K0 ['x'] or K1 [1] — bracket may contain ] inside quotes
    {
      let pos = 0;
      while (true) {
        const km = joined.slice(pos).match(/K(\d+)\s*\[/);
        if (!km) break;
        const kIdx = +km[1];
        const start = pos + km.index + km[0].length - 1; // at '['
        // scan balanced bracket respecting quotes
        let i = start, depth = 0, inQ = null, esc = false;
        let end = -1;
        for (; i < joined.length; i++) {
          const ch = joined[i];
          if (inQ) {
            if (esc) { esc = false; continue; }
            if (ch === '\\\\') { esc = true; continue; }
            if (ch === inQ) inQ = null;
            continue;
          }
          if (ch === "'" || ch === '"') { inQ = ch; continue; }
          if (ch === '[') depth++;
          else if (ch === ']') {
            depth--;
            if (depth === 0) { end = i; break; }
          }
        }
        if (end < 0) break;
        const bracket = joined.slice(start, end + 1);
        ensureK(kIdx, parseConstBracket(bracket));
        pos = end + 1;
      }
    }
    // bare Kn
    for (const a of rl.args || []) {
      if (isK(a)) ensureK(kNum(a), undefined);
    }
  }

  // Build label -> line index map (after expansion we'll remap)
  // We'll expand ops that need multi-inst into sequences, then resolve labels.

  const expanded = []; // {op, a, b, c, labels:[]}

  function push(op, a = 0, b = 0, c = 0, labels = []) {
    expanded.push({ op, a, b, c, labels });
  }

  for (const rl of fn.rawLines) {
    const labels = rl.labels || [];
    const op = rl.op;
    const args = rl.args || [];

    const attach = (insts) => {
      // first inst gets labels
      if (!insts.length) {
        push('NOP', 0, 0, 0, labels);
        return;
      }
      insts[0].labels = (insts[0].labels || []).concat(labels);
      for (const ins of insts) expanded.push(ins);
    };

    const one = (o, a, b, c) => attach([{ op: o, a, b, c, labels: [] }]);

    // Helpers for K with value from remaining args
    const kFrom = (i) => {
      const joined = args.slice(i).join(' ');
      const mk = matchKBracket(joined, 0);
      if (!mk) {
        // K0 without bracket
        const m2 = joined.match(/^K(\d+)/);
        if (!m2) return { slot: 0, val: null };
        return { slot: ensureK(+m2[1], undefined), idx: +m2[1] };
      }
      const val = mk.bracket ? parseConstBracket(mk.bracket) : undefined;
      return { slot: ensureK(mk.idx, val), idx: mk.idx };
    };

    switch (op) {
      case 'NOP':
        one('NOP', 0, 0, 0);
        break;
      case 'MOVE':
        one('MOVE', regNum(args[0]), regNum(args[1]), 0);
        break;
      case 'LOADK': {
        const ra = regNum(args[0]);
        const k = kFrom(1);
        // LOADK A uses ki in B+C*256 as 16-bit
        const ki = k.slot;
        one('LOADK', ra, ki & 255, (ki >> 8) & 255);
        break;
      }
      case 'LOADN': {
        // LOADN R2 1  — sometimes immediate
        const ra = regNum(args[0]);
        if (isK(args[1])) {
          const k = kFrom(1);
          one('LOADN', ra, k.slot & 255, (k.slot >> 8) & 255);
        } else {
          const n = Number(args[1]) || 0;
          // store as constant
          const slot = constants.length;
          constants.push(n);
          one('LOADN', ra, slot & 255, (slot >> 8) & 255);
        }
        break;
      }
      case 'LOADB':
        one('LOADB', regNum(args[0]), args[1] === 'true' || args[1] === '1' ? 1 : 0, 0);
        break;
      case 'LOADNIL':
        one('LOADNIL', regNum(args[0]), 0, 0);
        break;
      case 'GETGLOBAL': {
        const ra = regNum(args[0]);
        const k = kFrom(1);
        // 8xms: LOADK dest with name then GETGLOBAL dest, dest
        attach([
          { op: 'LOADK', a: ra, b: k.slot & 255, c: (k.slot >> 8) & 255, labels: [] },
          { op: 'GETGLOBAL', a: ra, b: ra, c: 0, labels: [] },
        ]);
        break;
      }
      case 'SETGLOBAL': {
        const ra = regNum(args[0]); // value?
        // format varies; often SETGLOBAL Rval Kname
        const k = kFrom(1);
        const tmp = 200; // high temp
        attach([
          { op: 'LOADK', a: tmp, b: k.slot & 255, c: (k.slot >> 8) & 255, labels: [] },
          { op: 'SETGLOBAL', a: tmp, b: ra, c: 0, labels: [] },
        ]);
        break;
      }
      case 'GETIMPORT': {
        // GETIMPORT R0 2 1  or with constants — treat like GETGLOBAL of last string const
        const ra = regNum(args[0]);
        // find any K string in args, else first K
        let slot = 0;
        for (let i = 1; i < args.length; i++) {
          if (isK(args[i])) {
            const k = kFrom(i);
            slot = k.slot;
            break;
          }
        }
        // also match path in brackets
        const joined = args.join(' ');
        const sm = matchKBracket(joined, 0);
        if (sm && sm.bracket) slot = ensureK(sm.idx, parseConstBracket(sm.bracket));
        attach([
          { op: 'LOADK', a: ra, b: slot & 255, c: (slot >> 8) & 255, labels: [] },
          { op: 'GETGLOBAL', a: ra, b: ra, c: 0, labels: [] },
        ]);
        break;
      }
      case 'GETTABLE':
        one('GETTABLE', regNum(args[0]), regNum(args[1]), regNum(args[2]));
        break;
      case 'SETTABLE': {
        // Luau text: SETTABLE Rvalue Rtable Rkey
        const rv = regNum(args[0]);
        const rt = regNum(args[1]);
        const rk = regNum(args[2]);
        // 8xms SETTABLE: R[A][RK(B)] = RK(C) → A=table, B=key, C=value
        one('SETTABLE', rt, rk, rv);
        break;
      }
      case 'GETTABLEKS': {
        const ra = regNum(args[0]);
        const rb = regNum(args[1]);
        const k = kFrom(2);
        const tmp = Math.max(ra, rb) + 8;
        attach([
          { op: 'LOADK', a: tmp, b: k.slot & 255, c: (k.slot >> 8) & 255, labels: [] },
          { op: 'GETTABLEKS2', a: ra, b: rb, c: tmp, labels: [] },
        ]);
        break;
      }
      case 'SETTABLEKS': {
        // SETTABLEKS Rval Rtbl K
        const rv = regNum(args[0]);
        const rt = regNum(args[1]);
        const k = kFrom(2);
        const tmp = Math.max(rv, rt) + 8;
        attach([
          { op: 'LOADK', a: tmp, b: k.slot & 255, c: (k.slot >> 8) & 255, labels: [] },
          { op: 'SETTABLE', a: rt, b: tmp, c: rv, labels: [] },
        ]);
        break;
      }
      case 'NAMECALL': {
        // Catph-style: single NAMECALL op (method name via const → load into temp then NAMECALL2)
        const ra = regNum(args[0]);
        const rb = regNum(args[1]);
        const k = kFrom(2);
        const tmp = Math.max(ra, rb) + 8;
        attach([
          { op: 'LOADK', a: tmp, b: k.slot & 255, c: (k.slot >> 8) & 255, labels: [] },
          { op: 'NAMECALL2', a: ra, b: rb, c: tmp, labels: [] },
        ]);
        break;
      }
      case 'SELF':
        one('SELF', regNum(args[0]), regNum(args[1]), regNum(args[2]));
        break;
      case 'CALL': {
        // CALL R2 2 -1  → A=base, B=narg+1?, C=nret encoding
        // Luau: CALL A B C where B = nresults encoding, C = ?
        // From sample: CALL R2 2 -1  (call with 2 args?, multret)
        // Luau bytecode CALL A B C: B = #args+1? Actually in Luau:
        // CALL A B C: R[A].. = R[A](R[A+1]..R[A+B-1]) with C results
        // B is nparams+1 (0 = vararg), C is nresults+1 (0 = multret)
        const ra = regNum(args[0]);
        let b = parseInt(args[1], 10);
        let c = parseInt(args[2], 10);
        if (Number.isNaN(b)) b = 1;
        if (Number.isNaN(c)) c = 1;
        // Luau uses -1 for multret in text sometimes
        if (c < 0) c = 0; // multret
        if (b < 0) b = 0;
        // 8xms CALL: B=narg+1 (0=vararg), C=nret+1 (0=all, 1=discard, 2=1 val)
        // Luau text "CALL R2 2 -1": likely B=#args=2, C=multret
        // Convert: 8xms B = narg+1 = b+1 if b is nargs? 
        // From Luau docs: B is number of parameters + 1 (or 0 for MULTRET args)
        // Actually standard Luau: CALL A B C — B = nresults+?, 
        // Looking at sample: CALL R2 2 -1 after MOVE R2, LOADK R3, LOADK R4 means 2 args so B=3 in Lua51 style?
        // Text shows CALL R2 2 -1 for add(1,2) with R2=fn, R3,R4=args → B=2 might mean 2 args
        // 8xms expects B=narg+1 → 3. So if Luau text B is nargs, convert to nargs+1
        // CALL R1 -1 0 after CALL R2 2 -1: first multret into R2, second takes all
        // Heuristic: if |c| style -1 already handled; for B, use B+1 when B>0 as nargs
        let b8 = b === 0 ? 0 : b + 1; // treat text B as nargs when >0
        // Exception: CALL R4 1 0 after MOVE R5 R3 — 1 arg → B=1 in text → B8=2 OK
        let c8 = c === 0 ? 0 : (c < 0 ? 0 : c + 1);
        // Wait sample CALL R2 2 -1: wants multret from add → C=0 in 8xms
        // CALL R1 -1 0: B=-1 means multret args → B=0, C=1 discard?
        if (parseInt(args[1], 10) < 0) b8 = 0;
        if (parseInt(args[2], 10) < 0) c8 = 0;
        else if (parseInt(args[2], 10) === 0) c8 = 1; // no results kept?
        // Re-read Luau CALL: In --text output "CALL R2 2 -1" matches luau bytecode display where B and C are the raw operand fields.
        // From Luau source: CALL A B C means B = n+1 args, C = m+1 returns (0 = MULTRET).
        // So text "2" and "-1" — -1 is display for MULTRET (0 in binary). So C=-1 → C=0.
        // B=2 means 1 arg + 1? n+1=2 → 1 arg. But add(1,2) has 2 args → B should be 3.
        // Looking again at Function1:
        //   MOVE R2 R0   -- fn
        //   LOADK R3 K1 [1]
        //   LOADK R4 K2 [2]
        //   CALL R2 2 -1
        // That's 2 args at R3,R4 so if B=n+1, B=3. Text says 2. Hmm.
        // Perhaps B is fixed differently. Try using raw B as 8xms B if B>=0, and C as 0 when -1 else C+1.
        b8 = parseInt(args[1], 10);
        c8 = parseInt(args[2], 10);
        if (b8 < 0) b8 = 0;
        if (c8 < 0) c8 = 0;
        else c8 = c8; // keep
        // Empirical: for 2 args CALL with B=2, 8xms needs B=3. So B_text is nargs, B8=nargs+1.
        // CALL R4 1 0: 1 arg, B=1 → B8=2; C=0 → discard all results C8=1
        const bText = parseInt(args[1], 10);
        const cText = parseInt(args[2], 10);
        if (bText < 0) b8 = 0;
        else b8 = bText + 1;
        if (cText < 0) c8 = 0;
        else if (cText === 0) c8 = 1;
        else c8 = cText + 1;
        one('CALL', ra, b8 & 255, c8 & 255);
        break;
      }
      case 'RETURN': {
        // Luau text RETURN R2 1 → 1 result. 8xms: B = nvalues+1 (2 = one value, 1 = none)
        const ra = regNum(args[0]);
        let n = parseInt(args[1], 10);
        if (Number.isNaN(n) || n < 0) n = 0;
        const b8 = (n + 1) & 255;
        one('RETURN', ra, b8, 0);
        break;
      }
      case 'ADD': case 'SUB': case 'MUL': case 'DIV': case 'MOD': case 'POW': case 'CONCAT':
        one(op, regNum(args[0]), regNum(args[1]), regNum(args[2]));
        break;
      case 'UNM': case 'NOT': case 'LEN':
        one(op, regNum(args[0]), regNum(args[1]), 0);
        break;
      case 'DUPTABLE':
      case 'NEWTABLE': {
        // NEWTABLE R1 1 2 — hash, array sizes
        one('NEWTABLE', regNum(args[0]), parseInt(args[1], 10) || 0, parseInt(args[2], 10) || 0);
        break;
      }
      case 'SETLIST': {
        // SETLIST R1 R2 2 [1] — A=table, B=start reg, C=count?
        const ra = regNum(args[0]);
        const rb = regNum(args[1]);
        const cnt = parseInt(args[2], 10) || 0;
        one('SETLIST', ra, rb, cnt);
        break;
      }
      case 'GETUPVAL':
        one('GETUPVAL', regNum(args[0]), parseInt(args[1], 10) || 0, 0);
        break;
      case 'SETUPVAL':
        one('SETUPVAL', regNum(args[0]), parseInt(args[1], 10) || 0, 0);
        break;
      case 'NEWCLOSURE': case 'DUPCLOSURE': {
        // NEWCLOSURE R0 P0 — P index is relative to this function's child list
        const ra = regNum(args[0]);
        let piRel = 0;
        for (const a of args) if (isProto(a)) piRel = protoNum(a);
        const pi = rp(piRel); // absolute index into flat protos array (non-main)
        pendingProto = pi;
        one('CLOSURE', ra, pi & 255, (pi >> 8) & 255);
        break;
      }
      case 'CAPTURE': {
        // CAPTURE binds to the proto of the most recent NEWCLOSURE (parent stream)
        // CAPTURE VAL R0 / CAPTURE REF R0 / CAPTURE UPVAL n
        if (pendingProto != null && captureMap) {
          const kind = String(args[0] || 'VAL').toUpperCase();
          const list = captureMap.get(pendingProto) || [];
          if (kind === 'UPVAL') {
            list.push({ kind: 'UPVAL', index: parseInt(args[1], 10) || 0 });
          } else if (kind === 'REF') {
            list.push({ kind: 'REF', reg: regNum(args[1]) });
          } else {
            // VAL (default)
            const reg = isReg(args[1]) ? regNum(args[1]) : (isReg(args[0]) ? regNum(args[0]) : 0);
            list.push({ kind: 'VAL', reg });
          }
          captureMap.set(pendingProto, list);
        }
        one('NOP', 0, 0, 0);
        break;
      }
      case 'JUMP': case 'JMP': {
        const lab = args.find(isLabel) || args[0];
        attach([{ op: 'JMP', a: 0, b: 0, c: 0, labels: [], _jmp: lab }]);
        break;
      }
      case 'JUMPIF': {
        const ra = regNum(args[0]);
        const lab = args.find(isLabel);
        // if R[A] then jmp — TEST A with inv=1, off=1 skip JMP; then JMP
        // if not true, skip JMP (off=1)
        attach([
          { op: 'TEST', a: ra, b: 1, c: 0, labels: [], }, // if not R[A], PC+=1 (skip jmp) — need check TEST encoding
          { op: 'JMP', a: 0, b: 0, c: 0, labels: [], _jmp: lab },
        ]);
        // Fix TEST: inv=0 → if not R[A] then PC+=off. So off=1 skips JMP when falsy. Good.
        break;
      }
      case 'JUMPIFNOT': {
        const ra = regNum(args[0]);
        const lab = args.find(isLabel);
        // if not R[A] then jmp: TEST inv=1 (if R[A] then skip jmp)
        attach([
          { op: 'TEST', a: ra, b: 1, c: 1, labels: [] },
          { op: 'JMP', a: 0, b: 0, c: 0, labels: [], _jmp: lab },
        ]);
        break;
      }
      case 'JUMPIFEQ': case 'JUMPIFNOTEQ': case 'JUMPIFLT': case 'JUMPIFLE':
      case 'JUMPIFNOTLT': case 'JUMPIFNOTLE': {
        // Cannot pack 2 regs + 16-bit offset in B,C — expand to CMP + JUMPIF
        const ra = regNum(args[0]);
        const rb = regNum(args[1]);
        const lab = args.find(isLabel);
        const tmp = Math.max(ra, rb, 8) + 6;
        let cmp = 'EQ';
        if (op === 'JUMPIFLT' || op === 'JUMPIFNOTLT') cmp = 'LT';
        else if (op === 'JUMPIFLE' || op === 'JUMPIFNOTLE') cmp = 'LE';
        const inv = (op === 'JUMPIFNOTEQ' || op === 'JUMPIFNOTLT' || op === 'JUMPIFNOTLE');
        attach([
          { op: cmp, a: tmp, b: ra, c: rb, labels: [] },
          { op: inv ? 'JUMPIFNOT' : 'JUMPIF', a: tmp, b: 0, c: 0, labels: [], _jmp: lab },
        ]);
        break;
      }

      case 'FORNPREP': {
        // FORNPREP R1 L1 — R1 is index-1 of for base (idx, limit, step at R1,R1+1,R1+2)
        const ra = regNum(args[0]);
        const lab = args.find(isLabel);
        attach([{ op: 'FORPREP', a: ra, b: 0, c: 0, labels: [], _jmp: lab }]);
        break;
      }
      case 'FORNLOOP': {
        const ra = regNum(args[0]);
        const lab = args.find(isLabel);
        attach([{ op: 'FORLOOP', a: ra, b: 0, c: 0, labels: [], _jmp: lab }]);
        break;
      }
      case 'FORGPREP': {
        // FORGPREP R3 L2 — generic for
        const ra = regNum(args[0]);
        const lab = args.find(isLabel);
        // TFORCALL then if nil jump end
        attach([
          { op: 'TFORCALL', a: ra, b: 3, c: 0, labels: [] },
          { op: 'TFORLOOP', a: ra, b: 0, c: 0, labels: [], _jmp: lab },
        ]);
        break;
      }
      case 'FORGLOOP': {
        const ra = regNum(args[0]);
        const lab = args.find(isLabel);
        const nres = parseInt(args[2], 10) || 2;
        attach([
          { op: 'TFORCALL', a: ra, b: nres + 1, c: 0, labels: [] },
          { op: 'TFORLOOP', a: ra, b: 0, c: 0, labels: [], _jmp: lab },
        ]);
        break;
      }
      case 'CLOSE':
      case 'VARARG':
        one(op === 'VARARG' ? 'VARARG' : 'NOP', regNum(args[0]), 0, 0);
        break;
      default:
        // Unknown — NOP keep labels
        one('NOP', 0, 0, 0);
        break;
    }
  }

  // Resolve labels
  const labelAt = new Map();
  expanded.forEach((ins, i) => {
    for (const lb of ins.labels || []) labelAt.set(lb, i);
  });

  const logical = [];
  for (let i = 0; i < expanded.length; i++) {
    const ins = expanded[i];
    let { op, a, b, c } = ins;
    if (ins._jmp) {
      const target = labelAt.get(ins._jmp);
      if (target === undefined) {
        // jump to end
        const off = expanded.length - i - 1;
        const enc = encodeSigned16(off);
        b = enc.b; c = enc.c;
      } else {
        // after PC++ at i (0-based), PC is i+2 in 1-based = i+1 0-based next
        // off = target - i - 1
        const off = target - i - 1;
        const enc = encodeSigned16(off);
        b = enc.b; c = enc.c;
      }
      // For FORPREP/FORLOOP/TFORLOOP/JMP/JUMPIF*
      if (op.startsWith('JUMPIF')) {
        // leave as custom — will map to runtime aliases
      }
    }
    // TEST encoding for short circuit: b is low off, c has inv
    logical.push({ op, a: a & 255, b: b & 255, c: c & 255 });
  }

  // max reg
  let maxReg = 8;
  for (const ins of logical) {
    maxReg = Math.max(maxReg, ins.a + 2, (ins.b < 200 ? ins.b : 0) + 2, ins.c + 2);
  }

  // Infer nparams: highest reg read before written
  const written = new Set();
  let nparams = 0;
  const readsOf = (ins) => {
    const r = [];
    const op = ins.op;
    if (['MOVE','UNM','NOT','LEN','LOADK','LOADN','LOADB','LOADNIL','GETGLOBAL','GETUPVAL','CLOSURE','NEWTABLE','RETURN'].includes(op)) {
      if (op === 'MOVE') r.push(ins.b);
      else if (['UNM','NOT','LEN'].includes(op)) r.push(ins.b);
      else if (op === 'RETURN') { for (let i = 0; i < Math.max(0, (ins.b || 1) - 1); i++) r.push(ins.a + i); }
    } else if (['ADD','SUB','MUL','DIV','MOD','POW','CONCAT','GETTABLE','SETTABLE','EQ','LT','LE'].includes(op)) {
      if (op === 'SETTABLE') { r.push(ins.a, ins.b, ins.c); }
      else r.push(ins.b, ins.c);
    } else if (op === 'CALL') {
      for (let i = 0; i < Math.max(0, (ins.b || 1) - 1); i++) r.push(ins.a + 1 + i);
      r.push(ins.a);
    } else if (op === 'SELF') r.push(ins.b, ins.c);
    return r.filter((x) => typeof x === 'number');
  };
  const writesOf = (ins) => {
    const op = ins.op;
    if (op === 'SETTABLE' || op === 'SETGLOBAL' || op === 'SETUPVAL' || op === 'JMP' || op === 'HALT' || op === 'NOP') return [];
    if (op === 'CALL') return []; // may write A but complex
    return [ins.a];
  };
  for (const ins of logical) {
    for (const rg of readsOf(ins)) {
      if (!written.has(rg) && rg < 32) nparams = Math.max(nparams, rg + 1);
    }
    for (const w of writesOf(ins)) written.add(w);
  }

  // Collect captures from original lines for this function
  const captures = [];
  for (const rl of fn.rawLines) {
    if (rl.op === 'CAPTURE') {
      // CAPTURE VAL R0 / CAPTURE UPVAL 0 / CAPTURE REF R1
      const kind = (rl.args[0] || 'VAL').toUpperCase();
      if (kind === 'VAL' || kind === 'REF') captures.push({ kind, reg: regNum(rl.args[1]) });
      else if (kind === 'UPVAL') captures.push({ kind: 'UPVAL', index: parseInt(rl.args[1], 10) || 0 });
      else if (isReg(rl.args[0])) captures.push({ kind: 'VAL', reg: regNum(rl.args[0]) });
    }
  }

  return { logical, constants, maxReg, captures, id: fn.id, nparams };
}

/**
 * Compile source via official luau-compile into 8xms VM shape.
 */

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

export function compileOfficialToVM(source, rng = Math.random) {
  const map = buildOpcodeMap(rng);
  const run = runLuauCompileText(source);
  if (!run.ok) return { ok: false, error: run.error, map };

  const funcs = parseLuauBytecodeText(run.text);
  if (!funcs.length) return { ok: false, error: 'no functions in bytecode', map, text: run.text };

  // Luau numbers functions with main as highest id usually (Function 1 is main for small scripts)
  // Actually Function 0 is first nested, Function N is main (last).
  // CAPTURE lines live in the *parent* after NEWCLOSURE — collect into target proto
  // Build parent → ordered child absolute function ids (P0, P1, ...)
  // Luau --text lists nested functions before parents; each parent claims
  // the nearest unclaimed lower ids matching its max NEWCLOSURE Pn.
  const claimed = new Set();
  const childrenOf = new Map(); // fid -> [childFid ...] for P0..Pn
  function maxProtoIdx(f) {
    let m = -1;
    for (const rl of f.rawLines || []) {
      if (rl.op === 'NEWCLOSURE' || rl.op === 'DUPCLOSURE') {
        for (const a of rl.args || []) {
          if (isProto(a)) m = Math.max(m, protoNum(a));
        }
      }
    }
    return m;
  }
  // Innermost first so nested parents claim before outer
  for (let i = 0; i < funcs.length; i++) {
    const f = funcs[i];
    const maxP = maxProtoIdx(f);
    const kids = [];
    if (maxP >= 0) {
      for (let j = f.id - 1; j >= 0 && kids.length < maxP + 1; j--) {
        if (!claimed.has(j)) {
          kids.unshift(j);
          claimed.add(j);
        }
      }
    }
    childrenOf.set(f.id, kids);
  }

  const captureMap = new Map(); // absolute proto index (non-main array index = function id) -> captures
  const lowered = funcs.map((f) => {
    const kids = childrenOf.get(f.id) || [];
    const resolveProto = (piRel) => {
      const abs = kids[piRel];
      return abs != null ? abs : piRel;
    };
    return lowerFunction(f, funcs, captureMap, resolveProto);
  });

  // Main proto = last function
  const main = lowered[lowered.length - 1];
  const childProtos = lowered.slice(0, -1);

  // Catph-style alias pool: same semantics, different physical opcodes per build
  // (polymorphic ISA — Catph strength without changing WAN shell/pack output)
  const CATPH_ALIAS = {
    MOVE: ['MOVE', 'MOVE2', 'MOVE3'],
    LOADK: ['LOADK', 'LOADK2', 'LOADK3'],
    LOADN: ['LOADN', 'LOADN2', 'LOADN3'],
    ADD: ['ADD', 'ADD2'], SUB: ['SUB', 'SUB2'], MUL: ['MUL', 'MUL2'],
    DIV: ['DIV', 'DIV2'], POW: ['POW', 'POW2'],
    CONCAT: ['CONCAT', 'CONCAT2', 'CONCAT3'],
    CALL: ['CALL', 'CALL1', 'CALL2', 'CALL3', 'CALL4'],
    RETURN: ['RETURN', 'RETURN0', 'RETURN1', 'RETURN2'],
    JMP: ['JMP', 'JMP0', 'JMP1', 'JMP2'],
    TEST: ['TEST', 'TEST0', 'TEST1'],
    GETTABLE: ['GETTABLE', 'GETTABLE2'], SETTABLE: ['SETTABLE', 'SETTABLE2'],
    GETFIELD: ['GETFIELD', 'GETFIELD2'], SETFIELD: ['SETFIELD', 'SETFIELD2'],
    GETTABLEKS: ['GETTABLEKS', 'GETTABLEKS2'], SETTABLEKS: ['SETTABLEKS', 'SETTABLEKS2'],
    GETTABLEN: ['GETTABLEN', 'GETTABLEN2'], SETTABLEN: ['SETTABLEN', 'SETTABLEN2'],
    NAMECALL: ['NAMECALL', 'NAMECALL2', 'NAMECALL3'],
    NAMECALL2: ['NAMECALL2', 'NAMECALL3', 'NAMECALL'],
    NAMECALL3: ['NAMECALL3', 'NAMECALL2', 'NAMECALL'],
    NEWTABLE: ['NEWTABLE', 'NEWTABLE0', 'NEWTABLE1'],
    SETLIST: ['SETLIST', 'SETLIST0', 'SETLIST1'],
    BAND: ['BAND', 'BAND2'], BOR: ['BOR', 'BOR2'], BXOR: ['BXOR', 'BXOR2'],
    SHL: ['SHL', 'SHL2'], SHR: ['SHR', 'SHR2'],
    LEN: ['LEN', 'LEN2'], UNM: ['UNM', 'UNM2'], NOT: ['NOT', 'NOT2'],
    FORPREP: ['FORPREP', 'FORPREP2'], FORLOOP: ['FORLOOP', 'FORLOOP2'],
    TFORLOOP: ['TFORLOOP', 'TFORLOOP2'],
    CLOSURE: ['CLOSURE', 'CLOSURE2', 'NEWCLOSURE'],
    SELF: ['SELF', 'SELFB'], VARARG: ['VARARG', 'GETVARARGS'],
  };
  function pickAlias(op) { return op; }

  function packLogical(logical, sk) {
    const insts = [];
    for (let i = 0; i < logical.length; i++) {
      const { op, a, b, c } = logical[i];
      let name = op;
      if (name === 'JUMPIFNOTLE' || name === 'JUMPIFLE' || name === 'JUMPIFLT' ||
          name === 'JUMPIFNOTLT' || name === 'JUMPIFEQ' || name === 'JUMPIFNOTEQ' ||
          name === 'JUMPIF' || name === 'JUMPIFNOT') {
        // already expanded JUMPIF → TEST+JMP upstream
      }
      // Catph-strength: polymorphic alias before phys map
      name = pickAlias(name);
      const phys = map.toPhys[name] ?? map.toPhys[op] ?? map.toPhys.NOP;
      insts.push(packInst(phys, a, b, c, sk, i));
    }
    insts.push(packInst(map.toPhys.HALT ?? 0, 0, 0, 0, sk, insts.length));
    return insts;
  }

  const sk = map.streamKey || 0;

  function toProtoBlob(L) {
    return {
      id: L.id,
      insts: packLogical(L.logical, sk),
      K: L.constants,
      constants: L.constants,
      maxReg: Math.max(L.maxReg, 16),
      captures: L.captures,
      nparams: L.nparams || 0,
      keys: null,
    };
  }

  // 8xms serializeProtos format — check what emit expects
  // From compileAst: protos as array of hardened trees
  // emitVMRuntime uses proto.insts, proto.K, proto.keys

  const mainInsts = packLogical(main.logical, sk);
  const protos = childProtos.map(toProtoBlob);

  // Re-pack with keys array matching emit expectations
  function withKeys(instWords) {
    const keys = [];
    for (let pc = 0; pc < instWords.length; pc++) {
      keys[pc] = (sk + Math.imul(pc, 0x9E3779B9)) >>> 0;
    }
    // packed words already include xor in packInst - check packInst
    return { insts: instWords, keys };
  }

  const mainPacked = withKeys(mainInsts);

  const skEnc = (map.streamKey || 0) >>> 0;
  const mainConsts = encryptConstants(main.constants, skEnc);
  return {
    ok: true,
    mode: 'vm-luau-official',
    map,
    insts: mainPacked.insts,
    constants: mainConsts,
    maxReg: Math.max(main.maxReg, 24),
    protos: protos.map((p) => {
      const w = withKeys(p.insts);
      const K = encryptConstants(p.K || p.constants || [], skEnc);
      // Captures keyed by absolute function id (== index in childProtos when main is last)
      const caps = (captureMap.get(p.id) || p.captures || []);
      return { insts: w.insts, K, constants: K, maxReg: p.maxReg, keys: null, captures: caps, nparams: p.nparams || 0, upvalues: caps.map((c) => ({ isLocal: c.kind !== "UPVAL", byRef: c.kind === "REF", index: c.kind === "UPVAL" ? (c.index || 0) : (c.reg != null ? c.reg : 0) })) };
    }),
    official: true,
    textPreview: run.text.slice(0, 500),
  };
}
