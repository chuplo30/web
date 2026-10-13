# 8XMS VM v6 — Luau state compiler -> VM bytecode

## New pipeline

`official Luau source -> official Luau bytecode -> bytecode lift -> state compiler (CFG + micro-states) -> superinstruction fusion -> polymorphic VM bytecode -> opaque runtime`

The important change is that the state machine is now a compiler IR stage. The old `transform.js` wrapper remains a legacy source-level obfuscator, but it is no longer the semantic control-flow compiler for VM3.

## State compiler

`js/ir/state-ir.js` builds, per function:

- basic-block boundaries and block ids
- one VM control state per lifted instruction PC
- explicit CFG successors
- randomized 32-bit state tokens
- keyed state-record integrity checks
- 256 randomized hash buckets for state dispatch
- per-function epoch masking of state tokens
- unreachable decoy states
- dense PC -> state-token routing table

The emitted runtime resolves the current PC from the opaque state token and advances by the compiled state route. It no longer uses the previous `pcCode` XOR state trick as the primary control-flow representation.

## Semantics

The state compiler does not change the official Luau semantics. It changes how the lifted control-flow is represented and dispatched. The bytecode interpreter still executes the lifted opcode semantics in the runtime.

## Validation

- `node --check js/ir/state-ir.js`
- `node --check js/vm-v3.js`
- `node --check js/runtime/luau-vm-runtime.js`
- `node tests/test-vm3-state.mjs`
- existing VM3 regression tests

Full-Luau coverage still requires the official `luau-compile` tool and continued lifter/runtime conformance work. This container does not currently provide that official compiler binary.
