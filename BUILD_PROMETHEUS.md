# 8XMS + Prometheus Medium8X (dual state-VM)

## Default pipeline

```
Source (Lua / Luau-compatible)
  → Vmify #1 (modified state-VM, not stock Prometheus)
  → EncryptStrings + AntiTamper
  → Vmify #2 (second state-VM wrap)
  → ConstantArray + NumbersToExpressions + WrapInFunction
  → 8xms encode20 pack (xor20+hex+xor20+base94) + AT + junk
```

Preset **Medium8X** = Medium-class steps with **2× Vmify** always on.

## VM differences vs stock Prometheus

- `MAX_REGS = 73` (stock 100)
- Dispatch: **5** condition styles (stock 3)
- Merge depth 11 (stock 7)
- Exit pos gate uses additive noise
- Tooling/deobfuscators for stock Prometheus will not match 1:1

## Netlify

- Bundled `bin/lua5.1` (no need to rely on apt alone)
- `netlify.toml` chmods binary + optional apt fallback
- `included_files` ships `js/**`, `prometheus/**`, `bin/**` into functions

Upload repo → deploy → `/api/obfuscate` uses Medium8X automatically.

## Attribution

Based on Prometheus by Elias Oelschner, https://github.com/prometheus-lua/Prometheus  
See `prometheus/LICENSE` and `THIRD_PARTY_NOTES.md`.
