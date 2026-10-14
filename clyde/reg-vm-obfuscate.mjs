#!/usr/bin/env node

// src/cli/reg-vm-obfuscate.ts
import { readFileSync, writeFileSync } from "fs";

// src/tokens.ts
var KEYWORDS = /* @__PURE__ */ new Set([
  "and",
  "break",
  "do",
  "else",
  "elseif",
  "end",
  "export",
  "false",
  "for",
  "function",
  "if",
  "in",
  "local",
  "nil",
  "not",
  "or",
  "repeat",
  "return",
  "then",
  "true",
  "until",
  "while"
]);

// src/lexer/Lexer.ts
var Lexer = class _Lexer {
  source;
  pos;
  tokens = [];
  errors = [];
  constructor(source2) {
    this.source = source2;
    this.pos = { line: 1, column: 1, offset: 0 };
  }
  lex() {
    while (this.pos.offset < this.source.length) {
      this.skipWhitespaceAndComments();
      if (this.pos.offset >= this.source.length) break;
      const start = this.clonePos();
      const token = this.readToken();
      if (token) {
        this.tokens.push(token);
      }
    }
    const end = this.clonePos();
    this.tokens.push({
      type: "EOF",
      loc: { start: end, end }
    });
    return { tokens: this.tokens, errors: this.errors };
  }
  clonePos() {
    return { ...this.pos };
  }
  loc(start, end) {
    return { start, end };
  }
  peek(offset = 0) {
    const i = this.pos.offset + offset;
    return i < this.source.length ? this.source[i] : "\0";
  }
  advance() {
    if (this.pos.offset >= this.source.length) return "\0";
    const ch = this.source[this.pos.offset];
    this.pos.offset++;
    if (ch === "\n") {
      this.pos.line++;
      this.pos.column = 1;
    } else {
      this.pos.column++;
    }
    return ch;
  }
  skipWhitespaceAndComments() {
    while (this.pos.offset < this.source.length) {
      const ch = this.peek();
      if (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        this.advance();
        continue;
      }
      if (ch === "-" && this.peek(1) === "-") {
        this.skipComment();
        continue;
      }
      break;
    }
  }
  skipComment() {
    this.advance();
    this.advance();
    const ch = this.peek();
    if (ch === "[") {
      const eqCount = this.readLongBracketStart();
      if (eqCount >= 0) {
        this.skipLongComment(eqCount);
        return;
      }
    }
    while (this.pos.offset < this.source.length && this.peek() !== "\n") {
      this.advance();
    }
  }
  readLongBracketStart() {
    let eqCount = 0;
    let i = 1;
    while (this.peek(i) === "=") {
      eqCount++;
      i++;
    }
    if (this.peek(i) !== "[") return -1;
    for (let j = 0; j < i + 1; j++) this.advance();
    return eqCount;
  }
  skipLongComment(eqCount) {
    const endSeq = "]" + "=".repeat(eqCount) + "]";
    let i = 0;
    while (this.pos.offset < this.source.length) {
      if (this.source[this.pos.offset] === endSeq[i]) {
        i++;
        this.advance();
        if (i === endSeq.length) return;
      } else if (i > 0) {
        i = 0;
      } else {
        this.advance();
      }
    }
    this.addError("Unclosed long comment");
  }
  addError(message) {
    const start = this.clonePos();
    this.errors.push({
      message,
      loc: { start, end: start },
      code: "E001"
    });
  }
  readToken() {
    const start = this.clonePos();
    const ch = this.peek();
    if (this.isLetter(ch) || ch === "_") {
      return this.readIdentifierOrKeyword(start);
    }
    if (this.isDigit(ch) || ch === "." && this.isDigit(this.peek(1))) {
      const num = this.readNumber(start);
      if (num) return num;
      return null;
    }
    if (ch === '"' || ch === "'") {
      return this.readShortString(start);
    }
    if (ch === "[" && (this.peek(1) === "[" || this.peek(1) === "=")) {
      return this.readLongString(start);
    }
    if (ch === "`") {
      return this.readBacktickString(start);
    }
    const op = this.tryReadOperator(ch);
    if (op) {
      const end = this.clonePos();
      return { type: "Punctuator", value: op, loc: this.loc(start, end) };
    }
    this.addError(`Unexpected character: ${JSON.stringify(ch)}`);
    this.advance();
    return null;
  }
  isLetter(ch) {
    return ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z";
  }
  isDigit(ch) {
    return ch >= "0" && ch <= "9";
  }
  isIdentCont(ch) {
    return this.isLetter(ch) || this.isDigit(ch) || ch === "_";
  }
  readIdentifierOrKeyword(start) {
    const startOff = this.pos.offset;
    while (this.pos.offset < this.source.length && this.isIdentCont(this.source[this.pos.offset])) {
      this.pos.offset++;
      this.pos.column++;
    }
    const value = this.source.substring(startOff, this.pos.offset);
    const end = { line: this.pos.line, column: this.pos.column, offset: this.pos.offset };
    if (KEYWORDS.has(value)) {
      return {
        type: "Keyword",
        value,
        loc: this.loc(start, end)
      };
    }
    return {
      type: "Identifier",
      value,
      loc: this.loc(start, end)
    };
  }
  readNumber(start) {
    let raw = "";
    const ch = this.peek();
    if (ch === "0" && (this.peek(1) === "x" || this.peek(1) === "X")) {
      raw += this.advance();
      raw += this.advance();
      while (this.pos.offset < this.source.length && (this.isHexDigit(this.peek()) || this.peek() === "_")) {
        raw += this.advance();
      }
      if (this.peek() === "." && this.isHexDigit(this.peek(2))) {
        raw += this.advance();
        while (this.pos.offset < this.source.length && (this.isHexDigit(this.peek()) || this.peek() === "_")) {
          raw += this.advance();
        }
      }
      if (this.peek() === "p" || this.peek() === "P") {
        raw += this.advance();
        if (this.peek() === "+" || this.peek() === "-") raw += this.advance();
        while (this.pos.offset < this.source.length && this.isDigit(this.peek())) {
          raw += this.advance();
        }
      }
    } else if (ch === "0" && (this.peek(1) === "b" || this.peek(1) === "B")) {
      raw += this.advance();
      raw += this.advance();
      while (this.pos.offset < this.source.length && (this.isBinaryDigit(this.peek()) || this.peek() === "_")) {
        raw += this.advance();
      }
    } else {
      while (this.pos.offset < this.source.length && (this.isDigit(this.peek()) || this.peek() === "_")) {
        raw += this.advance();
      }
      if (this.peek() === "." && this.isDigit(this.peek(1))) {
        raw += this.advance();
        while (this.pos.offset < this.source.length && (this.isDigit(this.peek()) || this.peek() === "_")) {
          raw += this.advance();
        }
      }
      if (this.peek() === "e" || this.peek() === "E") {
        raw += this.advance();
        if (this.peek() === "+" || this.peek() === "-") raw += this.advance();
        while (this.pos.offset < this.source.length && this.isDigit(this.peek())) {
          raw += this.advance();
        }
      }
    }
    if (raw === "") {
      this.advance();
      return null;
    }
    const end = this.clonePos();
    const valueStr = raw.replace(/_/g, "");
    return {
      type: "Number",
      value: valueStr,
      raw,
      loc: this.loc(start, end)
    };
  }
  isHexDigit(ch) {
    return ch >= "0" && ch <= "9" || ch >= "a" && ch <= "f" || ch >= "A" && ch <= "F";
  }
  isBinaryDigit(ch) {
    return ch === "0" || ch === "1";
  }
  readShortString(start) {
    const quote = this.advance();
    let value = "";
    let raw = quote;
    while (this.pos.offset < this.source.length) {
      const ch = this.peek();
      if (ch === quote) {
        raw += this.advance();
        break;
      }
      if (ch === "\\") {
        const escaped = this.readEscapeSequence(quote === '"');
        value += escaped.value;
        raw += escaped.raw;
        continue;
      }
      if (ch === "\n" || ch === "\0") {
        this.addError("Unclosed string literal");
        break;
      }
      value += this.advance();
      raw += ch;
    }
    const end = this.clonePos();
    return {
      type: "String",
      value,
      raw,
      loc: this.loc(start, end)
    };
  }
  readEscapeSequence(inDoubleQuote) {
    let raw = this.advance();
    const ch = this.peek();
    raw += this.advance();
    switch (ch) {
      case "n":
        return { value: "\n", raw };
      case "r":
        return { value: "\r", raw };
      case "t":
        return { value: "	", raw };
      case "a":
        return { value: "\x07", raw };
      case "b":
        return { value: "\b", raw };
      case "f":
        return { value: "\f", raw };
      case "v":
        return { value: "\v", raw };
      case "\\":
        return { value: "\\", raw };
      case '"':
        return { value: '"', raw };
      case "'":
        return { value: "'", raw };
      case "z":
        while (this.pos.offset < this.source.length) {
          const c = this.peek();
          if (c === " " || c === "	" || c === "\n" || c === "\r") {
            raw += this.advance();
          } else break;
        }
        return { value: "", raw };
      case "x": {
        let hex = "";
        for (let i = 0; i < 2 && this.isHexDigit(this.peek()); i++) {
          hex += this.advance();
          raw += this.source[this.pos.offset - 1];
        }
        const code = parseInt(hex, 16);
        return { value: isNaN(code) ? "\\x" + hex : String.fromCharCode(code), raw };
      }
      case "u": {
        if (this.peek() !== "{") {
          return { value: "\\u", raw };
        }
        raw += this.advance();
        let hex = "";
        while (this.isHexDigit(this.peek())) {
          hex += this.advance();
          raw += this.source[this.pos.offset - 1];
        }
        if (this.peek() !== "}") {
          this.addError("Invalid \\u{...} escape");
          return { value: "", raw };
        }
        raw += this.advance();
        const code = parseInt(hex, 16);
        return {
          value: isNaN(code) ? "" : String.fromCodePoint(code),
          raw
        };
      }
      default:
        if (ch >= "0" && ch <= "9") {
          let dec = ch;
          for (let i = 0; i < 2 && this.isDigit(this.peek()); i++) {
            const d = this.advance();
            dec += d;
            raw += d;
          }
          const code = parseInt(dec, 10);
          if (code <= 255) {
            return { value: String.fromCharCode(code), raw };
          }
        }
        return { value: ch, raw };
    }
  }
  readLongString(start) {
    this.advance();
    let eqCount = 0;
    while (this.peek() === "=") {
      eqCount++;
      this.advance();
    }
    if (this.peek() !== "[") {
      this.addError("Invalid long string start");
      return {
        type: "String",
        value: "",
        raw: "",
        loc: this.loc(start, this.clonePos())
      };
    }
    this.advance();
    if (this.peek() === "\n") this.advance();
    const endSeq = "]" + "=".repeat(eqCount) + "]";
    let value = "";
    let i = 0;
    while (this.pos.offset < this.source.length) {
      const ch = this.peek();
      if (ch === endSeq[i]) {
        i++;
        this.advance();
        if (i === endSeq.length) break;
      } else {
        if (i > 0) {
          value += endSeq.slice(0, i);
          i = 0;
        } else if (ch !== "\0") {
          value += this.advance();
        } else {
          this.addError("Unclosed long string");
          break;
        }
      }
    }
    if (i < endSeq.length && this.pos.offset >= this.source.length) {
      this.addError("Unclosed long string");
    }
    const end = this.clonePos();
    return {
      type: "String",
      value,
      raw: `[${"=".repeat(eqCount)}[${value}]${"=".repeat(eqCount)}]`,
      loc: this.loc(start, end)
    };
  }
  readBacktickString(start) {
    this.advance();
    let value = "";
    let raw = "`";
    let hasInterpolation = false;
    while (this.pos.offset < this.source.length) {
      const ch = this.peek();
      if (ch === "`") {
        raw += this.advance();
        break;
      }
      if (ch === "{") {
        if (this.peek(1) === "{") {
          this.addError("{{ is invalid in interpolated string");
          raw += this.advance();
          raw += this.advance();
          value += "{{";
        } else {
          hasInterpolation = true;
          break;
        }
        continue;
      }
      if (ch === "\\") {
        const next = this.peek(1);
        if (next === "`" || next === "{" || next === "\\") {
          raw += this.advance();
          raw += this.advance();
          value += next;
          continue;
        }
        if (next === "\n") {
          raw += this.advance();
          raw += this.advance();
          value += "\n";
          continue;
        }
        raw += this.advance();
        raw += this.advance();
        value += next || "";
        continue;
      }
      if (ch === "\0") {
        this.addError("Unclosed backtick string");
        break;
      }
      value += this.advance();
      raw += ch;
    }
    if (!hasInterpolation) {
      const end = this.clonePos();
      return {
        type: "String",
        value,
        raw,
        loc: this.loc(start, end)
      };
    }
    this.readBacktickStringWithInterpolation(start, value);
    return null;
  }
  readBacktickStringWithInterpolation(outerStart, firstPart) {
    const partStart = { ...this.pos, offset: this.pos.offset - firstPart.length };
    this.tokens.push({
      type: "InterpPart",
      value: firstPart,
      loc: this.loc(partStart, this.clonePos())
    });
    while (this.pos.offset < this.source.length) {
      const ch = this.peek();
      if (ch === "`") {
        this.advance();
        return;
      }
      if (ch === "{") {
        if (this.peek(1) === "{") {
          this.addError("{{ is invalid in interpolated string");
          this.advance();
          this.advance();
          this.tokens.push({
            type: "InterpPart",
            value: "{{",
            loc: this.loc(this.clonePos(), this.clonePos())
          });
          continue;
        }
        const braceStart = this.clonePos();
        this.advance();
        this.tokens.push({
          type: "Punctuator",
          value: "{",
          loc: this.loc(braceStart, this.clonePos())
        });
        const expEnd = this.findMatchingBrace();
        if (expEnd < 0) {
          this.addError("Unclosed { in interpolated string");
          return;
        }
        const expSource = this.source.slice(this.pos.offset, expEnd);
        const baseOffset = this.pos.offset;
        const baseLine = this.pos.line;
        const baseColumn = this.pos.column;
        const subLex = new _Lexer(expSource);
        const subResult = subLex.lex();
        for (const err of subResult.errors) {
          err.loc.start.offset += baseOffset;
          err.loc.end.offset += baseOffset;
          if (err.loc.start.line === 1) {
            err.loc.start.column += baseColumn - 1;
          }
          err.loc.start.line += baseLine - 1;
          if (err.loc.end.line === 1) {
            err.loc.end.column += baseColumn - 1;
          }
          err.loc.end.line += baseLine - 1;
          this.errors.push(err);
        }
        for (const t of subResult.tokens) {
          if (t.type === "EOF") continue;
          t.loc.start.offset += baseOffset;
          t.loc.end.offset += baseOffset;
          if (t.loc.start.line === 1) {
            t.loc.start.column += baseColumn - 1;
          }
          t.loc.start.line += baseLine - 1;
          if (t.loc.end.line === 1) {
            t.loc.end.column += baseColumn - 1;
          }
          t.loc.end.line += baseLine - 1;
          this.tokens.push(t);
        }
        for (let ci = this.pos.offset; ci < expEnd; ci++) {
          if (this.source[ci] === "\n") {
            this.pos.line++;
            this.pos.column = 1;
          } else {
            this.pos.column++;
          }
        }
        this.pos.offset = expEnd;
        const closeStart = this.clonePos();
        this.advance();
        this.tokens.push({
          type: "Punctuator",
          value: "}",
          loc: this.loc(closeStart, this.clonePos())
        });
        continue;
      }
      if (ch === "\\") {
        const next = this.peek(1);
        if (next === "`" || next === "{" || next === "\\") {
          this.advance();
          this.advance();
          const partStart2 = this.clonePos();
          this.tokens.push({
            type: "InterpPart",
            value: next,
            loc: this.loc(partStart2, this.clonePos())
          });
          continue;
        }
        if (next === "\n") {
          this.advance();
          this.advance();
          const partStart2 = this.clonePos();
          this.tokens.push({
            type: "InterpPart",
            value: "\n",
            loc: this.loc(partStart2, this.clonePos())
          });
          continue;
        }
        this.advance();
        this.advance();
        continue;
      }
      let partValue = "";
      const partStart3 = this.clonePos();
      while (this.pos.offset < this.source.length) {
        const c = this.peek();
        if (c === "`" || c === "{" || c === "\\") break;
        if (c === "\0") break;
        partValue += this.advance();
      }
      if (partValue) {
        this.tokens.push({
          type: "InterpPart",
          value: partValue,
          loc: this.loc(partStart3, this.clonePos())
        });
      }
    }
  }
  findMatchingBrace() {
    let depth = 1;
    let i = this.pos.offset;
    while (i < this.source.length) {
      const ch = this.source[i];
      if (ch === "-" && this.source[i + 1] === "-") {
        i += 2;
        if (this.source[i] === "[") {
          const eqCount = this.readLongBracketStartAt(i);
          if (eqCount >= 0) {
            i = this.findLongBracketEnd(i, eqCount);
            continue;
          }
        }
        while (i < this.source.length && this.source[i] !== "\n") {
          i++;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        const quote = ch;
        i++;
        while (i < this.source.length) {
          const c = this.source[i];
          if (c === "\\") {
            i += 2;
            continue;
          }
          if (c === quote) {
            i++;
            break;
          }
          i++;
        }
        continue;
      }
      if (ch === "`") {
        i++;
        while (i < this.source.length && this.source[i] !== "`") {
          if (this.source[i] === "\\") {
            i += 2;
            continue;
          }
          if (this.source[i] === "{") {
            i++;
            let nestedDepth = 1;
            while (i < this.source.length && nestedDepth > 0) {
              const c = this.source[i];
              if (c === '"' || c === "'") {
                const quote = c;
                i++;
                while (i < this.source.length) {
                  const sc = this.source[i];
                  if (sc === "\\") {
                    i += 2;
                    continue;
                  }
                  if (sc === quote) {
                    i++;
                    break;
                  }
                  i++;
                }
                continue;
              }
              if (c === "-" && this.source[i + 1] === "-") {
                i += 2;
                if (this.source[i] === "[") {
                  const eq = this.readLongBracketStartAt(i);
                  if (eq >= 0) {
                    i = this.findLongBracketEnd(i, eq);
                    continue;
                  }
                }
                while (i < this.source.length && this.source[i] !== "\n") i++;
                continue;
              }
              if (c === "{") nestedDepth++;
              else if (c === "}") nestedDepth--;
              else if (c === "\\") i++;
              if (nestedDepth > 0) i++;
            }
            if (i < this.source.length) i++;
            continue;
          }
          i++;
        }
        if (i < this.source.length) i++;
        continue;
      }
      if (ch === "[" && (this.source[i + 1] === "[" || this.source[i + 1] === "=")) {
        const eqCount = this.readLongBracketStartAt(i);
        if (eqCount >= 0) {
          i = this.findLongBracketEnd(i, eqCount);
          continue;
        }
      }
      if (ch === "{") {
        depth++;
        i++;
        continue;
      }
      if (ch === "}") {
        depth--;
        if (depth === 0) return i;
        i++;
        continue;
      }
      if (ch === "(" || ch === "[") {
        const open = ch;
        const close = ch === "(" ? ")" : "]";
        let d = 1;
        i++;
        while (i < this.source.length && d > 0) {
          const c = this.source[i];
          if (c === open) d++;
          else if (c === close) d--;
          i++;
        }
        continue;
      }
      i++;
    }
    return -1;
  }
  tryReadOperator(ch) {
    const c2 = this.peek(1);
    switch (ch) {
      case "+":
        this.advance();
        if (c2 === "=") {
          this.advance();
          return "+=";
        }
        return "+";
      case "-":
        this.advance();
        if (c2 === "=") {
          this.advance();
          return "-=";
        }
        if (c2 === ">") {
          this.advance();
          return "->";
        }
        return "-";
      case "*":
        this.advance();
        if (c2 === "=") {
          this.advance();
          return "*=";
        }
        return "*";
      case "/":
        this.advance();
        if (c2 === "/") {
          this.advance();
          if (this.peek() === "=") {
            this.advance();
            return "//=";
          }
          return "//";
        }
        if (c2 === "=") {
          this.advance();
          return "/=";
        }
        return "/";
      case "%":
        this.advance();
        if (c2 === "=") {
          this.advance();
          return "%=";
        }
        return "%";
      case "^":
        this.advance();
        if (c2 === "=") {
          this.advance();
          return "^=";
        }
        return "^";
      case "<":
        this.advance();
        if (c2 === "=") {
          this.advance();
          return "<=";
        }
        return "<";
      case ">":
        this.advance();
        if (c2 === "=") {
          this.advance();
          return ">=";
        }
        return ">";
      case "=":
        this.advance();
        if (c2 === "=") {
          this.advance();
          return "==";
        }
        return "=";
      case "~":
        this.advance();
        if (c2 === "=") {
          this.advance();
          return "~=";
        }
        return "~";
      case ".":
        this.advance();
        if (c2 === ".") {
          this.advance();
          const c3 = this.peek();
          if (c3 === ".") {
            this.advance();
            return "...";
          }
          if (c3 === "=") {
            this.advance();
            return "..=";
          }
          return "..";
        }
        return ".";
      case ":":
        this.advance();
        if (c2 === ":") {
          this.advance();
          return "::";
        }
        return ":";
      case "#":
        this.advance();
        return "#";
      case ",":
        this.advance();
        return ",";
      case ";":
        this.advance();
        return ";";
      case "(":
        this.advance();
        return "(";
      case ")":
        this.advance();
        return ")";
      case "[":
        this.advance();
        return "[";
      case "]":
        this.advance();
        return "]";
      case "{":
        this.advance();
        return "{";
      case "}":
        this.advance();
        return "}";
      case "|":
        this.advance();
        return "|";
      case "&":
        this.advance();
        return "&";
      case "?":
        this.advance();
        return "?";
      case "@":
        this.advance();
        return "@";
      default:
        return null;
    }
  }
  readLongBracketStartAt(offset) {
    let eqCount = 0;
    let i = offset + 1;
    while (this.source[i] === "=") {
      eqCount++;
      i++;
    }
    return this.source[i] === "[" ? eqCount : -1;
  }
  findLongBracketEnd(offset, eqCount) {
    const endSeq = "]" + "=".repeat(eqCount) + "]";
    let i = offset;
    while (i < this.source.length) {
      if (this.source.slice(i, i + endSeq.length) === endSeq) {
        return i + endSeq.length;
      }
      i++;
    }
    return this.source.length;
  }
};
function lex(source2) {
  return new Lexer(source2).lex();
}

// src/parser/TypeParser.ts
function parseType(ctx) {
  return parseUnion(ctx);
}
function parseUnion(ctx) {
  const types = [];
  let first = parseSimpleTypeWithOptional(ctx);
  if (!first) return null;
  types.push(first);
  while (ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === "|") {
    ctx.pos++;
    const next = parseSimpleTypeWithOptional(ctx);
    if (!next) return null;
    types.push(next);
  }
  if (types.length === 1 && !types[0].optional) return types[0].type;
  const start = types[0].type.loc.start;
  const end = types[types.length - 1].type.loc.end;
  return {
    type: "UnionType",
    types,
    loc: { start, end }
  };
}
function parseSimpleTypeWithOptional(ctx) {
  const t = parseIntersection(ctx);
  if (!t) return null;
  let optional = false;
  if (ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === "?") {
    ctx.pos++;
    optional = true;
  }
  return { type: t, optional };
}
function parseIntersection(ctx) {
  const types = [];
  let first = parseSimpleType(ctx);
  if (!first) return null;
  types.push(first);
  while (ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === "&") {
    ctx.pos++;
    const next = parseSimpleType(ctx);
    if (!next) return null;
    types.push(next);
  }
  if (types.length === 1) return types[0];
  const start = types[0].loc.start;
  const end = types[types.length - 1].loc.end;
  return {
    type: "IntersectionType",
    types,
    loc: { start, end }
  };
}
function isFunctionTypeLookahead(ctx) {
  let depth = 0;
  let i = ctx.pos;
  const t = ctx.tokens[i];
  if (!t || t.type !== "Punctuator" || t.value !== "(") return false;
  while (i < ctx.tokens.length) {
    const tok = ctx.tokens[i];
    if (tok.type === "Punctuator") {
      const val = tok.value;
      if (val === "(" || val === "{" || val === "<") {
        depth++;
      } else if (val === ")" || val === "}" || val === ">") {
        depth--;
        if (depth === 0) {
          const next = ctx.tokens[i + 1];
          if (next && next.type === "Punctuator" && next.value === "->") {
            return true;
          }
          return false;
        }
      }
    }
    i++;
  }
  return false;
}
function parseSimpleType(ctx) {
  const tok = ctx.tokens[ctx.pos];
  if (!tok) return null;
  if (tok.type === "Punctuator" && tok.value === "...") {
    ctx.pos++;
    const inner = parseType(ctx);
    if (!inner) return null;
    return { type: "VariadicTypePack", inner, loc: tok.loc };
  }
  if (tok.type === "Keyword" && tok.value === "nil") {
    ctx.pos++;
    return { type: "NilType", loc: tok.loc };
  }
  if (tok.type === "Keyword" && (tok.value === "true" || tok.value === "false")) {
    ctx.pos++;
    return {
      type: "SingletonType",
      value: tok.value === "true",
      loc: tok.loc
    };
  }
  if (tok.type === "String") {
    ctx.pos++;
    return {
      type: "SingletonType",
      value: tok.value,
      loc: tok.loc
    };
  }
  if ((tok.type === "Keyword" || tok.type === "Identifier") && tok.value === "typeof") {
    ctx.pos++;
    const lp = ctx.tokens[ctx.pos];
    if (lp?.type !== "Punctuator" || lp.value !== "(") return null;
    ctx.pos++;
    const exp = ctx.parseExpression();
    if (!exp) return null;
    const rp = ctx.tokens[ctx.pos];
    if (rp?.type !== "Punctuator" || rp.value !== ")") return null;
    ctx.pos++;
    return {
      type: "TypeofType",
      expression: exp,
      loc: ctx.mergeLoc(exp.loc)
    };
  }
  if (tok.type === "Punctuator" && tok.value === "(") {
    if (isFunctionTypeLookahead(ctx)) {
      return parseFunctionType(ctx);
    }
    ctx.pos++;
    const first = parseType(ctx);
    if (!first) return null;
    if (ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === ",") {
      ctx.pos++;
      const types = [first];
      while (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ")") {
        if (ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === "...") {
          ctx.pos++;
          const inner = parseType(ctx);
          if (!inner) return null;
          types.push({ type: "VariadicTypePack", inner, loc: inner.loc });
        } else {
          const ty = parseType(ctx);
          if (!ty) break;
          types.push(ty);
        }
        if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ",") break;
        ctx.pos++;
      }
      if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ")") return null;
      ctx.pos++;
      return { type: "TypePack", types, loc: tok.loc };
    } else {
      const rp = ctx.tokens[ctx.pos];
      if (rp?.type !== "Punctuator" || rp.value !== ")") return null;
      ctx.pos++;
      return {
        type: "ParenType",
        inner: first,
        loc: ctx.mergeLoc(first.loc)
      };
    }
  }
  if (tok.type === "Punctuator" && tok.value === "{") {
    return parseTableType(ctx);
  }
  if (tok.type === "Keyword" && tok.value === "(") {
    return null;
  }
  const ft = parseFunctionType(ctx);
  if (ft) return ft;
  if (tok.type === "Identifier" || tok.type === "Keyword" && ["any", "nil", "boolean", "number", "string", "thread", "read", "write"].includes(tok.value)) {
    return parseIdentifierType(ctx);
  }
  return null;
}
function parseIdentifierType(ctx) {
  const tok = ctx.tokens[ctx.pos];
  if (!tok || tok.type !== "Identifier" && tok.type !== "Keyword") return null;
  const start = tok.loc.start;
  let name = tok.value;
  ctx.pos++;
  let module;
  while (ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === ".") {
    ctx.pos++;
    const next = ctx.tokens[ctx.pos];
    if (next?.type !== "Identifier" && next?.type !== "Keyword") return null;
    module = name;
    name = next.value;
    ctx.pos++;
  }
  let typeParams;
  if (ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === "<") {
    ctx.pos++;
    typeParams = parseTypeParams(ctx);
    if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ">") return null;
    ctx.pos++;
  }
  const end = ctx.tokens[ctx.pos - 1]?.loc?.end ?? start;
  return {
    type: "IdentifierType",
    name,
    module,
    typeParams,
    loc: { start, end }
  };
}
function parseTypeParams(ctx) {
  const params = [];
  while (true) {
    const t = ctx.tokens[ctx.pos];
    if (!t || t.type === "Punctuator" && t.value === ">") break;
    if (t.type === "Identifier" && ctx.tokens[ctx.pos + 1]?.type === "Punctuator" && ctx.tokens[ctx.pos + 1].value === "...") {
      ctx.pos += 2;
      params.push({ type: "GenericTypePack", name: t.value, loc: t.loc });
    } else if (ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === "...") {
      ctx.pos++;
      const inner = parseType(ctx);
      if (!inner) break;
      params.push({ type: "VariadicTypePack", inner, loc: inner.loc });
    } else if (ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === "(") {
      const pack = parseTypePack(ctx);
      if (pack) params.push(pack);
    } else {
      const ty = parseType(ctx);
      if (ty) params.push(ty);
      else break;
    }
    if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ",") break;
    ctx.pos++;
  }
  return params;
}
function parseTypePack(ctx) {
  const tok = ctx.tokens[ctx.pos];
  if (tok?.type !== "Punctuator" || tok.value !== "(") return null;
  ctx.pos++;
  const types = [];
  while (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ")") {
    if (ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === "...") {
      ctx.pos++;
      const inner = parseType(ctx);
      if (!inner) return null;
      types.push({ type: "VariadicTypePack", inner, loc: inner.loc });
    } else {
      const ty = parseType(ctx);
      if (!ty) break;
      types.push(ty);
    }
    if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ",") break;
    ctx.pos++;
  }
  if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ")") return null;
  ctx.pos++;
  return { type: "TypePack", types, loc: tok.loc };
}
function parseTableType(ctx) {
  const tok = ctx.tokens[ctx.pos];
  if (tok?.type !== "Punctuator" || tok.value !== "{") return null;
  const start = tok.loc.start;
  ctx.pos++;
  const next = ctx.tokens[ctx.pos];
  if (next) {
    const savedPos = ctx.pos;
    const single = parseType(ctx);
    if (single && ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === "}") {
      ctx.pos++;
      return { type: "TableType", arrayType: single, loc: { start, end: ctx.tokens[ctx.pos - 1].loc.end } };
    }
    ctx.pos = savedPos;
  }
  const props = [];
  const fieldsep = [",", ";"];
  while (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== "}") {
    const t = ctx.tokens[ctx.pos];
    if (!t) break;
    if ((t.type === "Keyword" || t.type === "Identifier") && (t.value === "read" || t.value === "write")) {
      const savedPos = ctx.pos;
      const ro = t.value === "read";
      ctx.pos++;
      const next2 = ctx.tokens[ctx.pos];
      let processed = false;
      if (next2?.type === "Punctuator" && next2.value === "[") {
        ctx.pos++;
        const indexType = parseType(ctx);
        if (indexType && ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === "]") {
          ctx.pos++;
          if (ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === ":") {
            ctx.pos++;
            const valueType = parseType(ctx);
            if (valueType) {
              props.push({
                type: "TableIndexerType",
                indexType,
                valueType,
                readOnly: ro,
                writeOnly: !ro,
                loc: t.loc
              });
              processed = true;
            }
          }
        }
      } else if (next2?.type === "Identifier" || next2?.type === "Keyword") {
        const name = next2.value;
        ctx.pos++;
        if (ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === ":") {
          ctx.pos++;
          const propType = parseType(ctx);
          if (propType) {
            props.push({
              type: "TablePropType",
              name,
              propType,
              readOnly: ro,
              writeOnly: !ro,
              loc: t.loc
            });
            processed = true;
          }
        }
      }
      if (!processed) {
        ctx.pos = savedPos;
        const name = t.value;
        ctx.pos++;
        if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ":") break;
        ctx.pos++;
        const propType = parseType(ctx);
        if (!propType) break;
        props.push({ type: "TablePropType", name, propType, loc: t.loc });
      }
    } else if (t.type === "Punctuator" && t.value === "[") {
      ctx.pos++;
      const indexType = parseType(ctx);
      if (!indexType) break;
      if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== "]") break;
      ctx.pos++;
      if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ":") break;
      ctx.pos++;
      const valueType = parseType(ctx);
      if (!valueType) break;
      props.push({ type: "TableIndexerType", indexType, valueType, loc: t.loc });
    } else if (t.type === "Identifier" || t.type === "Keyword") {
      const name = t.value;
      ctx.pos++;
      if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ":") break;
      ctx.pos++;
      const propType = parseType(ctx);
      if (!propType) break;
      props.push({ type: "TablePropType", name, propType, loc: t.loc });
    } else {
      break;
    }
    const sep = ctx.tokens[ctx.pos];
    if (sep?.type === "Punctuator" && fieldsep.includes(sep.value)) ctx.pos++;
  }
  if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== "}") return null;
  ctx.pos++;
  return { type: "TableType", props, loc: { start, end: ctx.tokens[ctx.pos - 1].loc.end } };
}
function parseFunctionType(ctx) {
  const tok = ctx.tokens[ctx.pos];
  if (!tok) return null;
  let generics;
  if (tok.type === "Punctuator" && tok.value === "<") {
    ctx.pos++;
    generics = [];
    while (true) {
      const t = ctx.tokens[ctx.pos];
      if (!t) break;
      if (t.type === "Identifier") {
        let name = t.value;
        ctx.pos++;
        if (ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === "...") {
          ctx.pos++;
          name += "...";
        }
        generics.push(name);
      } else if (t.type === "Punctuator" && t.value === ">") {
        break;
      } else {
        break;
      }
      if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ",") break;
      ctx.pos++;
    }
    if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ">") return null;
    ctx.pos++;
  }
  const lp = ctx.tokens[ctx.pos];
  if (lp?.type !== "Punctuator" || lp.value !== "(") return generics ? null : null;
  ctx.pos++;
  const params = [];
  while (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ")") {
    const t = ctx.tokens[ctx.pos];
    if (t?.type === "Identifier" && ctx.tokens[ctx.pos + 1]?.type === "Punctuator" && ctx.tokens[ctx.pos + 1].value === "...") {
      ctx.pos += 2;
      params.push({ type: "GenericTypePack", name: t.value, loc: t.loc });
    } else if (t?.type === "Punctuator" && t.value === "...") {
      ctx.pos++;
      const inner = parseType(ctx);
      if (!inner) return null;
      params.push({ type: "VariadicTypePack", inner, loc: inner.loc });
    } else if (t?.type === "Identifier" || t?.type === "Keyword") {
      const name = t.value;
      ctx.pos++;
      if (ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === ":") {
        ctx.pos++;
        const paramType = parseType(ctx);
        if (!paramType) return null;
        params.push({ name, type: paramType });
      } else {
        params.push({ type: { type: "IdentifierType", name, loc: t.loc } });
      }
    } else {
      const paramType = parseType(ctx);
      if (!paramType) break;
      params.push({ type: paramType });
    }
    if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ",") break;
    ctx.pos++;
  }
  if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ")") return null;
  ctx.pos++;
  if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== "->") return null;
  ctx.pos++;
  const returnType = parseReturnType(ctx);
  if (!returnType) return null;
  return {
    type: "FunctionType",
    generics,
    params,
    returnType,
    loc: tok.loc
  };
}
function parseReturnType(ctx) {
  const t = ctx.tokens[ctx.pos];
  if (!t) return null;
  if (t.type === "Identifier" && ctx.tokens[ctx.pos + 1]?.type === "Punctuator" && ctx.tokens[ctx.pos + 1].value === "...") {
    ctx.pos += 2;
    return { type: "GenericTypePack", name: t.value, loc: t.loc };
  }
  if (t.type === "Punctuator" && t.value === "...") {
    ctx.pos++;
    const inner = parseType(ctx);
    if (!inner) return null;
    return { type: "VariadicTypePack", inner, loc: t.loc };
  }
  if (t.type === "Punctuator" && t.value === "(") {
    const pack = parseTypePack(ctx);
    return pack;
  }
  return parseType(ctx);
}
function parseTypePackOrPackDefault(ctx) {
  const t = ctx.tokens[ctx.pos];
  if (!t) return null;
  if (t.type === "Identifier" && ctx.tokens[ctx.pos + 1]?.type === "Punctuator" && ctx.tokens[ctx.pos + 1].value === "...") {
    ctx.pos += 2;
    return { type: "GenericTypePack", name: t.value, loc: t.loc };
  }
  if (t.type === "Punctuator" && t.value === "...") {
    ctx.pos++;
    const inner = parseType(ctx);
    if (!inner) return null;
    return { type: "VariadicTypePack", inner, loc: inner.loc };
  }
  if (t.type === "Punctuator" && t.value === "(") {
    return parseTypePack(ctx);
  }
  return null;
}
function parseGenericTypeListWithDefaults(ctx) {
  const tok = ctx.tokens[ctx.pos];
  if (tok?.type !== "Punctuator" || tok.value !== "<") return null;
  const start = tok.loc.start;
  ctx.pos++;
  const params = [];
  while (true) {
    const t = ctx.tokens[ctx.pos];
    if (!t || t.type === "Punctuator" && t.value === ">") break;
    if (t.type === "Identifier" && ctx.tokens[ctx.pos + 1]?.value === "...") {
      const name = t.value + "...";
      ctx.pos += 2;
      if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== "=") {
        params.push({ name });
      } else {
        ctx.pos++;
        const def = parseTypePackOrPackDefault(ctx);
        if (!def) break;
        params.push({ name, default: def });
      }
    } else if (t.type === "Identifier" || t.type === "Keyword") {
      const name = t.value;
      ctx.pos++;
      let defaultType;
      if (ctx.tokens[ctx.pos]?.type === "Punctuator" && ctx.tokens[ctx.pos].value === "=") {
        ctx.pos++;
        defaultType = parseType(ctx) ?? void 0;
      }
      params.push(defaultType ? { name, default: defaultType } : { name });
    } else {
      break;
    }
    if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ",") break;
    ctx.pos++;
  }
  if (ctx.tokens[ctx.pos]?.type !== "Punctuator" || ctx.tokens[ctx.pos].value !== ">") return null;
  ctx.pos++;
  return { type: "GenericTypeListWithDefaults", params, loc: { start, end: ctx.tokens[ctx.pos - 1].loc.end } };
}

