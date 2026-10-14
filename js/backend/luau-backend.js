/**
 * Full-Luau frontend bridge.
 *
 * The official Luau project owns the language parser/type syntax/compiler.
 * This adapter invokes the official luau-compile CLI when available and keeps
 * the produced bytecode as an explicit artifact. No source-string EXECSTR
 * fallback is used by the full pipeline.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function findTool(envName, fallback) {
  const exe = process.env[envName] || fallback;
  try {
    const out = execFileSync(exe, ["--help"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return { exe, help: out };
  } catch { return null; }
}

export function findLuau(exe = process.env.LUAU_BIN || "luau") {
  try {
    const out = execFileSync(exe, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return { exe, version: out.trim() };
  } catch { return null; }
}

export function findLuauCompiler(exe = process.env.LUAU_COMPILE_BIN || "luau-compile") {
  return findTool("LUAU_COMPILE_BIN", exe);
}

export function findLuauBytecode(exe = process.env.LUAU_BYTECODE_BIN || "luau-bytecode") {
  return findTool("LUAU_BYTECODE_BIN", exe);
}

export function probeOfficialLuau() {
  const compiler = findLuauCompiler();
  const bytecode = findLuauBytecode();
  const runtime = findLuau();
  return {
    available: !!compiler,
    compiler: compiler ? compiler.exe : null,
    bytecodeTool: bytecode ? bytecode.exe : null,
    runtime: runtime ? runtime.exe : null,
    runtimeVersion: runtime ? runtime.version : null,
  };
}

/**
 * Compile arbitrary Luau through the official compiler. This is the language
 * coverage boundary: generic types, attributes, classes, vectors, buffers,
 * native annotations and newer syntax are handled by the official frontend.
 *
 * Returns raw Luau bytecode as a Buffer. The custom 8XMS VM must still lift
 * this bytecode into 8XMS IR before it can execute it.
 */
export function compileFullLuau(source, {
  compiler = process.env.LUAU_COMPILE_BIN || "luau-compile",
  optimizationLevel = 1,
  debugLevel = 0,
} = {}) {
  if (typeof source !== "string") throw new TypeError("source must be a string");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "8xms-luau-"));
  const input = path.join(dir, "input.luau");
  try {
    fs.writeFileSync(input, source, "utf8");
    const args = [`-O${optimizationLevel}`, `-g${debugLevel}`, "--binary", input];
    const bytecode = execFileSync(compiler, args, { encoding: null, maxBuffer: 128 * 1024 * 1024 });
    if (!bytecode || bytecode.length < 4) throw new Error("official Luau compiler returned empty bytecode");
    return {
      format: "luau-bytecode",
      compiler,
      optimizationLevel,
      debugLevel,
      bytecode: Buffer.from(bytecode),
    };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

export function requireOfficialBackend() {
  const found = probeOfficialLuau();
  if (!found.available) {
    throw new Error(
      "Full-Luau backend unavailable: install the official luau-compile tool " +
      "and set LUAU_COMPILE_BIN if it is not on PATH."
    );
  }
  return found;
}
