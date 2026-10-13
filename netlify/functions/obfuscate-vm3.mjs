/**
 * Node/Netlify server endpoint for the full VM v3 pipeline.
 * Requires the official `luau-compile` executable in the deployment image;
 * set LUAU_COMPILE_BIN when the executable is not on PATH.
 */
import { compileLuauToVM } from '../../js/vm-v3.js';
import { emitLuauVMRuntime } from '../../js/runtime/luau-vm-runtime.js';

export async function handler(event) {
  const headers={
    'Content-Type':'application/json',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type',
  };
  if(event.httpMethod==='OPTIONS') return {statusCode:204,headers};
  if(event.httpMethod!=='POST') return {statusCode:405,headers,body:JSON.stringify({ok:false,error:'POST only'})};
  try{
    const body=JSON.parse(event.body||'{}');
    const source=String(body.code||body.source||'');
    if(!source.trim()) return {statusCode:400,headers,body:JSON.stringify({ok:false,error:'source is empty'})};
    const seed=Number.isFinite(Number(body.seed)) ? (Number(body.seed)>>>0) : ((Date.now()^(source.length<<5))>>>0);
    const program=compileLuauToVM(source,{seed,optimizationLevel:Number(body.O||1),debugLevel:0});
    const code=emitLuauVMRuntime(program,{entry:true,returnResults:true});
    return {statusCode:200,headers,body:JSON.stringify({ok:true,code,meta:{vm:program.vmVersion,luauBytecodeVersion:program.luauBytecodeVersion,functions:program.functions.length,integrity:program.integrity,outputBytes:Buffer.byteLength(code)}})};
  }catch(e){
    return {statusCode:400,headers,body:JSON.stringify({ok:false,error:String(e?.message||e)})};
  }
}
