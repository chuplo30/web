/**
 * 8XMS VM v2 pipeline.
 *
 * Full-Luau source is compiled by the official Luau compiler first. The raw
 * Luau bytecode is then the only accepted frontend artifact for the future
 * complete lifter. The old handwritten parser is retained only as a legacy
 * compatibility path and is never used when strictVM=true.
 */
import { generatePhysicalISA } from "./protection/vm-polymorph.js";
import { IR_VERSION } from "./ir/vm-ir.js";
import { compileToVM } from "./vm-compiler.js";
import { compileFullLuau, requireOfficialBackend } from "./backend/luau-backend.js";

export const VM2_VERSION = "2.1.0";

export function compile(source, { seed = Date.now(), strictVM = true, useOfficial = true } = {}) {
  if (strictVM && useOfficial) {
    requireOfficialBackend();
    const official = compileFullLuau(source);
    return {
      version: VM2_VERSION,
      irVersion: IR_VERSION,
      frontend: "official-luau",
      frontendArtifact: official.bytecode.toString("base64"),
      frontendFormat: official.format,
      isa: generatePhysicalISA([
        "MOVE", "LOADK", "CALL", "RETURN", "JMP", "JMPIF", "JMPIFNOT",
        "GETTABLE", "SETTABLE", "CLOSURE", "VARARG", "ADD", "SUB", "MUL",
        "DIV", "CONCAT", "EQ", "LT", "LE", "NEW_TABLE"
      ], seed),
      // Deliberately no EXECSTR and no handwritten-parser execution here.
      lifter: "pending-complete-luau-bytecode-lifter",
      program: null,
    };
  }

  const r = compileToVM(source, Math.random, { strictVM });
  return {
    version: VM2_VERSION,
    irVersion: IR_VERSION,
    frontend: "legacy-js-parser",
    isa: generatePhysicalISA([
      "MOVE", "LOADK", "CALL", "RETURN", "JMP", "JMPIF", "JMPIFNOT",
      "GETTABLE", "SETTABLE", "CLOSURE", "VARARG", "ADD", "SUB", "MUL",
      "DIV", "CONCAT", "EQ", "LT", "LE", "NEW_TABLE"
    ], seed),
    program: r,
  };
}
