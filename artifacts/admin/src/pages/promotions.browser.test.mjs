/** Run against a local Admin production preview. All API calls are intercepted:
 * this tests the real page/customFetch/feedback with no real account or backend.
 * Supply PLAYWRIGHT_MODULE_PATH when using an external existing Playwright runtime.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, after, test } from "node:test";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const base=process.env.PROMOTIONS_ADMIN_TEST_URL;
if(!base || !["localhost","127.0.0.1"].includes(new URL(base).hostname)) throw Error("Set a localhost PROMOTIONS_ADMIN_TEST_URL");
let browser;
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.PROMOTIONS_TEST_CHROME ? {executablePath:process.env.PROMOTIONS_TEST_CHROME}: {})});});
after(async()=>{await browser?.close();});
async function fixture(mode) {
  const context=await browser.newContext({timezoneId:"UTC"});
  await context.addInitScript(()=>localStorage.setItem("admin_jwt","local-browser-fixture"));
  const page=await context.newPage();
  const row={id:1,name:"Review fixture",description:null,type:"manual",discountType:"percentage",discountValue:10,priority:0,isActive:true,isExclusive:false,isStackable:false,startDate:null,endDate:null,rulesConfig:{},revision:"a".repeat(64),codes:[{id:1,promotionId:1,code:"REVIEW10",maxUses:null,usesPerUser:null,currentUses:0}]};
  if(mode==="dates") {row.startDate="2026-11-01 12:00:00.123456+02";row.endDate="2026-12-01 12:00:00.123456+02";}
  const mutations=[];
  let actorId=1;
  await page.route("**/*",async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==new URL(base).origin) return route.abort();
    if(!url.pathname.startsWith("/api/")) return route.continue();
    const reply=(status,body)=>route.fulfill({status,contentType:"application/json",body:body==null?undefined:JSON.stringify(body)});
    if(url.pathname==="/api/admin/auth/me") return reply(200,{id:actorId,username:"review",fullName:"Review Admin",email:"review@example.invalid",isSuperAdmin:true,roleId:null,role:null});
    if(url.pathname==="/api/promotions/save-protocol") return reply(200,mode==="unsupported" ? {} : {version:1,idempotency:true});
    if(url.pathname.startsWith("/api/promotions/operations/")) {
      if(mode==="lost" || mode==="malformed") return reply(200,{state:"succeeded",status:200,promotionId:1,response:row});
      if(mode==="missing") return reply(404,{error:"Operation not found"});
      return reply(200,{state:"pending"});
    }
    if(url.pathname==="/api/promotions" && req.method()==="GET") {
      if(mode==="refresh-failure" && mutations.length) return reply(503,{error:"List unavailable"});
      return reply(200,[row]);
    }
    if(url.pathname==="/api/promotions/1" && ["PATCH","DELETE"].includes(req.method())) {
      mutations.push({operation:req.headers()["idempotency-key"],method:req.method(),revision:req.headers()["if-match"],body:req.method()==="PATCH"?req.postDataJSON():null});
      if(mode==="stale") {row.name="Newer configuration";row.revision="b".repeat(64);return reply(409,{code:"PROMOTION_CHANGED",error:"Another Admin modified this promotion."});}
      if(mode==="required") return reply(428,{code:"PROMOTION_REVISION_REQUIRED",error:"Reload Promotions before saving changes."});
      if(mode==="validation") return reply(400,{error:"End date cannot precede start date."});
      if(mode==="duplicate") return reply(409,{code:"CODE_ALREADY_IN_USE",error:"This promo code is already in use."});
      if(mode==="operational" || (["retry","missing"].includes(mode) && mutations.length===1)) return reply(500,{error:"Internal server error"});
      if(mode==="timeout") return route.abort("timedout");
      if(req.method()==="DELETE") {row.isActive=false;return reply(204,null);}
      Object.assign(row,req.postDataJSON());row.revision="b".repeat(64);
      if(mode==="lost") return route.abort("connectionclosed");
      if(mode==="malformed") return route.fulfill({status:200,contentType:"application/json",body:"{broken"});
      return reply(200,row);
    }
    return reply(200,[]);
  });
  await page.goto(`${base}/promotions`);
  await page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).waitFor();
  return {page,context,mutations,setActor:(id)=>{actorId=id;}};
}
async function edit(page) {
  await page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).click();
  const dialog=page.getByRole("dialog"),name=dialog.locator("input").first();
  await name.fill("Unsaved review values");
  await dialog.getByRole("button",{name:"Save Promotion",exact:true}).click();
  return {dialog,name};
}
for(const [mode,message] of [["validation",/End date cannot precede/],["duplicate",/already in use/],["required",/Reload Promotions/],["operational",/save outcome could not be confirmed/],["timeout",/save outcome could not be confirmed/],["lost",/save outcome could not be confirmed/],["malformed",/save outcome could not be confirmed/]]) {
  test(`real Admin ${mode}: visible actionable feedback, preserved inputs, one request`,async()=>{
    const f=await fixture(mode);
    try {
      const {dialog,name}=await edit(f.page),alert=dialog.getByRole("alert");await alert.waitFor();
      assert.match(await alert.innerText(),message);assert.equal(await name.inputValue(),"Unsaved review values");assert.equal(f.mutations.length,1);assert.equal(f.mutations[0].revision,`"${"a".repeat(64)}"`);
      if(["validation","duplicate","required"].includes(mode)) assert.doesNotMatch(await alert.innerText(),/could not be confirmed/);
    } finally {await f.context.close();}
  });
}
test("real Admin stale revision preserves input until explicit close/reopen loads current configuration",async()=>{
  const f=await fixture("stale");
  try {
    const {dialog,name}=await edit(f.page);await dialog.getByRole("alert").waitFor();assert.match(await dialog.getByRole("alert").innerText(),/Another Admin modified/);assert.equal(await name.inputValue(),"Unsaved review values");
    await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
    await f.page.getByRole("button",{name:"Edit promotion Newer configuration",exact:true}).click();
    assert.equal(await f.page.getByRole("dialog").locator("input").first().inputValue(),"Newer configuration");
  } finally {await f.context.close();}
});
for(const mode of ["success","refresh-failure"]) {
  test(`real Admin confirmed save with ${mode}`,async()=>{
    const f=await fixture(mode);
    try {
      await edit(f.page);await f.page.getByRole("dialog").waitFor({state:"hidden"});
      if(mode==="refresh-failure") {await f.page.getByRole("alert").waitFor();assert.match(await f.page.getByRole("alert").innerText(),/Promotion saved, but the list could not be refreshed/);}
      else await f.page.getByRole("button",{name:"Edit promotion Unsaved review values",exact:true}).waitFor();
      assert.equal(f.mutations.length,1);
    } finally {await f.context.close();}
  });
}
for(const mode of ["success","operational"]) {
  test(`real Admin deactivation ${mode}`,async()=>{
    const f=await fixture(mode);
    try {
      await f.page.getByRole("button",{name:"Deactivate promotion Review fixture",exact:true}).click();
      await f.page.getByRole("alertdialog").getByRole("button",{name:"Deactivate",exact:true}).click();
      if(mode==="operational") {await f.page.getByRole("alert").waitFor();assert.match(await f.page.getByRole("alert").innerText(),/Deactivation could not be confirmed/);}
      else await f.page.getByText("Inactive",{exact:true}).waitFor();
      assert.equal(f.mutations.length,1);assert.equal(f.mutations[0].method,"DELETE");assert.equal(f.mutations[0].revision,`"${"a".repeat(64)}"`);
    } finally {await f.context.close();}
  });
}

