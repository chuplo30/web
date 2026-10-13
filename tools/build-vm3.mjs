#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { compileLuauToVM } from '../js/vm-v3.js';
import { emitLuauVMRuntime } from '../js/runtime/luau-vm-runtime.js';

const [srcPath, outPath = 'obfuscated-vm3.lua'] = process.argv.slice(2);
if (!srcPath) {
  console.error('usage: node tools/build-vm3.mjs input.luau [output.lua]');
  process.exit(2);
}
const source=fs.readFileSync(srcPath,'utf8');
const seed=(Date.now() ^ (source.length<<7))>>>0;
const program=compileLuauToVM(source,{seed,optimizationLevel:1,debugLevel:0});
const output=emitLuauVMRuntime(program,{entry:true,returnResults:true});
fs.mkdirSync(path.dirname(path.resolve(outPath)),{recursive:true});
fs.writeFileSync(outPath,output,'utf8');
console.log(JSON.stringify({
  vm:program.vmVersion,
  luauBytecodeVersion:program.luauBytecodeVersion,
  functions:program.functions.length,
  instructions:program.functions.reduce((n,f)=>n+f.code.length,0),
  integrity:program.integrity,
  outputBytes:Buffer.byteLength(output)
},null,2));