// src/parser/Parser.ts
var BINARY_PRECEDENCE = {
  "or": 1,
  "and": 2,
  "<": 3,
  ">": 3,
  "<=": 3,
  ">=": 3,
  "~=": 3,
  "==": 3,
  "..": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "//": 6,
  "%": 6,
  "^": 7
};
var BLOCK_END_KEYWORDS = /* @__PURE__ */ new Set(["end", "else", "elseif", "until"]);
var COMPOUND_OPS = /* @__PURE__ */ new Set(["+=", "-=", "*=", "/=", "//=", "%=", "^=", "..="]);
var Parser = class {
  tokens;
  pos = 0;
  errors = [];
  constructor(tokens2) {
    const eof = tokens2.find((t) => t.type === "EOF");
    this.tokens = tokens2.filter((t) => t.type !== "EOF");
    if (eof) this.tokens.push(eof);
  }
  parse() {
    const body = [];
    const start = this.loc();
    while (!this.isEOF()) {
      const stmt = this.parseStatementOrLast();
      if (stmt) body.push(stmt);
    }
    return {
      type: "Chunk",
      body,
      loc: { start: start.start, end: this.loc().end }
    };
  }
  getErrors() {
    return this.errors;
  }
  loc() {
    const t = this.tokens[this.pos];
    return t ? t.loc : this.tokens[this.tokens.length - 1].loc;
  }
  peek() {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1];
  }
  isEOF() {
    return this.peek().type === "EOF";
  }
  consume() {
    return this.tokens[this.pos++] ?? this.tokens[this.tokens.length - 1];
  }
  check(type, value) {
    const t = this.peek();
    if (t.type !== type) return false;
    if (value !== void 0 && t.value !== value) return false;
    return true;
  }
  expect(type, value) {
    const t = this.peek();
    if (t.type !== type || value !== void 0 && "value" in t && t.value !== value) {
      this.errors.push({
        message: `Expected ${value ?? type}, got ${"value" in t ? t.value : t.type}`,
        loc: t.loc
      });
      return null;
    }
    return this.consume();
  }
  createTypeContext() {
    const self = this;
    return {
      tokens: this.tokens,
      get pos() {
        return self.pos;
      },
      set pos(v) {
        self.pos = v;
      },
      parseExpression: () => this.parseExpression(),
      loc: () => this.loc(),
      mergeLoc: (loc) => this.mergeLoc(loc)
    };
  }
  parseTypeInContext() {
    const ctx = this.createTypeContext();
    const result = parseType(ctx);
    return result;
  }
  parseReturnTypeInContext() {
    const ctx = this.createTypeContext();
    const result = parseReturnType(ctx);
    return result;
  }
  parseGenericTypeListWithDefaultsInContext() {
    const ctx = this.createTypeContext();
    const result = parseGenericTypeListWithDefaults(ctx);
    return result;
  }
  parseStatementOrLast() {
    if (this.check("Keyword", "return")) return this.parseReturn();
    if (this.check("Keyword", "break")) return this.parseBreak();
    if (this.check("Identifier", "continue") && this.isContinueStatement()) return this.parseContinue();
    if (this.check("Keyword", "local")) return this.parseLocalOrLocalFunction();
    if (this.check("Keyword", "do")) return this.parseDo();
    if (this.check("Keyword", "while")) return this.parseWhile();
    if (this.check("Keyword", "repeat")) return this.parseRepeat();
    if (this.check("Keyword", "if")) return this.parseIf();
    if (this.check("Keyword", "for")) return this.parseFor();
    if (this.check("Punctuator", "@")) {
      const start = this.loc();
      const attrs = this.parseAttributes();
      if (this.check("Keyword", "function")) return this.parseFunction(attrs);
      if (this.check("Keyword", "local") && this.tokens[this.pos + 1]?.type === "Keyword" && this.tokens[this.pos + 1].value === "function") {
        this.consume();
        return this.parseLocalFunctionWithAttrs(attrs, start);
      }
      this.errors.push({ message: "Attributes must precede 'function' or 'local function'", loc: this.loc() });
      this.skipUnknownStatement();
      return null;
    }
    if (this.check("Keyword", "function")) return this.parseFunction();
    if (this.check("Identifier") && this.peek().value === "type") {
      const next = this.tokens[this.pos + 1];
      if (next && (next.type === "Identifier" || next.type === "Keyword" && next.value === "function")) {
        return this.parseTypeOrTypeFunction();
      }
    }
    if (this.check("Keyword", "export")) return this.parseExportOrTypeStatement();
    if (!this.check("Identifier") && !this.check("Punctuator", "(")) {
      this.errors.push({ message: `Unexpected ${this.peek().type}`, loc: this.loc() });
      this.consume();
      return null;
    }
    const prefix = this.parsePrefixExp();
    if (!prefix) return null;
    if (this.check("Punctuator", ",") || this.check("Punctuator", "=")) {
      return this.parseAssignment(prefix);
    }
    const op = this.peek();
    if (op.type === "Punctuator" && COMPOUND_OPS.has(op.value)) {
      return this.parseCompoundAssignment(prefix);
    }
    if (this.isCall(prefix)) {
      return { type: "FunctionCallStatement", call: prefix, loc: prefix.loc };
    }
    this.errors.push({ message: "Expected statement", loc: prefix.loc });
    this.consume();
    return null;
  }
  parseTypeOrTypeFunction() {
    const start = this.loc();
    this.consume();
    if (this.check("Keyword", "function")) {
      this.consume();
      const nameTok = this.expect("Identifier");
      if (!nameTok) return null;
      const fn = this.parseFunctionBody();
      if (!fn) return null;
      return {
        type: "TypeFunctionStatement",
        name: nameTok.value,
        generics: fn.generics,
        params: fn.params,
        returnType: fn.returnType,
        body: fn.body,
        loc: this.mergeLoc(start)
      };
    }
    return this.parseTypeStatement(start);
  }
  parseTypeStatement(start) {
    const loc = start ?? this.loc();
    const nameTok = this.expect("Identifier");
    if (!nameTok) return null;
    const name = nameTok.value;
    let generics;
    const gen = this.parseGenericTypeListWithDefaultsInContext();
    if (gen) generics = gen;
    if (!this.expect("Punctuator", "=")) return null;
    const value = this.parseTypeInContext();
    if (!value) return null;
    return { type: "TypeStatement", name, generics, value, loc: this.mergeLoc(loc) };
  }
  parseExportOrTypeStatement() {
    const start = this.loc();
    this.consume();
    if (!(this.check("Identifier") && this.peek().value === "type")) {
      this.skipUnknownStatement();
      return null;
    }
    this.consume();
    if (this.check("Keyword", "function")) {
      this.consume();
      const nameTok2 = this.expect("Identifier");
      if (!nameTok2) return null;
      const fn = this.parseFunctionBody();
      if (!fn) return null;
      return {
        type: "ExportTypeFunctionStatement",
        name: nameTok2.value,
        generics: fn.generics,
        params: fn.params,
        returnType: fn.returnType,
        body: fn.body,
        loc: this.mergeLoc(start)
      };
    }
    const nameTok = this.expect("Identifier");
    if (!nameTok) return null;
    const name = nameTok.value;
    let generics;
    const gen = this.parseGenericTypeListWithDefaultsInContext();
    if (gen) generics = gen;
    if (!this.expect("Punctuator", "=")) return null;
    const value = this.parseTypeInContext();
    if (!value) return null;
    return { type: "ExportTypeStatement", name, generics, value, loc: this.mergeLoc(start) };
  }
  skipUnknownStatement() {
    this.consume();
    const nextStmtKeywords = ["local", "function", "do", "while", "repeat", "if", "for", "return", "break", "export"];
    while (!this.isEOF()) {
      const t = this.peek();
      if (t.type === "EOF") break;
      if (t.type === "Keyword" && nextStmtKeywords.includes(t.value)) break;
      if (t.type === "Identifier" && (t.value === "continue" || t.value === "type")) break;
      this.consume();
    }
  }
  isContinueStatement() {
    const next = this.tokens[this.pos + 1];
    if (!next) return true;
    if (next.type === "Punctuator") {
      const v = next.value;
      return !["(", ".", "[", ":", "{", "=", ","].includes(v);
    }
    if (next.type === "String") return false;
    return true;
  }
  parseReturn() {
    const start = this.loc();
    this.consume();
    const values = this.parseExpList();
    return { type: "ReturnStatement", values: values.length ? values : void 0, loc: this.mergeLoc(start) };
  }
  parseBreak() {
    const loc = this.loc();
    this.consume();
    return { type: "BreakStatement", loc: this.mergeLoc(loc) };
  }
  parseContinue() {
    const loc = this.loc();
    this.consume();
    return { type: "ContinueStatement", loc: this.mergeLoc(loc) };
  }
  parseBinding() {
    const id = this.expect("Identifier");
    if (!id) return null;
    const name = id.value;
    let type;
    if (this.check("Punctuator", ":")) {
      this.consume();
      type = this.parseTypeInContext() ?? void 0;
    }
    return { name, type };
  }
  parseLocalOrLocalFunction() {
    const start = this.loc();
    this.consume();
    if (this.check("Keyword", "function")) {
      this.consume();
      const name = this.expect("Identifier");
      if (!name) return null;
      const fn = this.parseFunctionBody();
      if (!fn) return null;
      return {
        type: "LocalFunctionStatement",
        name: name.value,
        generics: fn.generics,
        params: fn.params,
        returnType: fn.returnType,
        body: fn.body,
        loc: this.mergeLoc(start)
      };
    }
    const vars = [];
    do {
      const binding = this.parseBinding();
      if (!binding) return null;
      vars.push(binding);
      if (!this.check("Punctuator", ",")) break;
      this.consume();
    } while (true);
    let values;
    if (this.check("Punctuator", "=")) {
      this.consume();
      values = this.parseExpList();
    }
    return { type: "LocalStatement", vars, values, loc: this.mergeLoc(start) };
  }
  parseLocalFunctionWithAttrs(attrs, start) {
    this.consume();
    const name = this.expect("Identifier");
    if (!name) return null;
    const fn = this.parseFunctionBody();
    if (!fn) return null;
    return {
      type: "LocalFunctionStatement",
      name: name.value,
      attributes: attrs.length ? attrs : void 0,
      generics: fn.generics,
      params: fn.params,
      returnType: fn.returnType,
      body: fn.body,
      loc: this.mergeLoc(start)
    };
  }
  parseAttributes() {
    const attrs = [];
    while (this.check("Punctuator", "@")) {
      this.consume();
      if (this.check("Punctuator", "[")) {
        this.consume();
        do {
          const nameTok = this.expect("Identifier");
          if (!nameTok) break;
          const attr = { name: nameTok.value };
          if (this.check("Punctuator", "(")) {
            this.consume();
            const args2 = [];
            while (!this.check("Punctuator", ")")) {
              const t = this.peek();
              if (t.type === "Number") {
                this.consume();
                const v = t.value;
                args2.push(v.includes(".") ? parseFloat(v) : parseInt(v, 10));
              } else if (t.type === "String") {
                this.consume();
                args2.push(t.value);
              } else if (t.type === "Keyword" && (t.value === "true" || t.value === "false")) {
                this.consume();
                args2.push(t.value === "true");
              } else {
                break;
              }
              if (!this.check("Punctuator", ",")) break;
              this.consume();
            }
            this.expect("Punctuator", ")");
            attr.args = args2;
          }
          attrs.push(attr);
          if (!this.check("Punctuator", ",")) break;
          this.consume();
        } while (true);
        this.expect("Punctuator", "]");
      } else {
        const nameTok = this.expect("Identifier");
        if (nameTok) attrs.push({ name: nameTok.value });
      }
    }
    return attrs;
  }
  parseDo() {
    const start = this.loc();
    this.consume();
    const body = this.parseBlock();
    this.expect("Keyword", "end");
    return { type: "DoStatement", body, loc: this.mergeLoc(start) };
  }
  parseWhile() {
    const start = this.loc();
    this.consume();
    const condition = this.parseExpression();
    if (!condition) return null;
    this.expect("Keyword", "do");
    const body = this.parseBlock();
    this.expect("Keyword", "end");
    return { type: "WhileStatement", condition, body, loc: this.mergeLoc(start) };
  }
  parseRepeat() {
    const start = this.loc();
    this.consume();
    const body = this.parseBlock();
    this.expect("Keyword", "until");
    const condition = this.parseExpression();
    if (!condition) return null;
    return { type: "RepeatStatement", body, condition, loc: this.mergeLoc(start) };
  }
  parseIf() {
    const start = this.loc();
    this.consume();
    const condition = this.parseExpression();
    if (!condition) return null;
    this.expect("Keyword", "then");
    const thenBody = this.parseBlock();
    const elseifClauses = [];
    while (this.check("Keyword", "elseif")) {
      this.consume();
      const c = this.parseExpression();
      if (!c) return null;
      this.expect("Keyword", "then");
      elseifClauses.push({ condition: c, body: this.parseBlock() });
    }
    let elseBody;
    if (this.check("Keyword", "else")) {
      this.consume();
      elseBody = this.parseBlock();
    }
    this.expect("Keyword", "end");
    return { type: "IfStatement", condition, thenBody, elseifClauses, elseBody, loc: this.mergeLoc(start) };
  }
  parseFor() {
    const start = this.loc();
    this.consume();
    const first = this.expect("Identifier");
    if (!first) return null;
    if (this.check("Punctuator", "=")) {
      this.consume();
      const startExp = this.parseExpression();
      if (!startExp) return null;
      this.expect("Punctuator", ",");
      const endExp = this.parseExpression();
      if (!endExp) return null;
      let step;
      if (this.check("Punctuator", ",")) {
        this.consume();
        step = this.parseExpression() ?? void 0;
      }
      this.expect("Keyword", "do");
      const body = this.parseBlock();
      this.expect("Keyword", "end");
      return {
        type: "ForNumericStatement",
        var: { type: "Identifier", name: first.value, loc: first.loc },
        start: startExp,
        end: endExp,
        step,
        body,
        loc: this.mergeLoc(start)
      };
    }
    const vars = [
      { type: "Identifier", name: first.value, loc: first.loc }
    ];
    while (this.check("Punctuator", ",")) {
      this.consume();
      const id = this.expect("Identifier");
      if (!id) return null;
      vars.push({ type: "Identifier", name: id.value, loc: id.loc });
    }
    if (this.check("Keyword", "in")) {
      this.consume();
      const iter = this.parseExpList();
      if (!iter.length) return null;
      this.expect("Keyword", "do");
      const body = this.parseBlock();
      this.expect("Keyword", "end");
      return { type: "ForInStatement", vars, iter, body, loc: this.mergeLoc(start) };
    }
    this.errors.push({ message: "Invalid for statement", loc: this.loc() });
    return null;
  }
  parseFunction(attrs) {
    const start = this.loc();
    this.consume();
    const name = this.parseFuncName();
    if (!name) return null;
    const fn = this.parseFunctionBody();
    if (!fn) return null;
    return {
      type: "FunctionStatement",
      name,
      attributes: attrs?.length ? attrs : void 0,
      generics: fn.generics,
      params: fn.params,
      returnType: fn.returnType,
      body: fn.body,
      loc: this.mergeLoc(start)
    };
  }
  parseFuncName() {
    const base = this.parseFuncNamePart();
    if (!base) return null;
    let method;
    if (this.check("Punctuator", ":")) {
      this.consume();
      const m = this.expect("Identifier");
      if (!m) return null;
      method = m.value;
    }
    return { type: "FuncName", base, method, loc: base.loc };
  }
  parseFuncNamePart() {
    const id = this.expect("Identifier");
    if (!id) return null;
    let obj = { type: "Identifier", name: id.value, loc: id.loc };
    while (this.check("Punctuator", ".")) {
      this.consume();
      const prop = this.expect("Identifier");
      if (!prop) return null;
      obj = { type: "MemberExpression", object: obj, property: prop.value, loc: this.mergeLoc(obj.loc) };
    }
    return obj;
  }
  parseFunctionGenerics() {
    if (!this.check("Punctuator", "<")) return void 0;
    this.consume();
    const generics = [];
    while (true) {
      const t = this.peek();
      if (t.type === "Identifier") {
        generics.push(t.value);
        this.consume();
        if (this.check("Punctuator", "...")) this.consume();
      } else if (t.type === "Punctuator" && t.value === ">") {
        break;
      } else {
        break;
      }
      if (!this.check("Punctuator", ",")) break;
      this.consume();
    }
    if (!this.expect("Punctuator", ">")) return void 0;
    return generics.length ? generics : void 0;
  }
  parseFunctionBody() {
    const generics = this.parseFunctionGenerics();
    this.expect("Punctuator", "(");
    const params = [];
    if (!this.check("Punctuator", ")")) {
      if (this.check("Punctuator", "...")) {
        this.consume();
        let varargType;
        if (this.check("Punctuator", ":")) {
          this.consume();
          varargType = this.parseTypeInContext() ?? void 0;
        }
        params.push({
          type: "Param",
          name: "...",
          typeAnnotation: varargType,
          variadic: true,
          loc: this.loc()
        });
      } else {
        do {
          const binding = this.parseBinding();
          if (!binding) return null;
          params.push({
            type: "Param",
            name: binding.name,
            typeAnnotation: binding.type,
            loc: this.loc()
          });
          if (!this.check("Punctuator", ",")) break;
          this.consume();
          if (this.check("Punctuator", "...")) {
            this.consume();
            let varargType;
            if (this.check("Punctuator", ":")) {
              this.consume();
              varargType = this.parseTypeInContext() ?? void 0;
            }
            params.push({
              type: "Param",
              name: "...",
              typeAnnotation: varargType,
              variadic: true,
              loc: this.loc()
            });
            break;
          }
        } while (true);
      }
    }
    this.expect("Punctuator", ")");
    let returnType;
    if (this.check("Punctuator", ":")) {
      this.consume();
      returnType = this.parseReturnTypeInContext() ?? void 0;
    }
    const body = this.parseBlock();
    this.expect("Keyword", "end");
    return { generics, params, returnType, body };
  }
  parseAssignment(prefix) {
    const vars = [prefix];
    while (this.check("Punctuator", ",")) {
      this.consume();
      const v = this.parsePrefixExp();
      if (!v) return null;
      vars.push(v);
    }
    if (!this.check("Punctuator", "=")) {
      this.errors.push({ message: "Expected '=' in assignment", loc: this.loc() });
      return null;
    }
    this.consume();
    const values = this.parseExpList();
    return { type: "AssignmentStatement", vars, values, loc: this.mergeLoc(prefix.loc) };
  }
  parseCompoundAssignment(prefix) {
    const op = this.consume();
    const value = this.parseExpression();
    if (!value) return null;
    return {
      type: "CompoundAssignmentStatement",
      var: prefix,
      operator: op.value,
      value,
      loc: this.mergeLoc(prefix.loc)
    };
  }
  parseBlock() {
    const body = [];
    while (!this.isEOF()) {
      const _bt = this.peek();
      if (_bt.type === "Keyword" && BLOCK_END_KEYWORDS.has(_bt.value)) break;
      if (this.check("Punctuator", ";")) {
        this.consume();
        continue;
      }
      const stmt = this.parseStatementOrLast();
      if (stmt) {
        body.push(stmt);
        if (stmt.type === "ReturnStatement" || stmt.type === "BreakStatement" || stmt.type === "ContinueStatement") {
          if (this.check("Punctuator", ";")) this.consume();
          break;
        }
      }
    }
    return body;
  }
  parsePrefixExp() {
    const t = this.peek();
    if (t.type === "Identifier") {
      return this.parsePrefixExpAfterIdentifier();
    }
    if (t.type === "Punctuator" && t.value === "(") {
      this.consume();
      const exp = this.parseExpression();
      if (!exp) return null;
      this.expect("Punctuator", ")");
      return this.parseSuffixExp({ type: "ParenExpression", expression: exp, loc: this.mergeLoc(exp.loc) });
    }
    return null;
  }
  parsePrefixExpAfterIdentifier() {
    const id = this.consume();
    const base = { type: "Identifier", name: id.value, loc: id.loc };
    return this.parseSuffixExp(base);
  }
  parseSuffixExp(base) {
    while (true) {
      const t = this.peek();
      if (t.type === "Punctuator") {
        if (t.value === "(") {
          this.consume();
          const args2 = this.parseExpList();
          this.expect("Punctuator", ")");
          base = { type: "CallExpression", callee: base, args: args2, loc: this.mergeLoc(base.loc) };
          continue;
        }
        if (t.value === "{") {
          const table = this.parseTableConstructor();
          if (!table) return null;
          base = { type: "CallExpression", callee: base, args: [table], loc: this.mergeLoc(base.loc) };
          continue;
        }
        if (t.value === "[") {
          this.consume();
          const index = this.parseExpression();
          if (!index) return null;
          this.expect("Punctuator", "]");
          base = { type: "IndexExpression", object: base, index, loc: this.mergeLoc(base.loc) };
          continue;
        }
        if (t.value === ".") {
          this.consume();
          const prop = this.expect("Identifier");
          if (!prop) return null;
          base = { type: "MemberExpression", object: base, property: prop.value, loc: this.mergeLoc(base.loc) };
          continue;
        }
        if (t.value === ":") {
          this.consume();
          const method = this.expect("Identifier");
          if (!method) return null;
          const nextT = this.peek();
          if (nextT.type === "String") {
            this.consume();
            base = { type: "MethodCallExpression", object: base, method: method.value, args: [{ type: "StringLiteral", value: nextT.value, loc: nextT.loc }], loc: this.mergeLoc(base.loc) };
          } else if (nextT.type === "Punctuator" && nextT.value === "{") {
            const table = this.parseTableConstructor();
            if (!table) return null;
            base = { type: "MethodCallExpression", object: base, method: method.value, args: [table], loc: this.mergeLoc(base.loc) };
          } else {
            this.expect("Punctuator", "(");
            const args2 = this.parseExpList();
            this.expect("Punctuator", ")");
            base = { type: "MethodCallExpression", object: base, method: method.value, args: args2, loc: this.mergeLoc(base.loc) };
          }
          continue;
        }
      }
      if (t.type === "String") {
        this.consume();
        base = { type: "CallExpression", callee: base, args: [{ type: "StringLiteral", value: t.value, loc: t.loc }], loc: this.mergeLoc(base.loc) };
        continue;
      }
      break;
    }
    return base;
  }
  isCall(exp) {
    return exp.type === "CallExpression" || exp.type === "MethodCallExpression";
  }
  parseExpression(prec = 0) {
    let left = null;
    const t = this.peek();
    if (t.type === "Punctuator" && t.value === "-") {
      const op = this.consume();
      const arg = this.parseExpression(6);
      if (!arg) return null;
      left = { type: "UnaryExpression", operator: "-", argument: arg, loc: this.mergeLoc(arg.loc) };
    } else if (t.type === "Keyword" && t.value === "not") {
      this.consume();
      const arg = this.parseExpression(6);
      if (!arg) return null;
      left = { type: "UnaryExpression", operator: "not", argument: arg, loc: this.mergeLoc(arg.loc) };
    } else if (t.type === "Punctuator" && t.value === "#") {
      this.consume();
      const arg = this.parseExpression(6);
      if (!arg) return null;
      left = { type: "UnaryExpression", operator: "#", argument: arg, loc: this.mergeLoc(arg.loc) };
    } else {
      left = this.parseAsexp();
    }
    if (!left) return null;
    while (true) {
      const op = this.peek();
      if (op.type !== "Punctuator" && op.type !== "Keyword") break;
      const opStr = op.value;
      const p = BINARY_PRECEDENCE[opStr];
      if (p === void 0 || p <= prec) break;
      const isRightAssoc = opStr === "^" || opStr === "..";
      this.consume();
      const right = this.parseExpression(isRightAssoc ? p - 1 : p);
      if (!right) return null;
      left = { type: "BinaryExpression", operator: opStr, left, right, loc: this.mergeLoc(left.loc) };
    }
    return left;
  }
  parseAsexp() {
    const exp = this.parseSimpleExp();
    if (!exp) return null;
    if (this.check("Punctuator", "::")) {
      this.consume();
      const assertedType = this.parseTypeInContext();
      if (!assertedType) return exp;
      return {
        type: "TypeAssertion",
        expression: exp,
        assertedType,
        loc: this.mergeLoc(exp.loc)
      };
    }
    return exp;
  }
  parseSimpleExp() {
    const t = this.peek();
    if (t.type === "Keyword") {
      const v = t.value;
      if (v === "nil") {
        this.consume();
        return { type: "NilLiteral", loc: t.loc };
      }
      if (v === "true" || v === "false") {
        this.consume();
        return { type: "BooleanLiteral", value: v === "true", loc: t.loc };
      }
    }
    if (t.type === "Number") {
      this.consume();
      return { type: "NumberLiteral", value: t.value, raw: t.raw, loc: t.loc };
    }
    if (t.type === "String") {
      this.consume();
      return { type: "StringLiteral", value: t.value, loc: t.loc };
    }
    if (t.type === "InterpPart") {
      return this.parseStringInterpolation();
    }
    if (t.type === "Punctuator" && t.value === "...") {
      this.consume();
      return { type: "VarargExpression", loc: t.loc };
    }
    if (t.type === "Punctuator" && t.value === "{") {
      return this.parseTableConstructor();
    }
    if (t.type === "Punctuator" && t.value === "@") {
      const attrs = this.parseAttributes();
      if (this.check("Keyword", "function")) {
        return this.parseFunctionExpression(attrs);
      }
      this.errors.push({ message: "Attributes must precede 'function'", loc: this.loc() });
      return null;
    }
    if (t.type === "Keyword" && t.value === "function") {
      return this.parseFunctionExpression();
    }
    if (t.type === "Keyword" && t.value === "if") {
      return this.parseIfElseExpression();
    }
    if (t.type === "Punctuator" && t.value === "(") {
      this.consume();
      const exp = this.parseExpression();
      if (!exp) return null;
      this.expect("Punctuator", ")");
      const paren = { type: "ParenExpression", expression: exp, loc: this.mergeLoc(exp.loc) };
      return this.parseSuffixExp(paren);
    }
    if (t.type === "Identifier") {
      return this.parsePrefixExp();
    }
    return null;
  }
  parseIfElseExpression() {
    const start = this.loc();
    this.consume();
    const condition = this.parseExpression();
    if (!condition) return null;
    this.expect("Keyword", "then");
    const thenExp = this.parseExpression();
    if (!thenExp) return null;
    const elseifClauses = [];
    while (this.check("Keyword", "elseif")) {
      this.consume();
      const c = this.parseExpression();
      if (!c) return null;
      this.expect("Keyword", "then");
      const v = this.parseExpression();
      if (!v) return null;
      elseifClauses.push({ condition: c, value: v });
    }
    this.expect("Keyword", "else");
    const elseExp = this.parseExpression();
    if (!elseExp) return null;
    return {
      type: "IfElseExpression",
      condition,
      thenExp,
      elseifClauses,
      elseExp,
      loc: this.mergeLoc(start)
    };
  }
  parseStringInterpolation() {
    const start = this.loc();
    const parts = [];
    const first = this.peek();
    if (first.type !== "InterpPart") return null;
    this.consume();
    parts.push(first.value);
    while (this.check("Punctuator", "{")) {
      this.consume();
      const exp = this.parseExpression();
      if (!exp) return null;
      parts.push(exp);
      if (!this.expect("Punctuator", "}")) return null;
      if (this.check("InterpPart")) {
        const part = this.consume();
        parts.push(part.value);
      }
    }
    return {
      type: "StringInterpolation",
      parts,
      loc: this.mergeLoc(start)
    };
  }
  parseTableConstructor() {
    const start = this.loc();
    this.consume();
    const fields = [];
    while (!this.check("Punctuator", "}")) {
      if (this.check("Punctuator", ",") || this.check("Punctuator", ";")) {
        this.consume();
        continue;
      }
      if (this.check("Punctuator", "[")) {
        this.consume();
        const index = this.parseExpression();
        if (!index) return null;
        this.expect("Punctuator", "]");
        this.expect("Punctuator", "=");
        const value = this.parseExpression();
        if (!value) return null;
        fields.push({ kind: "index", index, value });
      } else if (this.check("Identifier") && this.tokens[this.pos + 1]?.type === "Punctuator" && this.tokens[this.pos + 1].value === "=") {
        const id = this.consume();
        this.consume();
        const value = this.parseExpression();
        if (!value) return null;
        fields.push({ kind: "named", name: id.value, value });
      } else {
        const value = this.parseExpression();
        if (!value) return null;
        fields.push({ kind: "value", value });
      }
      if (this.check("Punctuator", ",") || this.check("Punctuator", ";")) this.consume();
    }
    this.expect("Punctuator", "}");
    return { type: "TableConstructor", fields, loc: this.mergeLoc(start) };
  }
  parseFunctionExpression(attrs) {
    const start = this.loc();
    this.consume();
    const fn = this.parseFunctionBody();
    if (!fn) return null;
    return {
      type: "FunctionExpression",
      attributes: attrs?.length ? attrs : void 0,
      generics: fn.generics,
      params: fn.params,
      returnType: fn.returnType,
      body: fn.body,
      loc: this.mergeLoc(start)
    };
  }
  parseExpList() {
    const list = [];
    const exp = this.parseExpression();
    if (!exp) return list;
    list.push(exp);
    while (this.check("Punctuator", ",")) {
      this.consume();
      const e = this.parseExpression();
      if (!e) break;
      list.push(e);
    }
    return list;
  }
  mergeLoc(loc) {
    const end = this.loc().end;
    return { start: loc.start, end };
  }
};
function parse(tokens2) {
  return new Parser(tokens2).parse();
}

