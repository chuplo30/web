/**
 * Recursive-descent Luau parser → AST.
 *
 * Supports full Luau/Lua 5.1 syntax:
 *   - locals, assignments, compound assignments (+=, -=, etc.)
 *   - functions (local/global/method), nested closures
 *   - if/elseif/else, while, repeat-until, for-num, for-in
 *   - break, continue, return (multi-value), goto/label
 *   - tables (array, named, mixed), table constructors with [expr]
 *   - method calls (a:b()), function calls (a()), chained (a.b.c:d())
 *   - binary ops with precedence, unary ops, vararg
 *   - type annotations (silently consumed via skipType)
 *   - Luau if-expression (cond and a or b handled by binary; if-expr parsed too)
 *   - Luau string interp on method/call (a"str", a{table})
 *
 * AST node types:
 *   Chunk{body}
 *   Local{names, values}, LocalFunction{name, params, body}
 *   FunctionStmt{name (dotted), method, params, body}
 *   Assign{vars, values, op}, CallStmt{expr}
 *   If{arms:[{cond,body}], elseBody}, While{cond, body}, Repeat{body, cond}
 *   ForNum{name, a, b, step, body}, ForIn{names, iter, body}
 *   Do{body}, Return{values}, Break, Continue, Goto{label}, Label{name}
 *   Number{value}, String{value}, Nil, Bool{value}, Vararg
 *   Name{name}, Index{obj, key, dot}, Call{callee, args}, MethodCall{obj, method, args}
 *   Bin{op, left, right}, Un{op, arg}, FunctionExpr{params, body}, Table{fields:[{key,value}]}
 *   IfExpr{cond, then, else} (Luau)
 */
import { lex } from './luau-lex.js';

