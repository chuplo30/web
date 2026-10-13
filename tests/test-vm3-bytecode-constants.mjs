import assert from 'node:assert/strict';
import { decodeLuauBytecode } from '../js/backend/luau-bytecode.js';
function vi(n){const a=[];do{let b=n&127;n=Math.floor(n/128);if(n)b|=128;a.push(b)}while(n);return Buffer.from(a)}
function u32(n){const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b}
function f32(n){const b=Buffer.alloc(4);b.writeFloatLE(n,0);return b}
function f64(n){const b=Buffer.alloc(8);b.writeDoubleLE(n,0);return b}
function w(op,a=0,b=0,c=0){return u32((op|(a<<8)|(b<<16)|(c<<24))>>>0)}
function build(version=9,withSize=false){
  const c=[];
  c.push(Buffer.from([0]));
  c.push(Buffer.from([1,1]));
  c.push(Buffer.from([2]),f64(3.5));
  c.push(Buffer.from([3]),vi(0));
  c.push(Buffer.from([4]),u32(0x12345678));
  c.push(Buffer.from([5]),vi(2),vi(0),vi(2));
  c.push(Buffer.from([6]),vi(0));
  c.push(Buffer.from([7]),f32(1),f32(2),f32(3),f32(4));
  c.push(Buffer.from([8]),vi(1),vi(2),Buffer.from([0,0,0,0]));
  c.push(Buffer.from([9,0]),u32(7),u32(0));
  const fn=Buffer.concat([withSize?vi(0):Buffer.alloc(0),Buffer.from([4,0,0,0,0]),vi(1),w(4,0,0,0),vi(10),...c,vi(0),vi(0),vi(0),vi(0),Buffer.from([0,0])]);
  return Buffer.concat([Buffer.from([version,3]),vi(1),vi(1),Buffer.from('s'),vi(0),vi(1),fn,vi(0)]);
}
const d=decodeLuauBytecode(build());
const K=d.functions[0].constants;
assert.equal(K[0].type,'nil'); assert.equal(K[1].value,true); assert.equal(K[2].value,3.5); assert.equal(K[3].value,'s');
assert.equal(K[4].value,0x12345678); assert.equal(K[5].type,'table'); assert.equal(K[7].type,'vector'); assert.equal(K[8].type,'table-with-constants'); assert.equal(K[9].type,'integer');
assert.equal(decodeLuauBytecode(build(12,true)).version,12);
console.log('vm3 constant decoder: PASS');
