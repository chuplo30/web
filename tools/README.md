# Full Luau toolchain

Install/build the official Luau CLI and expose `luau-compile` on PATH (or set `LUAU_COMPILE_BIN`).

`node tools/full-luau-check.mjs tests/luau-conformance.lua` validates that the official frontend accepts the corpus and emits bytecode.

The custom 8XMS VM still needs a complete bytecode-to-IR lifter before that bytecode can execute inside the custom VM.
