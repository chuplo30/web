/**
 * 8XMS ↔ Prometheus modified state-VM
 * Based on Prometheus by Elias Oelschner — https://github.com/prometheus-lua/Prometheus
 *
 * Default preset Medium8X = Medium steps + 2× Vmify (dual state-VM) in one pipeline.
 * emit.lua dispatch differs from stock (5-way split, MAX_REGS=73).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(path.resolve(__dirname, '..'), 'prometheus', 'src');

function findLua() {
  if (process.env.PROMETHEUS_LUA) return process.env.PROMETHEUS_LUA;
  const bundled = path.join(path.resolve(__dirname, '..'), 'bin', 'lua5.1');
  if (fs.existsSync(bundled)) {
    try { fs.chmodSync(bundled, 0o755); } catch (_) {}
    const r = spawnSync(bundled, ['-e', 'print(1)'], { encoding: 'utf8' });
    if (r.status === 0 && String(r.stdout).includes('1')) return bundled;
  }
  for (const c of ['luajit', 'lua5.1', 'lua51', 'lua']) {
    const r = spawnSync(c, ['-e', 'print(1)'], { encoding: 'utf8' });
    if (r.status === 0 && String(r.stdout).includes('1')) return c;
  }
  return null;
}

export function prometheusAvailable() {
  return !!findLua() && fs.existsSync(path.join(SRC, 'prometheus.lua'));
}

/**
 * @param {string} source
 * @param {{ preset?: string, seed?: number, layers?: number }} [opts]
 */
export function compileWithPrometheus(source, opts = {}) {
  const lua = findLua();
  if (!lua) {
    return { ok: false, backend: 'prometheus', error: 'Lua 5.1 not found (bin/lua5.1 or PATH)' };
  }
  if (!fs.existsSync(path.join(SRC, 'prometheus.lua'))) {
    return { ok: false, backend: 'prometheus', error: 'prometheus/src missing' };
  }

  const preset = opts.preset || 'Medium8X';
  // Medium8X / Strong already contain 2× Vmify → single pipeline pass
  const dualInPreset = preset === 'Medium8X' || preset === 'Strong';
  const layers = dualInPreset
    ? 1
    : Math.max(1, Math.min(3, opts.layers != null ? opts.layers : 2));
  const seed = (opts.seed != null ? opts.seed : (Date.now() % 2147483647)) >>> 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), '8xms-prom-'));
  const inFile = path.join(tmp, 'in.lua');
  const outFile = path.join(tmp, 'out.lua');
  const runner = path.join(tmp, 'run.lua');
  fs.writeFileSync(inFile, String(source), 'utf8');

  const runLua = `
local srcDir = ${JSON.stringify(SRC + '/')}
package.path = srcDir .. "?.lua;" .. srcDir .. "?/init.lua;" .. package.path
if not pcall(function() return math.random(1, 2^40) end) then
  local old = math.random
  math.random = function(a, b)
    if not a and not b then return old() end
    if not b then return math.random(1, a) end
    if a > b then a, b = b, a end
    local diff = b - a
    if diff > 2^31 - 1 then return math.floor(old() * diff + a) end
    return old(a, b)
  end
end
_G.newproxy = _G.newproxy or function(arg)
  if arg then return setmetatable({}, {}) end
  return {}
end

local Presets = require("presets")
local Pipeline = require("prometheus.pipeline")
local layers = ${layers}
local baseSeed = ${seed}
local preset1 = ${JSON.stringify(preset)}

local f = assert(io.open(${JSON.stringify(inFile)}, "rb"))
local src = f:read("*a"); f:close()

local function runPreset(name, layerSeed, code)
  local config = Presets[name]
  if not config then error("missing preset "..tostring(name)) end
  local c = {}
  for k,v in pairs(config) do c[k] = v end
  c.Seed = layerSeed
  if not c.Seed or c.Seed == 0 then c.Seed = layerSeed end
  return Pipeline:fromConfig(c):apply(code, "8xms-L")
end

for i = 1, layers do
  local layerSeed = (baseSeed + i * 9973) % 2147483647
  if layerSeed == 0 then layerSeed = i * 12345 end
  local name = (i == 1) and preset1 or "Vmify"
  local ok, result = pcall(runPreset, name, layerSeed, src)
  if not ok then
    ok, result = pcall(runPreset, "Medium", layerSeed, src)
  end
  if not ok then
    ok, result = pcall(runPreset, "Vmify", layerSeed, src)
  end
  if not ok then
    io.stderr:write("layer "..i.." failed: "..tostring(result).."\\n")
    os.exit(4)
  end
  src = result
  io.stderr:write("layer "..i.." ok size="..#src.." preset="..name.."\\n")
end

local out = assert(io.open(${JSON.stringify(outFile)}, "wb"))
out:write(src); out:close()
`;
  fs.writeFileSync(runner, runLua, 'utf8');

  const r = spawnSync(lua, [runner], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180000,
  });

  try {
    if (r.status !== 0) {
      return {
        ok: false,
        backend: 'prometheus',
        error: String(r.stderr || r.stdout || 'fail').slice(0, 3000),
      };
    }
    const code = fs.readFileSync(outFile, 'utf8');
    if (!code || code.length < 8) {
      return { ok: false, backend: 'prometheus', error: 'empty output' };
    }
    return {
      ok: true,
      code,
      backend: 'prometheus-8xms-medium',
      preset,
      seed,
      layers: dualInPreset ? 2 : layers, // report effective VM layers
      vmLayers: dualInPreset ? 2 : layers,
    };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}
