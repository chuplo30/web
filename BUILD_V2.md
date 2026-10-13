# VM v2 build plan

1. Install/pin an official Luau compiler version.
2. Add a bytecode-reader/lifter for that exact bytecode version.
3. Map every Luau opcode to semantic IR and add round-trip tests.
4. Differential-test IR VM vs official Luau on the conformance corpus.
5. Only then enable aggressive VM polymorphism and packing.

The adapter in `js/backend/luau-backend.js` intentionally detects the official
compiler but does not fake bytecode extraction through the CLI. For production
full-Luau support, embed the official compiler/VM or compile it to WASM/native.