export function parse(src) {
  const tokens = lex(src);
  let p = 0;
  const peek = (n = 0) => tokens[p + n] || { type: 'eof' };
  const at = (t, v) => {
    const x = peek();
    return x.type === t && (v === undefined || x.value === v);
  };
  const eat = (t, v) => {
    const x = peek();
    if (x.type !== t || (v !== undefined && x.value !== v)) {
      throw new Error('parse:' + x.line + ': expected ' + t + ' ' + (v || '') + ' got ' + x.type + ' ' + x.value);
    }
    p++;
    return x;
  };
  const match = (t, v) => { if (at(t, v)) { p++; return true; } return false; };

  // Skip a Luau type annotation: ": Type"
  function skipType() {
    if (!match('op', ':')) return;
    let depth = 0;
    for (let n = 0; n < 200; n++) {
      const x = peek();
      if (x.type === 'eof') break;
      if (at('op', '{') || at('op', '(') || at('op', '[')) { depth++; p++; continue; }
      if (at('op', '}') || at('op', ')') || at('op', ']')) { if (depth) { depth--; p++; continue; } break; }
      if (depth === 0) {
        // type expression ends at these:
        if (at('op', '=') || at('op', ',') || at('op', ')') || at('op', '}') ||
            at('kw', 'do') || at('kw', 'then') || at('kw', 'end') || at('kw', 'return') ||
            at('op', ';') || at('kw', 'in')) break;
        // also ends when a statement keyword follows
        if (x.type === 'kw' && ['and', 'or', 'not'].indexOf(x.value) === -1) break;
      }
      p++;
    }
  }

  // Skip Luau `:: Type` cast
  function skipCast() {
    while (at('op', '::')) {
      p++;
      // consume type expr (single type token or parenthesized)
      if (at('op', '(')) {
        let depth = 0;
        for (let n = 0; n < 100; n++) {
          if (at('op', '(')) { depth++; p++; continue; }
          if (at('op', ')')) { depth--; p++; if (depth === 0) break; continue; }
          if (at('eof')) break;
          p++;
        }
      } else {
        // identifier with optional . and generics
        p++;
        while (at('op', '.') || at('op', '<') || at('op', ',')) { p++; if (at('ident')) p++; }
      }
    }
  }

  function parseBlock() {
    const body = [];
    while (!at('eof') && !at('kw', 'end') && !at('kw', 'else') && !at('kw', 'elseif') && !at('kw', 'until')) {
      if (at('kw', 'return')) { body.push(parseReturn()); break; }
      try {
        body.push(parseStmt());
      } catch (e) {
        // Tolerant mode: on parse error, skip to next statement boundary
        // (semicolon, newline-equivalent keyword, or end of block).
        // This lets us recover from broken/incomplete scripts.
        let skipped = 0;
        while (!at('eof') && !at('kw', 'end') && !at('kw', 'else') && !at('kw', 'elseif') && !at('kw', 'until') &&
               !at('op', ';') && !at('kw', 'local') && !at('kw', 'function') && !at('kw', 'if') &&
               !at('kw', 'for') && !at('kw', 'while') && !at('kw', 'do') && !at('kw', 'repeat') &&
               !at('kw', 'break') && !at('kw', 'continue') && !at('kw', 'return')) {
          p++;
          if (++skipped > 200) break;
        }
        // Consume the semicolon if present
        match('op', ';');
      }
    }
    return { type: 'Block', body };
  }

  function parseReturn() {
    eat('kw', 'return');
    let values = [];
    if (!at('eof') && !at('kw', 'end') && !at('kw', 'else') && !at('kw', 'elseif') && !at('kw', 'until') && !at('op', ';')) {
      values = parseExprList();
    }
    match('op', ';');
    return { type: 'Return', values };
  }

  function parseStmt() {
    // Luau `export type Name = ...` and `type Name = ...` declarations — skip entirely.
    // Note: `type` and `export` are lexed as identifiers (not keywords) so that
    // `type(v)` (global function) still works in expression context. Here we
    // check for them at statement start.
    if (at('ident', 'export') && peek(1).type === 'ident' && peek(1).value === 'type') {
      p++; p++; // consume `export type`
      if (at('ident')) p++; // consume name
      while (!at('eof') && !at('op', ';') && !at('kw', 'end') && !at('kw', 'else') && !at('kw', 'elseif')) p++;
      match('op', ';');
      return { type: 'Do', body: { type: 'Block', body: [] } };
    }
    if (at('ident', 'type') && peek(1).type === 'ident') {
      // `type Name = ...` Luau type alias — skip to end of statement
      p++; p++; // consume `type Name`
      let depth = 0;
      for (let n = 0; n < 200; n++) {
        const x = peek();
        if (x.type === 'eof') break;
        if (at('op', '{') || at('op', '(') || at('op', '[')) { depth++; p++; continue; }
        if (at('op', '}') || at('op', ')') || at('op', ']')) { if (depth) { depth--; p++; continue; } break; }
        if (depth === 0 && (at('op', ';') || at('kw', 'end') || at('kw', 'else') || at('kw', 'elseif') || at('kw', 'return') || at('kw', 'local') || at('kw', 'function') || at('kw', 'if') || at('kw', 'for') || at('kw', 'while') || at('kw', 'do') || at('kw', 'repeat') || at('kw', 'break') || at('kw', 'continue'))) break;
        p++;
      }
      match('op', ';');
      return { type: 'Do', body: { type: 'Block', body: [] } };
    }
    // local
    if (match('kw', 'local')) {
      // local function name(params) ... end
      if (match('kw', 'function')) {
        const name = eat('ident').value;
        skipType();
        const fn = { type: 'LocalFunction', name, ...parseFuncBody() };
        match('op', ';');
        return fn;
      }
      // local type Name = ... (Luau) — skip
      if (at('ident', 'type')) {
        p++; // consume `type`
        if (at('ident')) p++; // consume name
        let depth = 0;
        for (let n = 0; n < 200; n++) {
          const x = peek();
          if (x.type === 'eof') break;
          if (at('op', '{') || at('op', '(') || at('op', '[')) { depth++; p++; continue; }
          if (at('op', '}') || at('op', ')') || at('op', ']')) { if (depth) { depth--; p++; continue; } break; }
          if (depth === 0 && (at('op', ';') || at('kw', 'end') || at('kw', 'else') || at('kw', 'elseif'))) break;
          p++;
        }
        match('op', ';');
        return { type: 'Do', body: { type: 'Block', body: [] } };
      }
      const names = [];
      names.push(eat('ident').value);
      skipType();
      while (match('op', ',')) { names.push(eat('ident').value); skipType(); }
      let values = [];
      if (match('op', '=')) values = parseExprList();
      match('op', ';');
      return { type: 'Local', names, values };
    }
    // function name.b.c:d(params) ... end
    if (match('kw', 'function')) {
      let name = eat('ident').value;
      let method = null;
      while (match('op', '.')) name += '.' + eat('ident').value;
      if (match('op', ':')) method = eat('ident').value;
      const fn = { type: 'FunctionStmt', name, method, ...parseFuncBody() };
      match('op', ';');
      return fn;
    }
    if (match('kw', 'if')) return parseIfRest();
    if (match('kw', 'while')) {
      const cond = parseExpr();
      eat('kw', 'do');
      const body = parseBlock();
      eat('kw', 'end');
      match('op', ';');
      return { type: 'While', cond, body };
    }
    if (match('kw', 'repeat')) {
      const body = parseBlock();
      eat('kw', 'until');
      const cond = parseExpr();
      match('op', ';');
      return { type: 'Repeat', body, cond };
    }
    if (match('kw', 'for')) return parseForRest();
    if (match('kw', 'do')) {
      const body = parseBlock();
      eat('kw', 'end');
      match('op', ';');
      return { type: 'Do', body };
    }
    if (match('kw', 'break')) { match('op', ';'); return { type: 'Break' }; }
    if (match('kw', 'continue')) { match('op', ';'); return { type: 'Continue' }; }
    if (match('kw', 'goto')) { const label = eat('ident').value; match('op', ';'); return { type: 'Goto', label }; }
    if (at('op', '::')) {
      p++; p++;
      const name = eat('ident').value;
      p++; p++;
      return { type: 'Label', name };
    }
    // assignment or call statement
    const expr = parseSuffixExp();
    return finishStmt(expr);
  }

  function parseIfRest() {
    const arms = [];
    let cond = parseExpr();
    eat('kw', 'then');
    arms.push({ cond, body: parseBlock() });
    while (match('kw', 'elseif')) {
      const c = parseExpr();
      eat('kw', 'then');
      arms.push({ cond: c, body: parseBlock() });
    }
    let elseBody = null;
    if (match('kw', 'else')) elseBody = parseBlock();
    eat('kw', 'end');
    match('op', ';');
    return { type: 'If', arms, elseBody };
  }

  function parseForRest() {
    const v1 = eat('ident').value;
    if (match('op', '=')) {
      const a = parseExpr();
      eat('op', ',');
      const b = parseExpr();
      let step = null;
      if (match('op', ',')) step = parseExpr();
      eat('kw', 'do');
      const body = parseBlock();
      eat('kw', 'end');
      match('op', ';');
      return { type: 'ForNum', name: v1, a, b, step, body };
    }
    const names = [v1];
    while (match('op', ',')) names.push(eat('ident').value);
    eat('kw', 'in');
    const iter = parseExprList();
    eat('kw', 'do');
    const body = parseBlock();
    eat('kw', 'end');
    match('op', ';');
    return { type: 'ForIn', names, iter, body };
  }

  function finishStmt(first) {
    // multi-assignment
    if (at('op', ',')) {
      const vars = [first];
      while (match('op', ',')) vars.push(parseSuffixExp());
      eat('op', '=');
      const values = parseExprList();
      match('op', ';');
      return { type: 'Assign', vars, values, op: '=' };
    }
    // simple assignment
    if (at('op', '=')) {
      p++;
      const values = parseExprList();
      match('op', ';');
      return { type: 'Assign', vars: [first], values, op: '=' };
    }
    // compound assignments
    for (const op of ['+=', '-=', '*=', '/=', '%=', '^=', '..', '//=']) {
      if (at('op', op)) {
        p++;
        const right = parseExpr();
        match('op', ';');
        return { type: 'Assign', vars: [first], values: [right], op };
      }
    }
    match('op', ';');
    return { type: 'CallStmt', expr: first };
  }

  function parseFuncBody() {
    eat('op', '(');
    const params = [];
    if (!at('op', ')')) {
      if (match('op', '...')) params.push('...');
      else {
        params.push(eat('ident').value);
        skipType();
        while (match('op', ',')) {
          if (match('op', '...')) { params.push('...'); break; }
          params.push(eat('ident').value);
          skipType();
        }
      }
    }
    eat('op', ')');
    skipType(); // return type
    const body = parseBlock();
    eat('kw', 'end');
    return { params, body };
  }

  function parseExprList() {
    const list = [parseExpr()];
    while (match('op', ',')) list.push(parseExpr());
    return list;
  }

  // Expression precedence (Lua-style):
  //   or
  //   and
  //   < > <= >= == ~=
  //   ..
  //   + -
  //   * / % //
  //   unary (not, -, #)
  //   ^
  function parseExpr() { return parseOr(); }
  function parseOr() {
    let l = parseAnd();
    while (match('kw', 'or')) {
      const r = parseAnd();
      l = { type: 'Bin', op: 'or', left: l, right: r };
    }
    return l;
  }
  function parseAnd() {
    let l = parseCmp();
    while (match('kw', 'and')) {
      const r = parseCmp();
      l = { type: 'Bin', op: 'and', left: l, right: r };
    }
    return l;
  }
  function parseCmp() {
    let l = parseConcat();
    while (at('op', '==') || at('op', '~=') || at('op', '<') || at('op', '>') || at('op', '<=') || at('op', '>=')) {
      const op = eat('op').value;
      const r = parseConcat();
      l = { type: 'Bin', op, left: l, right: r };
    }
    return l;
  }
  function parseConcat() {
    let l = parseAdd();
    while (at('op', '..')) {
      p++;
      const r = parseAdd();
      l = { type: 'Bin', op: '..', left: l, right: r };
    }
    return l;
  }
  function parseAdd() {
    let l = parseMul();
    while (at('op', '+') || at('op', '-') || at('op', '//')) {
      const op = eat('op').value;
      const r = parseMul();
      l = { type: 'Bin', op, left: l, right: r };
    }
    return l;
  }
  function parseMul() {
    let l = parseUnary();
    while (at('op', '*') || at('op', '/') || at('op', '%')) {
      const op = eat('op').value;
      const r = parseUnary();
      l = { type: 'Bin', op, left: l, right: r };
    }
    return l;
  }
  function parseUnary() {
    if (match('kw', 'not')) return { type: 'Un', op: 'not', arg: parseUnary() };
    if (match('op', '-')) return { type: 'Un', op: '-', arg: parseUnary() };
    if (match('op', '#')) return { type: 'Un', op: '#', arg: parseUnary() };
    const e = parsePow();
    skipCast();
    return e;
  }
  function parsePow() {
    const base = parseSuffixExp();
    if (match('op', '^')) {
      const r = parseUnary(); // ^ is right-assoc
      return { type: 'Bin', op: '^', left: base, right: r };
    }
    return base;
  }

  function parseSuffixExp() {
    let e = parsePrimary();
    for (;;) {
      if (match('op', '.')) {
        const n = eat('ident').value;
        e = { type: 'Index', obj: e, key: { type: 'String', value: n }, dot: true };
      } else if (match('op', '[')) {
        const k = parseExpr();
        eat('op', ']');
        e = { type: 'Index', obj: e, key: k, dot: false };
      } else if (match('op', ':')) {
        const m = eat('ident').value;
        const args = parseArgs();
        e = { type: 'MethodCall', obj: e, method: m, args };
      } else if (at('op', '(') || at('string') || at('op', '{')) {
        const args = parseArgs();
        e = { type: 'Call', callee: e, args };
      } else break;
    }
    return e;
  }

  function parseArgs() {
    if (match('op', '(')) {
      const args = [];
      if (!at('op', ')')) args.push(...parseExprList());
      eat('op', ')');
      return args;
    }
    if (at('string')) return [{ type: 'String', value: eat('string').value }];
    if (at('op', '{')) return [parseTable()];
    return [];
  }

  function parsePrimary() {
    if (at('number')) return { type: 'Number', value: eat('number').value };
    if (at('string')) return { type: 'String', value: eat('string').value };
    if (match('kw', 'nil')) return { type: 'Nil' };
    if (match('kw', 'true')) return { type: 'Bool', value: true };
    if (match('kw', 'false')) return { type: 'Bool', value: false };
    if (match('op', '...')) return { type: 'Vararg' };
    if (at('ident')) return { type: 'Name', name: eat('ident').value };
    if (match('op', '(')) {
      const e = parseExpr();
      eat('op', ')');
      return e;
    }
    if (at('op', '{')) return parseTable();
    if (match('kw', 'function')) return { type: 'FunctionExpr', ...parseFuncBody() };
    // Luau if-expression: if cond then a else b  (and elseif)
    if (match('kw', 'if')) {
      const cond = parseExpr();
      eat('kw', 'then');
      const then = parseExpr();
      let elseE = null;
      if (match('kw', 'elseif')) {
        elseE = parseExpr(); // nested if-expr
      } else if (match('kw', 'else')) {
        elseE = parseExpr();
      }
      eat('kw', 'end');
      return { type: 'IfExpr', cond, then, else: elseE };
    }
    throw new Error('parse:' + peek().line + ': bad primary ' + peek().type + ' ' + peek().value);
  }

  function parseTable() {
    eat('op', '{');
    const fields = [];
    while (!at('op', '}')) {
      if (match('op', '[')) {
        const k = parseExpr();
        eat('op', ']');
        eat('op', '=');
        fields.push({ key: k, value: parseExpr() });
      } else if (at('ident') && peek(1).type === 'op' && peek(1).value === '=') {
        const k = { type: 'String', value: eat('ident').value };
        eat('op', '=');
        fields.push({ key: k, value: parseExpr() });
      } else {
        fields.push({ key: null, value: parseExpr() });
      }
      if (!match('op', ',') && !match('op', ';')) break;
    }
    eat('op', '}');
    return { type: 'Table', fields };
  }

  const ast = { type: 'Chunk', body: parseBlock().body };
  if (!at('eof')) throw new Error('parse:' + peek().line + ': trailing ' + peek().type + ' ' + peek().value);
  return ast;
}
