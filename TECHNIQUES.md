# 8xms design notes (original)

## Lessons from public commercial reverse-engineering literature

### IronBrew-style ideas (reimplemented, not copied)
- Dispatch via **handler table** indexed by physical opcode (not one giant fragile if/elseif with empty branches).
- Per-build **opcode remapping** so static signatures drift.
- Constants as pool; optional EXECSTR path for unsupported syntax still runs inside VM shell.
- Super-operators / aliases: many physical opcodes collapse to same core handler.

### Clyde-style ideas (reimplemented lightly)
- Layered packing after IR/VM emission.
- Anti-tamper as separate encrypted fragments.

### 8xms pipeline
1. compileToVM → register bytecode + random 130-op map
2. emitVMRuntime → Lua interpreter with XOR-masked noise table
3. transformComplex → state-machine wrap + string pool
4. multi-frag triple multiLayerEncode + junk + AT

### Known limits
- Full Luau AST not implemented; complex scripts use EXECSTR constant inside VM.
- Not a Luraph-class commercial VM; improves cost of casual dump recovery.
