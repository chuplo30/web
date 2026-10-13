import assert from 'node:assert/strict';
import { compileStateFunction, STATE_IR_VERSION } from '../js/ir/state-ir.js';

const fn={
  id:0,maxstack:4,numparams:0,isvararg:false,constants:[{type:'string',value:'hello'}],children:[],
  instructions:[
    {pc:0,op:'LU_LOADK',a:0,b:0,c:0,d:0},
    {pc:1,op:'LU_JUMPIF',a:0,b:0,c:0,d:1,target:3},
    {pc:2,op:'LU_LOADNIL',a:1,b:0,c:0,d:0},
    {pc:3,op:'LU_RETURN',a:0,b:2,c:0,d:0}
  ]
};
const sm=compileStateFunction(fn,0x12345678,{decoys:24});
assert.equal(sm.version,STATE_IR_VERSION);
assert.equal(sm.liveStateCount,4);
assert.equal(sm.decoyStateCount,24);
assert.equal(sm.buckets.length,256);
assert.ok(sm.entryToken!==0);
assert.ok(sm.pcState[1]!==0 && sm.pcState[4]!==0);
assert.ok(sm.blocks.length>=2);
const live = sm.buckets.flat().filter(r => r[2] === ((x)=>x)(r[2]));
assert.equal(live.length, sm.stateCount);
assert.equal(new Set(sm.buckets.flat().map(r => r[0])).size, sm.stateCount);
console.log('vm3 state compiler: PASS');
