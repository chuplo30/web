#!/usr/bin/env node
import fs from "node:fs";
import { compileFullLuau, probeOfficialLuau } from "../js/backend/luau-backend.js";

const file = process.argv[2];
if (!file) { console.error("usage: node tools/full-luau-check.mjs <script.luau>"); process.exit(2); }
const source = fs.readFileSync(file, "utf8");
const caps = probeOfficialLuau();
if (!caps.available) { console.error("luau-compile not found"); process.exit(3); }
try {
  const r = compileFullLuau(source);
  console.log(JSON.stringify({ ok:true, compiler:r.compiler, bytes:r.bytecode.length }, null, 2));
} catch (e) {
  console.error(String(e?.message || e));
  process.exit(1);
}
