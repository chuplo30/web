# Third-party reference note

8XMS VM v2 uses architectural ideas informed by public open-source projects.
No proprietary Luraph source is included.

The official Luau project is MIT licensed and is the recommended language
authority for the frontend/bytecode compatibility layer.

## Prometheus (state-VM compiler)

The directory `prometheus/` contains a modified copy of **Prometheus** by Elias Oelschner:
https://github.com/prometheus-lua/Prometheus

License: see `prometheus/LICENSE` (attribution required).

8XMS uses Prometheus **Vmify** as an optional compile backend when a Lua 5.1 / LuaJIT
binary is available. Changes from upstream:

- `compiler/constants.lua` — different MAX_REGS
- `compiler/emit.lua` — modified container exit / pos gate
- `presets.lua` — added presets `8XMS` and `8XMS51`
- Packaging: output is always re-packed with 8xms encode20 (xor20+hex+xor20+base94)

Attribution (required by Prometheus license):
"Based on Prometheus by Elias Oelschner, https://github.com/prometheus-lua/Prometheus"

### 8XMS modifications to Prometheus

- Preset `Medium8X`: dual Vmify + Medium steps
- `compiler/emit.lua`: 5-way dispatch, merge depth 11
- `compiler/constants.lua`: MAX_REGS 73
- Bundled `bin/lua5.1` for Netlify runtime