// src/obfuscator/Obfuscator.ts
var KEYWORDS2 = /* @__PURE__ */ new Set([
  "and",
  "break",
  "continue",
  "do",
  "else",
  "elseif",
  "end",
  "export",
  "false",
  "for",
  "function",
  "if",
  "in",
  "local",
  "nil",
  "not",
  "or",
  "repeat",
  "return",
  "then",
  "true",
  "until",
  "while"
]);
var PRESERVED_GLOBALS = /* @__PURE__ */ new Set([
  "_G",
  "game",
  "workspace",
  "script",
  "Players",
  "Instance",
  "Vector3",
  "Vector2",
  "CFrame",
  "Color3",
  "UDim2",
  "UDim",
  "Ray",
  "BrickColor",
  "Enum",
  "math",
  "string",
  "table",
  "typeof",
  "pairs",
  "ipairs",
  "next",
  "print",
  "warn",
  "error",
  "assert",
  "tick",
  "wait",
  "spawn",
  "getfenv",
  "setfenv",
  "newproxy",
  "rawequal",
  "rawget",
  "rawset",
  "select",
  "tonumber",
  "tostring",
  "type",
  "unpack",
  "xpcall",
  "loadstring",
  "load",
  "bit32"
]);
function isValidIdentifier(name) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) && !KEYWORDS2.has(name);
}
function generateName(index) {
  if (index < 26) return String.fromCharCode(97 + index);
  let s = "";
  let n = index;
  while (n >= 0) {
    s = String.fromCharCode(97 + n % 26) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}
var DEFAULT_OPTIONS = {
  renameLocals: true,
  preserveGlobals: true,
  seed: 0
};
function obfuscate(ast2, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (!opts.renameLocals) return ast2;
  const scope = new ScopeManager(opts);
  return transformChunk(ast2, scope);
}
var ScopeManager = class {
  flat = /* @__PURE__ */ new Map();
  undoStack = [[]];
  nameCounter = 0;
  opts;
  constructor(opts) {
    this.opts = opts;
  }
  pushScope() {
    this.undoStack.push([]);
  }
  popScope() {
    const undo = this.undoStack.pop();
    for (let i = undo.length - 1; i >= 0; i--) {
      const entry = undo[i];
      if (entry.prev === void 0) {
        this.flat.delete(entry.name);
      } else {
        this.flat.set(entry.name, entry.prev);
      }
    }
  }
  declare(name) {
    if (!isValidIdentifier(name)) return name;
    if (this.opts.preserveGlobals && PRESERVED_GLOBALS.has(name)) return name;
    let newName;
    do {
      newName = generateName(this.nameCounter++);
    } while (KEYWORDS2.has(newName));
    const prev = this.flat.get(name);
    this.undoStack[this.undoStack.length - 1].push({ name, prev });
    this.flat.set(name, newName);
    return newName;
  }
  resolve(name) {
    if (!isValidIdentifier(name)) return name;
    if (this.opts.preserveGlobals && PRESERVED_GLOBALS.has(name)) return name;
    return this.flat.get(name) ?? name;
  }
};
function transformChunk(chunk2, scope) {
  return {
    ...chunk2,
    body: chunk2.body.map((s) => transformStatement(s, scope))
  };
}
function transformStatement(stmt, scope) {
  switch (stmt.type) {
    case "LocalStatement": {
      const values = stmt.values?.map((e) => transformExpression(e, scope));
      const vars = stmt.vars.map((v) => ({
        ...v,
        name: scope.declare(v.name)
      }));
      return { ...stmt, vars, values };
    }
    case "LocalFunctionStatement": {
      const name = scope.declare(stmt.name);
      scope.pushScope();
      const params = stmt.params.map((p) => ({
        ...p,
        name: p.variadic ? "..." : scope.declare(p.name)
      }));
      const body = stmt.body.map((s) => transformStatement(s, scope));
      scope.popScope();
      return { ...stmt, name, params, body };
    }
    case "FunctionStatement": {
      const name = transformFuncName(stmt.name, scope);
      scope.pushScope();
      const params = stmt.params.map((p) => ({
        ...p,
        name: p.variadic ? "..." : scope.declare(p.name)
      }));
      const body = stmt.body.map((s) => transformStatement(s, scope));
      scope.popScope();
      return { ...stmt, name, params, body };
    }
    case "ForNumericStatement": {
      scope.pushScope();
      const v = scope.declare(stmt.var.name);
      const varNode = { type: "Identifier", name: v, loc: stmt.var.loc };
      const body = stmt.body.map((s) => transformStatement(s, scope));
      scope.popScope();
      return {
        ...stmt,
        var: varNode,
        start: transformExpression(stmt.start, scope),
        end: transformExpression(stmt.end, scope),
        step: stmt.step ? transformExpression(stmt.step, scope) : void 0,
        body
      };
    }
    case "ForInStatement": {
      scope.pushScope();
      const vars = stmt.vars.map((v) => ({
        ...v,
        name: scope.declare(v.name)
      }));
      const body = stmt.body.map((s) => transformStatement(s, scope));
      scope.popScope();
      return {
        ...stmt,
        vars,
        iter: stmt.iter.map((e) => transformExpression(e, scope)),
        body
      };
    }
    case "TypeFunctionStatement":
    case "ExportTypeFunctionStatement": {
      scope.pushScope();
      const params = stmt.params.map((p) => ({
        ...p,
        name: p.variadic ? "..." : scope.declare(p.name)
      }));
      const body = stmt.body.map((s) => transformStatement(s, scope));
      scope.popScope();
      return { ...stmt, params, body };
    }
    case "DoStatement":
      scope.pushScope();
      const doBody = stmt.body.map((s) => transformStatement(s, scope));
      scope.popScope();
      return { ...stmt, body: doBody };
    case "WhileStatement":
      scope.pushScope();
      const whileBody = stmt.body.map((s) => transformStatement(s, scope));
      scope.popScope();
      return {
        ...stmt,
        condition: transformExpression(stmt.condition, scope),
        body: whileBody
      };
    case "RepeatStatement":
      scope.pushScope();
      const repeatBody = stmt.body.map((s) => transformStatement(s, scope));
      scope.popScope();
      return {
        ...stmt,
        body: repeatBody,
        condition: transformExpression(stmt.condition, scope)
      };
    case "IfStatement":
      scope.pushScope();
      const thenBody = stmt.thenBody.map((s) => transformStatement(s, scope));
      const elseifClauses = stmt.elseifClauses.map((c) => ({
        condition: transformExpression(c.condition, scope),
        body: c.body.map((s) => transformStatement(s, scope))
      }));
      const elseBody = stmt.elseBody?.map((s) => transformStatement(s, scope));
      scope.popScope();
      return {
        ...stmt,
        condition: transformExpression(stmt.condition, scope),
        thenBody,
        elseifClauses,
        elseBody
      };
    case "AssignmentStatement":
      return {
        ...stmt,
        vars: stmt.vars.map((v) => transformVar(v, scope)),
        values: stmt.values.map((e) => transformExpression(e, scope))
      };
    case "CompoundAssignmentStatement":
      return {
        ...stmt,
        var: transformVar(stmt.var, scope),
        value: transformExpression(stmt.value, scope)
      };
    case "FunctionCallStatement":
      return {
        ...stmt,
        call: transformExpression(stmt.call, scope)
      };
    case "ReturnStatement":
      return {
        ...stmt,
        values: stmt.values?.map((e) => transformExpression(e, scope))
      };
    default:
      return stmt;
  }
}
function transformFuncName(fn, scope) {
  const base = fn.base.type === "Identifier" ? { ...fn.base, name: scope.resolve(fn.base.name) } : transformExpression(fn.base, scope);
  return { ...fn, base };
}
function transformVar(v, scope) {
  switch (v.type) {
    case "Identifier":
      return { ...v, name: scope.resolve(v.name) };
    case "IndexExpression":
      return {
        ...v,
        object: transformExpression(v.object, scope),
        index: transformExpression(v.index, scope)
      };
    case "MemberExpression":
      return {
        ...v,
        object: transformExpression(v.object, scope)
      };
    default:
      return v;
  }
}
function transformExpression(exp, scope) {
  switch (exp.type) {
    case "Identifier":
      return { ...exp, name: scope.resolve(exp.name) };
    case "BinaryExpression":
      return {
        ...exp,
        left: transformExpression(exp.left, scope),
        right: transformExpression(exp.right, scope)
      };
    case "UnaryExpression":
      return {
        ...exp,
        argument: transformExpression(exp.argument, scope)
      };
    case "CallExpression":
      return {
        ...exp,
        callee: transformExpression(exp.callee, scope),
        args: exp.args.map((a) => transformExpression(a, scope))
      };
    case "MethodCallExpression":
      return {
        ...exp,
        object: transformExpression(exp.object, scope),
        args: exp.args.map((a) => transformExpression(a, scope))
      };
    case "IndexExpression":
      return {
        ...exp,
        object: transformExpression(exp.object, scope),
        index: transformExpression(exp.index, scope)
      };
    case "MemberExpression":
      return {
        ...exp,
        object: transformExpression(exp.object, scope)
      };
    case "TableConstructor":
      return {
        ...exp,
        fields: exp.fields.map((f) => {
          if (f.kind === "index") return { ...f, index: transformExpression(f.index, scope), value: transformExpression(f.value, scope) };
          if (f.kind === "named") return { ...f, value: transformExpression(f.value, scope) };
          return { ...f, value: transformExpression(f.value, scope) };
        })
      };
    case "FunctionExpression": {
      scope.pushScope();
      const params = exp.params.map((p) => ({
        ...p,
        name: p.variadic ? "..." : scope.declare(p.name)
      }));
      const body = exp.body.map((s) => transformStatement(s, scope));
      scope.popScope();
      return { ...exp, params, body };
    }
    case "ParenExpression":
      return { ...exp, expression: transformExpression(exp.expression, scope) };
    case "TypeAssertion":
      return {
        ...exp,
        expression: transformExpression(exp.expression, scope)
      };
    case "IfElseExpression":
      return {
        ...exp,
        condition: transformExpression(exp.condition, scope),
        thenExp: transformExpression(exp.thenExp, scope),
        elseifClauses: exp.elseifClauses.map((c) => ({
          condition: transformExpression(c.condition, scope),
          value: transformExpression(c.value, scope)
        })),
        elseExp: transformExpression(exp.elseExp, scope)
      };
    case "StringInterpolation":
      return {
        ...exp,
        parts: exp.parts.map((p) => typeof p === "string" ? p : transformExpression(p, scope))
      };
    default:
      return exp;
  }
}

// src/vm/bytecode.ts
var RK_OFFSET = 256;
function RK(kIndex) {
  return kIndex + RK_OFFSET;
}
var REG_OPCODE_COUNT = 57;
function regEmit(chunk2, op, A = 0, B = 0, C = 0) {
  const pos = chunk2.code.length;
  chunk2.code.push(op, A, B, C);
  chunk2.nInstructions++;
  if (A >= 0 && A < RK_OFFSET) chunk2.maxRegs = Math.max(chunk2.maxRegs, A + 1);
  if (B >= 0 && B < RK_OFFSET) chunk2.maxRegs = Math.max(chunk2.maxRegs, B + 1);
  if (C >= 0 && C < RK_OFFSET) chunk2.maxRegs = Math.max(chunk2.maxRegs, C + 1);
  return pos;
}
function regPatch(chunk2, pos, field, value) {
  const offset = field === "op" ? 0 : field === "A" ? 1 : field === "B" ? 2 : 3;
  chunk2.code[pos + offset] = value;
}
function regPC(chunk2) {
  return chunk2.nInstructions;
}
function regAddConst(chunk2, value) {
  const i = chunk2.K.indexOf(value);
  if (i >= 0) return i;
  chunk2.K.push(value);
  return chunk2.K.length - 1;
}
function createRegChunk() {
  return {
    K: [],
    code: [],
    nInstructions: 0,
    maxRegs: 0,
    nParams: 0,
    isVararg: false
  };
}
function regAddProto(parent, proto) {
  if (!parent.protos) parent.protos = [];
  parent.protos.push(proto);
  return parent.protos.length - 1;
}

// src/vm/RegCompiler.ts
function createCtx(parent) {
  return {
    chunk: createRegChunk(),
    locals: /* @__PURE__ */ new Map(),
    nextReg: 0,
    freeReg: 0,
    loopStack: [],
    parent,
    upvalues: /* @__PURE__ */ new Map(),
    upvalueList: [],
    isVararg: false,
    nParams: 0,
    uid: 0
  };
}
function allocLocal(ctx, name) {
  const reg = ctx.nextReg++;
  ctx.locals.set(name, reg);
  if (ctx.freeReg < ctx.nextReg) ctx.freeReg = ctx.nextReg;
  ctx.chunk.maxRegs = Math.max(ctx.chunk.maxRegs, ctx.nextReg);
  return reg;
}
function allocHidden(ctx, hint) {
  return allocLocal(ctx, `\0${hint}_${ctx.uid++}`);
}
function allocTemp(ctx) {
  const reg = ctx.freeReg++;
  ctx.chunk.maxRegs = Math.max(ctx.chunk.maxRegs, ctx.freeReg);
  return reg;
}
function reserveRegs(ctx, base, n) {
  const need = base + n;
  if (ctx.freeReg < need) ctx.freeReg = need;
  ctx.chunk.maxRegs = Math.max(ctx.chunk.maxRegs, need);
}
function saveFree(ctx) {
  return ctx.freeReg;
}
function restoreFree(ctx, s) {
  ctx.freeReg = s;
}
function pushScope(ctx) {
  return { locals: new Map(ctx.locals), nextReg: ctx.nextReg, freeReg: ctx.freeReg };
}
function popScope(ctx, snap) {
  ctx.locals = snap.locals;
  ctx.nextReg = snap.nextReg;
  ctx.freeReg = snap.freeReg;
}
function pushLoop(ctx, bodyRegStart) {
  const lc = { breakPatches: [], continuePatches: [], bodyRegStart };
  ctx.loopStack.push(lc);
  return lc;
}
function popLoop(ctx) {
  const lc = ctx.loopStack.pop();
  if (lc) {
    const end = regPC(ctx.chunk);
    for (const pc of lc.breakPatches) patchJump(ctx, pc, end);
  }
}
function resolveContinues(ctx) {
  const lc = ctx.loopStack[ctx.loopStack.length - 1];
  if (lc) {
    const target = regPC(ctx.chunk);
    for (const pc of lc.continuePatches) patchJump(ctx, pc, target);
    lc.continuePatches = [];
  }
}
function currentLoop(ctx) {
  return ctx.loopStack[ctx.loopStack.length - 1];
}
function resolveUpvalue(ctx, name) {
  const existing = ctx.upvalues.get(name);
  if (existing !== void 0) return existing;
  if (!ctx.parent) return null;
  const parentLocal = ctx.parent.locals.get(name);
  if (parentLocal !== void 0) {
    const idx = ctx.upvalueList.length;
    ctx.upvalueList.push({ name, isLocal: true, index: parentLocal });
    ctx.upvalues.set(name, idx);
    return idx;
  }
  const parentUV = resolveUpvalue(ctx.parent, name);
  if (parentUV !== null) {
    const idx = ctx.upvalueList.length;
    ctx.upvalueList.push({ name, isLocal: false, index: parentUV });
    ctx.upvalues.set(name, idx);
    return idx;
  }
  return null;
}
function emitJump(ctx) {
  const pc = regPC(ctx.chunk);
  regEmit(ctx.chunk, 21 /* JMP */, 0, 0, 0);
  return pc;
}
function patchJump(ctx, jmpPC, targetPC) {
  regPatch(ctx.chunk, jmpPC * 4, "B", targetPC - jmpPC - 1);
}
function constRK(ctx, value) {
  const ki = regAddConst(ctx.chunk, value);
  if (ki < RK_OFFSET) return RK(ki);
  const tmp = allocTemp(ctx);
  regEmit(ctx.chunk, 43 /* LOADKX */, tmp);
  regEmit(ctx.chunk, 44 /* EXTRAARG */, ki, 0, 0);
  return tmp;
}
function isCallLike(e) {
  return e.type === "CallExpression" || e.type === "MethodCallExpression";
}
function hasSpread(args2) {
  if (args2.length === 0) return false;
  const last = args2[args2.length - 1];
  return isCallLike(last) || last.type === "VarargExpression";
}
function compileExpr(ctx, exp, dest) {
  if (!exp) {
    if (dest === -1) dest = allocTemp(ctx);
    regEmit(ctx.chunk, 2 /* LOADNIL */, dest, 0);
    return dest;
  }
  const c = ctx.chunk;
  switch (exp.type) {
    case "NilLiteral": {
      if (dest === -1) dest = allocTemp(ctx);
      regEmit(c, 2 /* LOADNIL */, dest, 0);
      return dest;
    }
    case "BooleanLiteral": {
      if (dest === -1) dest = allocTemp(ctx);
      regEmit(c, 3 /* LOADBOOL */, dest, exp.value ? 1 : 0, 0);
      return dest;
    }
    case "NumberLiteral": {
      if (dest === -1) dest = allocTemp(ctx);
      regEmit(c, 1 /* LOADK */, dest, regAddConst(c, Number(exp.value)));
      return dest;
    }
    case "StringLiteral": {
      if (dest === -1) dest = allocTemp(ctx);
      regEmit(c, 1 /* LOADK */, dest, regAddConst(c, exp.value));
      return dest;
    }
    case "Identifier": {
      if (exp.name === "nil") {
        if (dest === -1) dest = allocTemp(ctx);
        regEmit(c, 2 /* LOADNIL */, dest, 0);
        return dest;
      }
      if (exp.name === "true" || exp.name === "false") {
        if (dest === -1) dest = allocTemp(ctx);
        regEmit(c, 3 /* LOADBOOL */, dest, exp.name === "true" ? 1 : 0, 0);
        return dest;
      }
      const localReg = ctx.locals.get(exp.name);
      if (localReg !== void 0) {
        if (dest === -1) return localReg;
        if (dest !== localReg) regEmit(c, 4 /* MOVE */, dest, localReg);
        return dest;
      }
      const uv = resolveUpvalue(ctx, exp.name);
      if (uv !== null) {
        if (dest === -1) dest = allocTemp(ctx);
        regEmit(c, 37 /* GETUPVAL */, dest, uv);
        return dest;
      }
      if (dest === -1) dest = allocTemp(ctx);
      regEmit(c, 5 /* GETGLOBAL */, dest, regAddConst(c, exp.name));
      return dest;
    }
    case "BinaryExpression":
      return compileBinaryExpr(ctx, exp, dest);
    case "UnaryExpression": {
      if (dest === -1) dest = allocTemp(ctx);
      const s = saveFree(ctx);
      const operand = compileExpr(ctx, exp.argument, -1);
      switch (exp.operator) {
        case "not":
          regEmit(c, 18 /* NOT */, dest, operand);
          break;
        case "-":
          regEmit(c, 17 /* UNM */, dest, operand);
          break;
        case "#":
          regEmit(c, 19 /* LEN */, dest, operand);
          break;
      }
      restoreFree(ctx, s);
      return dest;
    }
    case "ParenExpression":
      return compileExpr(ctx, exp.expression, dest);
    case "TypeAssertion":
      return compileExpr(ctx, exp.expression, dest);
    case "CallExpression": {
      if (dest === -1) dest = allocTemp(ctx);
      compileCall(ctx, exp, dest, 2);
      return dest;
    }
    case "MethodCallExpression": {
      if (dest === -1) dest = allocTemp(ctx);
      compileMethodCall(ctx, exp, dest, 2);
      return dest;
    }
    case "IndexExpression": {
      if (dest === -1) dest = allocTemp(ctx);
      const s = saveFree(ctx);
      const obj = compileExpr(ctx, exp.object, -1);
      const key = compileExprRK(ctx, exp.index);
      regEmit(c, 7 /* GETTABLE */, dest, obj, key);
      restoreFree(ctx, s);
      return dest;
    }
    case "MemberExpression": {
      if (dest === -1) dest = allocTemp(ctx);
      const s = saveFree(ctx);
      const obj = compileExpr(ctx, exp.object, -1);
      const key = constRK(ctx, exp.property);
      regEmit(c, 7 /* GETTABLE */, dest, obj, key);
      restoreFree(ctx, s);
      return dest;
    }
    case "TableConstructor":
      return compileTableCtor(ctx, exp.fields, dest);
    case "VarargExpression": {
      if (dest === -1) dest = allocTemp(ctx);
      regEmit(c, 35 /* VARARG */, dest, 2);
      return dest;
    }
    case "StringInterpolation":
      return compileStringInterp(ctx, exp.parts, dest);
    case "FunctionExpression": {
      if (dest === -1) dest = allocTemp(ctx);
      const protoIdx = compileFunctionBody(ctx, exp.params, exp.body);
      regEmit(c, 34 /* CLOSURE */, dest, protoIdx);
      return dest;
    }
    case "IfElseExpression":
      return compileIfElseExpr(ctx, exp, dest);
    default: {
      if (dest === -1) dest = allocTemp(ctx);
      regEmit(c, 2 /* LOADNIL */, dest, 0);
      return dest;
    }
  }
}
function compileBinaryExpr(ctx, exp, dest) {
  if (dest === -1) dest = allocTemp(ctx);
  const c = ctx.chunk;
  if (exp.operator === "and") {
    const s = saveFree(ctx);
    compileExpr(ctx, exp.left, dest);
    regEmit(c, 25 /* TEST */, dest, 0, 0);
    const skip = emitJump(ctx);
    compileExpr(ctx, exp.right, dest);
    patchJump(ctx, skip, regPC(c));
    restoreFree(ctx, s);
    return dest;
  }
  if (exp.operator === "or") {
    const s = saveFree(ctx);
    compileExpr(ctx, exp.left, dest);
    regEmit(c, 25 /* TEST */, dest, 0, 1);
    const skip = emitJump(ctx);
    compileExpr(ctx, exp.right, dest);
    patchJump(ctx, skip, regPC(c));
    restoreFree(ctx, s);
    return dest;
  }
  if (["==", "~=", "<", "<=", ">", ">="].includes(exp.operator)) {
    return compileComparison(ctx, exp, dest);
  }
  if (exp.operator === "..") {
    const s = saveFree(ctx);
    const regs = collectConcatChain(ctx, exp);
    regEmit(c, 20 /* CONCAT */, dest, regs[0], regs[regs.length - 1]);
    restoreFree(ctx, s);
    return dest;
  }
  const arithOps = {
    "+": 10 /* ADD */,
    "-": 11 /* SUB */,
    "*": 12 /* MUL */,
    "/": 13 /* DIV */,
    "%": 14 /* MOD */,
    "^": 15 /* POW */,
    "//": 16 /* IDIV */
  };
  const op = arithOps[exp.operator];
  if (op !== void 0) {
    const s = saveFree(ctx);
    const rb = compileExprRK(ctx, exp.left);
    const rc = compileExprRK(ctx, exp.right);
    regEmit(c, op, dest, rb, rc);
    restoreFree(ctx, s);
    return dest;
  }
  regEmit(c, 2 /* LOADNIL */, dest, 0);
  return dest;
}
function compileComparison(ctx, exp, dest) {
  const c = ctx.chunk;
  const s = saveFree(ctx);
  const rb = compileExprRK(ctx, exp.left);
  const rc = compileExprRK(ctx, exp.right);
  let cmpOp;
  let invertA;
  let swapped = false;
  switch (exp.operator) {
    case "==":
      cmpOp = 22 /* EQ */;
      invertA = 0;
      break;
    case "~=":
      cmpOp = 22 /* EQ */;
      invertA = 1;
      break;
    case "<":
      cmpOp = 23 /* LT */;
      invertA = 0;
      break;
    case "<=":
      cmpOp = 24 /* LE */;
      invertA = 0;
      break;
    case ">":
      cmpOp = 23 /* LT */;
      invertA = 0;
      swapped = true;
      break;
    case ">=":
      cmpOp = 24 /* LE */;
      invertA = 0;
      swapped = true;
      break;
    default:
      cmpOp = 22 /* EQ */;
      invertA = 0;
  }
  if (swapped) {
    regEmit(c, cmpOp, invertA, rc, rb);
  } else {
    regEmit(c, cmpOp, invertA, rb, rc);
  }
  const skip = emitJump(ctx);
  regEmit(c, 3 /* LOADBOOL */, dest, 1, 1);
  patchJump(ctx, skip, regPC(c));
  regEmit(c, 3 /* LOADBOOL */, dest, 0, 0);
  restoreFree(ctx, s);
  return dest;
}
function collectConcatChain(ctx, exp) {
  const exprs = [];
  function collect(e) {
    if (e.type === "BinaryExpression" && e.operator === "..") {
      collect(e.left);
      collect(e.right);
    } else {
      exprs.push(e);
    }
  }
  collect(exp);
  const base = ctx.freeReg;
  reserveRegs(ctx, base, exprs.length);
  for (let i = 0; i < exprs.length; i++) {
    compileExpr(ctx, exprs[i], base + i);
  }
  return exprs.map((_, i) => base + i);
}
function compileTableCtor(ctx, fields, dest) {
  if (dest === -1) dest = allocTemp(ctx);
  const c = ctx.chunk;
  const s = saveFree(ctx);
  regEmit(c, 9 /* NEWTABLE */, dest, 0, 0);
  let arrIdx = 0;
  for (let fi = 0; fi < fields.length; fi++) {
    const f = fields[fi];
    const isLast = fi === fields.length - 1;
    if (f.kind === "index") {
      const key = compileExprRK(ctx, f.index);
      const val = compileExprRK(ctx, f.value);
      regEmit(c, 8 /* SETTABLE */, dest, key, val);
    } else if (f.kind === "named") {
      const key = constRK(ctx, f.name);
      const val = compileExprRK(ctx, f.value);
      regEmit(c, 8 /* SETTABLE */, dest, key, val);
    } else {
      arrIdx++;
      if (isLast && (isCallLike(f.value) || f.value.type === "VarargExpression")) {
        const base = dest + 1;
        ctx.freeReg = Math.max(ctx.freeReg, base);
        if (isCallLike(f.value)) {
          compileCallMultiReg(ctx, f.value, base, 0);
        } else {
          regEmit(c, 35 /* VARARG */, base, 0);
        }
        regEmit(c, 33 /* SETLIST */, dest, 0, arrIdx);
      } else {
        const key = constRK(ctx, arrIdx);
        const val = compileExprRK(ctx, f.value);
        regEmit(c, 8 /* SETTABLE */, dest, key, val);
      }
    }
  }
  restoreFree(ctx, s);
  if (dest >= ctx.freeReg) ctx.freeReg = dest + 1;
  return dest;
}
function compileStringInterp(ctx, parts, dest) {
  if (dest === -1) dest = allocTemp(ctx);
  const c = ctx.chunk;
  if (parts.length === 0) {
    regEmit(c, 1 /* LOADK */, dest, regAddConst(c, ""));
    return dest;
  }
  const s = saveFree(ctx);
  const base = ctx.freeReg;
  const count = parts.length;
  reserveRegs(ctx, base, count);
  for (let i = 0; i < count; i++) {
    const p = parts[i];
    if (typeof p === "string") {
      regEmit(c, 1 /* LOADK */, base + i, regAddConst(c, p));
    } else {
      compileExpr(ctx, p, base + i);
    }
  }
  if (count === 1) {
    if (dest !== base) regEmit(c, 4 /* MOVE */, dest, base);
  } else {
    regEmit(c, 20 /* CONCAT */, dest, base, base + count - 1);
  }
  restoreFree(ctx, s);
  if (dest >= ctx.freeReg) ctx.freeReg = dest + 1;
  return dest;
}
function compileIfElseExpr(ctx, exp, dest) {
  if (dest === -1) dest = allocTemp(ctx);
  const c = ctx.chunk;
  const s = saveFree(ctx);
  const endJumps = [];
  const cond = compileExpr(ctx, exp.condition, -1);
  regEmit(c, 25 /* TEST */, cond, 0, 0);
  const jmpElse = emitJump(ctx);
  compileExpr(ctx, exp.thenExp, dest);
  endJumps.push(emitJump(ctx));
  patchJump(ctx, jmpElse, regPC(c));
  if (exp.elseifClauses) {
    for (const clause of exp.elseifClauses) {
      const cr = compileExpr(ctx, clause.condition, -1);
      regEmit(c, 25 /* TEST */, cr, 0, 0);
      const jNext = emitJump(ctx);
      compileExpr(ctx, clause.value, dest);
      endJumps.push(emitJump(ctx));
      patchJump(ctx, jNext, regPC(c));
    }
  }
  compileExpr(ctx, exp.elseExp, dest);
  for (const j of endJumps) patchJump(ctx, j, regPC(c));
  restoreFree(ctx, s);
  if (dest >= ctx.freeReg) ctx.freeReg = dest + 1;
  return dest;
}
function compileExprRK(ctx, exp) {
  if (!exp) {
    const tmp = allocTemp(ctx);
    regEmit(ctx.chunk, 2 /* LOADNIL */, tmp, 0);
    return tmp;
  }
  switch (exp.type) {
    case "NilLiteral": {
      const tmp = allocTemp(ctx);
      regEmit(ctx.chunk, 2 /* LOADNIL */, tmp, 0);
      return tmp;
    }
    case "BooleanLiteral":
      return constRK(ctx, exp.value);
    case "NumberLiteral":
      return constRK(ctx, Number(exp.value));
    case "StringLiteral":
      return constRK(ctx, exp.value);
    case "Identifier": {
      if (exp.name === "nil") {
        const tmp = allocTemp(ctx);
        regEmit(ctx.chunk, 2 /* LOADNIL */, tmp, 0);
        return tmp;
      }
      if (exp.name === "true") return constRK(ctx, true);
      if (exp.name === "false") return constRK(ctx, false);
      const reg = ctx.locals.get(exp.name);
      if (reg !== void 0 && reg < RK_OFFSET) return reg;
      return compileExpr(ctx, exp, -1);
    }
    default:
      return compileExpr(ctx, exp, -1);
  }
}
function compileCall(ctx, exp, base, nResults) {
  const c = ctx.chunk;
  const args2 = exp.args || [];
  const spread = hasSpread(args2);
  reserveRegs(ctx, base, 1 + args2.length + 1);
  compileExpr(ctx, exp.callee, base);
  for (let i = 0; i < args2.length; i++) {
    if (i === args2.length - 1 && spread) {
      if (isCallLike(args2[i])) {
        compileCallMultiReg(ctx, args2[i], base + 1 + i, 0);
      } else {
        regEmit(c, 35 /* VARARG */, base + 1 + i, 0);
      }
    } else {
      compileExpr(ctx, args2[i], base + 1 + i);
    }
  }
  const B = spread ? 0 : args2.length + 1;
  regEmit(c, 27 /* CALL */, base, B, nResults);
}
function compileMethodCall(ctx, exp, base, nResults) {
  const c = ctx.chunk;
  const args2 = exp.args || [];
  const spread = hasSpread(args2);
  reserveRegs(ctx, base, 2 + args2.length + 1);
  const objReg = compileExpr(ctx, exp.object, -1);
  const methodRK = constRK(ctx, exp.method);
  regEmit(c, 36 /* SELF */, base, objReg, methodRK);
  for (let i = 0; i < args2.length; i++) {
    if (i === args2.length - 1 && spread) {
      if (isCallLike(args2[i])) {
        compileCallMultiReg(ctx, args2[i], base + 2 + i, 0);
      } else {
        regEmit(c, 35 /* VARARG */, base + 2 + i, 0);
      }
    } else {
      compileExpr(ctx, args2[i], base + 2 + i);
    }
  }
  const B = spread ? 0 : args2.length + 2;
  regEmit(c, 27 /* CALL */, base, B, nResults);
}
function compileCallMultiReg(ctx, exp, base, nResults) {
  if (exp.type === "MethodCallExpression") {
    compileMethodCall(ctx, exp, base, nResults);
  } else if (exp.type === "CallExpression") {
    compileCall(ctx, exp, base, nResults);
  }
}
function compileFunctionBody(ctx, params, body) {
  const child = createCtx(ctx);
  let reg = 0;
  let nP = 0;
  let va = false;
  for (const p of params) {
    if (p.variadic) {
      va = true;
      continue;
    }
    child.locals.set(p.name, reg++);
    nP++;
  }
  child.nextReg = reg;
  child.freeReg = reg;
  child.isVararg = va;
  child.nParams = nP;
  child.chunk.nParams = nP;
  child.chunk.isVararg = va;
  child.chunk.maxRegs = reg;
  for (const stmt of body) compileStmt(child, stmt);
  const last = body.length > 0 ? body[body.length - 1] : null;
  if (!last || last.type !== "ReturnStatement") {
    regEmit(child.chunk, 29 /* RETURN */, 0, 1);
  }
  if (child.upvalueList.length > 0) {
    child.chunk.upvalues = child.upvalueList.map((uv) => [uv.isLocal ? 1 : 0, uv.index]);
  }
  return regAddProto(ctx.chunk, child.chunk);
}
function compileStmt(ctx, stmt) {
  if (!stmt) return;
  const c = ctx.chunk;
  switch (stmt.type) {
    case "LocalStatement":
      compileLocalStmt(ctx, stmt);
      break;
    case "AssignmentStatement":
      compileAssignStmt(ctx, stmt);
      break;
    case "CompoundAssignmentStatement":
      compileCompoundAssign(ctx, stmt);
      break;
    case "FunctionCallStatement":
      compileFuncCallStmt(ctx, stmt);
      break;
    case "DoStatement": {
      const snap = pushScope(ctx);
      for (const s of stmt.body) compileStmt(ctx, s);
      if (ctx.nextReg > snap.nextReg) regEmit(c, 39 /* CLOSEUPVAL */, snap.nextReg);
      popScope(ctx, snap);
      break;
    }
    case "WhileStatement":
      compileWhile(ctx, stmt);
      break;
    case "RepeatStatement":
      compileRepeat(ctx, stmt);
      break;
    case "IfStatement":
      compileIf(ctx, stmt);
      break;
    case "ForNumericStatement":
      compileForNumeric(ctx, stmt);
      break;
    case "ForInStatement":
      compileForIn(ctx, stmt);
      break;
    case "ReturnStatement":
      compileReturn(ctx, stmt);
      break;
    case "BreakStatement": {
      const lc = currentLoop(ctx);
      if (lc) {
        if (ctx.nextReg > lc.bodyRegStart) regEmit(c, 39 /* CLOSEUPVAL */, lc.bodyRegStart);
        lc.breakPatches.push(emitJump(ctx));
      }
      break;
    }
    case "ContinueStatement": {
      const lc = currentLoop(ctx);
      if (lc) {
        if (ctx.nextReg > lc.bodyRegStart) regEmit(c, 39 /* CLOSEUPVAL */, lc.bodyRegStart);
        lc.continuePatches.push(emitJump(ctx));
      }
      break;
    }
    case "LocalFunctionStatement": {
      const reg = allocLocal(ctx, stmt.name);
      const protoIdx = compileFunctionBody(ctx, stmt.params, stmt.body);
      regEmit(c, 34 /* CLOSURE */, reg, protoIdx);
      break;
    }
    case "FunctionStatement":
      compileFuncStmt(ctx, stmt);
      break;
    case "TypeStatement":
    case "ExportTypeStatement":
    case "TypeFunctionStatement":
    case "ExportTypeFunctionStatement":
      break;
    default:
      break;
  }
}
function compileLocalStmt(ctx, stmt) {
  const c = ctx.chunk;
  const nVars = stmt.vars.length;
  if (stmt.values && stmt.values.length > 0) {
    const nVals = stmt.values.length;
    const lastVal = stmt.values[nVals - 1];
    const spread = nVals > 0 && (isCallLike(lastVal) || lastVal.type === "VarargExpression");
    const regs = [];
    for (let i = 0; i < nVars; i++) {
      const reg = ctx.nextReg++;
      if (ctx.freeReg < ctx.nextReg) ctx.freeReg = ctx.nextReg;
      ctx.chunk.maxRegs = Math.max(ctx.chunk.maxRegs, ctx.nextReg);
      regs.push(reg);
    }
    if (spread && nVars > nVals) {
      for (let i = 0; i < nVals - 1; i++) {
        compileExpr(ctx, stmt.values[i], regs[i]);
      }
      const extra = nVars - (nVals - 1);
      if (isCallLike(lastVal)) {
        compileCallMultiReg(ctx, lastVal, regs[nVals - 1], extra + 1);
      } else {
        regEmit(c, 35 /* VARARG */, regs[nVals - 1], extra + 1);
      }
    } else {
      const count = Math.min(nVars, nVals);
      for (let i = 0; i < count; i++) {
        compileExpr(ctx, stmt.values[i], regs[i]);
      }
      if (nVals > nVars) {
        for (let i = nVars; i < nVals; i++) {
          const sv = saveFree(ctx);
          compileExpr(ctx, stmt.values[i], -1);
          restoreFree(ctx, sv);
        }
      }
      if (nVars > nVals) {
        regEmit(c, 2 /* LOADNIL */, regs[nVals], nVars - nVals - 1);
      }
    }
    for (let i = 0; i < nVars; i++) {
      ctx.locals.set(stmt.vars[i].name, regs[i]);
    }
  } else {
    const regs = [];
    for (let i = 0; i < nVars; i++) {
      regs.push(allocLocal(ctx, stmt.vars[i].name));
    }
    regEmit(c, 2 /* LOADNIL */, regs[0], nVars - 1);
  }
}
function compileAssignStmt(ctx, stmt) {
  const c = ctx.chunk;
  const nVars = stmt.vars.length;
  const nVals = stmt.values.length;
  const s = saveFree(ctx);
  const temps = [];
  const lastVal = nVals > 0 ? stmt.values[nVals - 1] : null;
  const spread = lastVal && (isCallLike(lastVal) || lastVal.type === "VarargExpression");
  if (spread && nVars > nVals) {
    for (let i = 0; i < nVals - 1; i++) {
      const t = allocTemp(ctx);
      compileExpr(ctx, stmt.values[i], t);
      temps.push(t);
    }
    const base = ctx.freeReg;
    const extra = nVars - (nVals - 1);
    if (isCallLike(lastVal)) {
      compileCallMultiReg(ctx, lastVal, base, extra + 1);
    } else {
      regEmit(c, 35 /* VARARG */, base, extra + 1);
    }
    for (let i = 0; i < extra; i++) temps.push(base + i);
  } else {
    const count = Math.min(nVars, nVals);
    for (let i = 0; i < count; i++) {
      const t = allocTemp(ctx);
      compileExpr(ctx, stmt.values[i], t);
      temps.push(t);
    }
    for (let i = nVars; i < nVals; i++) {
      compileExpr(ctx, stmt.values[i], -1);
    }
  }
  for (let i = 0; i < nVars; i++) {
    const v = stmt.vars[i];
    const src = i < temps.length ? temps[i] : -1;
    assignToVar(ctx, v, src);
  }
  restoreFree(ctx, s);
}
function assignToIdent(ctx, name, src) {
  const c = ctx.chunk;
  const localReg = ctx.locals.get(name);
  if (localReg !== void 0) {
    if (src >= 0) {
      if (src !== localReg) regEmit(c, 4 /* MOVE */, localReg, src);
    } else {
      regEmit(c, 2 /* LOADNIL */, localReg, 0);
    }
    return;
  }
  const uv = resolveUpvalue(ctx, name);
  if (uv !== null) {
    if (src >= 0) {
      regEmit(c, 38 /* SETUPVAL */, src, uv);
    } else {
      const tmp = allocTemp(ctx);
      regEmit(c, 2 /* LOADNIL */, tmp, 0);
      regEmit(c, 38 /* SETUPVAL */, tmp, uv);
    }
    return;
  }
  if (src >= 0) {
    regEmit(c, 6 /* SETGLOBAL */, src, regAddConst(c, name));
  } else {
    const tmp = allocTemp(ctx);
    regEmit(c, 2 /* LOADNIL */, tmp, 0);
    regEmit(c, 6 /* SETGLOBAL */, tmp, regAddConst(c, name));
  }
}
function assignToVar(ctx, v, src) {
  const c = ctx.chunk;
  if (v.type === "Identifier") {
    assignToIdent(ctx, v.name, src);
  } else if (v.type === "IndexExpression") {
    const obj = compileExpr(ctx, v.object, -1);
    const key = compileExprRK(ctx, v.index);
    if (src >= 0) {
      regEmit(c, 8 /* SETTABLE */, obj, key, src);
    } else {
      const tmp = allocTemp(ctx);
      regEmit(c, 2 /* LOADNIL */, tmp, 0);
      regEmit(c, 8 /* SETTABLE */, obj, key, tmp);
    }
  } else if (v.type === "MemberExpression") {
    const obj = compileExpr(ctx, v.object, -1);
    const key = constRK(ctx, v.property);
    if (src >= 0) {
      regEmit(c, 8 /* SETTABLE */, obj, key, src);
    } else {
      const tmp = allocTemp(ctx);
      regEmit(c, 2 /* LOADNIL */, tmp, 0);
      regEmit(c, 8 /* SETTABLE */, obj, key, tmp);
    }
  }
}
function compileCompoundAssign(ctx, stmt) {
  const c = ctx.chunk;
  const s = saveFree(ctx);
  const baseOp = stmt.operator.replace("=", "");
  const arithOps = {
    "+": 10 /* ADD */,
    "-": 11 /* SUB */,
    "*": 12 /* MUL */,
    "/": 13 /* DIV */,
    "%": 14 /* MOD */,
    "^": 15 /* POW */,
    "//": 16 /* IDIV */
  };
  const op = arithOps[baseOp];
  const isConcat = baseOp === "..";
  if (stmt.var.type === "Identifier") {
    const localReg = ctx.locals.get(stmt.var.name);
    if (localReg !== void 0) {
      if (isConcat) {
        const concatBase = ctx.freeReg;
        reserveRegs(ctx, concatBase, 2);
        regEmit(c, 4 /* MOVE */, concatBase, localReg);
        compileExpr(ctx, stmt.value, concatBase + 1);
        regEmit(c, 20 /* CONCAT */, localReg, concatBase, concatBase + 1);
      } else if (op !== void 0) {
        const valRK = compileExprRK(ctx, stmt.value);
        regEmit(c, op, localReg, localReg, valRK);
      }
    } else {
      const uv = resolveUpvalue(ctx, stmt.var.name);
      const tmp = allocTemp(ctx);
      if (uv !== null) {
        regEmit(c, 37 /* GETUPVAL */, tmp, uv);
      } else {
        regEmit(c, 5 /* GETGLOBAL */, tmp, regAddConst(c, stmt.var.name));
      }
      if (isConcat) {
        const valReg = allocTemp(ctx);
        compileExpr(ctx, stmt.value, valReg);
        regEmit(c, 20 /* CONCAT */, tmp, tmp, valReg);
      } else if (op !== void 0) {
        const valRK = compileExprRK(ctx, stmt.value);
        regEmit(c, op, tmp, tmp, valRK);
      }
      if (uv !== null) {
        regEmit(c, 38 /* SETUPVAL */, tmp, uv);
      } else {
        regEmit(c, 6 /* SETGLOBAL */, tmp, regAddConst(c, stmt.var.name));
      }
    }
  } else {
    const objReg = compileExpr(ctx, stmt.var.object, -1);
    let keyRK;
    if (stmt.var.type === "IndexExpression") {
      keyRK = compileExprRK(ctx, stmt.var.index);
    } else {
      keyRK = constRK(ctx, stmt.var.property);
    }
    const oldReg = allocTemp(ctx);
    regEmit(c, 7 /* GETTABLE */, oldReg, objReg, keyRK);
    if (isConcat) {
      const valReg = allocTemp(ctx);
      compileExpr(ctx, stmt.value, valReg);
      regEmit(c, 20 /* CONCAT */, oldReg, oldReg, valReg);
    } else if (op !== void 0) {
      const valRK = compileExprRK(ctx, stmt.value);
      regEmit(c, op, oldReg, oldReg, valRK);
    }
    regEmit(c, 8 /* SETTABLE */, objReg, keyRK, oldReg);
  }
  restoreFree(ctx, s);
}
function compileFuncCallStmt(ctx, stmt) {
  const s = saveFree(ctx);
  const call = stmt.call;
  const base = ctx.freeReg;
  if (call.type === "MethodCallExpression" || call.object && call.method) {
    compileMethodCall(ctx, call, base, 1);
  } else {
    compileCall(ctx, call, base, 1);
  }
  restoreFree(ctx, s);
}
function compileWhile(ctx, stmt) {
  const c = ctx.chunk;
  const condPC = regPC(c);
  const snap = pushScope(ctx);
  const bodyStart = ctx.nextReg;
  pushLoop(ctx, bodyStart);
  const sv = saveFree(ctx);
  const cond = compileExpr(ctx, stmt.condition, -1);
  regEmit(c, 25 /* TEST */, cond, 0, 0);
  const jmpOut = emitJump(ctx);
  restoreFree(ctx, sv);
  for (const st of stmt.body) compileStmt(ctx, st);
  resolveContinues(ctx);
  if (ctx.nextReg > bodyStart) regEmit(c, 39 /* CLOSEUPVAL */, bodyStart);
  const back = emitJump(ctx);
  patchJump(ctx, back, condPC);
  patchJump(ctx, jmpOut, regPC(c));
  popLoop(ctx);
  popScope(ctx, snap);
}
function compileRepeat(ctx, stmt) {
  const c = ctx.chunk;
  const bodyPC = regPC(c);
  const snap = pushScope(ctx);
  const bodyStart = ctx.nextReg;
  pushLoop(ctx, bodyStart);
  for (const st of stmt.body) compileStmt(ctx, st);
  resolveContinues(ctx);
  if (ctx.nextReg > bodyStart) regEmit(c, 39 /* CLOSEUPVAL */, bodyStart);
  const sv = saveFree(ctx);
  const cond = compileExpr(ctx, stmt.condition, -1);
  regEmit(c, 25 /* TEST */, cond, 0, 0);
  const jmpBack = emitJump(ctx);
  patchJump(ctx, jmpBack, bodyPC);
  restoreFree(ctx, sv);
  popLoop(ctx);
  popScope(ctx, snap);
}
function compileIf(ctx, stmt) {
  const c = ctx.chunk;
  const endJumps = [];
  let sv = saveFree(ctx);
  const cond = compileExpr(ctx, stmt.condition, -1);
  regEmit(c, 25 /* TEST */, cond, 0, 0);
  const jmpElse = emitJump(ctx);
  restoreFree(ctx, sv);
  let snap = pushScope(ctx);
  for (const st of stmt.thenBody) compileStmt(ctx, st);
  if (ctx.nextReg > snap.nextReg) regEmit(c, 39 /* CLOSEUPVAL */, snap.nextReg);
  popScope(ctx, snap);
  endJumps.push(emitJump(ctx));
  patchJump(ctx, jmpElse, regPC(c));
  for (const ec of stmt.elseifClauses) {
    sv = saveFree(ctx);
    const cr = compileExpr(ctx, ec.condition, -1);
    regEmit(c, 25 /* TEST */, cr, 0, 0);
    const jmpNext = emitJump(ctx);
    restoreFree(ctx, sv);
    snap = pushScope(ctx);
    for (const st of ec.body) compileStmt(ctx, st);
    if (ctx.nextReg > snap.nextReg) regEmit(c, 39 /* CLOSEUPVAL */, snap.nextReg);
    popScope(ctx, snap);
    endJumps.push(emitJump(ctx));
    patchJump(ctx, jmpNext, regPC(c));
  }
  if (stmt.elseBody) {
    snap = pushScope(ctx);
    for (const st of stmt.elseBody) compileStmt(ctx, st);
    if (ctx.nextReg > snap.nextReg) regEmit(c, 39 /* CLOSEUPVAL */, snap.nextReg);
    popScope(ctx, snap);
  }
  const end = regPC(c);
  for (const j of endJumps) patchJump(ctx, j, end);
}
function compileForNumeric(ctx, stmt) {
  const c = ctx.chunk;
  const snap = pushScope(ctx);
  const sv = saveFree(ctx);
  const counterReg = allocHidden(ctx, "for_i");
  const limitReg = allocHidden(ctx, "for_lim");
  const stepReg = allocHidden(ctx, "for_step");
  const userReg = allocLocal(ctx, stmt.var.name);
  compileExpr(ctx, stmt.start, counterReg);
  compileExpr(ctx, stmt.end, limitReg);
  if (stmt.step) {
    compileExpr(ctx, stmt.step, stepReg);
  } else {
    regEmit(c, 1 /* LOADK */, stepReg, regAddConst(c, 1));
  }
  const forprepPC = regPC(c);
  regEmit(c, 30 /* FORPREP */, counterReg, 0);
  const bodyStart = ctx.nextReg;
  pushLoop(ctx, bodyStart);
  for (const st of stmt.body) compileStmt(ctx, st);
  resolveContinues(ctx);
  regEmit(c, 39 /* CLOSEUPVAL */, userReg);
  const forloopPC = regPC(c);
  const bodyStartPC = forprepPC + 1;
  regEmit(c, 31 /* FORLOOP */, counterReg, bodyStartPC - forloopPC - 1);
  regPatch(c, forprepPC * 4, "B", forloopPC - forprepPC - 1);
  popLoop(ctx);
  restoreFree(ctx, sv);
  popScope(ctx, snap);
}
function compileForIn(ctx, stmt) {
  const c = ctx.chunk;
  const snap = pushScope(ctx);
  const sv = saveFree(ctx);
  const iterReg = allocHidden(ctx, "for_iter");
  const stateReg = allocHidden(ctx, "for_state");
  const ctrlReg = allocHidden(ctx, "for_ctrl");
  const iterCount = stmt.iter.length;
  if (iterCount === 1 && isCallLike(stmt.iter[0])) {
    compileCallMultiReg(ctx, stmt.iter[0], iterReg, 4);
  } else if (iterCount > 1 && isCallLike(stmt.iter[iterCount - 1])) {
    for (let i = 0; i < iterCount - 1; i++) {
      compileExpr(ctx, stmt.iter[i], iterReg + i);
    }
    const remaining = 3 - (iterCount - 1);
    compileCallMultiReg(ctx, stmt.iter[iterCount - 1], iterReg + iterCount - 1, remaining + 1);
  } else {
    for (let i = 0; i < Math.min(iterCount, 3); i++) {
      compileExpr(ctx, stmt.iter[i], iterReg + i);
    }
    for (let i = iterCount; i < 3; i++) {
      regEmit(c, 2 /* LOADNIL */, iterReg + i, 0);
    }
  }
  regEmit(c, 42 /* ITERPREP */, iterReg);
  const nVars = stmt.vars.length;
  for (const v of stmt.vars) allocLocal(ctx, v.name);
  const loopTopPC = regPC(c);
  const bodyStart = ctx.nextReg;
  pushLoop(ctx, bodyStart);
  regEmit(c, 32 /* TFORLOOP */, iterReg, 0, nVars);
  const jmpEnd = emitJump(ctx);
  for (const st of stmt.body) compileStmt(ctx, st);
  resolveContinues(ctx);
  regEmit(c, 39 /* CLOSEUPVAL */, iterReg + 3);
  const back = emitJump(ctx);
  patchJump(ctx, back, loopTopPC);
  patchJump(ctx, jmpEnd, regPC(c));
  popLoop(ctx);
  restoreFree(ctx, sv);
  popScope(ctx, snap);
}
function compileReturn(ctx, stmt) {
  const c = ctx.chunk;
  if (!stmt.values || stmt.values.length === 0) {
    regEmit(c, 29 /* RETURN */, 0, 1);
    return;
  }
  const nVals = stmt.values.length;
  const lastVal = stmt.values[nVals - 1];
  const spread = isCallLike(lastVal) || lastVal.type === "VarargExpression";
  if (nVals === 1 && isCallLike(lastVal)) {
    const base = ctx.freeReg;
    compileCallMultiReg(ctx, lastVal, base, 0);
    regEmit(c, 29 /* RETURN */, base, 0);
  } else if (nVals === 1 && lastVal.type === "VarargExpression") {
    const base = ctx.freeReg;
    regEmit(c, 35 /* VARARG */, base, 0);
    regEmit(c, 29 /* RETURN */, base, 0);
  } else if (spread) {
    const base = ctx.freeReg;
    reserveRegs(ctx, base, nVals);
    for (let i = 0; i < nVals - 1; i++) {
      compileExpr(ctx, stmt.values[i], base + i);
    }
    if (isCallLike(lastVal)) {
      compileCallMultiReg(ctx, lastVal, base + nVals - 1, 0);
    } else {
      regEmit(c, 35 /* VARARG */, base + nVals - 1, 0);
    }
    regEmit(c, 29 /* RETURN */, base, 0);
  } else {
    const base = ctx.freeReg;
    reserveRegs(ctx, base, nVals);
    for (let i = 0; i < nVals; i++) {
      compileExpr(ctx, stmt.values[i], base + i);
    }
    regEmit(c, 29 /* RETURN */, base, nVals + 1);
  }
}
function compileFuncStmt(ctx, stmt) {
  const c = ctx.chunk;
  const s = saveFree(ctx);
  const fn = stmt.name;
  const params = fn.method ? [{ type: "Param", name: "self", loc: stmt.loc }, ...stmt.params] : stmt.params;
  const protoIdx = compileFunctionBody(ctx, params, stmt.body);
  if (fn.method) {
    const obj = compileExpr(ctx, fn.base, -1);
    const closure = allocTemp(ctx);
    regEmit(c, 34 /* CLOSURE */, closure, protoIdx);
    const key = constRK(ctx, fn.method);
    regEmit(c, 8 /* SETTABLE */, obj, key, closure);
  } else if (fn.base.type === "Identifier") {
    const localReg = ctx.locals.get(fn.base.name);
    if (localReg !== void 0) {
      regEmit(c, 34 /* CLOSURE */, localReg, protoIdx);
    } else {
      const tmp = allocTemp(ctx);
      regEmit(c, 34 /* CLOSURE */, tmp, protoIdx);
      const uv = resolveUpvalue(ctx, fn.base.name);
      if (uv !== null) {
        regEmit(c, 38 /* SETUPVAL */, tmp, uv);
      } else {
        regEmit(c, 6 /* SETGLOBAL */, tmp, regAddConst(c, fn.base.name));
      }
    }
  } else if (fn.base.type === "MemberExpression") {
    const obj = compileExpr(ctx, fn.base.object, -1);
    const closure = allocTemp(ctx);
    regEmit(c, 34 /* CLOSURE */, closure, protoIdx);
    const key = constRK(ctx, fn.base.property);
    regEmit(c, 8 /* SETTABLE */, obj, key, closure);
  }
  restoreFree(ctx, s);
}
function regCompile(ast2) {
  const ctx = createCtx();
  ctx.chunk.isVararg = true;
  for (const stmt of ast2.body) compileStmt(ctx, stmt);
  const last = ast2.body.length > 0 ? ast2.body[ast2.body.length - 1] : null;
  if (!last || last.type !== "ReturnStatement") {
    regEmit(ctx.chunk, 29 /* RETURN */, 0, 1);
  }
  return ctx.chunk;
}

// src/vm/reg-vm-gen.ts
import { randomBytes } from "crypto";
import { writeFileSync as _dumpWrite } from "fs";

// src/vm/lzma.ts
function base85Encode(data) {
  let padded = data;
  if (data.length % 4 !== 0) {
    const padLen = 4 - data.length % 4;
    padded = new Uint8Array(data.length + padLen);
    padded.set(data);
  }
  let result = "";
  for (let i = 0; i < padded.length; i += 4) {
    const val = padded[i] << 24 | padded[i + 1] << 16 | padded[i + 2] << 8 | padded[i + 3];
    const uval = val >>> 0;
    if (uval === 0) {
      result += "z";
      continue;
    }
    let v = uval;
    const c = new Array(5);
    for (let j = 4; j >= 0; j--) {
      c[j] = String.fromCharCode(33 + v % 85);
      v = Math.floor(v / 85);
    }
    result += c.join("");
  }
  return result;
}
function adler32(data) {
  let a = 1, b = 0;
  const MOD = 65521;
  let idx = 0;
  while (idx < data.length) {
    const end = Math.min(idx + 5552, data.length);
    for (; idx < end; idx++) {
      a += data[idx];
      b += a;
    }
    a %= MOD;
    b %= MOD;
  }
  return b * 65536 + a;
}
function generateSBox(rng2) {
  const sbox = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng2() * (i + 1));
    [sbox[i], sbox[j]] = [sbox[j], sbox[i]];
  }
  return sbox;
}
function invertSBox(sbox) {
  const inv = new Array(256);
  for (let i = 0; i < 256; i++) {
    inv[sbox[i]] = i;
  }
  return inv;
}
function encryptAndEncode(input, rng2) {
  const encoder = new TextEncoder();
  const raw = encoder.encode(input);
  const origLen = raw.length;
  const checksum = adler32(raw);
  const sbox = generateSBox(rng2);
  const invSbox = invertSBox(sbox);
  const keyLen = 20 + Math.floor(rng2() * 13);
  const xorKey = [];
  for (let i = 0; i < keyLen; i++) {
    xorKey.push(Math.floor(rng2() * 256));
  }
  const substituted = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    substituted[i] = sbox[raw[i]];
  }
  const encrypted = new Uint8Array(substituted.length);
  encrypted[0] = substituted[0] ^ xorKey[0];
  for (let i = 1; i < substituted.length; i++) {
    encrypted[i] = substituted[i] ^ xorKey[i % keyLen] ^ encrypted[i - 1];
  }
  const blob = base85Encode(encrypted);
  return { blob, xorKey, invSbox, checksum, origLen };
}

