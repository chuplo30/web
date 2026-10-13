/**
 * Conservative VM superinstruction fusion. A fused opcode occupies the same
 * number of words as the first instruction; its immediately following
 * instruction remains in the stream but is executed by the fused handler and
 * skipped. Jumps into that second instruction are excluded.
 */
const PAIRS = [
  ["LU_LOADK","LU_RETURN","LU_FUSE_LOADK_RETURN"],
  ["LU_MOVE","LU_RETURN","LU_FUSE_MOVE_RETURN"],
  ["LU_GETGLOBAL","LU_CALL","LU_FUSE_GETGLOBAL_CALL"],
  ["LU_GETTABLEKS","LU_CALL","LU_FUSE_GETTABLEKS_CALL"]
];

export function fuseInstructions(fn) {
  const targets=new Set();
  for(const i of fn.instructions) if(i.target!=null) targets.add(i.target);
  const out=fn.instructions.map(i=>({...i}));
  for(let i=0;i<out.length-1;i++){
    const a=out[i], b=out[i+1];
    if(targets.has(b.pc) || a.pc+a.len!==b.pc) continue;
    for(const [x,y,fused] of PAIRS){
      if(a.op===x && b.op===y){
        if((y==="LU_CALL" && b.a!==a.a) || (y==="LU_RETURN" && b.a!==a.a)) continue;
        out[i]={...a,op:fused,fusedWith:b.op,fusedLen:b.len};
        break;
      }
    }
  }
  return {...fn,instructions:out};
}

export function fuseProgram(program){
  return {...program,functions:program.functions.map(fuseInstructions)};
}
