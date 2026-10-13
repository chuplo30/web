import assert from 'node:assert/strict';
import { generatePhysicalISA, encodeWideInstruction, AD_OP, E_OP, AUX_OP } from '../js/protection/vm-polymorph.js';
import { LUAU_OPCODE_NAMES } from '../js/backend/luau-bytecode.js';

const logical=[...LUAU_OPCODE_NAMES.map(x=>`LU_${x}`),'LU_FUSE_LOADK_RETURN','LU_FUSE_MOVE_RETURN','LU_FUSE_GETGLOBAL_CALL','LU_FUSE_GETTABLEKS_CALL'];
const isa=generatePhysicalISA(logical,0x12345678);
function signed16(x){x&=0xffff;return x&0x8000?x-0x10000:x}
function signed24(x){x&=0xffffff;return x&0x800000?x-0x1000000:x}
function dec(words,op,pc){
  const phys=isa.enc[op]; const key=isa.keys[phys]>>>0;
  let w=(words[0]^((isa.streamKey+Math.imul(pc>>>0,0x9e3779b9))>>>0))>>>0;
  const k=isa.masks[op]>>>0, p=isa.operandPerm[op];
  const raw=[(w>>>8)&255,(w>>>16)&255,(w>>>24)&255];
  const vals={};
  if (AD_OP.has(op)) vals.a=raw[0]^(k&255);
  else if (!E_OP.has(op)) { vals[p[0]]=raw[0]^(k&255); vals[p[1]]=raw[1]^((k>>>8)&255); vals[p[2]]=raw[2]^((k>>>16)&255); }
  const out={a:vals.a,b:vals.b,c:vals.c,d:signed16(w>>>16),e:signed24(w>>>8)};
  if (AD_OP.has(op)) out.d=signed16(w>>>16);
  if (E_OP.has(op)) out.e=signed24(w>>>8);
  if (AUX_OP.has(op)) out.aux=(words[1]^key^isa.auxKey)>>>0;
  return out;
}
for(let i=0;i<logical.length;i++){
  const op=logical[i], inst={op,a:37,b:91,c:173,d:-1234,e:-23456,aux:0xdecafbad};
  const words=encodeWideInstruction(inst,isa,17+i*2);
  const got=dec(words,op,17+i*2);
  if(!E_OP.has(op)) assert.equal(got.a,37,op);
  if(!AD_OP.has(op)&&!E_OP.has(op)) { assert.equal(got.b,91,op); assert.equal(got.c,173,op); }
  if(AD_OP.has(op)) assert.equal(got.d,-1234,op);
  if(E_OP.has(op)) assert.equal(got.e,-23456,op);
  if(AUX_OP.has(op)) assert.equal(got.aux,0xdecafbad>>>0,op);
}
console.log(`vm3 polymorphic roundtrip: PASS (${logical.length} opcodes)`);
