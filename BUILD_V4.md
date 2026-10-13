# 8XMS VM v4 changes

## Fixed
- Fixed VM v3 per-word function-key decoding mismatch. Encoded words are now decoded with the same `key + pc * 0x9e3779b9` schedule used by the packer.
- Fixed AUX-word decoding: the extra word now reverses the per-word key before AUX/ISA keys are removed.
- Fixed closure capture inspection by exposing the decoded opcode tag as `op`; removed the undefined `AUX` reference in the closure path.
- Added a guarded CALL diagnostic so a bad register no longer surfaces only as the generic `attempt to call a nil value`.
- Added global lookup fallback through `getgenv()`/`_G` for executor environments where the chunk environment does not mirror the global table.

## Output cleanup
- Removed the old `__S[n]=string.char(82,101,...)` style decoy pool from the browser pipeline.
- Reworked VM string constants to encrypted `@X...` packed blobs instead of ASCII-number `string.char(...)` arrays.
- Junk strings in the state-machine wrapper use the same packed representation.
- The generated runtime still uses `string.char(byte)` internally for byte reconstruction; it no longer emits the original text as an ASCII argument list.

## Validation
- `node --check js/vm-runtime.js`
- `node --check js/obfuscate.js`
- `node --check js/vm-v3.js`
- `node --check js/runtime/luau-vm-runtime.js`
- `node tests/test-vm3.mjs`
- `node tests/test-vm3-e2e-fake.mjs`
- Browser-pipeline smoke test: no multi-byte numeric `string.char(82,101,...)` constant leak and no plaintext `RemoteEvent` in a sample build.

End-to-end Roblox execution still needs to be verified in the target executor/runtime; this package does not claim exact parity with a commercial protector.
