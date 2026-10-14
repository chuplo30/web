#!/usr/bin/env node
import fs from 'node:fs';
function vi(n){const a=[];do{let b=n&127;n=Math.floor(n/128);if(n)b|=128;a.push(b)}while(n);return Buffer.from(a)}
function u32(n){const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b}
function w(op,a=0,b=0,c=0){return (op|(a<<8)|(b<<16)|(c<<24))>>>0}
const args=process.argv.slice(2); if(args.includes('--help')){console.log('fake luau-compile');process.exit(0)}
// v9, type v3; string table: "hello"; one main proto: LOADK R0,K0 then RETURN R0,1.
const fn=Buffer.concat([
  Buffer.from([2,0,0,0,0]), // maxstack,numparams,numupvalues,vararg,flags
  vi(2),
  u32(5), // LOADK A0 D0
  u32(w(22,0,2,0)), // RETURN A0 B2
  vi(1),
  Buffer.from([3]),vi(0),
  vi(0),
  vi(0),
  vi(0),vi(0),Buffer.from([0,0])
]);
const out=Buffer.concat([Buffer.from([9,3]),vi(1),vi(5),Buffer.from('hello'),vi(0),vi(1),fn,vi(0)]);
process.stdout.write(out);
