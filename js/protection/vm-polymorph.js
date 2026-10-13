/**
 * Polymorphic virtual ISA generator used by the full Luau bytecode VM.
 * Each build gets a fresh opcode permutation plus per-op operand scrambling.
 */
export function makePrng(seed) {
  let x = (seed >>> 0) || 0x9e3779b9;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17; x >>>= 0;
    x ^= x << 5; x >>>= 0;
    return (x >>> 0) / 0x100000000;
  };
}

export function shuffle(a, rng) {
  a = [...a];
  for (let i=a.length-1;i>0;i--) {
    const j=Math.floor(rng()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

export function generatePhysicalISA(logical, seed=Date.now()) {
  const rng=makePrng(seed);
  const uniq=[...new Set(logical)];
  const order=shuffle(uniq,rng);
  const enc=new Map(order.map((x,i)=>[x,i]));
  const tagValues=shuffle(Array.from({length:order.length},(_,i)=>i+1),rng);
  const tags=Object.fromEntries(order.map((x,i)=>[x,tagValues[i]]));
  const operandPerm={};
  const masks={};
  for(const op of order){
    operandPerm[op]=shuffle(["a","b","c"],rng);
    masks[op]=Math.floor(rng()*0xffffffff)>>>0;
  }
  const keys=order.map(()=>Math.floor(rng()*0xffffffff)>>>0);
  return {
    version:4,
    seed:seed>>>0,
    order,
    tags,
    enc:Object.fromEntries(enc),
    operandPerm,
    masks,
    keys,
    streamKey:Math.floor(rng()*0xffffffff)>>>0,
    auxKey:Math.floor(rng()*0xffffffff)>>>0
  };
}

function keyFor(isa, op) {
  const phys=isa.enc[op];
  if (phys===undefined) throw new Error(`No physical opcode for ${op}`);
  return isa.keys[phys]>>>0;
}

export function encodeWord(inst, isa, pc) {
  const op=isa.enc[inst.op];
  if(op===undefined) throw new Error(`No physical opcode for ${inst.op}`);
  const p=isa.operandPerm[inst.op] || ["a","b","c"];
  const vals={a:inst.a>>>0,b:inst.b>>>0,c:inst.c>>>0};
  const k=isa.masks?.[inst.op]>>>0 || 0;
  const q=p.map((name,i)=>((vals[name] & 255) ^ ((k >>> (i*8)) & 255)) & 255);
  let w=((op&255)|(q[0]<<8)|(q[1]<<16)|(q[2]<<24))>>>0;
  w ^= (isa.streamKey + Math.imul(pc>>>0,0x9e3779b9))>>>0;
  return w>>>0;
}

const AD_OP = new Set(["LU_FUSE_LOADK_RETURN","LU_LOADN","LU_LOADK","LU_JUMP","LU_JUMPBACK","LU_JUMPIF","LU_JUMPIFNOT","LU_JUMPIFEQ","LU_JUMPIFLE","LU_JUMPIFLT","LU_JUMPIFNOTEQ","LU_JUMPIFNOTLE","LU_JUMPIFNOTLT","LU_NEWCLOSURE","LU_DUPTABLE","LU_FORNPREP","LU_FORNLOOP","LU_FORGLOOP","LU_FORGPREP_INEXT","LU_FORGPREP_NEXT","LU_DUPCLOSURE","LU_JUMPXEQKNIL","LU_JUMPXEQKB","LU_JUMPXEQKN","LU_JUMPXEQKS","LU_CMPPROTO"]);
const E_OP = new Set(["LU_JUMPX","LU_COVERAGE"]);
const AUX_OP = new Set(["LU_FUSE_GETGLOBAL_CALL","LU_FUSE_GETTABLEKS_CALL","LU_GETGLOBAL","LU_SETGLOBAL","LU_GETIMPORT","LU_GETTABLEKS","LU_SETTABLEKS","LU_NAMECALL","LU_NEWTABLE","LU_SETLIST","LU_FORGLOOP","LU_FASTCALL3","LU_LOADKX","LU_FASTCALL2","LU_FASTCALL2K","LU_JUMPIFEQ","LU_JUMPIFLE","LU_JUMPIFLT","LU_JUMPIFNOTEQ","LU_JUMPIFNOTLE","LU_JUMPIFNOTLT","LU_JUMPXEQKNIL","LU_JUMPXEQKB","LU_JUMPXEQKN","LU_JUMPXEQKS","LU_GETUDATAKS","LU_SETUDATAKS","LU_NAMECALLUDATA","LU_NEWCLASSMEMBER","LU_CALLFB","LU_NEWCLASS"]);

/** Encode an instruction into the exact Luau-sized word stream used by 8XMS. */
export function encodeWideInstruction(inst, isa, pc) {
  let w=encodeWord(inst,isa,pc);
  const phys=isa.enc[inst.op];
  const k=isa.keys[phys]>>>0;
  let extra=null;
  if (AUX_OP.has(inst.op)) extra=((inst.aux>>>0) ^ k ^ isa.auxKey)>>>0;
  else if (AD_OP.has(inst.op)) extra=null;
  else if (E_OP.has(inst.op)) extra=null;
  const op=isa.enc[inst.op];
  // Re-encode AD/E fields because encodeWord intentionally only handles ABC.
  if (AD_OP.has(inst.op)) {
    const a=((inst.a>>>0)&255) ^ ((isa.masks[inst.op]>>>0)&255);
    const d=(inst.d|0) & 0xffff;
    w=((op&255)|(a<<8)|(d<<16))>>>0;
    w ^= (isa.streamKey + Math.imul(pc>>>0,0x9e3779b9))>>>0;
  } else if (E_OP.has(inst.op)) {
    const a=((inst.a>>>0)&255) ^ ((isa.masks[inst.op]>>>0)&255);
    const e=(inst.e|0) & 0xffffff;
    w=((op&255)|(e<<8))>>>0;
    w ^= (isa.streamKey + Math.imul(pc>>>0,0x9e3779b9))>>>0;
  }
  return extra===null ? [w>>>0] : [w>>>0,extra>>>0];
}

export { AD_OP, E_OP, AUX_OP };
