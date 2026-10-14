/**
 * Luau/Lua lexer — full Luau syntax support including compound assignments,
 * `continue`, type annotations (passed through), long strings/comments.
 *
 * Tokens: kw | ident | number | string | op | eof
 */
export function lex(src) {
  const s = String(src);
  const tokens = [];
  let i = 0, line = 1, col = 1;
  const KW = new Set([
    'and','break','do','else','elseif','end','false','for','function','goto',
    'if','in','local','nil','not','or','repeat','return','then','true','until','while','continue',
    // Note: 'type' and 'export' are Luau type-system keywords but we keep them
    // as identifiers so that `type(v)` (the global function call) parses
    // correctly. The parser handles `type Name = ...` declarations by
    // checking for `ident 'type'` at statement start.
  ]);
  function peek(n = 0) { return s[i + n]; }
  function adv() {
    const c = s[i++];
    if (c === '\n') { line++; col = 1; } else col++;
    return c;
  }
  function push(type, value) { tokens.push({ type, value, line, col }); }

  while (i < s.length) {
    const c = peek();
    // whitespace
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { adv(); continue; }
    // comments
    if (c === '-' && peek(1) === '-') {
      adv(); adv();
      // long comment
      if (peek() === '[') {
        let eq = 0; adv();
        while (peek() === '=') { eq++; adv(); }
        if (peek() === '[') {
          adv();
          const close = ']' + '='.repeat(eq) + ']';
          const idx = s.indexOf(close, i);
          if (idx < 0) { while (i < s.length) adv(); continue; }
          while (i < idx) adv();
          for (let k = 0; k < close.length; k++) adv();
          continue;
        }
        // not a long comment — back up and treat as line comment
      }
      // line comment
      while (i < s.length && peek() !== '\n') adv();
      continue;
    }
    // strings
    if (c === '"' || c === "'") {
      const q = adv();
      let str = '';
      while (i < s.length && peek() !== q) {
        if (peek() === '\\') {
          adv();
          const e = adv();
          const m = { n: '\n', t: '\t', r: '\r', '"': '"', "'": "'", '\\': '\\', '0': '\0', a: '\a', b: '\b', f: '\f', v: '\v' };
          if (m[e] !== undefined) str += m[e];
          else if (e === 'x') {
            let hex = '';
            for (let k = 0; k < 2 && /[0-9a-fA-F]/.test(peek() || ''); k++) hex += adv();
            str += String.fromCharCode(parseInt(hex, 16));
          } else if (e === 'z') {
            while (i < s.length && /\s/.test(peek())) adv();
          } else if (/[0-9]/.test(e)) {
            let dec = e;
            while (dec.length < 3 && /[0-9]/.test(peek() || '')) dec += adv();
            str += String.fromCharCode(parseInt(dec, 8));
          } else str += e;
        } else str += adv();
      }
      if (peek() === q) adv();
      push('string', str);
      continue;
    }
    // long string
    if (c === '[' && (peek(1) === '[' || peek(1) === '=')) {
      adv();
      let eq = 0;
      while (peek() === '=') { eq++; adv(); }
      if (peek() !== '[') {
        // not a long string — it's an index. Push '[' and continue.
        push('op', '[');
        continue;
      }
      adv();
      const close = ']' + '='.repeat(eq) + ']';
      const idx = s.indexOf(close, i);
      if (idx < 0) throw new Error('lex:' + line + ': unclosed long string');
      let str = '';
      // skip first newline if present
      if (peek() === '\n') adv();
      while (i < idx) str += adv();
      for (let k = 0; k < close.length; k++) adv();
      push('string', str);
      continue;
    }
    // numbers
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(peek(1) || ''))) {
      let num = '';
      if (c === '0' && (peek(1) === 'x' || peek(1) === 'X')) {
        num += adv() + adv();
        while (/[0-9a-fA-F_]/.test(peek() || '')) num += adv();
        // hex float: 0x1.8p3
        if (peek() === 'p' || peek() === 'P') {
          num += adv();
          if (peek() === '+' || peek() === '-') num += adv();
          while (/[0-9_]/.test(peek() || '')) num += adv();
        }
      } else {
        while (/[0-9_]/.test(peek() || '')) num += adv();
        if (peek() === '.') { num += adv(); while (/[0-9_]/.test(peek() || '')) num += adv(); }
        if (peek() === 'e' || peek() === 'E') {
          num += adv();
          if (peek() === '+' || peek() === '-') num += adv();
          while (/[0-9_]/.test(peek() || '')) num += adv();
        }
      }
      push('number', Number(num.replace(/_/g, '')));
      continue;
    }
    // identifiers
    if (/[A-Za-z_]/.test(c)) {
      let id = '';
      while (/[A-Za-z0-9_]/.test(peek() || '')) id += adv();
      if (KW.has(id)) push('kw', id);
      else push('ident', id);
      continue;
    }
    // operators
    const three = s.slice(i, i + 3);
    if (three === '...' || three === '..=') { adv(); adv(); adv(); push('op', three); continue; }
    const two = s.slice(i, i + 2);
    const twos = ['==', '~=', '<=', '>=', '..', '+=', '-=', '*=', '/=', '%=', '^=', '//=', '::', '->', '//'];
    if (twos.includes(two)) { adv(); adv(); push('op', two); continue; }
    if ('+-*/%^#<>={}[]().,;:&|'.includes(c)) { push('op', adv()); continue; }
    // skip Luau type-ish @ ? (treated as no-op in expr context)
    if (c === '@' || c === '?') { adv(); continue; }
    throw new Error('lex:' + line + ': unexpected ' + JSON.stringify(c));
  }
  push('eof', null);
  return tokens;
}
