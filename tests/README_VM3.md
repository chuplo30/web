# VM v3 validation

VM v3 is the full-Luau bytecode execution path. It uses the official Luau compiler as the language frontend, decodes the serialized Luau bytecode, lifts each instruction without rebuilding the source AST, and emits a per-build polymorphic VM stream.

## Local tool requirements

Install the official `luau-compile` command and put it on `PATH`, or set `LUAU_COMPILE_BIN`.

Run the deterministic parser/lifter fixture test:

```bash
node tests/test-vm3.mjs
```

Run an actual source build after installing the compiler:

```bash
node tools/build-vm3.mjs input.luau output.lua
```

The container used to package this release does not ship the official Luau compiler/runtime, so end-to-end execution against the current Luau VM must be run in an environment that has those official binaries. The fixture test still validates the serialized-bytecode decoder, lifter, and polymorphic encoder without external binaries.
