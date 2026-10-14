# 8xms Obfuscate + Custom Register VM

## Pipeline

```
Luau
  → compileToVM (~130 opcodes, random physical map per build)
  → emit Lua interpreter + bytecode (opcode table XOR-masked at runtime)
  → transformComplex (nested state machine shell)
  → multi-fragment × triple multiLayerEncode (XOR/hex/Base94)
  → junk 140–180KB + Anti-Tamper
  → loadstring
```

## VM modes

- **vm**: simple straight-line scripts compiled to real bytecode
- **execstr**: full script as VM constant + `EXECSTR` handler (any valid Luau still runs)

## Files

| Path | Role |
|------|------|
| `js/vm-isa.js` | 130 opcode ISA + packInst |
| `js/vm-compiler.js` | source → bytecode |
| `js/vm-runtime.js` | bytecode → Lua interpreter source |
| `js/transform.js` | state-machine shell |
| `js/obfuscate.js` | full pipeline |
| `netlify/functions/obfuscate.mjs` | API |

## Deploy

Netlify publish `.` — see `docs.html` for API.


## VM module

- `vm-isa.js` — 130 logical opcodes + random physical map
- `vm-compiler.js` — subset bytecode / EXECSTR fallback
- `vm-runtime.js` — handler-table interpreter emitter

Obfuscate pipeline always runs VM emission before State Machine + pack.
