# 8XMS VM v3 build notes

## Compiler boundary

VM v3 treats the official Luau compiler as the language authority. Do not expand the old JavaScript parser when a new Luau language feature appears. Update the official compiler and the bytecode decoder/lifter instead.

## Bytecode pipeline

1. Compile source to serialized Luau bytecode.
2. Decode version/type header, string table, userdata table and protos.
3. Decode constants and instruction words using the official opcode encoding.
4. Convert each instruction to a `LU_*` semantic instruction while preserving its original word PC and AUX word.
5. Generate a new physical ISA for the build.
6. Scramble the instruction stream and add the per-function integrity guard.
7. Emit the Luau VM runtime.

## Release testing

Use a pinned official Luau release for production builds. Run the supplied fixture tests, then compile a broad source corpus covering generics/types, closures/upvalues, multiple return values, varargs, loops, metamethods, buffers/vectors, classes when enabled, coroutine/yield behavior, and error paths. Compare the official Luau runtime and the VM output/side effects.

## Known limitations of this v3 drop

The serialized decoder intentionally runs with debug output disabled (`-g0`) because debug line/local streams are not execution-critical. Experimental class semantics are represented conservatively. Fastcall instructions currently use the compiler-provided fallback call path instead of reproducing VM-native builtin micro-optimizations. These choices preserve a clear correctness path while leaving room for later optimization.