// src/vm/bootstrap-template.ts
function longStringLevel(s) {
  let level2 = 0;
  while (s.includes("]" + "=".repeat(level2) + "]")) {
    level2++;
  }
  return level2;
}
function shuffle(arr, rng2) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng2() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function uniqueRandInt(min, max, exclude, rng2) {
  let v;
  do {
    v = min + Math.floor(rng2() * (max - min + 1));
  } while (exclude.has(v));
  return v;
}
function obfuscateNum(n, rng2) {
  n = n & 255;
  const variant = Math.floor(rng2() * 7);
  switch (variant) {
    case 0: {
      const a = Math.floor(rng2() * (n + 1));
      return `(${a}+${n - a})`;
    }
    case 1: {
      const b = 1 + Math.floor(rng2() * 300);
      return `(${n + b}-${b})`;
    }
    case 2: {
      const a = 2 + Math.floor(rng2() * 11);
      const c = (n % a + a) % a;
      const b = (n - c) / a;
      if (b < 0) return `(${n + 127}-127)`;
      return `(${a}*${b}+${c})`;
    }
    case 3: {
      const b = 100 + Math.floor(rng2() * 500);
      return `(${n + b}-${b})`;
    }
    case 4: {
      const a = 2 + Math.floor(rng2() * 8);
      const b = Math.ceil(n / a) + Math.floor(rng2() * 20);
      const c = a * b - n;
      return `(${a}*${b}-${c})`;
    }
    case 5: {
      const c = 50 + Math.floor(rng2() * 500);
      const a = 50 + Math.floor(rng2() * 500);
      const b = n - a + c;
      if (b < 0) return `(${n + 200}-200)`;
      return `(${a}+${b}-${c})`;
    }
    default: {
      const a = 3 + Math.floor(rng2() * 10);
      const pad = 1 + Math.floor(rng2() * 50);
      const total = n + pad;
      const b = Math.floor(total / a);
      const c = total - a * b;
      return `(${a}*${b}+${c}-${pad})`;
    }
  }
}
function generateBootstrap(config) {
  const { vmBlob, vmOrigLen, xorKey, invSbox, checksum, chunkName = "Clyde", rng: rng2 } = config;
  const prefixes = ["_0", "_1", "_2", "_3", "_4", "_5"];
  const suffixes = "abcdefghjkmnpqrstuvwx".split("");
  const allNames = [];
  for (const p of prefixes) {
    for (const s of suffixes) {
      allNames.push(p + s);
    }
  }
  shuffle(allNames, rng2);
  let ni = 0;
  const N = () => allNames[ni++];
  const nByte = N(), nGsub = N(), nPack = N(), nSub = N(), nChar = N();
  const nLoad = N(), nAssert = N(), nType = N(), nBxor = N(), nPcall = N();
  const nTconcat = N(), nBand = N();
  const nDecode = N(), nDecrypt = N(), nVerify = N();
  const nKeyInteg = N(), nSboxInteg = N(), nMutate = N();
  const nKeyRaw = N(), nKey = N(), nKeyLen = N();
  const nSboxRaw = N(), nSbox = N();
  const nRaw = N(), nDec = N();
  const nOk = N(), nFn = N(), nState = N(), nResult = N(), nZeroExp = N();
  const junkFnNames = [N(), N(), N(), N(), N()];
  const junkVarNames = [N(), N(), N(), N(), N(), N(), N(), N()];
  const keyMask = 1 + Math.floor(rng2() * 254);
  const sboxMask = 1 + Math.floor(rng2() * 254);
  const maskedKey = xorKey.map((b) => b ^ keyMask);
  const maskedSbox = invSbox.map((b) => b ^ sboxMask);
  const keyXorSum = xorKey.reduce((a, b) => a ^ b, 0);
  const sboxSum = invSbox.reduce((a, b) => a + b, 0) % 65536;
  const lvl = longStringLevel(vmBlob);
  const open = "[" + "=".repeat(lvl) + "[";
  const close = "]" + "=".repeat(lvl) + "]";
  const usedStates = /* @__PURE__ */ new Set();
  const stDecode = uniqueRandInt(100, 9999, usedStates, rng2);
  usedStates.add(stDecode);
  const stDecrypt = uniqueRandInt(100, 9999, usedStates, rng2);
  usedStates.add(stDecrypt);
  const stVerify = uniqueRandInt(100, 9999, usedStates, rng2);
  usedStates.add(stVerify);
  const stLoad = uniqueRandInt(100, 9999, usedStates, rng2);
  usedStates.add(stLoad);
  const stExec = uniqueRandInt(100, 9999, usedStates, rng2);
  usedStates.add(stExec);
  const stMutate = uniqueRandInt(100, 9999, usedStates, rng2);
  usedStates.add(stMutate);
  const junkStates = [];
  for (let i = 0; i < 3; i++) {
    const js = uniqueRandInt(100, 9999, usedStates, rng2);
    usedStates.add(js);
    junkStates.push(js);
  }
  const opaA = 1 + Math.floor(rng2() * 254);
  const opaB = 1 + Math.floor(rng2() * 254);
  const opaExpected = opaA + opaB;
  const SPREAD = 6;
  const L_MERGE = SPREAD + 1;
  const L_RECON = SPREAD + 2;
  const L_FUNCS = SPREAD + 3;
  const L_OPAQUE = SPREAD + 4;
  const fragments = [];
  const spreadLayer = () => 1 + Math.floor(rng2() * SPREAD);
  {
    const builtins = [
      [nByte, "string.byte"],
      [nGsub, "string.gsub"],
      [nPack, "string.pack"],
      [nSub, "string.sub"],
      [nChar, "string.char"],
      [nLoad, "loadstring"],
      [nAssert, "assert"],
      [nType, "type"],
      [nBxor, "bit32.bxor"],
      [nPcall, "pcall"],
      [nTconcat, "table.concat"],
      [nBand, "bit32.band"]
    ];
    shuffle(builtins, rng2);
    let bi = 0;
    while (bi < builtins.length) {
      const groupSize = 1 + Math.floor(rng2() * Math.min(3, builtins.length - bi));
      const names = builtins.slice(bi, bi + groupSize).map((b) => b[0]).join(",");
      const values = builtins.slice(bi, bi + groupSize).map((b) => b[1]).join(",");
      fragments.push({ code: `local ${names}=${values}`, layer: 0 });
      bi += groupSize;
    }
  }
  const nDbgRef = N();
  const nLineRef = N();
  const chDebug = [100, 101, 98, 117, 103].map((c) => obfuscateNum(c, rng2)).join(",");
  const chInfo = [105, 110, 102, 111].map((c) => obfuscateNum(c, rng2)).join(",");
  const chL = obfuscateNum(108, rng2);
  const chGetfenv = [103, 101, 116, 102, 101, 110, 118].map((c) => obfuscateNum(c, rng2)).join(",");
  fragments.push({
    code: `local ${nDbgRef}=(function() local _0ok,_0r=${nPcall}(function() local _0d=rawget(_G,${nChar}(${chDebug})) if not _0d then local _0g=rawget(_G,${nChar}(${chGetfenv})) if _0g then _0d=rawget(_0g(0) or {},${nChar}(${chDebug})) end end return _0d and _0d[${nChar}(${chInfo})] end) return _0ok and _0r or nil end)()`,
    layer: spreadLayer()
  });
  fragments.push({
    code: `local ${nLineRef}=${nDbgRef} and ${nDbgRef}(${obfuscateNum(1, rng2)},${nChar}(${chL})) or 0`,
    layer: L_MERGE
  });
  {
    const splitArray = (data, baseName) => {
      const numFrags = 3 + Math.floor(rng2() * 3);
      const fragNames = [];
      const fragSizes = [];
      let remaining = data.length;
      for (let i = 0; i < numFrags - 1; i++) {
        const minChunk = Math.max(1, Math.floor(remaining / (numFrags - i) * 0.5));
        const maxChunk = Math.floor(remaining / (numFrags - i) * 1.5);
        const size = minChunk + Math.floor(rng2() * (maxChunk - minChunk + 1));
        fragSizes.push(Math.min(size, remaining - (numFrags - 1 - i)));
        remaining -= fragSizes[i];
      }
      fragSizes.push(remaining);
      let offset = 0;
      for (let i = 0; i < numFrags; i++) {
        const fragName = N();
        fragNames.push(fragName);
        const chunk2 = data.slice(offset, offset + fragSizes[i]);
        const obfChunk = chunk2.map((b) => obfuscateNum(b, rng2)).join(",");
        fragments.push({ code: `local ${fragName}={${obfChunk}}`, layer: spreadLayer() });
        offset += fragSizes[i];
      }
      const mergeLines = [];
      const nCounter = N();
      mergeLines.push(`local ${baseName}={}`);
      mergeLines.push(`local ${nCounter}=0`);
      for (const fn of fragNames) {
        mergeLines.push(`for _0i=1,#${fn} do ${nCounter}=${nCounter}+1 ${baseName}[${nCounter}]=${fn}[_0i] end`);
      }
      fragments.push({ code: mergeLines.join("\n"), layer: L_MERGE });
    };
    splitArray(maskedSbox, nSboxRaw);
    splitArray(maskedKey, nKeyRaw);
  }
  for (let i = 0; i < junkFnNames.length; i++) {
    const jfType = Math.floor(rng2() * 4);
    let jfCode;
    const jn = junkFnNames[i];
    const magic1 = 1 + Math.floor(rng2() * 200);
    const magic2 = Math.floor(rng2() * 200);
    switch (jfType) {
      case 0:
        jfCode = `local function ${jn}(data)
local _0t={}
for _0i=1,#data do _0t[_0i]=${nBxor}(${nByte}(data,_0i),${nBand}(_0i*${magic1}+${magic2},0xFF)) end
return ${nTconcat}(_0t)
end`;
        break;
      case 1:
        jfCode = `local function ${jn}(data)
local _0t={}
for _0i=1,#data do _0t[_0i]=${nChar}(${nBxor}(${nByte}(data,_0i),${nBand}(_0i+${magic1},0xFF))) end
return ${nTconcat}(_0t)
end`;
        break;
      case 2:
        jfCode = `local function ${jn}(data)
local _0r={}
for _0i=#data,1,-1 do _0r[#data-_0i+1]=${nChar}(${nBxor}(${nByte}(data,_0i),${magic2})) end
return ${nTconcat}(_0r)
end`;
        break;
      default:
        jfCode = `local function ${jn}(data)
local _0t={}
local _0a=${magic1}
for _0i=1,#data do _0t[_0i]=${nChar}(${nBxor}(${nByte}(data,_0i),${nBand}(_0a,0xFF)));_0a=_0a+${magic2} end
return ${nTconcat}(_0t)
end`;
        break;
    }
    fragments.push({ code: jfCode, layer: spreadLayer() });
  }
  const obfSboxMask = obfuscateNum(sboxMask, rng2);
  const obfKeyMask = obfuscateNum(keyMask, rng2);
  fragments.push({ code: `local ${nSbox}={}
for _0i=1,256 do ${nSbox}[_0i]=${nBxor}(${nSboxRaw}[_0i],${obfSboxMask}) end`, layer: L_RECON });
  fragments.push({ code: `local ${nKeyLen}=#${nKeyRaw}
local ${nKey}={}
for _0i=1,${nKeyLen} do ${nKey}[_0i]=${nBxor}(${nKeyRaw}[_0i],${obfKeyMask}) end`, layer: L_RECON });
  for (let i = 0; i < junkVarNames.length; i++) {
    const jvType = Math.floor(rng2() * 4);
    let jvCode;
    switch (jvType) {
      case 0:
        jvCode = `local ${junkVarNames[i]}=${nBxor}(${1 + Math.floor(rng2() * 254)},${nSboxRaw}[${1 + Math.floor(rng2() * 255)}])`;
        break;
      case 1:
        jvCode = `local ${junkVarNames[i]}=${nBand}(${nKeyRaw}[${1 + Math.floor(rng2() * (xorKey.length - 1))}]+${Math.floor(rng2() * 200)},0xFF)`;
        break;
      case 2:
        jvCode = `local ${junkVarNames[i]}=#${nKeyRaw}+${Math.floor(rng2() * 100)}`;
        break;
      default:
        jvCode = `local ${junkVarNames[i]}=${nBxor}(${Math.floor(rng2() * 256)},${Math.floor(rng2() * 256)})`;
        break;
    }
    fragments.push({ code: jvCode, layer: L_RECON });
  }
  const decoderLines = [
    `local function ${nDecode}(s)`,
    `s=${nGsub}(s,"[%s]","")`,
    `local ${nZeroExp}=${nChar}(33):rep(5)`,
    `s=${nGsub}(s,"z",${nZeroExp})`,
    `local o={}`,
    `for i=1,#s,5 do`,
    `local d,e,f,g,h=${nByte}(s,i,i+4)`,
    `local v=(d-33)*52200625+(e-33)*614125+(f-33)*7225+(g-33)*85+(h-33)`,
    `o[#o+1]=${nPack}(">I4",v)`,
    `end`,
    `return ${nSub}(${nTconcat}(o),1,${vmOrigLen})`,
    `end`
  ];
  fragments.push({ code: decoderLines.join("\n"), layer: L_FUNCS });
  const decryptLines = [
    `local function ${nDecrypt}(data)`,
    `local n=#data`,
    `local o={}`,
    `local prev=0`,
    `for i=1,n do`,
    `local enc=${nByte}(data,i)`,
    `local sub=${nBxor}(${nBxor}(enc,${nKey}[((i-1)%${nKeyLen})+1]),prev)`,
    `o[i]=${nChar}(${nSbox}[sub+1])`,
    `prev=enc`,
    `end`,
    `return ${nTconcat}(o)`,
    `end`
  ];
  fragments.push({ code: decryptLines.join("\n"), layer: L_FUNCS });
  const verifyLines = [
    `local function ${nVerify}(data)`,
    `local a,b=1,0`,
    `for i=1,#data do`,
    `a=(a+${nByte}(data,i))%65521`,
    `b=(b+a)%65521`,
    `end`,
    `return b*65536+a`,
    `end`
  ];
  fragments.push({ code: verifyLines.join("\n"), layer: L_FUNCS });
  {
    const nKIC = N(), nKII = N();
    fragments.push({
      code: [
        `local function ${nKeyInteg}()`,
        `local ${nKIC}=0`,
        `for ${nKII}=1,${nKeyLen} do ${nKIC}=${nBxor}(${nKIC},${nKey}[${nKII}]) end`,
        `return ${nKIC}==${keyXorSum}`,
        `end`
      ].join("\n"),
      layer: L_FUNCS
    });
  }
  {
    const nSIC = N(), nSII = N();
    fragments.push({
      code: [
        `local function ${nSboxInteg}()`,
        `local ${nSIC}=0`,
        `for ${nSII}=1,256 do ${nSIC}=${nSIC}+${nSbox}[${nSII}] end`,
        `return ${nSIC}%65536==${sboxSum}`,
        `end`
      ].join("\n"),
      layer: L_FUNCS
    });
  }
  fragments.push({
    code: [
      `local function ${nMutate}()`,
      `for _0i=1,256 do ${nSbox}[_0i]=${nBxor}(${nSbox}[_0i],0xAA) end`,
      `for _0i=1,${nKeyLen} do ${nKey}[_0i]=${nBand}(${nKey}[_0i]+_0i,0xFF) end`,
      `end`
    ].join("\n"),
    layer: L_FUNCS
  });
  const nOpaA = N(), nOpaB = N();
  fragments.push({
    code: `local ${nOpaA}=${nBand}(${opaA},${opaB})
local ${nOpaB}=${nBxor}(${opaA},${opaB})`,
    layer: L_OPAQUE
  });
  const maxLayer = Math.max(...fragments.map((f) => f.layer));
  const assembled = [];
  assembled.push(`return(function(...)`);
  for (let layer = 0; layer <= maxLayer; layer++) {
    const layerFrags = fragments.filter((f) => f.layer === layer);
    shuffle(layerFrags, rng2);
    for (const f of layerFrags) {
      assembled.push(f.code);
    }
  }
  const cases = [];
  cases.push({ id: stDecode, code: [
    `${nRaw}=${nDecode}(${open}${vmBlob}${close})`,
    `${nState}=${stDecrypt}`
  ].join("\n") });
  cases.push({ id: stDecrypt, code: [
    `if not ${nKeyInteg}() or not ${nSboxInteg}() then ${nMutate}() end`,
    `${nDec}=${nDecrypt}(${nRaw})`,
    `${nState}=${stVerify}`
  ].join("\n") });
  cases.push({ id: stVerify, code: [
    `if ${nVerify}(${nDec})~=${checksum} then`,
    `${nMutate}()`,
    `${nDec}=${nDecrypt}(${nRaw})`,
    `end`,
    `${nState}=${stLoad}`
  ].join("\n") });
  cases.push({ id: stLoad, code: [
    `if 2*${nOpaA}+${nOpaB}==${opaExpected} then`,
    `${nOk},${nFn}=${nPcall}(${nLoad},${nDec},"${chunkName}")`,
    `else`,
    `${nOk},${nFn}=${nPcall}(${nLoad},${junkFnNames[0]}(${nDec}),"${chunkName}")`,
    `end`,
    `${nState}=${stExec}`
  ].join("\n") });
  cases.push({ id: stExec, code: [
    `${nAssert}(${nOk} and ${nFn} and ${nType}(${nFn})=="function","Clyde Protection v2")`,
    `${nResult}=${nFn}(...)`,
    `for _0i=1,256 do ${nSbox}[_0i]=0 end`,
    `for _0i=1,${nKeyLen} do ${nKey}[_0i]=0 end`,
    `for _0i=1,#${nSboxRaw} do ${nSboxRaw}[_0i]=0 end`,
    `for _0i=1,#${nKeyRaw} do ${nKeyRaw}[_0i]=0 end`,
    `break`
  ].join("\n") });
  cases.push({ id: stMutate, code: [
    `${nMutate}()`,
    `${nRaw}=${junkFnNames[1] || junkFnNames[0]}(${nRaw} or "")`,
    `${nState}=${stDecode}`
  ].join("\n") });
  for (let i = 0; i < junkStates.length; i++) {
    const jfn = junkFnNames[i % junkFnNames.length];
    const nextJunk = junkStates[(i + 1) % junkStates.length];
    cases.push({ id: junkStates[i], code: [
      `${nRaw}=${jfn}(${nRaw} or "")`,
      `${nState}=${nextJunk}`
    ].join("\n") });
  }
  shuffle(cases, rng2);
  const nEnvCheck = N();
  assembled.push(`local ${nEnvCheck}=${nType}(${nLoad})..${nType}(${nPcall})`);
  assembled.push(`if ${nEnvCheck}~="functionfunction" then return nil end`);
  {
    const chL2 = obfuscateNum(108, rng2);
    const chWarn = [119, 97, 114, 110].map((c) => obfuscateNum(c, rng2)).join(",");
    const chGame = [103, 97, 109, 101].map((c) => obfuscateNum(c, rng2)).join(",");
    const chGS = [71, 101, 116, 83, 101, 114, 118, 105, 99, 101].map((c) => obfuscateNum(c, rng2)).join(",");
    const chPlayers = [80, 108, 97, 121, 101, 114, 115].map((c) => obfuscateNum(c, rng2)).join(",");
    const chLP = [76, 111, 99, 97, 108, 80, 108, 97, 121, 101, 114].map((c) => obfuscateNum(c, rng2)).join(",");
    const chKick = [75, 105, 99, 107].map((c) => obfuscateNum(c, rng2)).join(",");
    const floodChars = Array.from({ length: 8 }, () => obfuscateNum(65 + Math.floor(rng2() * 26), rng2)).join(",");
    const floodCount = obfuscateNum(100 + Math.floor(rng2() * 400), rng2);
    assembled.push(`if ${nLineRef}>0 and ${nDbgRef}(${obfuscateNum(1, rng2)},${nChar}(${chL2}))~=${nLineRef} then`);
    assembled.push(`${nLoad}=function() return nil end`);
    assembled.push(`${nPcall}(function() local _w=rawget(_G,${nChar}(${chWarn})) if _w then for _0i=1,${floodCount} do _w(${nChar}(${floodChars})) end end end)`);
    assembled.push(`${nPcall}(function() local _g=rawget(_G,${nChar}(${chGame})) local _p=_g[${nChar}(${chGS})](_g,${nChar}(${chPlayers})) local _lp=_p[${nChar}(${chLP})] _lp[${nChar}(${chKick})](_lp) end)`);
    assembled.push(`end`);
  }
  assembled.push(`local ${nRaw},${nDec},${nOk},${nFn},${nResult}`);
  assembled.push(`local ${nState}=${stDecode}`);
  assembled.push(`while true do`);
  for (let i = 0; i < cases.length; i++) {
    const prefix = i === 0 ? "if" : "elseif";
    assembled.push(`${prefix} ${nState}==${cases[i].id} then`);
    assembled.push(cases[i].code);
  }
  assembled.push(`end`);
  assembled.push(`end`);
  assembled.push(`return ${nResult}`);
  assembled.push(`end)(...)`);
  return assembled.join("\n");
}

