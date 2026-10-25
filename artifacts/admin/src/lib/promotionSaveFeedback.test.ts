import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer, type Server } from "node:http";
import { ApiError, ResponseParseError, customFetch } from "../../../../lib/api-client-react/src/custom-fetch";
import { promotionMutationFailure, promotionRefreshFailure } from "./promotionSaveFeedback";

let server: Server;
let base: string;
let requests = 0;
let reachedTimeout: (()=>void) | undefined;
before(async()=>{
  server=createServer((req,res)=>{
    requests++;
    if (req.url==="/disconnect" || req.url==="/lost") { req.socket.destroy();return; }
    if (req.url==="/timeout") { reachedTimeout?.();return; }
    const cases: Record<string,[number,unknown]>={
      "/400":[400,{error:"End date cannot precede start date."}],
      "/code":[409,{code:"CODE_ALREADY_IN_USE",error:"This promo code is already in use."}],
      "/stale":[409,{code:"PROMOTION_CHANGED",error:"This promotion changed since you opened it."}],
      "/428":[428,{code:"PROMOTION_REVISION_REQUIRED",error:"Reload Promotions before saving changes."}],
      "/500":[500,{error:"Internal server error"}],
      "/saved":[201,{id:123}],
      "/deleted":[204,null],
    };
    if(req.url==="/malformed") {res.writeHead(201,{"content-type":"application/json"});res.end("{broken");return;}
    const [status,body]=cases[req.url!]??[503,{error:"List unavailable"}];
    res.writeHead(status,{"content-type":"application/json"});res.end(body==null?undefined:JSON.stringify(body));
  });
  server.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.on("listening",resolve));
  const address=server.address();assert.ok(address&&typeof address!=="string");base=`http://127.0.0.1:${address.port}`;
});
after(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));});
async function errorAt(path:string,signal?:AbortSignal) {
  try { await customFetch(`${base}${path}`,{method:"POST",body:"{}",signal});assert.fail("Expected rejection"); }
  catch(error) { return error; }
}
for(const [path,status,reload,detail] of [["/400",400,false,"End date"],["/code",409,false,"already in use"],["/stale",409,true,"changed since"],["/428",428,true,"Reload Promotions"]] as const) {
  test(`actual customFetch ${path} exposes status and shows actionable rejection`,async()=>{
    const error=await errorAt(path);assert.ok(error instanceof ApiError);assert.equal(error.status,status);
    const feedback=promotionMutationFailure(error,"save");assert.equal(feedback.outcome,"rejected");assert.equal(feedback.reload,reload);assert.ok(feedback.message.includes(detail));assert.doesNotMatch(feedback.message,/could not be confirmed/);
  });
}
for(const path of ["/500","/disconnect","/lost","/malformed"]) {
  test(`actual customFetch ${path} is uncertain and is not retried`,async()=>{
    const before=requests,error=await errorAt(path);
    if(path==="/malformed") {assert.ok(error instanceof ResponseParseError);assert.equal(error.status,201);}
    const feedback=promotionMutationFailure(error,"save");assert.equal(feedback.outcome,"uncertain");assert.match(feedback.message,/entries are preserved/);assert.match(feedback.message,/check whether it saved/);assert.equal(requests,before+1);
  });
}
test("aborted timeout after server receives request remains uncertain",async()=>{
  const controller=new AbortController();let reached!:()=>void;
  const ready=new Promise<void>(resolve=>{reached=resolve;});reachedTimeout=reached;
  const result=errorAt("/timeout",controller.signal);await ready;controller.abort(new DOMException("Timed out","TimeoutError"));
  const feedback=promotionMutationFailure(await result,"save");assert.equal(feedback.outcome,"uncertain");
});
test("confirmed save plus failed list refresh is reported as saved, not failed or unknown",async()=>{
  assert.deepEqual(await customFetch(`${base}/saved`,{method:"POST",body:"{}"}),{id:123});
  const error=await errorAt("/list");const message=promotionRefreshFailure(error,"saved");assert.match(message,/Promotion saved, but the list/);assert.doesNotMatch(message,/could not be confirmed/);
});
test("deactivation handles success, business conflict, uncertain failure and failed refresh distinctly",async()=>{
  assert.equal(await customFetch(`${base}/deleted`,{method:"DELETE"}),null);
  assert.equal(promotionMutationFailure(await errorAt("/stale"),"deactivate").outcome,"rejected");
  const failure=promotionMutationFailure(await errorAt("/disconnect"),"deactivate");assert.match(failure.message,/Deactivation could not be confirmed/);assert.match(failure.message,/current status/);
  assert.match(promotionRefreshFailure(await errorAt("/list"),"deactivated"),/Promotion deactivated, but the list/);
});
