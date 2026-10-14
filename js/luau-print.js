/** AST → Lua source (after scramble). */
export function printAst(node) {
  if (!node) return '';
  if (Array.isArray(node)) return node.map(printAst).join('\n');
  switch (node.type) {
    case 'Chunk': return (node.body||[]).map(printAst).join('\n');
    case 'Block': return (node.body||[]).map(printAst).join('\n');
    case 'Local': {
      const ns = node.names.join(', ');
      if (!node.values||!node.values.length) return `local ${ns}`;
      return `local ${ns} = ${node.values.map(printAst).join(', ')}`;
    }
    case 'Assign': {
      const op = node.op === '=' ? ' = ' : ` ${node.op} `;
      if (node.op !== '=') return `${printAst(node.vars[0])}${op}${printAst(node.values[0])}`;
      return `${node.vars.map(printAst).join(', ')} = ${node.values.map(printAst).join(', ')}`;
    }
    case 'CallStmt': return printAst(node.expr);
    case 'Return': return 'return' + (node.values&&node.values.length ? ' '+node.values.map(printAst).join(', ') : '');
    case 'Break': return 'break';
    case 'Continue': return 'continue';
    case 'Do': return `do\n${printAst(node.body)}\nend`;
    case 'If': {
      let s = '';
      node.arms.forEach((a,i) => {
        s += (i===0?`if ${printAst(a.cond)} then`:`elseif ${printAst(a.cond)} then`) + '\n' + printAst(a.body) + '\n';
      });
      if (node.elseBody) s += 'else\n' + printAst(node.elseBody) + '\n';
      return s + 'end';
    }
    case 'While': return `while ${printAst(node.cond)} do\n${printAst(node.body)}\nend`;
    case 'Repeat': return `repeat\n${printAst(node.body)}\nuntil ${printAst(node.cond)}`;
    case 'ForNum': {
      const st = node.step ? `, ${printAst(node.step)}` : '';
      return `for ${node.name} = ${printAst(node.a)}, ${printAst(node.b)}${st} do\n${printAst(node.body)}\nend`;
    }
    case 'ForIn': return `for ${node.names.join(', ')} in ${node.iter.map(printAst).join(', ')} do\n${printAst(node.body)}\nend`;
    case 'LocalFunction': return `local function ${node.name}(${(node.params||[]).join(', ')})\n${printAst(node.body)}\nend`;
    case 'FunctionStmt': {
      const n = node.method ? `${node.name}:${node.method}` : node.name;
      return `function ${n}(${(node.params||[]).join(', ')})\n${printAst(node.body)}\nend`;
    }
    case 'FunctionExpr': return `function(${(node.params||[]).join(', ')})\n${printAst(node.body)}\nend`;
    case 'Name': return node.name;
    case 'Number': return String(node.value);
    case 'String': return JSON.stringify(node.value);
    case 'Nil': return 'nil';
    case 'Bool': return node.value ? 'true' : 'false';
    case 'Vararg': return '...';
    case 'Bin': return `(${printAst(node.left)} ${node.op} ${printAst(node.right)})`;
    case 'Un': return node.op === 'not' ? `(not ${printAst(node.arg)})` : `(${node.op}${printAst(node.arg)})`;
    case 'Call': {
      const a = (node.args||[]).map(printAst).join(', ');
      return `${printAst(node.callee)}(${a})`;
    }
    case 'MethodCall': {
      const a = (node.args||[]).map(printAst).join(', ');
      return `${printAst(node.obj)}:${node.method}(${a})`;
    }
    case 'Index':
      if (node.dot && node.key.type === 'String') return `${printAst(node.obj)}.${node.key.value}`;
      return `${printAst(node.obj)}[${printAst(node.key)}]`;
    case 'Table': {
      const fs = (node.fields||[]).map(f => {
        if (!f.key) return printAst(f.value);
        if (f.key.type==='String') {
          const k = f.key.value;
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return k + ' = ' + printAst(f.value);
          return '[' + JSON.stringify(k) + '] = ' + printAst(f.value);
        }
        return '[' + printAst(f.key) + '] = ' + printAst(f.value);
      });
      return '{' + fs.join(', ') + '}';
    }
    default: return '';
  }
}