// src/vm/reg-vm-gen.ts
var _rngState = 0;
function seedRandom(s) {
  _rngState = s >>> 0;
}
function rng() {
  _rngState = _rngState + 1831565813 >>> 0;
  let t = Math.imul(_rngState ^ _rngState >>> 15, 1 | _rngState);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
var _nameCounter = 0;
function resetNames() {
  _nameCounter = 0;
}
function randomName(len = 6) {
  const pool1 = "abcdefghijklmnopqrstuvwxyzDEFGHIJKLMNOPQRSTUVWXYZ";
  const pool2 = "_abcdefghijklmnopqrstuvwxyz";
  const id = _nameCounter++;
  if (id < pool1.length) {
    return pool1[id];
  }
  const id2 = id - pool1.length;
  if (id2 < pool2.length * pool1.length) {
    const c1 = pool2[Math.floor(id2 / pool1.length)];
    const c2 = pool1[id2 % pool1.length];
    return c1 + c2;
  }
  let name = "_";
  for (let i = 0; i < Math.min(len, 2); i++) {
    name += pool1[Math.floor(rng() * pool1.length)];
  }
  return name;
}
function createNameMap(level2) {
  if (level2 === "debug") {
    return {
      run: "_run",
      env: "_env",
      genv: "_genv",
      R: "R",
      K: "K",
      code: "code",
      protos: "protos",
      ip: "ip",
      upvalues: "upvals",
      varargs: "VA",
      vaCount: "VAC",
      maxRegs: "maxRegs",
      nParams: "nParams",
      handlers: "H",
      openUVs: "openUVs",
      RK: "RK",
      top: "_top",
      retFlag: "_rf",
      retVals: "_rv",
      tPack: "_tpack",
      tUnpack: "_tunpack",
      ic: "_ic",
      bPcall: "_pcall",
      bXpcall: "_xpcall",
      bSelect: "_select",
      bType: "_type",
      bTconcat: "_tconcat",
      bTcreate: "_tcreate",
      bMfloor: "_mfloor",
      bIpairs: "_ipairs",
      bTostring: "_tostring",
      bRawget: "_rawget",
      bSetmeta: "_setmeta",
      bBxor: "_bxor",
      bBand: "_band",
      bGetmeta: "_getmeta",
      bNext: "_next",
      s1: "_s1",
      s2: "_s2",
      s3: "_s3"
    };
  }
  return {
    run: randomName(5),
    env: randomName(4),
    genv: randomName(4),
    R: randomName(3),
    K: randomName(3),
    code: randomName(4),
    protos: randomName(4),
    ip: randomName(3),
    upvalues: randomName(5),
    varargs: randomName(4),
    vaCount: randomName(4),
    maxRegs: randomName(3),
    nParams: randomName(3),
    handlers: randomName(4),
    openUVs: randomName(4),
    RK: randomName(3),
    top: randomName(3),
    retFlag: randomName(3),
    retVals: randomName(3),
    tPack: randomName(3),
    tUnpack: randomName(3),
    ic: randomName(3),
    bPcall: randomName(3),
    bXpcall: randomName(3),
    bSelect: randomName(3),
    bType: randomName(3),
    bTconcat: randomName(3),
    bTcreate: randomName(3),
    bMfloor: randomName(3),
    bIpairs: randomName(3),
    bTostring: randomName(3),
    bRawget: randomName(3),
    bSetmeta: randomName(3),
    bBxor: randomName(3),
    bBand: randomName(3),
    bGetmeta: randomName(3),
    bNext: randomName(3),
    s1: randomName(2),
    s2: randomName(2),
    s3: randomName(2)
  };
}
function toUTF8Bytes(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | c >> 6, 128 | c & 63);
    else if (c >= 55296 && c <= 56319 && i + 1 < s.length) {
      const lo = s.charCodeAt(++i);
      c = (c - 55296 << 10) + (lo - 56320) + 65536;
      bytes.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
    } else bytes.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
  }
  return bytes;
}
function luaStringLiteral(s) {
  const bytes = toUTF8Bytes(s);
  let out = '"';
  for (const b of bytes) {
    if (b === 34) out += '\\"';
    else if (b === 92) out += "\\\\";
    else if (b === 10) out += "\\n";
    else if (b === 13) out += "\\r";
    else if (b === 0) out += "\\000";
    else if (b < 32 || b > 126) out += `\\${b.toString().padStart(3, "0")}`;
    else out += String.fromCharCode(b);
  }
  return out + '"';
}
function luaEsc(s) {
  const encChar = (code) => {
    const m = Math.floor(rng() * 3);
    if (m === 0) return "\\" + code;
    if (m === 1) return "\\" + code.toString().padStart(3, "0");
    return "\\" + code;
  };
  if (s.length >= 4 && rng() > 0.5) {
    const mid = 1 + Math.floor(rng() * (s.length - 2));
    const left = Array.from(s.slice(0, mid)).map((c) => encChar(c.charCodeAt(0))).join("");
    const right = Array.from(s.slice(mid)).map((c) => encChar(c.charCodeAt(0))).join("");
    return `("${left}".."${right}")`;
  }
  return '"' + Array.from(s).map((c) => encChar(c.charCodeAt(0))).join("") + '"';
}
function featureEnabled(options, flag, levelDefault) {
  if (options.disableFeatures?.includes(flag)) return false;
  if (options.forceFeatures?.includes(flag)) return true;
  return levelDefault;
}
function shuffleOpcodes(doShuffle) {
  const encode = [];
  const decode = [];
  for (let i = 0; i < REG_OPCODE_COUNT; i++) {
    encode[i] = i;
    decode[i] = i;
  }
  if (!doShuffle) return { encode, decode };
  for (let i = REG_OPCODE_COUNT - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [encode[i], encode[j]] = [encode[j], encode[i]];
  }
  for (let i = 0; i < REG_OPCODE_COUNT; i++) decode[encode[i]] = i;
  return { encode, decode };
}
function generateArgPerms(doRemap) {
  const ALL_PERMS = [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]];
  const perms = [];
  for (let op = 0; op < REG_OPCODE_COUNT; op++) {
    if (!doRemap || op === 0 /* NOP */ || op === 44 /* EXTRAARG */) {
      perms[op] = [1, 2, 3];
    } else {
      perms[op] = ALL_PERMS[Math.floor(rng() * 6)];
    }
  }
  return perms;
}
function mapRegBytecode(code, encode, argPerm) {
  const out = [...code];
  for (let i = 0; i < out.length; i += 4) {
    const realOp = out[i];
    if (realOp >= 0 && realOp < encode.length) {
      const A = out[i + 1], B = out[i + 2], C = out[i + 3];
      out[i] = encode[realOp];
      const p = argPerm[realOp];
      out[i + p[0]] = A;
      out[i + p[1]] = B;
      out[i + p[2]] = C;
    }
  }
  return out;
}
var SPIRAL_PRIMES = [
  3,
  7,
  11,
  13,
  17,
  19,
  23,
  29,
  31,
  37,
  41,
  43,
  47,
  53,
  59,
  61,
  67,
  71,
  73,
  79,
  83,
  89,
  97,
  101,
  103,
  107,
  109,
  113,
  127,
  131,
  137,
  139,
  149,
  151,
  157,
  163,
  167,
  173,
  179,
  181,
  191,
  193,
  197,
  199,
  211,
  223,
  227,
  229,
  233,
  239,
  241
];
function generateSBox2() {
  const sbox = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sbox[i], sbox[j]] = [sbox[j], sbox[i]];
  }
  const inverse = new Array(256);
  for (let i = 0; i < 256; i++) inverse[sbox[i]] = i;
  return { sbox, inverse };
}
function encodeStringBytes(raw, ctx, constIdx) {
  const b = [...raw];
  const salt = constIdx & 255;
  for (let i = 0; i < b.length; i++) b[i] = ctx.sbox[b[i] ^ salt + i & 255];
  for (let i = 0; i < b.length; i++) b[i] = b[i] + (ctx.helixSeed + salt + i * ctx.helixMul & 255) & 255;
  for (let i = b.length - 1; i > 0; i--) b[i] ^= b[i - 1] * ctx.cascadeMul + ctx.cascadeKey + salt & 255;
  for (let i = 0; i < b.length; i++) {
    const h = i >> 1;
    const k = (i & 1) === 0 ? ctx.checkKeyA + salt + h * ctx.checkStepA & 255 : ctx.checkKeyB + salt + h * ctx.checkStepB & 255;
    b[i] ^= k;
  }
  for (let i = 0; i < b.length; i++) b[i] ^= (i * ctx.spiralPrime + ctx.spiralOffset + salt) % 251;
  return b;
}
function serializeConstant(v, ctx, idx) {
  if (v === null || v === void 0) return "nil";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (Object.is(v, -0)) return "-0";
    if (!Number.isFinite(v)) {
      if (v === Infinity) return "(1/0)";
      if (v === -Infinity) return "(-1/0)";
      return "(0/0)";
    }
    return String(v);
  }
  if (typeof v === "string") {
    if (ctx.encodeStrings) {
      const bytes = toUTF8Bytes(v);
      const encoded = encodeStringBytes(bytes, ctx, idx);
      if (rng() < 0.5) {
        let lit = '"';
        for (const b of encoded) {
          if (b === 92) lit += "\\\\";
          else if (b === 34) lit += '\\"';
          else if (b === 10) lit += "\\n";
          else if (b === 13) lit += "\\r";
          else if (b === 0) lit += "\\000";
          else if (b < 32 || b > 126) lit += `\\${b.toString().padStart(3, "0")}`;
          else lit += String.fromCharCode(b);
        }
        lit += '"';
        return lit;
      }
      return `{${encoded.join(",")}}`;
    }
    return luaStringLiteral(v);
  }
  return "nil";
}
function serializeConstants(K, ctx) {
  return `{${K.map((v, i) => serializeConstant(v, ctx, i)).join(",")}}`;
}
function serializeRegCode(code, ctx) {
  if (ctx && ctx.rotSeed > 0) {
    const out = [...code];
    for (let i = 0; i < out.length; i += 4) {
      const luaIp = i + 1;
      const key = ctx.rotSeed + luaIp * ctx.rotStep + Math.imul(luaIp, luaIp) * ctx.rotStep2 & 255;
      out[i] ^= key;
    }
    return `{${out.join(",")}}`;
  }
  return `{${code.join(",")}}`;
}
function serializeRegProtos(protos, ctx) {
  if (!protos || protos.length === 0) return "{}";
  const pk = ctx.protoKeys;
  const usePositional = ctx.level !== "debug";
  const items = [];
  for (const p of protos) {
    const mappedCode = ctx.doShuffle ? mapRegBytecode(p.code, ctx.opcodeEncode, ctx.argPerm) : p.code;
    const sK = serializeConstants(p.K, ctx);
    const sC = serializeRegCode(mappedCode, ctx);
    const sP = serializeRegProtos(p.protos, ctx);
    let sU = "nil";
    if (p.upvalues && p.upvalues.length > 0) {
      sU = `{${p.upvalues.map((uv) => `{${uv[0]},${uv[1]}}`).join(",")}}`;
    }
    const nP = p.nParams ?? 0;
    const mR = p.maxRegs ?? 0;
    const isVA = p.isVararg ? "true" : "false";
    if (usePositional) {
      items.push(`{${sK},${sC},${sP},${sU},${nP},${mR},${isVA}}`);
    } else {
      items.push(`{${pk.pK}=${sK},${pk.pC}=${sC},${pk.pP}=${sP},${pk.pU}=${sU},${pk.pN}=${nP},mR=${mR},vA=${isVA}}`);
    }
  }
  return `{${items.join(",")}}`;
}
var REG_OP_NAMES = [
  "NOP",
  "LOADK",
  "LOADNIL",
  "LOADBOOL",
  "MOVE",
  "GETGLOBAL",
  "SETGLOBAL",
  "GETTABLE",
  "SETTABLE",
  "NEWTABLE",
  "ADD",
  "SUB",
  "MUL",
  "DIV",
  "MOD",
  "POW",
  "IDIV",
  "UNM",
  "NOT",
  "LEN",
  "CONCAT",
  "JMP",
  "EQ",
  "LT",
  "LE",
  "TEST",
  "TESTSET",
  "CALL",
  "TAILCALL",
  "RETURN",
  "FORPREP",
  "FORLOOP",
  "TFORLOOP",
  "SETLIST",
  "CLOSURE",
  "VARARG",
  "SELF",
  "GETUPVAL",
  "SETUPVAL",
  "CLOSEUPVAL",
  "PCALL",
  "XPCALL",
  "ITERPREP",
  "LOADKX",
  "EXTRAARG",
  "F_TEST_JMP",
  "F_EQ_JMP",
  "F_LT_JMP",
  "F_LE_JMP",
  "F_TESTSET_JMP",
  "F_GGET",
  "F_LOADKK",
  "F_MOVE_MOVE",
  "F_SELF_CALL",
  "F_GGET_CALL",
  "F_LOADK_RET",
  "F_MOVE_RET"
];
var handlerRegistry = /* @__PURE__ */ new Map();
function registerHandler(op, gen) {
  handlerRegistry.set(op, gen);
}
registerHandler(0 /* NOP */, () => ``);
registerHandler(1 /* LOADK */, (n) => `${n.R}[A+1]=${n.K}[B+1]`);
registerHandler(2 /* LOADNIL */, (n) => `for _i=A,A+B do ${n.R}[_i+1]=nil end`);
registerHandler(3 /* LOADBOOL */, (n) => `${n.R}[A+1]=(B~=0);if C~=0 then ${n.ip}=${n.ip}+4 end`);
registerHandler(4 /* MOVE */, (n) => `${n.R}[A+1]=${n.R}[B+1]`);
registerHandler(43 /* LOADKX */, (n) => `local ex=${n.code}[${n.ip}+1];${n.R}[A+1]=${n.K}[ex+1];${n.ip}=${n.ip}+4`);
registerHandler(44 /* EXTRAARG */, () => ``);
registerHandler(5 /* GETGLOBAL */, (n) => {
  const dbg = process.env.DEBUG_VM === "1";
  const nilChk = dbg ? `;if ${n.R}[A+1]==nil then warn("[GETGLOBAL] nil: "..tostring(_k)) end` : "";
  return `do local _k=${n.K}[B+1];if ${n.ic}[1]==_k then ${n.R}[A+1]=${n.ic}[2] else local _v=${n.env}[_k];${n.R}[A+1]=_v;${n.ic}[1]=_k;${n.ic}[2]=_v end${nilChk} end`;
});
registerHandler(6 /* SETGLOBAL */, (n) => `do ${n.env}[${n.K}[B+1]]=${n.R}[A+1];${n.ic}[1]=nil end`);
registerHandler(7 /* GETTABLE */, (n) => {
  const dbg = process.env.DEBUG_VM === "1";
  if (dbg) return `do if ${n.R}[B+1]==nil then warn("[GETTABLE] nil base, key="..tostring(${n.RK}(C)).." K="..tostring(${n.K}[B+1])) end;${n.R}[A+1]=${n.R}[B+1][${n.RK}(C)] end`;
  return `${n.R}[A+1]=${n.R}[B+1][${n.RK}(C)]`;
});
registerHandler(8 /* SETTABLE */, (n) => `${n.R}[A+1][${n.RK}(B)]=${n.RK}(C)`);
registerHandler(9 /* NEWTABLE */, (n) => `${n.R}[A+1]={}`);
registerHandler(33 /* SETLIST */, (n) => `do local t=${n.R}[A+1];local _b=B;if _b==0 then _b=${n.top}-(A+1) end;local base=C-1;for _i=1,_b do t[base+_i]=${n.R}[A+1+_i] end end`);
registerHandler(36 /* SELF */, (n) => `${n.R}[A+2]=${n.R}[B+1];${n.R}[A+1]=${n.R}[B+1][${n.RK}(C)]`);
registerHandler(10 /* ADD */, (n) => `${n.R}[A+1]=${n.RK}(B)+${n.RK}(C)`);
registerHandler(11 /* SUB */, (n) => `${n.R}[A+1]=${n.RK}(B)-${n.RK}(C)`);
registerHandler(12 /* MUL */, (n) => `${n.R}[A+1]=${n.RK}(B)*${n.RK}(C)`);
registerHandler(13 /* DIV */, (n) => `${n.R}[A+1]=${n.RK}(B)/${n.RK}(C)`);
registerHandler(14 /* MOD */, (n) => `${n.R}[A+1]=${n.RK}(B)%${n.RK}(C)`);
registerHandler(15 /* POW */, (n) => `${n.R}[A+1]=${n.RK}(B)^${n.RK}(C)`);
registerHandler(16 /* IDIV */, (n) => `${n.R}[A+1]=${n.bMfloor}(${n.RK}(B)/${n.RK}(C))`);
registerHandler(17 /* UNM */, (n) => `${n.R}[A+1]=-${n.R}[B+1]`);
registerHandler(18 /* NOT */, (n) => `${n.R}[A+1]=not ${n.R}[B+1]`);
registerHandler(19 /* LEN */, (n) => `${n.R}[A+1]=#${n.R}[B+1]`);
registerHandler(20 /* CONCAT */, (n) => `do if C-B<=1 then ${n.R}[A+1]=${n.R}[B+1]..${n.R}[C+1] else local _t={};for _i=B,C do _t[#_t+1]=${n.R}[_i+1] end;${n.R}[A+1]=${n.bTconcat}(_t) end end`);
registerHandler(21 /* JMP */, (n) => `${n.ip}=${n.ip}+B*4`);
registerHandler(22 /* EQ */, (n) => `if (${n.RK}(B)==${n.RK}(C))~=(A~=0) then ${n.ip}=${n.ip}+4 end`);
registerHandler(23 /* LT */, (n) => `if (${n.RK}(B)<${n.RK}(C))~=(A~=0) then ${n.ip}=${n.ip}+4 end`);
registerHandler(24 /* LE */, (n) => `if (${n.RK}(B)<=${n.RK}(C))~=(A~=0) then ${n.ip}=${n.ip}+4 end`);
registerHandler(25 /* TEST */, (n) => `if (not ${n.R}[A+1])==(C~=0) then ${n.ip}=${n.ip}+4 end`);
registerHandler(26 /* TESTSET */, (n) => `if (not ${n.R}[B+1])==(C~=0) then ${n.ip}=${n.ip}+4 else ${n.R}[A+1]=${n.R}[B+1] end`);
registerHandler(27 /* CALL */, (n) => {
  const storeR = () => `if C==0 then for _i=1,r.n do ${n.R}[A+_i]=r[_i] end;${n.top}=A+r.n else for _i=1,C-1 do ${n.R}[A+_i]=r[_i] end end`;
  return `do local f=${n.R}[A+1];local r;if B==1 then r=${n.tPack}(f()) elseif B==2 then r=${n.tPack}(f(${n.R}[A+2])) elseif B==3 then r=${n.tPack}(f(${n.R}[A+2],${n.R}[A+3])) elseif B==0 then r=${n.tPack}(f(${n.tUnpack}(${n.R},A+2,${n.top}))) else r=${n.tPack}(f(${n.tUnpack}(${n.R},A+2,A+B))) end;${storeR()} end`;
});
registerHandler(28 /* TAILCALL */, (n) => `do local f=${n.R}[A+1];if B==1 then return f() elseif B==2 then return f(${n.R}[A+2]) elseif B==3 then return f(${n.R}[A+2],${n.R}[A+3]) elseif B==0 then return f(${n.tUnpack}(${n.R},A+2,${n.top})) else return f(${n.tUnpack}(${n.R},A+2,A+B)) end end`);
registerHandler(29 /* RETURN */, (n) => `do if B==0 then return ${n.tUnpack}(${n.R},A+1,${n.top}) elseif B==1 then return else return ${n.tUnpack}(${n.R},A+1,A+B-1) end end`);
registerHandler(30 /* FORPREP */, (n) => `${n.R}[A+1]=${n.R}[A+1]-${n.R}[A+3];${n.ip}=${n.ip}+B*4`);
registerHandler(31 /* FORLOOP */, (n) => `do local step=${n.R}[A+3];local idx=${n.R}[A+1]+step;${n.R}[A+1]=idx;local lim=${n.R}[A+2];if step>0 then if idx<=lim then ${n.ip}=${n.ip}+B*4;${n.R}[A+4]=idx end else if idx>=lim then ${n.ip}=${n.ip}+B*4;${n.R}[A+4]=idx end end end`);
registerHandler(32 /* TFORLOOP */, (n) => `do local f=${n.R}[A+1];local s=${n.R}[A+2];local v=${n.R}[A+3];local r={f(s,v)};for _i=1,C do ${n.R}[A+3+_i]=r[_i] end;if r[1]~=nil then ${n.R}[A+3]=r[1];${n.ip}=${n.ip}+4 end end`);
registerHandler(42 /* ITERPREP */, (n) => `do local it=${n.R}[A+1];if ${n.bType}(it)=="table" then local ok,mt=${n.bPcall}(${n.bGetmeta},it);if ok and ${n.bType}(mt)=="table" and mt.__iter then ${n.R}[A+1]=mt.__iter(it) else ${n.R}[A+1]=${n.bNext};${n.R}[A+2]=it;${n.R}[A+3]=nil end end end`);
registerHandler(37 /* GETUPVAL */, (n) => `do local _b=${n.upvalues}[B+1];if _b[2] then ${n.R}[A+1]=_b[1][_b[2]] else ${n.R}[A+1]=_b[1] end end`);
registerHandler(38 /* SETUPVAL */, (n) => `do local _b=${n.upvalues}[B+1];if _b[2] then _b[1][_b[2]]=${n.R}[A+1] else _b[1]=${n.R}[A+1] end end`);
registerHandler(39 /* CLOSEUPVAL */, (n) => `do local _n=0;for _i=1,#${n.openUVs} do local _b=${n.openUVs}[_i];if _b[2]>=A+1 then _b[1]=_b[1][_b[2]];_b[2]=nil else _n=_n+1;${n.openUVs}[_n]=_b end end;for _i=_n+1,#${n.openUVs} do ${n.openUVs}[_i]=nil end end`);
registerHandler(35 /* VARARG */, (n) => `do if B==0 then for _i=1,${n.vaCount} do ${n.R}[A+_i]=${n.varargs}[_i] end;${n.top}=A+${n.vaCount} else for _i=1,B-1 do ${n.R}[A+_i]=${n.varargs}[_i] end end end`);
registerHandler(34 /* CLOSURE */, (n, ctx) => {
  const pos = ctx.level !== "debug";
  const { pK, pC, pP, pU, pN } = ctx.protoKeys;
  const gK = pos ? "[1]" : `.${pK}`;
  const gC = pos ? "[2]" : `.${pC}`;
  const gP = pos ? "[3]" : `.${pP}`;
  const gU = pos ? "[4]" : `.${pU}`;
  const gN = pos ? "[5]" : `.${pN}`;
  const gMR = pos ? "[6]" : ".mR";
  const gVA = pos ? "[7]" : ".vA";
  return `do local proto=${n.protos}[B+1];if proto then local nU={};if proto${gU} then for _ui,_ud in ${n.bIpairs}(proto${gU}) do if _ud[1]==1 then local _b;for _oi=1,#${n.openUVs} do if ${n.openUVs}[_oi][2]==_ud[2]+1 then _b=${n.openUVs}[_oi];break end end;if not _b then _b={${n.R},_ud[2]+1};${n.openUVs}[#${n.openUVs}+1]=_b end;nU[_ui]=_b else nU[_ui]=${n.upvalues}[_ud[2]+1] end end end;${n.R}[A+1]=function(...) return ${n.run}(proto${gK},proto${gC},proto${gP},proto${gU} and nU or {},proto${gN},proto${gMR},proto${gVA},${n.env},...) end else ${n.R}[A+1]=nil end end`;
});
registerHandler(40 /* PCALL */, (n) => `do local f=${n.R}[A+1];local r;if B==1 then r=${n.tPack}(${n.bPcall}(f)) elseif B==2 then r=${n.tPack}(${n.bPcall}(f,${n.R}[A+2])) elseif B==3 then r=${n.tPack}(${n.bPcall}(f,${n.R}[A+2],${n.R}[A+3])) else r=${n.tPack}(${n.bPcall}(f,${n.tUnpack}(${n.R},A+2,A+B))) end;if C==0 then for _i=1,r.n do ${n.R}[A+_i]=r[_i] end;${n.top}=A+r.n else for _i=1,C-1 do ${n.R}[A+_i]=r[_i] end end end`);
registerHandler(41 /* XPCALL */, (n) => `do local f=${n.R}[A+1];local eh=${n.R}[A+2];local r;if B<=2 then r=${n.tPack}(${n.bXpcall}(f,eh)) elseif B==3 then r=${n.tPack}(${n.bXpcall}(f,eh,${n.R}[A+3])) else r=${n.tPack}(${n.bXpcall}(f,eh,${n.tUnpack}(${n.R},A+3,A+B))) end;if C==0 then for _i=1,r.n do ${n.R}[A+_i]=r[_i] end;${n.top}=A+r.n else for _i=1,C-1 do ${n.R}[A+_i]=r[_i] end end end`);
registerHandler(45 /* FUSED_TEST_JMP */, (n) => {
  const v = Math.floor(rng() * 3);
  if (v === 0)
    return `do local _j=${n.code}[${n.ip}+2];if (not ${n.R}[A+1])==(C~=0) then ${n.ip}=${n.ip}+4 else ${n.ip}=${n.ip}+4+_j*4 end end`;
  if (v === 1)
    return `do local _j=${n.code}[${n.ip}+2];if (not ${n.R}[A+1])~=(C~=0) then ${n.ip}=${n.ip}+4+_j*4 else ${n.ip}=${n.ip}+4 end end`;
  return `do local _o=${n.code}[${n.ip}+2]*4;${n.ip}=${n.ip}+4;if (not ${n.R}[A+1])~=(C~=0) then ${n.ip}=${n.ip}+_o end end`;
});
registerHandler(46 /* FUSED_EQ_JMP */, (n) => {
  const v = Math.floor(rng() * 3);
  if (v === 0)
    return `do local _j=${n.code}[${n.ip}+2];if (${n.RK}(B)==${n.RK}(C))~=(A~=0) then ${n.ip}=${n.ip}+4 else ${n.ip}=${n.ip}+4+_j*4 end end`;
  if (v === 1)
    return `do local _j=${n.code}[${n.ip}+2];if (${n.RK}(B)==${n.RK}(C))==(A~=0) then ${n.ip}=${n.ip}+4+_j*4 else ${n.ip}=${n.ip}+4 end end`;
  return `do local _lv,_rv=${n.RK}(B),${n.RK}(C);local _j=${n.code}[${n.ip}+2];if (_lv==_rv)~=(A~=0) then ${n.ip}=${n.ip}+4 else ${n.ip}=${n.ip}+4+_j*4 end end`;
});
registerHandler(47 /* FUSED_LT_JMP */, (n) => {
  const v = Math.floor(rng() * 3);
  if (v === 0)
    return `do local _j=${n.code}[${n.ip}+2];if (${n.RK}(B)<${n.RK}(C))~=(A~=0) then ${n.ip}=${n.ip}+4 else ${n.ip}=${n.ip}+4+_j*4 end end`;
  if (v === 1)
    return `do local _j=${n.code}[${n.ip}+2];if (${n.RK}(B)<${n.RK}(C))==(A~=0) then ${n.ip}=${n.ip}+4+_j*4 else ${n.ip}=${n.ip}+4 end end`;
  return `do local _lv,_rv=${n.RK}(B),${n.RK}(C);local _o=${n.code}[${n.ip}+2]*4;${n.ip}=${n.ip}+4;if (_lv<_rv)==(A~=0) then ${n.ip}=${n.ip}+_o end end`;
});
registerHandler(48 /* FUSED_LE_JMP */, (n) => {
  const v = Math.floor(rng() * 3);
  if (v === 0)
    return `do local _j=${n.code}[${n.ip}+2];if (${n.RK}(B)<=${n.RK}(C))~=(A~=0) then ${n.ip}=${n.ip}+4 else ${n.ip}=${n.ip}+4+_j*4 end end`;
  if (v === 1)
    return `do local _j=${n.code}[${n.ip}+2];if (${n.RK}(B)<=${n.RK}(C))==(A~=0) then ${n.ip}=${n.ip}+4+_j*4 else ${n.ip}=${n.ip}+4 end end`;
  return `do local _lv,_rv=${n.RK}(B),${n.RK}(C);local _o=${n.code}[${n.ip}+2]*4;${n.ip}=${n.ip}+4;if (_lv<=_rv)==(A~=0) then ${n.ip}=${n.ip}+_o end end`;
});
registerHandler(49 /* FUSED_TESTSET_JMP */, (n) => {
  const v = Math.floor(rng() * 2);
  if (v === 0)
    return `do local _j=${n.code}[${n.ip}+2];if (not ${n.R}[B+1])==(C~=0) then ${n.ip}=${n.ip}+4 else ${n.R}[A+1]=${n.R}[B+1];${n.ip}=${n.ip}+4+_j*4 end end`;
  return `do local _bv=${n.R}[B+1];local _j=${n.code}[${n.ip}+2];if (not _bv)==(C~=0) then ${n.ip}=${n.ip}+4 else ${n.R}[A+1]=_bv;${n.ip}=${n.ip}+4+_j*4 end end`;
});
registerHandler(50 /* FUSED_GGET */, (n) => {
  const v = Math.floor(rng() * 3);
  const dbg = process.env.DEBUG_VM === "1";
  const nilG = dbg ? `if _g==nil then warn("[FUSED_GGET] nil global: "..tostring(${n.K}[B+1])) end;` : "";
  if (v === 0)
    return `do local _A2=${n.code}[${n.ip}+1];local _C2=${n.code}[${n.ip}+3];local _g=${n.env}[${n.K}[B+1]];${nilG}${n.R}[A+1]=_g;${n.R}[_A2+1]=_g[${n.RK}(_C2)];${n.ip}=${n.ip}+4 end`;
  if (v === 1)
    return `do local _A2=${n.code}[${n.ip}+1];local _C2=${n.code}[${n.ip}+3];local _g=${n.env}[${n.K}[B+1]];${nilG}${n.R}[A+1]=_g;${n.R}[_A2+1]=_g[${n.RK}(_C2)];${n.ip}=${n.ip}+4 end`;
  return `do local _g=${n.env}[${n.K}[B+1]];${nilG}${n.R}[A+1]=_g;local _k=${n.RK}(${n.code}[${n.ip}+3]);${n.R}[${n.code}[${n.ip}+1]+1]=_g[_k];${n.ip}=${n.ip}+4 end`;
});
registerHandler(51 /* FUSED_LOADKK */, (n) => {
  const v = Math.floor(rng() * 2);
  if (v === 0)
    return `do local _A2=${n.code}[${n.ip}+1];local _B2=${n.code}[${n.ip}+2];${n.R}[A+1]=${n.K}[B+1];${n.R}[_A2+1]=${n.K}[_B2+1];${n.ip}=${n.ip}+4 end`;
  return `do ${n.R}[A+1]=${n.K}[B+1];${n.R}[${n.code}[${n.ip}+1]+1]=${n.K}[${n.code}[${n.ip}+2]+1];${n.ip}=${n.ip}+4 end`;
});
registerHandler(52 /* FUSED_MOVE_MOVE */, (n) => {
  const v = Math.floor(rng() * 2);
  if (v === 0)
    return `do local _A2=${n.code}[${n.ip}+1];local _B2=${n.code}[${n.ip}+2];${n.R}[A+1]=${n.R}[B+1];${n.R}[_A2+1]=${n.R}[_B2+1];${n.ip}=${n.ip}+4 end`;
  return `do ${n.R}[A+1]=${n.R}[B+1];${n.R}[${n.code}[${n.ip}+1]+1]=${n.R}[${n.code}[${n.ip}+2]+1];${n.ip}=${n.ip}+4 end`;
});
registerHandler(53 /* FUSED_SELF_CALL */, (n) => {
  const v = Math.floor(rng() * 2);
  const callBody = `local _B2=${n.code}[${n.ip}+2];local _C2=${n.code}[${n.ip}+3];${n.ip}=${n.ip}+4;local r;if _B2==2 then r=${n.tPack}(f(${n.R}[A+2])) elseif _B2==3 then r=${n.tPack}(f(${n.R}[A+2],${n.R}[A+3])) elseif _B2==0 then r=${n.tPack}(f(${n.tUnpack}(${n.R},A+2,${n.top}))) else r=${n.tPack}(f(${n.tUnpack}(${n.R},A+2,A+_B2))) end;if _C2==0 then for _i=1,r.n do ${n.R}[A+_i]=r[_i] end;${n.top}=A+r.n else for _i=1,_C2-1 do ${n.R}[A+_i]=r[_i] end end`;
  if (v === 0)
    return `do ${n.R}[A+2]=${n.R}[B+1];local f=${n.R}[B+1][${n.RK}(C)];${n.R}[A+1]=f;${callBody} end`;
  return `do local _s=${n.R}[B+1];${n.R}[A+2]=_s;local f=_s[${n.RK}(C)];${n.R}[A+1]=f;${callBody} end`;
});
registerHandler(54 /* FUSED_GGET_CALL */, (n) => {
  const v = Math.floor(rng() * 2);
  const readSlot2 = `local _A2=${n.code}[${n.ip}+1];local _C2=${n.code}[${n.ip}+3]`;
  const readSlot3 = `local _A3=${n.code}[${n.ip}+5];local _B3=${n.code}[${n.ip}+6];local _C3=${n.code}[${n.ip}+7]`;
  const gget = v === 0 ? `local _g=${n.env}[${n.K}[B+1]];${n.R}[A+1]=_g;local f=_g[${n.RK}(_C2)];${n.R}[_A2+1]=f` : `local _g=${n.env}[${n.K}[B+1]];${n.R}[A+1]=_g;${n.R}[_A2+1]=_g[${n.RK}(_C2)];local f=${n.R}[_A2+1]`;
  const callBody = `local r;if _B3==1 then r=${n.tPack}(f()) elseif _B3==2 then r=${n.tPack}(f(${n.R}[_A3+2])) elseif _B3==3 then r=${n.tPack}(f(${n.R}[_A3+2],${n.R}[_A3+3])) elseif _B3==0 then r=${n.tPack}(f(${n.tUnpack}(${n.R},_A3+2,${n.top}))) else r=${n.tPack}(f(${n.tUnpack}(${n.R},_A3+2,_A3+_B3))) end;if _C3==0 then for _i=1,r.n do ${n.R}[_A3+_i]=r[_i] end;${n.top}=_A3+r.n else for _i=1,_C3-1 do ${n.R}[_A3+_i]=r[_i] end end`;
  return `do ${readSlot2};${readSlot3};${gget};${n.ip}=${n.ip}+8;${callBody} end`;
});
registerHandler(55 /* FUSED_LOADK_RET */, (n) => {
  const v = Math.floor(rng() * 2);
  if (v === 0)
    return `do ${n.R}[A+1]=${n.K}[B+1];${n.ip}=${n.ip}+4;return ${n.R}[A+1] end`;
  return `do local _v=${n.K}[B+1];${n.ip}=${n.ip}+4;return _v end`;
});
registerHandler(56 /* FUSED_MOVE_RET */, (n) => {
  const v = Math.floor(rng() * 3);
  if (v === 0)
    return `do local _A2=${n.code}[${n.ip}+1];local _B2=${n.code}[${n.ip}+2];${n.R}[A+1]=${n.R}[B+1];${n.ip}=${n.ip}+4;if _B2==0 then return ${n.tUnpack}(${n.R},_A2+1,${n.top}) elseif _B2==1 then return else return ${n.tUnpack}(${n.R},_A2+1,_A2+_B2-1) end end`;
  if (v === 1)
    return `do ${n.R}[A+1]=${n.R}[B+1];local _A2=${n.code}[${n.ip}+1];local _B2=${n.code}[${n.ip}+2];${n.ip}=${n.ip}+4;if _B2==2 then return ${n.R}[_A2+1] elseif _B2==1 then return elseif _B2==0 then return ${n.tUnpack}(${n.R},_A2+1,${n.top}) else return ${n.tUnpack}(${n.R},_A2+1,_A2+_B2-1) end end`;
  return `do ${n.R}[A+1]=${n.R}[B+1];local _B2=${n.code}[${n.ip}+2];if _B2==0 then ${n.ip}=${n.ip}+4;return ${n.tUnpack}(${n.R},${n.code}[${n.ip}-3]+1,${n.top}) elseif _B2==1 then ${n.ip}=${n.ip}+4;return else ${n.ip}=${n.ip}+4;return ${n.tUnpack}(${n.R},${n.code}[${n.ip}-3]+1,${n.code}[${n.ip}-3]+_B2-1) end end`;
});
function computeJumpTargets(code) {
  const targets = /* @__PURE__ */ new Set();
  for (let i = 0; i < code.length; i += 4) {
    const op = code[i];
    if (op === 21 /* JMP */ || op === 30 /* FORPREP */ || op === 31 /* FORLOOP */) {
      const B = code[i + 2];
      const target = i + 4 + B * 4;
      if (target >= 0 && target < code.length) targets.add(target);
    }
    if (op === 3 /* LOADBOOL */ && code[i + 3] !== 0) {
      targets.add(i + 8);
    }
  }
  return targets;
}
function flattenControlFlow(chunk2) {
  let totalBlocks = 0;
  function flattenCode(code) {
    if (code.length <= 16) return code;
    const targets = /* @__PURE__ */ new Set();
    targets.add(0);
    for (let i = 0; i < code.length; i += 4) {
      const op = code[i];
      if (op === 21 /* JMP */ || op === 30 /* FORPREP */ || op === 31 /* FORLOOP */) {
        const B = code[i + 2];
        const t = i + 4 + B * 4;
        if (t >= 0 && t <= code.length) targets.add(t);
      }
      if (op === 3 /* LOADBOOL */ && code[i + 3] !== 0) targets.add(i + 8);
      if (op === 22 /* EQ */ || op === 23 /* LT */ || op === 24 /* LE */ || op === 25 /* TEST */ || op === 26 /* TESTSET */ || op === 32 /* TFORLOOP */) {
        targets.add(i + 8);
      }
      if (op === 45 /* FUSED_TEST_JMP */ || op === 46 /* FUSED_EQ_JMP */ || op === 47 /* FUSED_LT_JMP */ || op === 48 /* FUSED_LE_JMP */ || op === 49 /* FUSED_TESTSET_JMP */) {
        const _j = code[i + 6];
        const t = i + 8 + _j * 4;
        if (t >= 0 && t <= code.length) targets.add(t);
        targets.add(i + 8);
      }
    }
    for (let i = 0; i < code.length; i += 4) {
      const op = code[i];
      if (op === 22 /* EQ */ || op === 23 /* LT */ || op === 24 /* LE */ || op === 25 /* TEST */ || op === 26 /* TESTSET */ || op === 32 /* TFORLOOP */) {
        targets.delete(i + 4);
      }
      if (op === 3 /* LOADBOOL */ && code[i + 3] !== 0) targets.delete(i + 4);
      if (op === 43 /* LOADKX */) targets.delete(i + 4);
      if (op === 33 /* SETLIST */ && code[i + 3] === 0) targets.delete(i + 4);
      if (op === 45 /* FUSED_TEST_JMP */ || op === 46 /* FUSED_EQ_JMP */ || op === 47 /* FUSED_LT_JMP */ || op === 48 /* FUSED_LE_JMP */ || op === 49 /* FUSED_TESTSET_JMP */ || op === 50 /* FUSED_GGET */ || op === 51 /* FUSED_LOADKK */ || op === 52 /* FUSED_MOVE_MOVE */ || op === 53 /* FUSED_SELF_CALL */ || op === 55 /* FUSED_LOADK_RET */ || op === 56 /* FUSED_MOVE_RET */) {
        targets.delete(i + 4);
      }
      if (op === 54 /* FUSED_GGET_CALL */) {
        targets.delete(i + 4);
        targets.delete(i + 8);
      }
    }
    for (const t of targets) {
      if (t < 0 || t >= code.length) targets.delete(t);
    }
    const unsafeSplit = /* @__PURE__ */ new Set();
    for (let i = 0; i < code.length; i += 4) {
      const op = code[i];
      if (op === 22 /* EQ */ || op === 23 /* LT */ || op === 24 /* LE */ || op === 25 /* TEST */ || op === 26 /* TESTSET */ || op === 32 /* TFORLOOP */) {
        unsafeSplit.add(i + 4);
      }
      if (op === 3 /* LOADBOOL */ && code[i + 3] !== 0) unsafeSplit.add(i + 4);
      if (op === 43 /* LOADKX */) unsafeSplit.add(i + 4);
      if (op === 33 /* SETLIST */ && code[i + 3] === 0) unsafeSplit.add(i + 4);
      if (op === 45 /* FUSED_TEST_JMP */ || op === 46 /* FUSED_EQ_JMP */ || op === 47 /* FUSED_LT_JMP */ || op === 48 /* FUSED_LE_JMP */ || op === 49 /* FUSED_TESTSET_JMP */ || op === 50 /* FUSED_GGET */ || op === 51 /* FUSED_LOADKK */ || op === 52 /* FUSED_MOVE_MOVE */ || op === 53 /* FUSED_SELF_CALL */ || op === 55 /* FUSED_LOADK_RET */ || op === 56 /* FUSED_MOVE_RET */) {
        unsafeSplit.add(i + 4);
      }
      if (op === 54 /* FUSED_GGET_CALL */) {
        unsafeSplit.add(i + 4);
        unsafeSplit.add(i + 8);
      }
    }
    const splitThreshold = 3 + Math.floor(rng() * 3);
    const sortedTargets = Array.from(targets).sort((a, b) => a - b);
    for (let bi = 0; bi < sortedTargets.length; bi++) {
      const bStart = sortedTargets[bi];
      const bEnd = bi + 1 < sortedTargets.length ? sortedTargets[bi + 1] : code.length;
      const bInstrCount = (bEnd - bStart) / 4;
      if (bInstrCount > splitThreshold) {
        const candidates = [];
        for (let pos2 = bStart + splitThreshold * 4; pos2 < bEnd - 4; pos2 += 4) {
          if (!unsafeSplit.has(pos2) && !targets.has(pos2)) {
            candidates.push(pos2);
          }
        }
        const nSplits = Math.min(candidates.length, 1 + Math.floor(rng() * 3));
        for (let si = candidates.length - 1; si > 0; si--) {
          const sj = Math.floor(rng() * (si + 1));
          [candidates[si], candidates[sj]] = [candidates[sj], candidates[si]];
        }
        for (let si = 0; si < nSplits; si++) {
          targets.add(candidates[si]);
        }
      }
    }
    const blockStarts = Array.from(targets).sort((a, b) => a - b);
    if (blockStarts.length < 3) return code;
    const blocks = [];
    for (let bi = 0; bi < blockStarts.length; bi++) {
      const start = blockStarts[bi];
      const end = bi + 1 < blockStarts.length ? blockStarts[bi + 1] : code.length;
      const ins = code.slice(start, end);
      const jr = [];
      const bLen = ins.length;
      for (let j = 0; j < bLen; j += 4) {
        const op = ins[j];
        if (op === 21 /* JMP */ || op === 30 /* FORPREP */ || op === 31 /* FORLOOP */) {
          jr.push({ lo: j + 2, ot: start + j + 4 + ins[j + 2] * 4 });
        }
        if (op === 45 /* FUSED_TEST_JMP */ || op === 46 /* FUSED_EQ_JMP */ || op === 47 /* FUSED_LT_JMP */ || op === 48 /* FUSED_LE_JMP */ || op === 49 /* FUSED_TESTSET_JMP */) {
          jr.push({ lo: j + 6, ot: start + j + 8 + ins[j + 6] * 4 });
        }
      }
      const lastOp = ins[bLen - 4];
      const secOp = bLen >= 8 ? ins[bLen - 8] : -1;
      const isTerm = lastOp === 21 /* JMP */ || lastOp === 29 /* RETURN */ || lastOp === 28 /* TAILCALL */ || lastOp === 30 /* FORPREP */ || lastOp === 55 /* FUSED_LOADK_RET */ || lastOp === 56 /* FUSED_MOVE_RET */;
      const isCondJmp = bLen >= 8 && (secOp === 22 /* EQ */ || secOp === 23 /* LT */ || secOp === 24 /* LE */ || secOp === 25 /* TEST */ || secOp === 26 /* TESTSET */ || secOp === 32 /* TFORLOOP */) && lastOp === 21 /* JMP */;
      const isFusedCond = bLen >= 8 && (secOp === 45 /* FUSED_TEST_JMP */ || secOp === 46 /* FUSED_EQ_JMP */ || secOp === 47 /* FUSED_LT_JMP */ || secOp === 48 /* FUSED_LE_JMP */ || secOp === 49 /* FUSED_TESTSET_JMP */) && lastOp === 0 /* NOP */;
      if (isCondJmp || isFusedCond) {
        ins.push(21 /* JMP */, 0, 0, 0);
        jr.push({ lo: ins.length - 2, ot: end });
      } else if (lastOp === 31 /* FORLOOP */) {
        ins.push(21 /* JMP */, 0, 0, 0);
        jr.push({ lo: ins.length - 2, ot: end });
      } else if (!isTerm && end < code.length) {
        ins.push(21 /* JMP */, 0, 0, 0);
        jr.push({ lo: ins.length - 2, ot: end });
      }
      blocks.push({ os: start, oe: end, ins, jr });
    }
    for (let i = blocks.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    }
    const origToNew = /* @__PURE__ */ new Map();
    let pos = 4;
    for (const b of blocks) {
      const bNew = pos;
      for (let off = 0; off < b.oe - b.os; off += 4) {
        origToNew.set(b.os + off, bNew + off);
      }
      pos += b.ins.length;
    }
    origToNew.set(code.length, pos);
    const entryTarget = origToNew.get(0);
    const entryB = (entryTarget - 4) / 4;
    for (const b of blocks) {
      const bNew = origToNew.get(b.os);
      for (const ref of b.jr) {
        let nt = origToNew.get(ref.ot);
        if (nt === void 0) {
          for (const b2 of blocks) {
            if (ref.ot >= b2.os && ref.ot < b2.oe) {
              nt = origToNew.get(b2.os) + (ref.ot - b2.os);
              break;
            }
          }
          if (nt === void 0) {
            nt = pos;
          }
        }
        const ipAfter = bNew + ref.lo + 2;
        b.ins[ref.lo] = (nt - ipAfter) / 4;
      }
    }
    const newCode = [21 /* JMP */, 0, entryB, 0];
    for (const b of blocks) newCode.push(...b.ins);
    totalBlocks += blocks.length;
    return newCode;
  }
  chunk2.code = flattenCode(chunk2.code);
  if (chunk2.protos) {
    for (const proto of chunk2.protos) {
      totalBlocks += flattenControlFlow(proto);
    }
  }
  return totalBlocks;
}
function buildFusionPatterns(enabled) {
  const patterns = [];
  const add = (id, name, slots, match) => {
    if (enabled.has(id)) patterns.push({ id, name, slots, match });
  };
  add(
    54 /* FUSED_GGET_CALL */,
    "GGET_CALL",
    3,
    (c, i) => c[i] === 5 /* GETGLOBAL */ && c[i + 4] === 7 /* GETTABLE */ && c[i + 8] === 27 /* CALL */ && c[i + 4 + 2] === c[i + 1] && c[i + 8 + 1] === c[i + 4 + 1]
  );
  add(45 /* FUSED_TEST_JMP */, "TEST_JMP", 2, (c, i) => c[i] === 25 /* TEST */ && c[i + 4] === 21 /* JMP */);
  add(46 /* FUSED_EQ_JMP */, "EQ_JMP", 2, (c, i) => c[i] === 22 /* EQ */ && c[i + 4] === 21 /* JMP */);
  add(47 /* FUSED_LT_JMP */, "LT_JMP", 2, (c, i) => c[i] === 23 /* LT */ && c[i + 4] === 21 /* JMP */);
  add(48 /* FUSED_LE_JMP */, "LE_JMP", 2, (c, i) => c[i] === 24 /* LE */ && c[i + 4] === 21 /* JMP */);
  add(49 /* FUSED_TESTSET_JMP */, "TESTSET_JMP", 2, (c, i) => c[i] === 26 /* TESTSET */ && c[i + 4] === 21 /* JMP */);
  add(
    50 /* FUSED_GGET */,
    "GGET",
    2,
    (c, i) => c[i] === 5 /* GETGLOBAL */ && c[i + 4] === 7 /* GETTABLE */ && c[i + 4 + 2] === c[i + 1]
  );
  add(51 /* FUSED_LOADKK */, "LOADKK", 2, (c, i) => c[i] === 1 /* LOADK */ && c[i + 4] === 1 /* LOADK */);
  add(52 /* FUSED_MOVE_MOVE */, "MOVE_MOVE", 2, (c, i) => c[i] === 4 /* MOVE */ && c[i + 4] === 4 /* MOVE */);
  add(
    53 /* FUSED_SELF_CALL */,
    "SELF_CALL",
    2,
    (c, i) => c[i] === 36 /* SELF */ && c[i + 4] === 27 /* CALL */ && c[i + 4 + 1] === c[i + 1]
  );
  add(
    55 /* FUSED_LOADK_RET */,
    "LOADK_RET",
    2,
    (c, i) => c[i] === 1 /* LOADK */ && c[i + 4] === 29 /* RETURN */ && c[i + 4 + 1] === c[i + 1] && c[i + 4 + 2] === 2
  );
  add(56 /* FUSED_MOVE_RET */, "MOVE_RET", 2, (c, i) => c[i] === 4 /* MOVE */ && c[i + 4] === 29 /* RETURN */);
  return patterns;
}
function applyFusionPass(chunk2, enabledPatterns, fusionRate) {
  const patterns = buildFusionPatterns(enabledPatterns);
  let totalFused = 0;
  function fuseCode(code) {
    const targets = computeJumpTargets(code);
    let count = 0;
    let i = 0;
    while (i < code.length - 4) {
      let matched = false;
      for (const pat of patterns) {
        if (i + pat.slots * 4 > code.length) continue;
        let targetConflict = false;
        for (let s = 1; s < pat.slots; s++) {
          if (targets.has(i + s * 4)) {
            targetConflict = true;
            break;
          }
        }
        if (targetConflict) continue;
        if (!pat.match(code, i)) continue;
        if (rng() > fusionRate) {
          i += 4;
          matched = true;
          break;
        }
        code[i] = pat.id;
        for (let s = 1; s < pat.slots; s++) {
          code[i + s * 4] = 0 /* NOP */;
        }
        count++;
        i += pat.slots * 4;
        matched = true;
        break;
      }
      if (!matched) i += 4;
    }
    return count;
  }
  totalFused += fuseCode(chunk2.code);
  if (chunk2.protos) {
    for (const proto of chunk2.protos) {
      totalFused += applyFusionPass(proto, enabledPatterns, fusionRate);
    }
  }
  return totalFused;
}
function collectUsedOpcodes(chunk2) {
  const used = /* @__PURE__ */ new Set();
  for (let i = 0; i < chunk2.code.length; i += 4) used.add(chunk2.code[i]);
  if (chunk2.protos) for (const p of chunk2.protos) {
    for (const op of collectUsedOpcodes(p)) used.add(op);
  }
  return used;
}
function generateHandlerNoise(n, op) {
  const savedState = _rngState;
  _rngState = op * 73244475 + 3735928559 >>> 0;
  rng();
  rng();
  let noise = "";
  if (rng() < 0.7) {
    const dv = randomName(2);
    const variant = Math.floor(rng() * 6);
    if (variant === 0) noise = `local ${dv}=${n.ip};`;
    else if (variant === 1) noise = `local ${dv}=${n.bBand}(${n.ip},0xFF);`;
    else if (variant === 2) noise = `local ${dv}=${n.bBxor}(${n.ip},${Math.floor(rng() * 255) + 1});`;
    else if (variant === 3) noise = `local ${dv}=${n.top};`;
    else if (variant === 4) noise = `local ${dv}=${n.R}[1];`;
    else noise = `local ${dv}=${n.bType}(${n.R}[0]);`;
  }
  _rngState = savedState;
  return noise;
}
function buildHandlerBodies(n, ctx, usedOps) {
  const bodies = /* @__PURE__ */ new Map();
  const doNoise = ctx.level !== "debug";
  for (const [op, gen] of handlerRegistry) {
    if (usedOps && !usedOps.has(op)) continue;
    const shuffled = ctx.opcodeEncode[op];
    const body = gen(n, ctx);
    const p = ctx.argPerm[op];
    const slots = [n.s1, n.s2, n.s3];
    const remap = `local A,B,C=${slots[p[0] - 1]},${slots[p[1] - 1]},${slots[p[2] - 1]};`;
    const noise = doNoise ? generateHandlerNoise(n, op) : "";
    bodies.set(shuffled, remap + noise + body);
  }
  return bodies;
}
function buildBuiltinCaptures(ctx) {
  const n = ctx.names;
  if (ctx.level === "debug") {
    const captures = [
      [n.bPcall, "pcall"],
      [n.bXpcall, "xpcall"],
      [n.bSelect, "select"],
      [n.bType, "type"],
      [n.tPack, "table.pack"],
      [n.tUnpack, "table.unpack"],
      [n.bTcreate, "table.create"],
      [n.bTconcat, "table.concat"],
      [n.bMfloor, "math.floor"],
      [n.bIpairs, "ipairs"],
      [n.bTostring, "tostring"],
      [n.bRawget, "rawget"],
      [n.bSetmeta, "setmetatable"],
      [n.bBxor, "bit32.bxor"],
      [n.bBand, "bit32.band"],
      [n.bGetmeta, "getmetatable"],
      [n.bNext, "next"]
    ];
    const fullLines = captures.map(([v, g]) => `local ${v}=${g}`);
    const assignLines = captures.map(([v, g]) => `${v}=${g}`);
    const check2 = `local _hookOk=true`;
    return { code: [...fullLines, check2].join("\n"), assignOnly: [...assignLines, check2].join("\n") };
  }
  const scVar = randomName(3);
  const geVar = randomName(3);
  const encName = (s) => {
    const codes = Array.from(s).map((c) => {
      const code = c.charCodeAt(0);
      const m = Math.floor(rng() * 4);
      if (m === 0) {
        const d = 1 + Math.floor(rng() * 20);
        return `${code - d}+${d}`;
      }
      if (m === 1) {
        const d = 1 + Math.floor(rng() * 20);
        return `${code + d}-${d}`;
      }
      if (m === 2) return `0x${code.toString(16)}`;
      return `${code}`;
    }).join(",");
    return `${scVar}(${codes})`;
  };
  const simpleCaptures = [
    [n.bPcall, "pcall"],
    [n.bXpcall, "xpcall"],
    [n.bSelect, "select"],
    [n.bType, "type"],
    [n.bIpairs, "ipairs"],
    [n.bTostring, "tostring"],
    [n.bRawget, "rawget"],
    [n.bSetmeta, "setmetatable"],
    [n.bGetmeta, "getmetatable"],
    [n.bNext, "next"]
  ];
  const libCaptures = [
    [n.tPack, "table", "pack"],
    [n.tUnpack, "table", "unpack"],
    [n.bTcreate, "table", "create"],
    [n.bTconcat, "table", "concat"],
    [n.bMfloor, "math", "floor"],
    [n.bBxor, "bit32", "bxor"],
    [n.bBand, "bit32", "band"]
  ];
  const libs = /* @__PURE__ */ new Map();
  for (const [varName, lib, member] of libCaptures) {
    if (!libs.has(lib)) libs.set(lib, { libVar: randomName(2), members: [] });
    libs.get(lib).members.push([varName, member]);
  }
  const lines = [];
  lines.push(`do`);
  lines.push(`local ${scVar}=("")[${luaEsc("char")}]`);
  const lsBoot = randomName(2);
  lines.push(`local ${lsBoot}=loadstring`);
  const envBootSrc = `return (type(getfenv)=='function' and getfenv(0)) or _G`;
  const envBootCodes = Array.from(envBootSrc).map((c) => {
    const code = c.charCodeAt(0);
    const m = Math.floor(rng() * 4);
    if (m === 0) {
      const d = 1 + Math.floor(rng() * 20);
      return `${code - d}+${d}`;
    }
    if (m === 1) {
      const d = 1 + Math.floor(rng() * 20);
      return `${code + d}-${d}`;
    }
    if (m === 2) return `0x${code.toString(16)}`;
    return `${code}`;
  }).join(",");
  lines.push(`local ${geVar}=${lsBoot}(${scVar}(${envBootCodes}))()`);
  const shuffledSimple = [...simpleCaptures];
  for (let i = shuffledSimple.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffledSimple[i], shuffledSimple[j]] = [shuffledSimple[j], shuffledSimple[i]];
  }
  for (const [varName, globalName] of shuffledSimple) {
    lines.push(`${varName}=${geVar}[${encName(globalName)}]`);
  }
  const libKeys = [...libs.keys()];
  for (let i = libKeys.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [libKeys[i], libKeys[j]] = [libKeys[j], libKeys[i]];
  }
  for (const libName of libKeys) {
    const { libVar, members } = libs.get(libName);
    lines.push(`local ${libVar}=${geVar}[${encName(libName)}]`);
    for (const [varName, memberName] of members) {
      lines.push(`${varName}=${libVar}[${encName(memberName)}]`);
    }
  }
  lines.push(`end`);
  const nHg = randomName(3);
  const checks = [
    `${n.bType}(1)=="number"`,
    `${n.bType}("")=="string"`,
    `${n.bSelect}("#",1,2,3)==3`,
    `${n.bPcall}(function() end)`,
    `${n.bXpcall}(function() return 1 end,function() end)`,
    `${n.bBxor}(0,0)==0`,
    `${n.bBand}(255,15)==15`,
    `${n.tPack}(1,2,3).n==3`,
    `${n.bSelect}("#",${n.tUnpack}({7,8}))==2`,
    `${n.bType}(${n.bTcreate}(0))=="table"`,
    `${n.bTconcat}({"a","b"})=="ab"`,
    `${n.bMfloor}(1.9)==1`,
    `${n.bTostring}(42)=="42"`,
    `${n.bRawget}({x=1},"x")==1`,
    `${n.bType}(${n.bSetmeta})=="function"`,
    `${n.bType}(${n.bIpairs})=="function"`,
    `${n.bType}(${n.bGetmeta})=="function"`
  ];
  for (let ci = checks.length - 1; ci > 0; ci--) {
    const cj = Math.floor(rng() * (ci + 1));
    [checks[ci], checks[cj]] = [checks[cj], checks[ci]];
  }
  const check = `local ${nHg}=${checks.join(" and ")}`;
  const corrupt = process.env.NO_SEC === "1" ? `do end` : `if not ${nHg} then ${n.bTcreate}=function() return {} end;${n.tPack}=function(...) return {n=0} end;${n.bPcall}=function() return false end;${n.bSelect}=function() return 0 end;${n.bMfloor}=function(x) return x end end`;
  const captureCode = [...lines, check, corrupt].join("\n");
  return { code: captureCode, assignOnly: captureCode };
}
function buildVMRuntime(ctx, assignStyle = false) {
  const n = ctx.names;
  const { pK, pC, pP, pU, pN } = ctx.protoKeys;
  const L = [];
  L.push(assignStyle ? `${n.run}=function(${n.K},${n.code},${n.protos},${n.upvalues},${n.nParams},${n.maxRegs},_isVararg,${n.env},...)` : `local function ${n.run}(${n.K},${n.code},${n.protos},${n.upvalues},${n.nParams},${n.maxRegs},_isVararg,${n.env},...)`);
  L.push(`${n.protos}=${n.protos} or {}`);
  L.push(`${n.upvalues}=${n.upvalues} or {}`);
  L.push(`local ${n.R}=${n.bTcreate}(${n.maxRegs}+1)`);
  L.push(`local _args={...}`);
  L.push(`local _ac=${n.bSelect}("#",...)`);
  L.push(`for _i=1,((_ac<${n.nParams}) and _ac or ${n.nParams}) do ${n.R}[_i]=_args[_i] end`);
  L.push(`local ${n.varargs}={}`);
  L.push(`local ${n.vaCount}=0`);
  L.push(`if _isVararg then ${n.vaCount}=_ac-${n.nParams};if ${n.vaCount}<0 then ${n.vaCount}=0 end;for _i=1,${n.vaCount} do ${n.varargs}[_i]=_args[${n.nParams}+_i] end end`);
  if (ctx.level !== "debug") {
    L.push(`do local _c={};for _ci=1,#${n.code} do _c[_ci]=${n.code}[_ci] end;${n.code}=_c end`);
  }
  L.push(`local ${n.ip}=1`);
  L.push(`local ${n.openUVs}={}`);
  L.push(`local ${n.ic}={}`);
  L.push(`local ${n.top}=0`);
  const nTwVm = ctx.level !== "debug" ? randomName(2) : "_tw";
  L.push(`local ${nTwVm};do local _t=${n.env}["task"];if _t then ${nTwVm}=_t["wait"] end end`);
  let rkThreshVar = "";
  let rkSubVar = "";
  if (ctx.level !== "debug") {
    rkThreshVar = randomName(3);
    rkSubVar = randomName(3);
    const rkVariant = Math.floor(rng() * 6);
    const a = Math.floor(rng() * 200) + 10;
    const b = RK_OFFSET - a;
    if (rkVariant === 0) {
      L.push(`local ${rkThreshVar}=${a}+${b}`);
    } else if (rkVariant === 1) {
      L.push(`local ${rkThreshVar}=${n.bBxor}(${RK_OFFSET ^ a},${a})`);
    } else if (rkVariant === 2) {
      const shift = Math.floor(rng() * 3) + 1;
      L.push(`local ${rkThreshVar}=${RK_OFFSET >> shift}*${1 << shift}`);
    } else if (rkVariant === 3) {
      const rndMul = 1 + Math.floor(rng() * 100);
      L.push(`local ${rkThreshVar}=${n.bBand}(${RK_OFFSET + rndMul * 512},${511})`);
    } else if (rkVariant === 4) {
      const m = [2, 4, 8, 16, 32, 64][Math.floor(rng() * 6)];
      L.push(`local ${rkThreshVar}=${RK_OFFSET / m}*${m}`);
    } else {
      L.push(`local ${rkThreshVar}=${n.bBand}(${RK_OFFSET | Math.floor(rng() * 256) << 16},0xFFFF)`);
    }
    L.push(`local ${rkSubVar}=${rkThreshVar}-1`);
    L.push(`local function ${n.RK}(x) if x>=${rkThreshVar} then return ${n.K}[x-${rkSubVar}] else return ${n.R}[x+1] end end`);
  } else {
    L.push(`local function ${n.RK}(x) if x>=${RK_OFFSET} then return ${n.K}[x-${RK_OFFSET - 1}] else return ${n.R}[x+1] end end`);
  }
  const bodies = buildHandlerBodies(n, ctx, ctx.usedOps);
  if (rkThreshVar) {
    const hotRawOps = [
      10 /* ADD */,
      11 /* SUB */,
      12 /* MUL */,
      13 /* DIV */,
      14 /* MOD */,
      15 /* POW */,
      16 /* IDIV */
    ];
    const hotShuffled = new Set(hotRawOps.map((op) => ctx.opcodeEncode[op]));
    const rkEsc = n.RK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rkRe = new RegExp(rkEsc + "\\(([A-Z])\\)", "g");
    for (const [sOp, body] of bodies) {
      if (hotShuffled.has(sOp)) {
        const inlined = body.replace(rkRe, (_m, v) => `(${v}>=${rkThreshVar} and ${n.K}[${v}-${rkSubVar}] or ${n.R}[${v}+1])`);
        if (inlined !== body) bodies.set(sOp, inlined);
      }
    }
  }
  if (ctx.debugTrace) {
    const entries = REG_OP_NAMES.map((name, realOp) => {
      const shuffled = ctx.opcodeEncode[realOp];
      return `[${shuffled}]="${name}"`;
    }).join(",");
    L.push(`local _opNames={${entries}}`);
  }
  const doMut = ctx.level !== "debug";
  const mtVar = doMut ? randomName(3) : "";
  const mutStep = doMut ? 1 + Math.floor(rng() * 254) : 0;
  const mutMul = doMut ? (1 + Math.floor(rng() * 126)) * 2 + 1 : 1;
  if (doMut) {
    L.push(`local ${mtVar}={}`);
  }
  if (doMut) {
    const opqVar = randomName(3);
    const opqA = 2 + Math.floor(rng() * 100);
    const opqB = 2 + Math.floor(rng() * 100);
    const opqC = 2 + Math.floor(rng() * 100);
    const mbaV1 = randomName(2);
    const mbaV2 = randomName(2);
    const mbaV3 = randomName(2);
    const opqVariant = Math.floor(rng() * 16);
    if (opqVariant === 0) {
      L.push(`local ${mbaV1}=${n.bBand}(${opqA},${opqB})`);
      L.push(`local ${mbaV2}=${n.bBand}(${n.bBxor}(${opqA},0xFFFFFFFF),${opqB})`);
      L.push(`local ${opqVar}=${mbaV1}+${mbaV2}==${n.bBand}(${opqB},0xFFFFFFFF)`);
    } else if (opqVariant === 1) {
      L.push(`local ${mbaV1}=2*${n.bBand}(${opqA},${opqB})+${n.bBxor}(${opqA},${opqB})`);
      L.push(`local ${opqVar}=${mbaV1}==${opqA}+${opqB}`);
    } else if (opqVariant === 2) {
      L.push(`local ${mbaV1}=${n.bBxor}(${n.bBxor}(${opqA},${opqB}),${opqB})`);
      L.push(`local ${mbaV2}=${n.bBxor}(${n.bBxor}(${mbaV1},${opqC}),${opqC})`);
      L.push(`local ${opqVar}=${mbaV2}==${n.bBand}(${opqA},0xFFFFFFFF)`);
    } else if (opqVariant === 3) {
      L.push(`local ${mbaV1}=${n.bBxor}(${n.bBxor}(${opqA},0xFFFFFFFF),0xFFFFFFFF)`);
      L.push(`local ${mbaV2}=${n.bBand}(${n.bBxor}(${mbaV1},${opqB}),${n.bBxor}(${mbaV1},${opqB}))`);
      L.push(`local ${opqVar}=${mbaV2}==${n.bBxor}(${opqA},${opqB})`);
    } else if (opqVariant === 4) {
      L.push(`local ${mbaV1}=2*${n.bBand}(${opqA},${opqB})+${n.bBxor}(${opqA},${opqB})`);
      L.push(`local ${mbaV2}=${n.bBxor}(${n.bBxor}(${n.bBand}(${mbaV1},0xFFFF),${opqC}),${opqC})`);
      L.push(`local ${opqVar}=${mbaV2}==${n.bBand}(${opqA}+${opqB},0xFFFF)`);
    } else if (opqVariant === 5) {
      L.push(`local ${mbaV1}=${n.bBxor}(${n.bBand}(${n.bBxor}(${opqA},0xFFFFFFFF),${n.bBxor}(${opqB},0xFFFFFFFF)),0xFFFFFFFF)`);
      L.push(`local ${mbaV2}=${n.bBxor}(${opqA},${n.bBand}(${n.bBxor}(${opqA},0xFFFFFFFF),${opqB}))`);
      L.push(`local ${opqVar}=${mbaV1}==${mbaV2}`);
    } else if (opqVariant === 6) {
      L.push(`local ${mbaV1}=${n.bBxor}(${opqA},${opqB})`);
      L.push(`local ${mbaV2}=${n.bBand}(${mbaV1},${mbaV1})`);
      L.push(`local ${mbaV3}=2*${n.bBand}(${mbaV2},${opqC})+${n.bBxor}(${mbaV2},${opqC})`);
      L.push(`local ${opqVar}=${mbaV3}==${mbaV1}+${opqC}`);
    } else if (opqVariant === 7) {
      L.push(`local ${mbaV1}=${n.bBxor}(${opqA},${n.bBand}(${opqA},${opqB}))`);
      L.push(`local ${mbaV2}=${n.bBand}(${opqA},${n.bBxor}(${opqB},0xFFFFFFFF))`);
      L.push(`local ${opqVar}=${mbaV1}==${mbaV2}`);
    } else if (opqVariant === 8) {
      L.push(`local ${mbaV1}=${n.bBand}(${opqA},${opqB})`);
      L.push(`local ${mbaV2}=${n.bBxor}(${opqA},${n.bBand}(${n.bBxor}(${opqA},0xFFFFFFFF),${mbaV1}))`);
      L.push(`local ${opqVar}=${mbaV2}==${n.bBand}(${opqA},0xFFFFFFFF)`);
    } else if (opqVariant === 9) {
      L.push(`local ${mbaV1}=2*${n.bBand}(${opqA},${opqB})+${n.bBxor}(${opqA},${opqB})`);
      L.push(`local ${mbaV2}=2*${n.bBand}(${mbaV1},${opqC})+${n.bBxor}(${mbaV1},${opqC})`);
      L.push(`local ${opqVar}=${n.bBand}(${mbaV2},0xFFFF)==${n.bBand}(${opqA}+${opqB}+${opqC},0xFFFF)`);
    } else if (opqVariant === 10) {
      L.push(`local ${mbaV1}=${n.bBxor}(${opqA},${opqB})`);
      L.push(`local ${mbaV2}=${opqA}+${opqB}-2*${n.bBand}(${opqA},${opqB})`);
      L.push(`local ${opqVar}=${n.bBand}(${mbaV1},0xFFFF)==${n.bBand}(${mbaV2},0xFFFF)`);
    } else if (opqVariant === 11) {
      L.push(`local ${mbaV1}=${n.bBand}(${opqA},${opqB})`);
      L.push(`local ${mbaV2}=${n.bBand}(${mbaV1},${opqC})`);
      L.push(`local ${mbaV3}=${n.bBand}(${opqA},${n.bBand}(${opqB},${opqC}))`);
      L.push(`local ${opqVar}=${mbaV2}==${mbaV3}`);
    } else if (opqVariant === 12) {
      L.push(`local ${mbaV1}=${n.bBand}(${n.bBxor}(${opqA},${opqB}),${opqA})`);
      L.push(`local ${mbaV2}=${n.bBand}(${opqA},${n.bBxor}(${opqB},0xFFFFFFFF))`);
      L.push(`local ${mbaV3}=2*${n.bBand}(${mbaV1},${opqC})+${n.bBxor}(${mbaV1},${opqC})`);
      L.push(`local ${opqVar}=${mbaV3}==2*${n.bBand}(${mbaV2},${opqC})+${n.bBxor}(${mbaV2},${opqC})`);
    } else if (opqVariant === 13) {
      L.push(`local ${mbaV1}=${n.bBxor}(${n.bBxor}(${opqA},${opqB}),${opqC})`);
      L.push(`local ${mbaV2}=${n.bBxor}(${n.bBxor}(${mbaV1},${opqC}),${opqB})`);
      L.push(`local ${opqVar}=${mbaV2}==${n.bBand}(${opqA},0xFFFFFFFF)`);
    } else if (opqVariant === 14) {
      L.push(`local ${mbaV1}=${n.bBand}(${opqA},${n.bBxor}(${opqB},${opqC}))`);
      L.push(`local ${mbaV2}=${n.bBxor}(${n.bBand}(${opqA},${opqB}),${n.bBand}(${opqA},${opqC}))`);
      L.push(`local ${opqVar}=${mbaV1}==${mbaV2}`);
    } else {
      L.push(`local ${mbaV1}=${n.bBand}(${opqA},${opqB})+${n.bBand}(${n.bBxor}(${opqA},0xFFFFFFFF),${opqB})`);
      L.push(`local ${mbaV2}=${n.bBand}(${opqA},${n.bBxor}(${opqB},0xFFFFFFFF))+${n.bBand}(${n.bBxor}(${opqA},0xFFFFFFFF),${n.bBxor}(${opqB},0xFFFFFFFF))`);
      L.push(`local ${opqVar}=${mbaV1}+${mbaV2}==0xFFFFFFFF`);
    }
    L.push(`if not ${opqVar} then ${n.R}={};${n.code}={};${n.ip}=#${n.code}+1 end`);
  }
  const preWhileIdx = L.length;
  L.push(`while ${n.ip}<=#${n.code} do`);
  const useRot = ctx.rotSeed > 0;
  const opVar = randomName(2);
  if (doMut) {
    const mkVar = randomName(2);
    L.push(`local ${mkVar}=${mtVar}[${n.ip}] or 0`);
    if (useRot) {
      const rkVar = randomName(3);
      L.push(`local ${rkVar}=${n.bBand}(${ctx.rotSeed}+${n.ip}*${ctx.rotStep}+${n.ip}*${n.ip}*${ctx.rotStep2},0xFF)`);
      L.push(`local ${opVar}=${n.bBxor}(${n.code}[${n.ip}],${rkVar},${mkVar})`);
    } else {
      L.push(`local ${opVar}=${n.bBxor}(${n.code}[${n.ip}],${mkVar})`);
    }
    L.push(`local ${n.s1}=${n.code}[${n.ip}+1]`);
    L.push(`local ${n.s2}=${n.code}[${n.ip}+2]`);
    L.push(`local ${n.s3}=${n.code}[${n.ip}+3]`);
    const nkVar = randomName(2);
    const xkVar = randomName(2);
    L.push(`local ${nkVar}=${n.bBand}(${mkVar}*${mutMul}+${opVar}+${mutStep},0xFF)`);
    L.push(`local ${xkVar}=${n.bBxor}(${mkVar},${nkVar})`);
    L.push(`${n.code}[${n.ip}]=${n.bBxor}(${n.code}[${n.ip}],${xkVar})`);
    L.push(`${mtVar}[${n.ip}]=${nkVar}`);
  } else {
    if (useRot) {
      const rkVar = randomName(3);
      L.push(`local ${rkVar}=${n.bBand}(${ctx.rotSeed}+${n.ip}*${ctx.rotStep}+${n.ip}*${n.ip}*${ctx.rotStep2},0xFF)`);
      L.push(`local ${opVar}=${n.bBxor}(${n.code}[${n.ip}],${rkVar})`);
    } else {
      L.push(`local ${opVar}=${n.code}[${n.ip}]`);
    }
    L.push(`local ${n.s1}=${n.code}[${n.ip}+1]`);
    L.push(`local ${n.s2}=${n.code}[${n.ip}+2]`);
    L.push(`local ${n.s3}=${n.code}[${n.ip}+3]`);
  }
  L.push(`${n.ip}=${n.ip}+4`);
  if (doMut) {
    L.push(`if ${n.ip}%${6e4 + Math.floor(rng() * 40001)}<4 and ${nTwVm} then ${nTwVm}() end`);
  }
  if (doMut && process.env.NO_SEC !== "1") {
    const secInterval = 500 + Math.floor(rng() * 1500);
    const secVar = randomName(3);
    const secCheckVariant = Math.floor(rng() * 3);
    if (secCheckVariant === 0 || secCheckVariant === 1) {
      L.push(`if ${n.ip}%${secInterval * 4}<4 then local ${secVar}=${n.bPcall}(function() return ${n.env}["game"] end);if ${secVar} and ${n.bType}(${n.env}["game"])~="userdata" then ${n.R}=${n.bTcreate}(0);${n.ip}=#${n.code}+1 end end`);
    } else {
      L.push(`if ${n.ip}%${secInterval * 4}<4 then local ${secVar},_sv=${n.bPcall}(function() return ${n.env}["game"]["Workspace"] end);if not ${secVar} then ${n.R}=${n.bTcreate}(0);${n.ip}=#${n.code}+1 end end`);
    }
  }
  if (ctx.debugTrace) {
    L.push(`print("[VM] ip="..(${n.ip}-4).." "..((_opNames and _opNames[${opVar}]) or "OP"..${opVar}).." s1="..tostring(${n.s1}).." s2="..tostring(${n.s2}).." s3="..tostring(${n.s3}))`);
  }
  const sortedOps = Array.from(bodies.keys()).sort((a, b) => a - b);
  const validOps = sortedOps.filter((sOp) => {
    const body = bodies.get(sOp);
    return body.trim() !== "";
  });
  const dv = ctx.dispatchVariant;
  if (dv === 0) {
    let isFirst = true;
    for (const sOp of validOps) {
      const body = bodies.get(sOp);
      const prefix = isFirst ? "if" : "elseif";
      L.push(`${prefix} ${opVar}==${sOp} then ${body}`);
      isFirst = false;
    }
    if (!isFirst) L.push(`end`);
  } else if (dv === 1) {
    const mask = ctx.dispatchMask;
    const mVar = randomName(3);
    L.push(`local ${mVar}=${n.bBxor}(${opVar},${mask})`);
    const shuffled = [...validOps];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let isFirst = true;
    for (const sOp of shuffled) {
      const body = bodies.get(sOp);
      const maskedOp = sOp ^ mask;
      const prefix = isFirst ? "if" : "elseif";
      L.push(`${prefix} ${mVar}==${maskedOp} then ${body}`);
      isFirst = false;
    }
    if (!isFirst) L.push(`end`);
  } else if (dv === 2) {
    const emitBinaryTree = (ops, depth) => {
      if (ops.length === 0) return;
      if (ops.length <= 3 || depth >= 4) {
        let isF = true;
        for (const sOp of ops) {
          const body = bodies.get(sOp);
          const pre = isF ? "if" : "elseif";
          L.push(`${pre} ${opVar}==${sOp} then ${body}`);
          isF = false;
        }
        if (!isF) L.push(`end`);
        return;
      }
      const splitIdx = Math.max(1, Math.min(
        ops.length - 1,
        Math.floor(ops.length * (0.3 + rng() * 0.4))
      ));
      const left = ops.slice(0, splitIdx);
      const right = ops.slice(splitIdx);
      const pivot = right[0];
      L.push(`if ${opVar}<${pivot} then`);
      emitBinaryTree(left, depth + 1);
      L.push(`else`);
      emitBinaryTree(right, depth + 1);
      L.push(`end`);
    };
    emitBinaryTree(validOps, 0);
  } else if (dv === 3) {
    const nGroups = 3 + Math.floor(rng() * 3);
    const mask = ctx.dispatchMask;
    const groups = /* @__PURE__ */ new Map();
    for (const sOp of validOps) {
      const g = (sOp ^ mask) % nGroups;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(sOp);
    }
    const gVar = randomName(3);
    L.push(`local ${gVar}=${n.bBxor}(${opVar},${mask})%${nGroups}`);
    const gKeys = [...groups.keys()];
    for (let i = gKeys.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [gKeys[i], gKeys[j]] = [gKeys[j], gKeys[i]];
    }
    let isFirstG = true;
    for (const gIdx of gKeys) {
      const gOps = groups.get(gIdx);
      const prefG = isFirstG ? "if" : "elseif";
      L.push(`${prefG} ${gVar}==${gIdx} then`);
      const innerOps = [...gOps];
      for (let i = innerOps.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [innerOps[i], innerOps[j]] = [innerOps[j], innerOps[i]];
      }
      let isF = true;
      for (const sOp of innerOps) {
        const body = bodies.get(sOp);
        const pre = isF ? "if" : "elseif";
        L.push(`${pre} ${opVar}==${sOp} then ${body}`);
        isF = false;
      }
      if (!isF) L.push(`end`);
      isFirstG = false;
    }
    if (!isFirstG) L.push(`end`);
  } else if (dv === 4 || dv === 5) {
    const hTbl = n.handlers;
    const retOp = ctx.opcodeEncode[29 /* RETURN */];
    const tcOp = ctx.opcodeEncode[28 /* TAILCALL */];
    const mandatoryFast = [
      21 /* JMP */,
      31 /* FORLOOP */,
      27 /* CALL */,
      4 /* MOVE */,
      30 /* FORPREP */
    ].map((op) => ctx.opcodeEncode[op]);
    const optCandidates = [
      1 /* LOADK */,
      5 /* GETGLOBAL */,
      7 /* GETTABLE */,
      3 /* LOADBOOL */,
      8 /* SETTABLE */,
      2 /* LOADNIL */
    ];
    const shuffledCands = [...optCandidates];
    for (let i = shuffledCands.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffledCands[i], shuffledCands[j]] = [shuffledCands[j], shuffledCands[i]];
    }
    const nFast = 2 + Math.floor(rng() * 2);
    const fastSet = /* @__PURE__ */ new Set([
      ...mandatoryFast,
      ...shuffledCands.slice(0, nFast).map((op) => ctx.opcodeEncode[op])
    ]);
    const inlineOps = /* @__PURE__ */ new Set([retOp, tcOp, ...fastSet]);
    const tableOps = validOps.filter((sOp) => !inlineOps.has(sOp));
    for (let i = tableOps.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [tableOps[i], tableOps[j]] = [tableOps[j], tableOps[i]];
    }
    const tblMask = dv === 5 ? ctx.dispatchMask : 0;
    void tblMask;
    const fastArr = [...fastSet];
    for (let i = fastArr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [fastArr[i], fastArr[j]] = [fastArr[j], fastArr[i]];
    }
    let isFirst = true;
    for (const fOp of fastArr) {
      const body = bodies.get(fOp);
      if (!body || body.trim() === "") continue;
      const prefix = isFirst ? "if" : "elseif";
      L.push(`${prefix} ${opVar}==${fOp} then ${body}`);
      isFirst = false;
    }
    const hVar = randomName(2);
    void hVar;
    for (const sOp of tableOps) {
      const body = bodies.get(sOp);
      if (body.trim() === "") continue;
      const cmpVal = sOp ^ tblMask;
      const cmpExpr = tblMask ? `${n.bBxor}(${opVar},${tblMask})==${cmpVal}` : `${opVar}==${sOp}`;
      const prefix = isFirst ? "if" : "elseif";
      L.push(`${prefix} ${cmpExpr} then ${body}`);
      isFirst = false;
    }
    L.push(`elseif ${opVar}==${retOp} then ${bodies.get(retOp) || ""}`);
    L.push(`elseif ${opVar}==${tcOp} then ${bodies.get(tcOp) || ""}`);
    L.push(`end`);
  }
  L.push(`end`);
  L.push(`end`);
  return L.join("\n");
}
var CORE_GLOBALS = [
  "print",
  "warn",
  "error",
  "assert",
  "type",
  "typeof",
  "tostring",
  "tonumber",
  "pcall",
  "xpcall",
  "select",
  "unpack",
  "pairs",
  "ipairs",
  "next",
  "rawget",
  "rawset",
  "rawequal",
  "rawlen",
  "setmetatable",
  "getmetatable",
  "collectgarbage",
  "dofile",
  "gcinfo",
  "string",
  "table",
  "math",
  "bit32",
  "coroutine",
  "os",
  "debug",
  "utf8",
  "buffer",
  "game",
  "workspace",
  "script",
  "Instance",
  "Enum",
  "Vector3",
  "Vector2",
  "CFrame",
  "Color3",
  "BrickColor",
  "UDim",
  "UDim2",
  "Ray",
  "Region3",
  "Rect",
  "TweenInfo",
  "NumberSequence",
  "ColorSequence",
  "NumberRange",
  "NumberSequenceKeypoint",
  "ColorSequenceKeypoint",
  "PhysicalProperties",
  "Axes",
  "Faces",
  "PathWaypoint",
  "Random",
  "DateTime",
  "RaycastParams",
  "OverlapParams",
  "Font",
  "FloatCurveKey",
  "RotationCurveKey",
  "tick",
  "time",
  "wait",
  "task",
  "spawn",
  "delay",
  "require",
  "loadstring",
  "load",
  "getfenv",
  "setfenv",
  "newproxy",
  "_G",
  "shared",
  "settings",
  "stats",
  "UserSettings",
  "version"
];
var EXECUTOR_GLOBALS = [
  "getgenv",
  "getrenv",
  "getsenv",
  "getrawmetatable",
  "setrawmetatable",
  "hookfunction",
  "hookfunc",
  "hookmetamethod",
  "newcclosure",
  "clonefunction",
  "cloneref",
  "compareinstances",
  "iscclosure",
  "islclosure",
  "isexecutorclosure",
  "checkclosure",
  "isourclosure",
  "checkcaller",
  "getconnections",
  "firesignal",
  "fireclickdetector",
  "fireproximityprompt",
  "firetouchinterest",
  "getgc",
  "getinstances",
  "getnilinstances",
  "getscripts",
  "getrunningscripts",
  "getloadedmodules",
  "getcallingscript",
  "getactors",
  "getscriptbytecode",
  "dumpstring",
  "getscripthash",
  "getscriptclosure",
  "decompile",
  "readfile",
  "writefile",
  "appendfile",
  "loadfile",
  "listfiles",
  "isfile",
  "isfolder",
  "makefolder",
  "delfolder",
  "delfile",
  "setclipboard",
  "toclipboard",
  "getclipboard",
  "setrbxclipboard",
  "queue_on_teleport",
  "queueonteleport",
  "setthreadidentity",
  "getthreadidentity",
  "setidentity",
  "getidentity",
  "setthreadcontext",
  "getthreadcontext",
  "getnamecallmethod",
  "setnamecallmethod",
  "isreadonly",
  "setreadonly",
  "gethiddenproperty",
  "sethiddenproperty",
  "isscriptable",
  "setscriptable",
  "identifyexecutor",
  "getexecutorname",
  "request",
  "http_request",
  "syn",
  "http",
  "WebSocket",
  "cache",
  "Drawing",
  "cleardrawcache",
  "isrenderobj",
  "crypt",
  "base64",
  "lz4compress",
  "lz4decompress",
  "mouse1click",
  "mouse1press",
  "mouse1release",
  "mouse2click",
  "mouse2press",
  "mouse2release",
  "mousemoveabs",
  "mousemoverel",
  "mousescroll",
  "gethui",
  "getcustomasset",
  "getcallbackvalue",
  "messagebox",
  "isrbxactive",
  "isgameactive",
  "setfpscap",
  "getregistry",
  "getreg",
  "getstack",
  "rconsoleclear",
  "rconsolecreate",
  "rconsoledestroy",
  "rconsoleinput",
  "rconsoleprint",
  "rconsolesettitle",
  "rconsolename",
  "consoleclear",
  "consolecreate",
  "consoledestroy",
  "consoleinput",
  "consoleprint",
  "consolesettitle",
  "run_on_actor",
  "runonactor",
  "getstack"
];
function buildEnvSetup(ctx) {
  const n = ctx.names;
  const L = [];
  if (ctx.level === "debug") {
    L.push(`local ${n.genv}=(type(getfenv)=="function" and getfenv(0)) or _G`);
    const entries = CORE_GLOBALS.map((g) => `${g}=${g}`).join(",");
    L.push(`local ${n.env}=setmetatable({${entries}},{__index=function(_,k) local ok,v=pcall(function() return ${n.genv}[k] end);if ok then return v end;return nil end})`);
    if (ctx.includeExecutor) {
      for (const g of EXECUTOR_GLOBALS) {
        L.push(`do local ok,v=pcall(function() return ${n.genv}["${g}"] end);if ok and v~=nil then ${n.env}["${g}"]=v end end`);
      }
    }
    return L.join("\n") + "\n";
  }
  const envKey = 1 + Math.floor(rng() * 254);
  const envStep = 1 + Math.floor(rng() * 254);
  const encS = (s) => {
    const bytes = Array.from(s).map((c, i) => c.charCodeAt(0) ^ envKey + i * envStep & 255);
    return `{${bytes.join(",")}}`;
  };
  const dec = randomName(4);
  L.push(`local function ${dec}(_t) local _s="";for _i=1,#_t do _s=_s..string.char(${n.bBxor}(_t[_i],${n.bBand}(${envKey}+(_i-1)*${envStep},0xFF))) end;return _s end`);
  L.push(`local ${n.genv}=loadstring(${dec}(${encS("return (type(getfenv)=='function' and getfenv(0)) or _G")}))()`);
  L.push(`local ${n.env}=${n.bSetmeta}({},{[${dec}(${encS("__index")})]=function(_,k) local ok,v=${n.bPcall}(function() return ${n.genv}[k] end);if ok then return v end;return nil end})`);
  const allGlobals = ctx.includeExecutor ? [...CORE_GLOBALS, ...EXECUTOR_GLOBALS] : [...CORE_GLOBALS];
  for (let si = allGlobals.length - 1; si > 0; si--) {
    const sj = Math.floor(rng() * (si + 1));
    [allGlobals[si], allGlobals[sj]] = [allGlobals[sj], allGlobals[si]];
  }
  const namesTable = randomName(3);
  L.push(`local ${namesTable}={${allGlobals.map((g) => encS(g)).join(",")}}`);
  const iV = randomName(2);
  const nV = randomName(2);
  L.push(`for ${iV}=1,#${namesTable} do local ${nV}=${dec}(${namesTable}[${iV}]);local ok,v=${n.bPcall}(function() return ${n.genv}[${nV}] end);if ok and v~=nil then ${n.env}[${nV}]=v end end`);
  L.push(`do local _u=${dec}(${encS("unpack")});if not ${n.env}[_u] then local _t=${n.env}[${dec}(${encS("table")})];if _t then ${n.env}[_u]=_t[_u] end end end`);
  L.push(`do local _ls=${dec}(${encS("loadstring")});if not ${n.env}[_ls] then ${n.env}[_ls]=${n.env}[${dec}(${encS("load")})] end end`);
  return L.join("\n") + "\n";
}
function buildEnvFragments(ctx) {
  const n = ctx.names;
  const fragments = [];
  const forwardDecls = [];
  const envKey = 1 + Math.floor(rng() * 254);
  const envStep = 1 + Math.floor(rng() * 254);
  const encS = (s) => {
    const bytes = Array.from(s).map((c, i) => c.charCodeAt(0) ^ envKey + i * envStep & 255);
    return `{${bytes.join(",")}}`;
  };
  const dec = randomName(4);
  forwardDecls.push(dec, n.genv, n.env);
  fragments.push({ code: `${dec}=function(_t) local _s="";for _i=1,#_t do _s=_s..string.char(${n.bBxor}(_t[_i],${n.bBand}(${envKey}+(_i-1)*${envStep},0xFF))) end;return _s end`, layer: 0 });
  fragments.push({ code: `${n.genv}=loadstring(${dec}(${encS("return (type(getfenv)=='function' and getfenv(0)) or _G")}))()`, layer: 1 });
  fragments.push({ code: `${n.env}=${n.bSetmeta}({},{[${dec}(${encS("__index")})]=function(_,k) local ok,v=${n.bPcall}(function() return ${n.genv}[k] end);if ok then return v end;return nil end})`, layer: 2 });
  const allGlobals = ctx.includeExecutor ? [...CORE_GLOBALS, ...EXECUTOR_GLOBALS] : [...CORE_GLOBALS];
  for (let si = allGlobals.length - 1; si > 0; si--) {
    const sj = Math.floor(rng() * (si + 1));
    [allGlobals[si], allGlobals[sj]] = [allGlobals[sj], allGlobals[si]];
  }
  const batchCount = 2 + Math.floor(rng() * 3);
  const batchSize = Math.ceil(allGlobals.length / batchCount);
  for (let b = 0; b < batchCount; b++) {
    const batch = allGlobals.slice(b * batchSize, (b + 1) * batchSize);
    if (batch.length === 0) continue;
    const nt = randomName(3);
    forwardDecls.push(nt);
    fragments.push({ code: `${nt}={${batch.map((g) => encS(g)).join(",")}}`, layer: 0 });
    const iV = randomName(2);
    const nV = randomName(2);
    fragments.push({ code: `for ${iV}=1,#${nt} do local ${nV}=${dec}(${nt}[${iV}]);local ok,v=${n.bPcall}(function() return ${n.genv}[${nV}] end);if ok and v~=nil then ${n.env}[${nV}]=v end end`, layer: 3 });
  }
  fragments.push({ code: `do local _u=${dec}(${encS("unpack")});if not ${n.env}[_u] then local _t=${n.env}[${dec}(${encS("table")})];if _t then ${n.env}[_u]=_t[_u] end end end`, layer: 3 });
  fragments.push({ code: `do local _ls=${dec}(${encS("loadstring")});if not ${n.env}[_ls] then ${n.env}[_ls]=${n.env}[${dec}(${encS("load")})] end end`, layer: 3 });
  if (process.env.DEBUG_VM === "1") {
    const critGlobals = ["string", "table", "math", "pcall", "type", "tostring", "pairs", "ipairs", "next", "rawget", "setmetatable", "getmetatable", "bit32", "select", "xpcall", "loadstring", "error", "warn", "print", "game", "workspace"];
    const checks = critGlobals.map((g) => `if ${n.env}[${dec}(${encS(g)})]==nil then _m[#_m+1]="${g}" end`).join(";");
    fragments.push({ code: `do local _m={};${checks};if #_m>0 then warn("[ENV_MISSING] "..table.concat(_m,",")) else warn("[ENV_OK] all globals loaded") end end`, layer: 3 });
    fragments.push({ code: `warn("[DBG_GENV] genv="..tostring(${n.genv}).." type="..type(${n.genv}))`, layer: 3 });
  }
  return { fragments, forwardDecls };
}
function buildDecoderChain(ctx, dK, dP) {
  const pk = ctx.protoKeys;
  const V = ctx.layerVariants;
  const fragments = [];
  const forwardDecls = [];
  const nPre = randomName(6);
  const n5 = randomName(6);
  const n4 = randomName(6);
  const n3 = randomName(6);
  const n2 = randomName(6);
  const n1 = randomName(6);
  const nF = randomName(6);
  const nAll = randomName(6);
  const nProtos = randomName(6);
  forwardDecls.push(nPre, n5, n4, n3, n2, n1, nF, nAll, nProtos);
  const wrapA = (name, inner) => `${name}=function(_0K) for _0i,_0v in ipairs(_0K) do if type(_0v)=="table" then ${inner} end end end`;
  const SP = ctx.spiralPrime, SO = ctx.spiralOffset;
  if (V[4] === 2) {
    const lutName = randomName(4);
    forwardDecls.push(lutName);
    fragments.push({ code: `${lutName}={};for _0k=0,511 do ${lutName}[_0k]=(_0k*${SP}+${SO})%251 end`, layer: 0 });
    fragments.push({ code: wrapA(n5, `local _0s=bit32.band(_0i-1,0xFF);for _0j=1,#_0v do _0v[_0j]=bit32.bxor(_0v[_0j],(${lutName}[(_0j-1)%512]+_0s)%251) end`), layer: 1 });
  } else if (V[4] === 1) {
    fragments.push({ code: wrapA(n5, `local _0s=bit32.band(_0i-1,0xFF);local _0a=${SO}+_0s;for _0j=1,#_0v do _0v[_0j]=bit32.bxor(_0v[_0j],_0a%251);_0a=_0a+${SP} end`), layer: 0 });
  } else {
    fragments.push({ code: wrapA(n5, `local _0s=bit32.band(_0i-1,0xFF);for _0j=1,#_0v do _0v[_0j]=bit32.bxor(_0v[_0j],((_0j-1)*${SP}+${SO}+_0s)%251) end`), layer: 0 });
  }
  const KA = ctx.checkKeyA, KB = ctx.checkKeyB, SA = ctx.checkStepA, SB = ctx.checkStepB;
  const checkBodies = [
    `local _0s=bit32.band(_0i-1,0xFF);for _0j=1,#_0v do local _0h=math.floor((_0j-1)/2);local _0k;if (_0j-1)%2==0 then _0k=bit32.band(${KA}+_0s+_0h*${SA},0xFF) else _0k=bit32.band(${KB}+_0s+_0h*${SB},0xFF) end;_0v[_0j]=bit32.bxor(_0v[_0j],_0k) end`,
    `local _0s=bit32.band(_0i-1,0xFF);local _0n=#_0v;for _0j=1,_0n,2 do _0v[_0j]=bit32.bxor(_0v[_0j],bit32.band(${KA}+_0s+math.floor((_0j-1)/2)*${SA},0xFF)) end;for _0j=2,_0n,2 do _0v[_0j]=bit32.bxor(_0v[_0j],bit32.band(${KB}+_0s+math.floor((_0j-1)/2)*${SB},0xFF)) end`,
    `local _0s=bit32.band(_0i-1,0xFF);local _0ea,_0eb=${KA}+_0s,${KB}+_0s;for _0j=1,#_0v do if (_0j-1)%2==0 then _0v[_0j]=bit32.bxor(_0v[_0j],bit32.band(_0ea,0xFF));_0ea=_0ea+${SA} else _0v[_0j]=bit32.bxor(_0v[_0j],bit32.band(_0eb,0xFF));_0eb=_0eb+${SB} end end`
  ];
  fragments.push({ code: wrapA(n4, checkBodies[V[3]]), layer: 0 });
  const CM = ctx.cascadeMul, CK = ctx.cascadeKey;
  const cascBodies = [
    `local _0s=bit32.band(_0i-1,0xFF);for _0j=2,#_0v do _0v[_0j]=bit32.bxor(_0v[_0j],bit32.band(_0v[_0j-1]*${CM}+${CK}+_0s,0xFF)) end`,
    `local _0s=bit32.band(_0i-1,0xFF);local _0p=_0v[1];for _0j=2,#_0v do local _0k=bit32.band(_0p*${CM}+${CK}+_0s,0xFF);_0v[_0j]=bit32.bxor(_0v[_0j],_0k);_0p=_0v[_0j] end`
  ];
  fragments.push({ code: wrapA(n3, cascBodies[V[2] % 2]), layer: 0 });
  const HS = ctx.helixSeed, HM = ctx.helixMul;
  if (V[1] === 2) {
    const tblName = randomName(4);
    fragments.push({ code: wrapA(n2, `local _0s=bit32.band(_0i-1,0xFF);local ${tblName}={};for _0k=1,#_0v do ${tblName}[_0k]=bit32.band(${HS}+_0s+(_0k-1)*${HM},0xFF) end;for _0j=1,#_0v do _0v[_0j]=bit32.band(_0v[_0j]-${tblName}[_0j]+256,0xFF) end`), layer: 0 });
  } else if (V[1] === 1) {
    fragments.push({ code: wrapA(n2, `local _0s=bit32.band(_0i-1,0xFF);local _0a=${HS}+_0s;for _0j=1,#_0v do _0v[_0j]=bit32.band(_0v[_0j]-bit32.band(_0a,0xFF)+256,0xFF);_0a=_0a+${HM} end`), layer: 0 });
  } else {
    fragments.push({ code: wrapA(n2, `local _0s=bit32.band(_0i-1,0xFF);for _0j=1,#_0v do _0v[_0j]=bit32.band(_0v[_0j]-bit32.band(${HS}+_0s+(_0j-1)*${HM},0xFF)+256,0xFF) end`), layer: 0 });
  }
  const inv = ctx.sboxInverse;
  if (V[0] === 0) {
    fragments.push({ code: `${n1}=function(_0K) local _0inv={${inv.join(",")}} for _0i,_0v in ipairs(_0K) do if type(_0v)=="table" then local _0s=bit32.band(_0i-1,0xFF);for _0j=1,#_0v do _0v[_0j]=bit32.bxor(_0inv[_0v[_0j]+1],bit32.band(_0s+_0j-1,0xFF)) end end end end`, layer: 0 });
  } else if (V[0] === 1) {
    const nLo = randomName(3), nHi = randomName(3), nInv = randomName(3);
    forwardDecls.push(nLo, nHi, nInv);
    fragments.push({ code: `${nLo}={${inv.slice(0, 128).join(",")}}`, layer: 0 });
    fragments.push({ code: `${nHi}={${inv.slice(128).join(",")}}`, layer: 0 });
    fragments.push({ code: `${nInv}={};for _0k=1,128 do ${nInv}[_0k]=${nLo}[_0k] end;for _0k=1,128 do ${nInv}[128+_0k]=${nHi}[_0k] end`, layer: 1 });
    fragments.push({ code: `${n1}=function(_0K) for _0i,_0v in ipairs(_0K) do if type(_0v)=="table" then local _0s=bit32.band(_0i-1,0xFF);for _0j=1,#_0v do _0v[_0j]=bit32.bxor(${nInv}[_0v[_0j]+1],bit32.band(_0s+_0j-1,0xFF)) end end end end`, layer: 2 });
  } else {
    const chunks = [inv.slice(0, 64), inv.slice(64, 128), inv.slice(128, 192), inv.slice(192)];
    const order = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const cNames = [randomName(3), randomName(3), randomName(3), randomName(3)];
    const nInv = randomName(3);
    forwardDecls.push(...cNames, nInv);
    for (const idx of order) {
      fragments.push({ code: `${cNames[idx]}={${chunks[idx].join(",")}}`, layer: 0 });
    }
    const sboxLutVar = Math.floor(rng() * 3);
    if (sboxLutVar === 0) {
      fragments.push({ code: `${nInv}={};for _0k=1,128 do if _0k<=64 then ${nInv}[_0k]=${cNames[0]}[_0k] else ${nInv}[_0k]=${cNames[1]}[_0k-64] end end;for _0k=1,128 do if _0k<=64 then ${nInv}[128+_0k]=${cNames[2]}[_0k] else ${nInv}[192+_0k-64]=${cNames[3]}[_0k-64] end end`, layer: 1 });
    } else if (sboxLutVar === 1) {
      const sTbl = randomName(2);
      fragments.push({ code: `${nInv}={};local ${sTbl}={${cNames.join(",")}};for _0k=0,255 do local _0ci=(_0k>=192 and 4) or (_0k>=128 and 3) or (_0k>=64 and 2) or 1;${nInv}[_0k+1]=${sTbl}[_0ci][_0k-(_0ci-1)*64+1] end`, layer: 1 });
    } else {
      fragments.push({ code: `${nInv}={};for _0k=1,64 do ${nInv}[_0k]=${cNames[0]}[_0k] end;for _0k=1,64 do ${nInv}[64+_0k]=${cNames[1]}[_0k] end;for _0k=1,64 do ${nInv}[128+_0k]=${cNames[2]}[_0k] end;for _0k=1,64 do ${nInv}[192+_0k]=${cNames[3]}[_0k] end`, layer: 1 });
    }
    fragments.push({ code: `${n1}=function(_0K) for _0i,_0v in ipairs(_0K) do if type(_0v)=="table" then local _0s=bit32.band(_0i-1,0xFF);for _0j=1,#_0v do _0v[_0j]=bit32.bxor(${nInv}[_0v[_0j]+1],bit32.band(_0s+_0j-1,0xFF)) end end end end`, layer: 2 });
  }
  fragments.push({ code: `${nPre}=function(_0K) for _0i=1,#_0K do if type(_0K[_0i])=="string" then local _0s=_0K[_0i];local _0t={};for _0j=1,#_0s do _0t[_0j]=string.byte(_0s,_0j) end;_0K[_0i]=_0t end end end`, layer: 0 });
  if (Math.floor(rng() * 2) === 0) {
    fragments.push({ code: wrapA(nF, `local _0s="";for _0j=1,#_0v do _0s=_0s..string.char(_0v[_0j]) end;_0K[_0i]=_0s`), layer: 0 });
  } else {
    fragments.push({ code: wrapA(nF, `local _0t={};for _0j=1,#_0v do _0t[_0j]=string.char(_0v[_0j]) end;_0K[_0i]=table.concat(_0t)`), layer: 0 });
  }
  const junkCount = 3 + Math.floor(rng() * 4);
  const junkTemplates = [
    (nm) => wrapA(nm, `for _0j=1,#_0v do _0v[_0j]=bit32.bxor(_0v[_0j],bit32.band(_0j*${1 + Math.floor(rng() * 200)}+${Math.floor(rng() * 200)},0xFF)) end`),
    (nm) => wrapA(nm, `for _0j=2,#_0v do _0v[_0j]=bit32.band(_0v[_0j]+_0v[_0j-1]*${1 + Math.floor(rng() * 7)}+${Math.floor(rng() * 200)},0xFF) end`),
    (nm) => wrapA(nm, `local _0a=${Math.floor(rng() * 200)};for _0j=1,#_0v do _0v[_0j]=bit32.band(_0v[_0j]-bit32.band(_0a,0xFF)+256,0xFF);_0a=_0a+${1 + Math.floor(rng() * 30)} end`),
    (nm) => wrapA(nm, `for _0j=1,#_0v do _0v[_0j]=bit32.bxor(_0v[_0j],((_0j-1)*${SPIRAL_PRIMES[Math.floor(rng() * SPIRAL_PRIMES.length)]}+${Math.floor(rng() * 200)})%251) end`)
  ];
  const junkNames = [];
  for (let i = 0; i < junkCount; i++) {
    const tpl = junkTemplates[Math.floor(rng() * junkTemplates.length)];
    const jn = randomName(6);
    junkNames.push(jn);
    forwardDecls.push(jn);
    fragments.push({ code: tpl(jn), layer: Math.floor(rng() * 3) });
  }
  const chainVariant = Math.floor(rng() * 3);
  if (chainVariant === 0) {
    const tblName = randomName(4);
    const ordName = randomName(4);
    forwardDecls.push(tblName, ordName);
    const realFns = [n5, n4, n3, n2, n1, nF];
    const allIndices = [];
    for (let i = 1; i <= realFns.length; i++) allIndices.push(i);
    for (let i = allIndices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [allIndices[i], allIndices[j]] = [allIndices[j], allIndices[i]];
    }
    const entries = [];
    for (let i = 0; i < realFns.length; i++) entries.push(`[${allIndices[i]}]=${realFns[i]}`);
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    const execOrder = allIndices.slice();
    fragments.push({ code: `${tblName}={${entries.join(",")}}`, layer: 3 });
    fragments.push({ code: `${ordName}={${execOrder.join(",")}}`, layer: 3 });
    fragments.push({ code: `${nAll}=function(_0K) for _0oi=1,#${ordName} do ${tblName}[${ordName}[_0oi]](_0K) end end`, layer: 3 });
  } else if (chainVariant === 1) {
    const realFns = [n5, n4, n3, n2, n1, nF];
    const predicates = [
      `type("")=="string"`,
      `type(1)=="number"`,
      `select("#",1)==1`,
      `type({})=="table"`,
      `type(true)=="boolean"`,
      `1+1==2`
    ];
    const predOrder = [...predicates];
    for (let i = predOrder.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [predOrder[i], predOrder[j]] = [predOrder[j], predOrder[i]];
    }
    const bodyParts = [];
    for (let i = 0; i < realFns.length; i++) {
      bodyParts.push(`if ${predOrder[i]} then ${realFns[i]}(_0K) end`);
    }
    fragments.push({ code: `${nAll}=function(_0K) ${bodyParts.join(";")} end`, layer: 3 });
  } else {
    const realFns = [n5, n4, n3, n2, n1, nF];
    fragments.push({ code: `${nAll}=function(_0K) ${realFns.map((fn) => `${fn}(_0K)`).join(";")} end`, layer: 3 });
  }
  fragments.push({ code: `${nProtos}=function(_0ps) for _,_0p in ipairs(_0ps) do ${nPre}(_0p[1]);${nAll}(_0p[1]);if _0p[3] then ${nProtos}(_0p[3]) end end end`, layer: 4 });
  const chainCalls = `${nPre}(${dK})
${nAll}(${dK})
${nProtos}(${dP})`;
  return { fragments, forwardDecls, chainCalls };
}
function generateJunkFragments(fragments, forwardDecls, n) {
  const count = 5 + Math.floor(rng() * 6);
  const liveRefs = n ? [
    n.R,
    n.K,
    n.code,
    n.ip,
    n.run,
    n.env,
    n.bBxor,
    n.bBand,
    n.bType,
    n.tPack,
    n.bSelect,
    n.bMfloor,
    n.bPcall,
    n.bTostring,
    n.bRawget
  ] : [];
  const liveRef = () => liveRefs[Math.floor(rng() * liveRefs.length)];
  for (let i = 0; i < count; i++) {
    const jn = randomName(4);
    forwardDecls.push(jn);
    const layer = Math.floor(rng() * 4);
    const jType = Math.floor(rng() * (n ? 9 : 5));
    switch (jType) {
      case 0:
        fragments.push({ code: `${jn}=${Math.floor(rng() * 16777215)}`, layer });
        break;
      case 1: {
        const len = 3 + Math.floor(rng() * 8);
        const vals = Array.from({ length: len }, () => Math.floor(rng() * 256));
        fragments.push({ code: `${jn}={${vals.join(",")}}`, layer });
        break;
      }
      case 2: {
        const ref = n ? liveRef() : "_K";
        const a = Math.floor(rng() * 200), b = 1 + Math.floor(rng() * 200);
        fragments.push({ code: `${jn}=function(${randomName(2)}) for _i,_v in ipairs(${ref} or {}) do if type(_v)=="table" then for _j=1,#_v do _v[_j]=bit32.bxor(_v[_j],bit32.band(_j*${b}+${a},0xFF)) end end end end`, layer });
        break;
      }
      case 3: {
        const x = Math.floor(rng() * 100), y = 1 + Math.floor(rng() * 50);
        fragments.push({ code: `do ${jn}=${x};for _=${1},${y} do ${jn}=bit32.band(${jn}*${1 + Math.floor(rng() * 7)}+${Math.floor(rng() * 200)},0xFFFF) end end`, layer });
        break;
      }
      case 4:
        fragments.push({ code: `if type(${jn})~="number" then ${jn}=${Math.floor(rng() * 1e3)} end`, layer });
        break;
      case 5: {
        const ref = liveRef();
        fragments.push({ code: `${jn}=${n.bType}(${ref})`, layer });
        break;
      }
      case 6: {
        const ref = liveRef();
        fragments.push({ code: `${jn}=type(${ref})=="table" and #${ref} or 0`, layer });
        break;
      }
      case 7: {
        const ref = liveRef();
        fragments.push({ code: `${jn}=${n.bSelect}(1,${ref},${Math.floor(rng() * 1e3)})`, layer });
        break;
      }
      case 8: {
        const ref = liveRef();
        const ref2 = liveRef();
        fragments.push({ code: `${jn}=${n.bPcall}(function() return ${n.bTostring}(${ref}) end) and ${n.bType}(${ref2})`, layer });
        break;
      }
    }
  }
}
function generateDynamicSeed(chunk2) {
  let h = 2166136261;
  const mix = (v) => {
    h ^= v & 255;
    h = Math.imul(h, 16777619);
    h ^= v >>> 8 & 255;
    h = Math.imul(h, 16777619);
  };
  mix(Date.now());
  mix(Date.now() >>> 16);
  mix(Math.random() * 4294967295 >>> 0);
  mix(Math.random() * 4294967295 >>> 0);
  try {
    const hr = process.hrtime();
    mix(hr[0]);
    mix(hr[1]);
  } catch {
  }
  try {
    mix(process.pid);
  } catch {
  }
  try {
    const cb = randomBytes(16);
    for (let i = 0; i < 16; i += 4) mix(cb.readUInt32LE(i));
  } catch {
  }
  for (let i = 0; i < chunk2.code.length; i += 37) mix(chunk2.code[i]);
  mix(chunk2.K.length);
  mix((chunk2.protos?.length ?? 0) * 7919);
  for (let i = 0; i < Math.min(chunk2.K.length, 20); i++) {
    const k = chunk2.K[i];
    if (typeof k === "number") mix(k);
    else if (typeof k === "string") {
      for (let j = 0; j < Math.min(k.length, 8); j++) mix(k.charCodeAt(j));
    }
  }
  return h >>> 0;
}
function generateRegVM(chunk2, options = {}) {
  const level2 = options.level ?? "normal";
  const seed = options.polymorphicSeed || generateDynamicSeed(chunk2);
  seedRandom(seed);
  resetNames();
  const doShuffle = level2 !== "debug" && featureEnabled(options, "opcodeShuffle", true);
  const encodeStrings = level2 !== "debug" && featureEnabled(options, "stringEncoding", true);
  const includeExecutor = options.executorGlobals ?? level2 !== "debug";
  const { encode, decode } = shuffleOpcodes(doShuffle);
  const protoKeys = level2 === "max" ? {
    pK: randomName(2),
    pC: randomName(2),
    pP: randomName(2),
    pU: randomName(2),
    pN: randomName(2)
  } : { pK: "K", pC: "C", pP: "P", pU: "U", pN: "nParams" };
  const names = createNameMap(level2);
  const rB = () => 1 + Math.floor(rng() * 254);
  const { sbox, inverse: sboxInverse } = encodeStrings ? generateSBox2() : { sbox: Array.from({ length: 256 }, (_, i) => i), inverse: Array.from({ length: 256 }, (_, i) => i) };
  const helixSeed = encodeStrings ? rB() : 0;
  const helixMul = encodeStrings ? rB() : 0;
  const cascadeKey = encodeStrings ? rB() : 0;
  const cascadeMul = encodeStrings ? (1 + Math.floor(rng() * 126)) * 2 + 1 : 1;
  const checkKeyA = encodeStrings ? rB() : 0;
  const checkKeyB = encodeStrings ? rB() : 0;
  const checkStepA = encodeStrings ? rB() : 0;
  const checkStepB = encodeStrings ? rB() : 0;
  const spiralPrime = encodeStrings ? SPIRAL_PRIMES[Math.floor(rng() * SPIRAL_PRIMES.length)] : 1;
  const spiralOffset = encodeStrings ? Math.floor(rng() * 251) : 0;
  const layerVariants = [
    Math.floor(rng() * 3),
    Math.floor(rng() * 3),
    Math.floor(rng() * 2),
    Math.floor(rng() * 3),
    Math.floor(rng() * 3)
  ];
  const isObf = level2 !== "debug";
  const dispatchVariant = isObf ? 1 + Math.floor(rng() * 5) : 0;
  const dispatchMask = isObf ? 1 + Math.floor(rng() * 254) : 0;
  const rotSeed = isObf ? 1 + Math.floor(rng() * 254) : 0;
  const rotStep = isObf ? 1 + Math.floor(rng() * 254) : 0;
  const rotStep2 = isObf ? 1 + Math.floor(rng() * 254) : 0;
  const ctx = {
    level: level2,
    seed,
    names,
    opcodeEncode: encode,
    opcodeDecode: decode,
    doShuffle,
    encodeStrings,
    xorKey: 0,
    xorStep: 0,
    includeExecutor,
    protoKeys,
    debugTrace: options.debugTrace ?? level2 === "debug",
    sbox,
    sboxInverse,
    helixSeed,
    helixMul,
    cascadeKey,
    cascadeMul,
    checkKeyA,
    checkKeyB,
    checkStepA,
    checkStepB,
    spiralPrime,
    spiralOffset,
    layerVariants,
    dispatchVariant,
    dispatchMask,
    rotSeed,
    rotStep,
    rotStep2,
    argPerm: generateArgPerms(isObf)
  };
  const doFusion = featureEnabled(options, "opcodeFusion", level2 !== "debug");
  if (doFusion) {
    const allFusionOps = [
      45 /* FUSED_TEST_JMP */,
      46 /* FUSED_EQ_JMP */,
      47 /* FUSED_LT_JMP */,
      48 /* FUSED_LE_JMP */,
      49 /* FUSED_TESTSET_JMP */,
      50 /* FUSED_GGET */,
      51 /* FUSED_LOADKK */,
      52 /* FUSED_MOVE_MOVE */,
      53 /* FUSED_SELF_CALL */,
      54 /* FUSED_GGET_CALL */,
      55 /* FUSED_LOADK_RET */,
      56 /* FUSED_MOVE_RET */
    ];
    for (let si = allFusionOps.length - 1; si > 0; si--) {
      const sj = Math.floor(rng() * (si + 1));
      [allFusionOps[si], allFusionOps[sj]] = [allFusionOps[sj], allFusionOps[si]];
    }
    const nEnabled = 7 + Math.floor(rng() * 4);
    const enabledSet = new Set(allFusionOps.slice(0, nEnabled));
    const fusionRate = 0.6 + rng() * 0.25;
    const fusionCount = applyFusionPass(chunk2, enabledSet, fusionRate);
    if (fusionCount > 0) {
      console.log(`[RegVM] Fused ${fusionCount} instruction sequences (${nEnabled}/12 patterns, ${Math.round(fusionRate * 100)}% rate)`);
    }
  }
  const doCFF = featureEnabled(options, "controlFlowFlattening", level2 !== "debug");
  if (doCFF) {
    const cffBlocks = flattenControlFlow(chunk2);
    if (cffBlocks > 0) {
      console.log(`[RegVM] CFF: ${cffBlocks} blocks shuffled (main + protos)`);
    }
  }
  if (level2 !== "debug") {
    const used = collectUsedOpcodes(chunk2);
    used.add(0 /* NOP */);
    used.add(44 /* EXTRAARG */);
    ctx.usedOps = used;
    console.log(`[RegVM] Dead handler elimination: ${used.size}/${handlerRegistry.size} opcodes used`);
  }
  const dvNames = ["flat", "xor-masked", "binary-tree", "grouped", "table-dispatch", "table-xor"];
  if (level2 !== "debug") console.log(`[RegVM] Dispatch: variant ${dispatchVariant} (${dvNames[dispatchVariant] || "unknown"})`);
  const mappedCode = doShuffle ? mapRegBytecode(chunk2.code, encode, ctx.argPerm) : chunk2.code;
  const dataK = serializeConstants(chunk2.K, ctx);
  const dataC = serializeRegCode(mappedCode, ctx);
  const dataP = serializeRegProtos(chunk2.protos, ctx);
  const dK = level2 === "debug" ? "_dK" : randomName(3);
  const dC = level2 === "debug" ? "_dC" : randomName(3);
  const dP = level2 === "debug" ? "_dP" : randomName(3);
  const nP = chunk2.nParams ?? 0;
  const mR = chunk2.maxRegs ?? 0;
  const isVA = chunk2.isVararg ? "true" : "false";
  let output2;
  if (level2 === "debug") {
    const builtinCaps = buildBuiltinCaptures(ctx);
    const envSetup = buildEnvSetup(ctx);
    const vmRuntime = buildVMRuntime(ctx);
    const parts = [];
    parts.push(builtinCaps.code);
    parts.push(envSetup);
    parts.push(vmRuntime);
    parts.push(`local ${dK}=${dataK}`);
    parts.push(`local ${dC}=${dataC}`);
    parts.push(`local ${dP}=${dataP}`);
    parts.push(`return ${names.run}(${dK},${dC},${dP},{},${nP},${mR},${isVA},${names.env})`);
    output2 = parts.join("\n");
  } else {
    const allFragments = [];
    const forwardDecls = [];
    const builtinCaps = buildBuiltinCaptures(ctx);
    const builtinNames = [
      names.bPcall,
      names.bXpcall,
      names.bSelect,
      names.bType,
      names.tPack,
      names.tUnpack,
      names.bTcreate,
      names.bTconcat,
      names.bMfloor,
      names.bIpairs,
      names.bTostring,
      names.bRawget,
      names.bSetmeta,
      names.bBxor,
      names.bBand,
      names.bGetmeta,
      names.bNext
    ];
    forwardDecls.push(...builtinNames);
    allFragments.push({ code: builtinCaps.assignOnly, layer: -1 });
    const envResult = buildEnvFragments(ctx);
    allFragments.push(...envResult.fragments);
    forwardDecls.push(...envResult.forwardDecls);
    forwardDecls.push(names.run);
    const vmCode = buildVMRuntime(ctx, true);
    allFragments.push({ code: vmCode, layer: Math.floor(rng() * 3) });
    forwardDecls.push(dK, dC, dP);
    allFragments.push({ code: `${dK}=${dataK}`, layer: Math.floor(rng() * 3) });
    allFragments.push({ code: `${dC}=${dataC}`, layer: Math.floor(rng() * 3) });
    allFragments.push({ code: `${dP}=${dataP}`, layer: Math.floor(rng() * 3) });
    let chainCalls = "";
    if (encodeStrings) {
      const decResult = buildDecoderChain(ctx, dK, dP);
      allFragments.push(...decResult.fragments);
      forwardDecls.push(...decResult.forwardDecls);
      chainCalls = decResult.chainCalls;
    }
    generateJunkFragments(allFragments, forwardDecls, names);
    const minLayer = allFragments.reduce((mn, f) => Math.min(mn, f.layer), 0);
    const maxLayer = allFragments.reduce((mx, f) => Math.max(mx, f.layer), 0);
    const sorted = [];
    for (let layer = minLayer; layer <= maxLayer; layer++) {
      const bucket = allFragments.filter((f) => f.layer === layer);
      for (let i = bucket.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [bucket[i], bucket[j]] = [bucket[j], bucket[i]];
      }
      sorted.push(...bucket);
    }
    for (let i = forwardDecls.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [forwardDecls[i], forwardDecls[j]] = [forwardDecls[j], forwardDecls[i]];
    }
    const declLines = [];
    let di = 0;
    while (di < forwardDecls.length) {
      const groupSize = 3 + Math.floor(rng() * 5);
      declLines.push(`local ${forwardDecls.slice(di, di + groupSize).join(",")}`);
      di += groupSize;
    }
    const parts = [];
    parts.push(...declLines);
    if (level2 === "max") {
      const cffSt = randomName(2);
      const cffUsed = /* @__PURE__ */ new Set();
      const cffId = () => {
        let id;
        do {
          id = 100 + Math.floor(rng() * 65e3);
        } while (cffUsed.has(id));
        cffUsed.add(id);
        return id;
      };
      const realStates = [];
      const realIds = [];
      for (let i = 0; i < sorted.length; i++) realIds.push(cffId());
      if (chainCalls) realIds.push(cffId());
      const exitId = cffId();
      for (let i = 0; i < sorted.length; i++) {
        const nxt = i + 1 < realIds.length ? realIds[i + 1] : exitId;
        realStates.push({ id: realIds[i], code: sorted[i].code, nextId: nxt });
      }
      if (chainCalls) {
        realStates.push({ id: realIds[sorted.length], code: chainCalls, nextId: exitId });
      }
      const nFake = 8 + Math.floor(rng() * 7);
      const fakeIds = [];
      for (let fi = 0; fi < nFake; fi++) fakeIds.push(cffId());
      const fakeStates = [];
      for (let fi = 0; fi < nFake; fi++) {
        const jn = randomName(3);
        const jn2 = randomName(3);
        const fv = Math.floor(rng() * 8);
        const fa = 2 + Math.floor(rng() * 200);
        const fb = 2 + Math.floor(rng() * 200);
        let fc;
        if (fv === 0) {
          fc = `local ${jn}=${Math.floor(rng() * 65536)};for _k=1,${4 + Math.floor(rng() * 8)} do ${jn}=(${jn}*${3 + Math.floor(rng() * 5)}+${Math.floor(rng() * 256)})%${["65536", "0x10000", "(256*256)", "(0x100*256)"][Math.floor(rng() * 4)]} end`;
        } else if (fv === 1) {
          fc = `local ${jn}={${Array.from({ length: 16 + Math.floor(rng() * 16) }, () => Math.floor(rng() * 256)).join(",")}};local ${jn2}=0;for _k=1,#${jn} do ${jn2}=bit32.bxor(${jn2},${jn}[_k]) end`;
        } else if (fv === 2) {
          fc = `local ${jn}=bit32.band(${fa},${fb});local ${jn2}=bit32.band(bit32.bxor(${fa},0xFFFFFFFF),${fb});if ${jn}+${jn2}~=${fb} then ${jn}=bit32.bxor(${jn},${jn2}) end`;
        } else if (fv === 3) {
          fc = `local ${jn}={};for _k=0,${63 + Math.floor(rng() * 64)} do ${jn}[_k+1]=bit32.bxor(_k*${SPIRAL_PRIMES[Math.floor(rng() * SPIRAL_PRIMES.length)]}+${Math.floor(rng() * 200)},bit32.band(_k,0xFF)) end`;
        } else if (fv === 4) {
          fc = `local ${jn}={};for _k=1,${8 + Math.floor(rng() * 24)} do ${jn}[_k]=bit32.band(bit32.bxor(_k*${1 + Math.floor(rng() * 7)},${Math.floor(rng() * 256)}),0xFF) end;local ${jn2}=${jn}[1];for _k=2,#${jn} do ${jn2}=2*bit32.band(${jn2},${jn}[_k])+bit32.bxor(${jn2},${jn}[_k]) end`;
        } else if (fv === 5) {
          fc = `local ${jn}=2*bit32.band(${fa},${fb})+bit32.bxor(${fa},${fb});local ${jn2}=bit32.bxor(bit32.bxor(${jn},${Math.floor(rng() * 65536)}),${Math.floor(rng() * 65536)})`;
        } else if (fv === 6) {
          fc = `local ${jn}={${Array.from({ length: 6 + Math.floor(rng() * 10) }, () => Math.floor(rng() * 256)).join(",")}};local ${jn2}="";for _k=1,#${jn} do ${jn2}=${jn2}..string.char(bit32.band(bit32.bxor(${jn}[_k],_k*${1 + Math.floor(rng() * 13)}+${Math.floor(rng() * 200)}),0x7F)+32) end`;
        } else {
          fc = `local ${jn}=bit32.bxor(${fa},bit32.band(${fa},${fb}));local ${jn2}=bit32.band(${fa},bit32.bxor(${fb},0xFFFFFFFF));if ${jn}~=${jn2} then for _k=1,${2 + Math.floor(rng() * 4)} do ${jn}=bit32.bxor(${jn},bit32.band(${jn},${Math.floor(rng() * 65536)})) end end`;
        }
        const fnxt = fakeIds[Math.floor(rng() * fakeIds.length)];
        fakeStates.push({ id: fakeIds[fi], code: fc, nextId: fnxt });
      }
      const allSt = [...realStates, ...fakeStates];
      for (let i = allSt.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [allSt[i], allSt[j]] = [allSt[j], allSt[i]];
      }
      const emitTransition = (st) => {
        const tVar = Math.floor(rng() * 6);
        const target = st.nextId;
        if (tVar === 0) {
          return `${cffSt}=${target}`;
        } else if (tVar === 1) {
          const split = Math.floor(rng() * (target + 1));
          return `${cffSt}=${split}+${target - split}`;
        } else if (tVar === 2) {
          const mask = 1 + Math.floor(rng() * 65535);
          return `${cffSt}=bit32.bxor(bit32.bxor(${target},${mask}),${mask})`;
        } else if (tVar === 3) {
          return `${cffSt}=bit32.bxor(bit32.bxor(${target},0xFFFFFFFF),0xFFFFFFFF)`;
        } else if (tVar === 4) {
          const mul = 3 + Math.floor(rng() * 13);
          return `${cffSt}=math.floor(${target * mul}/${mul})`;
        } else {
          const xa = Math.floor(rng() * 65536);
          const xb = Math.floor(rng() * 65536);
          const encoded = target ^ xa ^ xb;
          return `${cffSt}=bit32.bxor(bit32.bxor(${encoded},${xb}),${xa})`;
        }
      };
      parts.push(`local ${cffSt}=${realIds[0]}`);
      parts.push(`while true do`);
      for (let si = 0; si < allSt.length; si++) {
        const st = allSt[si];
        const kw = si === 0 ? "if" : "elseif";
        parts.push(`${kw} ${cffSt}==${st.id} then`);
        parts.push(st.code);
        if (st.nextId === exitId) {
          parts.push(`break`);
        } else {
          parts.push(emitTransition(st));
        }
      }
      parts.push(`end`);
      parts.push(`end`);
      if (process.env.ENV_CHECK === "1") {
        const chkVars = [
          ["run", names.run],
          ["env", names.env],
          ["pcall", names.bPcall],
          ["bxor", names.bBxor],
          ["band", names.bBand],
          ["type", names.bType],
          ["select", names.bSelect],
          ["tpack", names.tPack],
          ["tunpack", names.tUnpack],
          ["mfloor", names.bMfloor],
          ["setmeta", names.bSetmeta],
          ["tostring", names.bTostring],
          ["dK", dK],
          ["dC", dC],
          ["dP", dP]
        ];
        const wParts = chkVars.map(([l, v]) => `"${l}="..tostring(${v})`);
        parts.push(`warn("[ENV_CHECK] "..${wParts.join('.." "..')})`);
      }
      parts.push(`return ${names.run}(${dK},${dC},${dP},{},${nP},${mR},${isVA},${names.env})`);
    } else {
      for (const frag of sorted) {
        parts.push(frag.code);
      }
      if (chainCalls) parts.push(chainCalls);
      if (process.env.ENV_CHECK === "1") {
        const chkVars = [
          ["run", names.run],
          ["env", names.env],
          ["pcall", names.bPcall],
          ["bxor", names.bBxor],
          ["band", names.bBand],
          ["type", names.bType],
          ["select", names.bSelect],
          ["tpack", names.tPack],
          ["tunpack", names.tUnpack],
          ["mfloor", names.bMfloor],
          ["setmeta", names.bSetmeta],
          ["tostring", names.bTostring],
          ["dK", dK],
          ["dC", dC],
          ["dP", dP]
        ];
        const wParts = chkVars.map(([l, v]) => `"${l}="..tostring(${v})`);
        parts.push(`warn("[ENV_CHECK] "..${wParts.join('.." "..')})`);
      }
      parts.push(`return ${names.run}(${dK},${dC},${dP},{},${nP},${mR},${isVA},${names.env})`);
    }
    output2 = parts.join("\n");
  }
  if (process.env.DUMP_RAW === "1" && level2 !== "debug") {
    _dumpWrite("debug-vm-raw.lua", output2, "utf-8");
    console.log(`[RegVM] DUMP_RAW: saved ${output2.length} chars to debug-vm-raw.lua`);
  }
  if (level2 !== "debug" && process.env.NO_CIPHER !== "1") {
    const vmRawLen = Buffer.byteLength(output2, "utf-8");
    console.log(`[RegVM] Blob: encrypting VM runtime (${vmRawLen} bytes)...`);
    const { blob: vmBlob, xorKey, invSbox, checksum, origLen: vmOrigLen } = encryptAndEncode(output2, rng);
    console.log(`[RegVM] Blob: VM blob = ${vmBlob.length} chars (SBox+CBC+Base85), key=${xorKey.length}B, checksum=${checksum}`);
    output2 = generateBootstrap({
      vmBlob,
      vmOrigLen,
      xorKey,
      invSbox,
      checksum,
      chunkName: "Clyde",
      rng
    });
    console.log(`[RegVM] Blob: final output = ${output2.length} chars`);
  }
  if (!options._noWatermark) {
    const art = [
      `_________ .__            .___       __________                __                 __  .__                ____   ____________  `,
      `\\_   ___ \\|  | ___.__. __| _/____   \\______   \\_______  _____/  |_  ____   _____/  |_|__| ____   ____   \\   \\ /   /\\_____  \\ `,
      `/    \\  \\/|  |<   |  |/ __ |/ __ \\   |     ___/\\_  __ \\/  _ \\   __\\/ __ \\_/ ___\\   __\\  |/  _ \\ /    \\   \\   Y   /  /  ____/ `,
      `\\     \\___|  |_\\___  / /_/ \\  ___/   |    |     |  | \\(  <_> )  | \\  ___/\\  \\___|  | |  (  <_> )   |  \\   \\     /  /       \\ `,
      ` \\______  /____/ ____\\____ |\\___  >  |____|     |__|   \\____/|__|  \\___  >\\___  >__| |__|\\____/|___|  /    \\___/   \\_______ \\`,
      `        \\/     \\/         \\/    \\/                                     \\/     \\/                    \\/                     \\/`,
      ``,
      `https://clydeprotectionde.cloud | ClydeProtection Just like VMProtect, but for Lua.`
    ];
    output2 = `--[[
${art.join("\n")}
]]
` + output2;
  }
  if (level2 !== "debug") {
    const watermarkEnd = output2.indexOf("]]\n");
    if (watermarkEnd !== -1) {
      const watermark = output2.substring(0, watermarkEnd + 3);
      const code = output2.substring(watermarkEnd + 3);
      const oneLine = code.split("\n").filter((l) => l.trim().length > 0).join(" ");
      output2 = watermark + "\n" + oneLine;
    }
  }
  return output2;
}

