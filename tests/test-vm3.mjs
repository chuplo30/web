import assert from 'node:assert/strict';
import { decodeLuauBytecode, decodeAndLiftLuauBytecode } from '../js/backend/luau-bytecode.js';
import { generatePhysicalISA, encodeWideInstruction } from '../js/protection/vm-polymorph.js';

function vi(n){const out=[]; do{let b=n&127;n=Math.floor(n/128); if(n)b|=128; out.push(b)}while(n); return Buffer.from(out);}
function u32(n){const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;}
function word(op,a=0,b=0,c=0){return (op|(a<<8)|(b<<16)|(c<<24))>>>0;}
function ad(op,a,d){return (op|(a<<8)|((d&0xffff)<<16))>>>0;}
const parts=[Buffer.from([9,3]),vi(1),vi(5),Buffer.from('print'),vi(0),vi(1)];
parts.push(Buffer.from([2,0,0,0,0]));
parts.push(vi(2),u32(ad(4,0,42)),u32(word(22,0,2,0)));
parts.push(vi(0),vi(0),vi(0),vi(0),vi(0),Buffer.from([0,0]));
const blob=Buffer.concat(parts);
const d=decodeLuauBytecode(blob);
assert.equal(d.version,9); assert.equal(d.functions.length,1); assert.equal(d.functions[0].instructions.length,2);
const l=decodeAndLiftLuauBytecode(blob); assert.equal(l.functions[0].instructions[0].op,'LU_LOADN'); assert.equal(l.functions[0].instructions[1].op,'LU_RETURN');
const isa=generatePhysicalISA(['LU_LOADN','LU_RETURN'],123);
for(const i of l.functions[0].instructions){ const words=encodeWideInstruction(i,isa,i.pc); assert.ok(words.length>=1); }
console.log('vm3 synthetic bytecode decode/lift/encode: PASS');
