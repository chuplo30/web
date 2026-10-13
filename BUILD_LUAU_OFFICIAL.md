# Path B — Official Luau compiler → 8xms VM

```
source.luau
  → bin/luau-compile --text -O0 -g0
  → parse text bytecode (LOADK, CALL, NAMECALL, FORN*, JUMPIF*, …)
  → map to 8xms physical opcodes + stream XOR
  → emitVMRuntime (pack xor20/hex/base94 still applied by obfuscate.js)
```

Requires `bin/luau-compile` (bundled). Browser without binary falls back to AST compiler.

Tested: `print(1+2)`, nested `add(3,4)` → `3` / `7` under Luau CLI.
