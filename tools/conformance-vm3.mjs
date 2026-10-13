#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileLuauToVM } from '../js/vm-v3.js';
import { emitLuauVMRuntime } from '../js/runtime/luau-vm-runtime.js';

const [, , corpusDir = 'tests/corpus-vm3'] = process.argv;
const compiler=process.env.LUAU_COMPILE_BIN || 'luau-compile';
const runtime=process.env.LUAU_BIN || 'luau';

function run(exe,args,src){
  const r=spawnSync(exe,args,{input:src,encoding:'utf8',maxBuffer:16*1024*1024});
  return {status:r.status ?? 1,stdout:r.stdout||'',stderr:r.stderr||''};
}
function exists(exe){return spawnSync(exe,['--version'],{stdio:'ignore'}).status===0;}
if(!exists(compiler)||!exists(runtime)){
  console.error(JSON.stringify({ok:false,error:'Install official luau-compile and luau or set LUAU_COMPILE_BIN/LUAU_BIN.'}));
  process.exit(2);
}
const files=fs.readdirSync(corpusDir).filter(f=>f.endsWith('.luau')).sort();
if(!files.length){console.error('No .luau fixtures in '+corpusDir);process.exit(2);}
let pass=0;
for(const file of files){
  const source=fs.readFileSync(path.join(corpusDir,file),'utf8');
  const expected=run(runtime,[path.join(corpusDir,file)],'');
  let got={status:1,stdout:'',stderr:''};
  try{
    const program=compileLuauToVM(source,{seed:0x8a7f0000+pass,optimizationLevel:1,debugLevel:0});
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'8xms-vm3-test-'));
    const out=path.join(dir,'vm.lua');
    fs.writeFileSync(out,emitLuauVMRuntime(program,{entry:true,returnResults:true}));
    got=run(runtime,[out],'');
    fs.rmSync(dir,{recursive:true,force:true});
  }catch(e){got.stderr=String(e?.stack||e)}
  const same=expected.status===got.status && expected.stdout===got.stdout;
  if(same) pass++; else console.log(JSON.stringify({file,expected,got},null,2));
  console.log(`${same?'PASS':'FAIL'} ${file}`);
}
console.log(`VM3 conformance: ${pass}/${files.length}`);
process.exit(pass===files.length?0:1);
