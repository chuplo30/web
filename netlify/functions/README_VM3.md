# VM v3 Netlify endpoint

`obfuscate-vm3.mjs` exposes the full Luau-bytecode pipeline as a Node function.
It requires the official `luau-compile` executable to exist in the deployed
runtime. A browser-only deployment without the official compiler should keep
using the legacy browser path.