// src/cli/reg-vm-obfuscate.ts
var args = process.argv.slice(2);
var level = "normal";
if (args.includes("--debug")) level = "debug";
if (args.includes("--max")) level = "max";
var outIndex = args.findIndex((a) => a === "-o" || a === "--output");
var outFile = outIndex >= 0 ? args[outIndex + 1] : null;
var fileArgs = args.filter(
  (a, i) => !a.startsWith("-") && (outIndex < 0 || i < outIndex || i > outIndex + 1)
);
var file = fileArgs[0];
if (!file) {
  console.error("Usage: node reg-vm-obfuscate.js [--debug|--normal|--max] [-o output.lua] input.lua");
  process.exit(1);
}
var source = readFileSync(file, "utf-8");
console.error(`[RegVM] Input: ${file} (${source.length} chars)`);
console.error(`[RegVM] Level: ${level}`);
var t0 = Date.now();
var { tokens, errors: lexErrors } = lex(source);
if (lexErrors.length > 0) {
  console.error("Lexer errors:", lexErrors.map((e) => e.message));
  process.exit(1);
}
var ast = parse(tokens);
var obfuscated = obfuscate(ast, {
  renameLocals: true,
  preserveGlobals: true
});
var chunk = regCompile(obfuscated);
console.error(`[RegVM] Bytecode: ${chunk.code.length / 4} instructions, ${chunk.K.length} constants, ${(chunk.protos || []).length} protos, maxRegs=${chunk.maxRegs}`);
var disableFeatures = [];
if (args.includes("--no-cff")) disableFeatures.push("controlFlowFlattening");
var output = generateRegVM(chunk, {
  level,
  executorGlobals: level !== "debug",
  polymorphicSeed: Date.now(),
  debugTrace: false,
  disableFeatures
});
var elapsed = Date.now() - t0;
console.error(`[RegVM] Output: ${output.length} chars (${elapsed}ms)`);
if (outFile) {
  writeFileSync(outFile, output, "utf-8");
  console.error(`[RegVM] Written to ${outFile}`);
} else {
  console.log(output);
}
