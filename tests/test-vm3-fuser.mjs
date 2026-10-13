import assert from 'node:assert/strict';
import { fuseInstructions } from '../js/ir/vm-fuser.js';
const fn={instructions:[
  {op:'LU_LOADK',pc:0,len:1,d:0,a:0,b:0,c:0,target:null},
  {op:'LU_RETURN',pc:1,len:1,a:0,b:2,c:0,d:0,target:null},
  {op:'LU_MOVE',pc:2,len:1,a:1,b:2,c:0,d:0,target:null},
  {op:'LU_RETURN',pc:3,len:1,a:1,b:2,c:0,d:0,target:null},
  {op:'LU_JUMP',pc:4,len:1,a:0,b:0,c:0,d:1,target:6},
  {op:'LU_RETURN',pc:5,len:1,a:0,b:2,c:0,d:0,target:null},
  {op:'LU_RETURN',pc:6,len:1,a:0,b:2,c:0,d:0,target:null}
]};
const out=fuseInstructions(fn);
assert.equal(out.instructions[0].op,'LU_FUSE_LOADK_RETURN');
assert.equal(out.instructions[2].op,'LU_FUSE_MOVE_RETURN');
console.log('vm3 superinstruction fuser: PASS');