test("real Admin preserves untouched timestamp instants and microseconds across browser timezones",async()=>{
  const f=await fixture("dates");
  try {
    await edit(f.page);await f.page.getByRole("dialog").waitFor({state:"hidden"});
    assert.equal(f.mutations[0].body.startDate,"2026-11-01 12:00:00.123456+02");
    assert.equal(f.mutations[0].body.endDate,"2026-12-01 12:00:00.123456+02");
  } finally {await f.context.close();}
});

test("real Admin displays local date instants and submits an explicitly edited date",async()=>{
  const f=await fixture("dates");
  try {
    await f.page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).click();
    const dialog=f.page.getByRole("dialog"),dates=dialog.locator('input[type="datetime-local"]');
    assert.equal(await dates.nth(0).inputValue(),"2026-11-01T10:00");
    await dates.nth(0).fill("2026-11-02T11:30");
    await dialog.getByRole("button",{name:"Save Promotion",exact:true}).click();await dialog.waitFor({state:"hidden"});
    assert.equal(f.mutations[0].body.startDate,"2026-11-02T11:30:00.000Z");
    assert.equal(f.mutations[0].body.endDate,"2026-12-01 12:00:00.123456+02");
  } finally {await f.context.close();}
});

test("Admin reconciles a committed lost response after reload without another mutation",async()=>{
 const f=await fixture("lost");try{
  await edit(f.page);await f.page.getByRole("dialog").getByRole("alert").waitFor();
  const pending=await f.page.evaluate(()=>JSON.parse(sessionStorage.getItem("central.promotions.pending.v1")));
  assert.equal(pending.id,f.mutations[0].operation);assert.equal(pending.actorId,1);assert.doesNotMatch(JSON.stringify(pending),/local-browser-fixture|admin_jwt/);
  await f.page.reload();const dialog=f.page.getByRole("dialog");await dialog.waitFor();assert.equal(await dialog.locator("input").first().inputValue(),"Unsaved review values");
  await dialog.getByRole("button",{name:"Check previous save",exact:true}).click();await dialog.waitFor({state:"hidden"});assert.equal(f.mutations.length,1);assert.equal(await f.page.evaluate(()=>sessionStorage.getItem("central.promotions.pending.v1")),null);
 }finally{await f.context.close();}
});
for(const mode of ["retry","missing"]){test(`Admin ${mode} recovery explicitly resends the original request and identity`,async()=>{
 const f=await fixture(mode);try{
  await edit(f.page);const dialog=f.page.getByRole("dialog");await dialog.getByRole("alert").waitFor();
  assert.equal(await dialog.locator("input").first().isDisabled(),true);
  await dialog.getByRole("button",{name:"Check previous save",exact:true}).click();
  assert.equal(f.mutations.length,1);
  await dialog.getByRole("button",{name:"Retry original request",exact:true}).click();await dialog.waitFor({state:"hidden"});
  assert.equal(f.mutations.length,2);assert.equal(f.mutations[1].operation,f.mutations[0].operation);assert.deepEqual(f.mutations[1].body,f.mutations[0].body);assert.equal(f.mutations[1].body.name,"Unsaved review values");
 }finally{await f.context.close();}
});}
test("Admin authentication change never submits another actor's pending request",async()=>{
 const f=await fixture("operational");try{
  await edit(f.page);await f.page.getByRole("dialog").getByRole("alert").waitFor();f.setActor(2);await f.page.reload();await f.page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).waitFor();
  assert.equal(await f.page.evaluate(()=>sessionStorage.getItem("central.promotions.pending.v1")),null);assert.equal(f.mutations.length,1);assert.equal(await f.page.getByRole("dialog").count(),0);
 }finally{await f.context.close();}
});
test("Admin refuses to send a durable save to an unsupported API version",async()=>{
 const f=await fixture("unsupported");try{await edit(f.page);await f.page.getByRole("dialog").getByRole("alert").waitFor();assert.match(await f.page.getByRole("dialog").getByRole("alert").innerText(),/save support is unavailable/);assert.equal(f.mutations.length,0);}finally{await f.context.close();}
});
test("Admin fails before mutation if recovery context cannot be retained",async()=>{
 const f=await fixture("success");try{
  await f.page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==="central.promotions.pending.v1")throw new DOMException("Recovery storage unavailable","QuotaExceededError");return original.call(this,key,value);};});
  const {dialog,name}=await edit(f.page);await dialog.getByRole("alert").filter({hasText:/Recovery storage unavailable/}).waitFor();assert.equal(f.mutations.length,0);assert.equal(await name.inputValue(),"Unsaved review values");
 }finally{await f.context.close();}
});
