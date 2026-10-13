# 8XMS VM v2 conformance

The project now treats official Luau as the language authority instead of
trying to grow the small JS parser into a second Luau implementation.

For a real full-Luau build, provide an official Luau compiler/library and run
the conformance corpus before enabling strict VM emission.

The current JS VM remains available for the subset it explicitly supports.
Unsupported programs must fail in `strict-vm` mode rather than leaking source
through `EXECSTR`.
