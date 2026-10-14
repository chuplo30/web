# 8XMS VM v5 — opaque output + Base94 string packing

## Changes

- Fixed the Base94 string decoder mismatch that could turn a valid global lookup into a nil CALL target.
- Replaced the previous two-hex-character-per-byte string packing with keyed Base94 packing.
- Strings are split into 48-byte chunks; each chunk has its own derived key and offset.
- Source/API strings are no longer emitted as `string.char(82,101,...)` pools.
- Removed recognizable Roblox/API names from the light wrapper filler pool.
- Anti-tamper direct fragments now hide their string literals behind keyed Base94 and opaque aliases for common Roblox globals/service names.
- Production CALL failures use a generic `8XMS: runtime fault` message instead of exposing PC/register details.
- Kept the v3 official-bytecode path's `xpack94` representation and fixed its multi-chunk key offset handling.

## Validation

The following pass in Node:

- VM3 synthetic bytecode decode/lift/encode
- VM3 polymorphic roundtrip
- VM3 emitter smoke
- VM3 superinstruction fuser
- VM3 constant decoder
- VM3 fake end-to-end
- opaque-output regression test

## Important

The opaque output layer does not make the runtime semantically compatible with every Luau/Roblox executor by itself. Full Luau compatibility still depends on the official Luau compiler + complete bytecode lifter/runtime semantics, while Roblox APIs are supplied by the target runtime.
