/** Run against a local Admin production preview. All API calls are intercepted:
 * this tests the real page/customFetch/feedback with no real account or backend.
 * Supply PLAYWRIGHT_MODULE_PATH when using an external existing Playwright runtime.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { beforeEach, afterEach, test } from "node:test";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const base=process.env.PROMOTIONS_ADMIN_TEST_URL;
if(!base || !["localhost","127.0.0.1"].includes(new URL(base).hostname)) throw Error("Set a localhost PROMOTIONS_ADMIN_TEST_URL");
let browser;
// Each test owns its browser, including reload/replay checks within that test.
// Avoid accumulating macOS display-link resources across many closed contexts.
beforeEach(async()=>{browser=await chromium.launch({headless:true,args:["--disable-gpu"],...(process.env.PROMOTIONS_TEST_CHROME ? {executablePath:process.env.PROMOTIONS_TEST_CHROME}: {})});});
afterEach(async()=>{await browser?.close();});
async function fixture(mode) {
  const context=await browser.newContext({timezoneId:"UTC"});
  await context.addInitScript(()=>localStorage.setItem("admin_jwt","local-browser-fixture"));
  const page=await context.newPage();
  const row={id:1,name:"Review fixture",description:null,type:"manual",discountType:"percentage",discountValue:10,priority:0,isActive:true,isExclusive:false,isStackable:false,startDate:null,endDate:null,rulesConfig:{},revision:"a".repeat(64),codes:[{id:1,promotionId:1,code:"REVIEW10",maxUses:null,usesPerUser:null,currentUses:0}]};
  if(mode==="dates") {row.startDate="2026-11-01 12:00:00.123456+02";row.endDate="2026-12-01 12:00:00.123456+02";}
  if(mode==="null-rules") row.rulesConfig=null;
  if(mode==="verified-rules") row.rulesConfig={verifiedStudentOnly:true};
  if(mode==="automatic") {row.type="automatic";row.codes=[];}
  if(mode==="legacy-limit") row.rulesConfig={maxGlobalUses:"2"};
  if(mode==="legacy-rules") row.rulesConfig={legacyRule:true,packageIds:[99]};
  if(mode==="stored-rules") row.rulesConfig={verifiedStudentOnly:false,minimumBasketAmount:0,maxGlobalUses:4,maxUsesPerUser:2,branches:["Main","Giza"]};
  if(mode==="package-rules") row.rulesConfig={packageIds:[8,99],firstPackagePurchaseOnly:true};
  const mutations=[];
  let actorId=1;
  await page.route("**/*",async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==new URL(base).origin) return route.abort();
    if(!url.pathname.startsWith("/api/")) return route.continue();
    const reply=(status,body)=>route.fulfill({status,contentType:"application/json",body:body==null?undefined:JSON.stringify(body)});
    if(url.pathname==="/api/admin/auth/me") return reply(200,{id:actorId,username:"review",fullName:"Review Admin",email:"review@example.invalid",isSuperAdmin:mode!=="readonly",roleId:mode==="readonly"?2:null,role:mode==="readonly"?{id:2,name:"Read only",permissions:{promotions:{view:true}}}:null});
    if(url.pathname==="/api/promotions/save-protocol") return reply(200,mode==="unsupported" ? {} : {version:1,idempotency:true});
    if(url.pathname==="/api/price-packages" && mode==="package-error") return reply(503,{error:"Unavailable"});
    if(url.pathname==="/api/price-packages") return reply(200,[{id:7,name:"Studio Package",isActive:true},{id:8,name:"Retired Package",isActive:false}]);
    if(url.pathname.startsWith("/api/promotions/operations/")) {
      if(mode==="lost" || mode==="malformed") return reply(200,{state:"succeeded",status:200,promotionId:1,response:row});
      if(mode==="missing") return reply(404,{error:"Operation not found"});
      return reply(200,{state:"pending"});
    }
    if(url.pathname==="/api/promotions" && req.method()==="GET") {
      if(mode==="refresh-failure" && mutations.length) return reply(503,{error:"List unavailable"});
      return reply(200,[row]);
    }
    if(url.pathname==="/api/promotions" && req.method()==="POST") {mutations.push({operation:req.headers()["idempotency-key"],method:"POST",body:req.postDataJSON()});return reply(201,{...row,...req.postDataJSON(),id:2});}
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
  if(mode==="readonly") await page.getByRole("heading",{name:"Promotions",exact:true}).waitFor();
  else await page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).waitFor();
  return {page,context,mutations,setActor:(id)=>{actorId=id;}};
}

test("structured conditions submit the existing exact API keys and numeric values",async()=>{
  const f=await fixture("success");
  try {
    await f.page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).click();
    const d=f.page.getByRole("dialog");
    assert.equal(await d.getByText("Rules Config JSON",{exact:true}).count(),0);
    await d.getByRole("switch",{name:"Verified students only",exact:true}).check();
    await d.getByRole("button",{name:/Additional settings/}).click();
    await d.getByLabel("Minimum purchase (EGP)",{exact:true}).fill("123.45");
    await d.getByLabel("Total promotion redemptions",{exact:true}).fill("4");
    await d.getByLabel("Promotion redemptions per customer",{exact:true}).fill("2");
    await d.getByLabel("Eligible branches (one per line)",{exact:true}).fill("Main\nGiza");
    await d.getByRole("button",{name:"Save Promotion",exact:true}).click();
    await d.waitFor({state:"hidden"});
    assert.deepEqual(f.mutations[0].body.rulesConfig,{verifiedStudentOnly:true,minimumBasketAmount:123.45,maxGlobalUses:4,maxUsesPerUser:2,branches:["Main","Giza"]});
    assert.equal(f.mutations[0].body.code,"REVIEW10");assert.equal(f.mutations[0].body.type,"manual");
  } finally {await f.context.close();}
});
test("Manual and Automatic controls change presentation without losing existing rules",async()=>{
  const f=await fixture("success");
  try {
    await f.page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).click();
    const d=f.page.getByRole("dialog");
    await d.getByText("Customers enter this promotion’s code",{exact:false}).waitFor();
    await d.getByRole("combobox").first().click();await f.page.getByRole("option",{name:"Automatic discount",exact:true}).click();
    await d.getByText("Eligible purchases receive this promotion automatically",{exact:false}).waitFor();
    assert.equal(await d.getByLabel("Promo code",{exact:true}).count(),0);
    await d.getByRole("button",{name:"Save Promotion",exact:true}).click();await d.waitFor({state:"hidden"});
    assert.equal(f.mutations[0].body.type,"automatic");assert.equal(f.mutations[0].body.code,"");
  } finally {await f.context.close();}
});
test("unsupported legacy conditions are preserved and cannot silently be saved",async()=>{
  const f=await fixture("legacy-rules");
  try {
    await f.page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).click();
    const d=f.page.getByRole("dialog");await d.getByText(/Saved conditions need review/).first().waitFor();
    await d.getByRole("button",{name:"Save Promotion",exact:true}).click();
    assert.equal(f.mutations.length,0);await d.getByText("View preserved legacy conditions").click();
    assert.match(await d.locator("pre").innerText(),/legacyRule/);
  } finally {await f.context.close();}
});
test("name-only edits preserve stored class conditions",async()=>{
  const f=await fixture("stored-rules");
  try {
    await f.page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).click();
    const d=f.page.getByRole("dialog");
    await d.locator("input").first().fill("Name only");
    await d.getByRole("button",{name:"Save Promotion",exact:true}).click();await d.waitFor({state:"hidden"});
    assert.deepEqual(f.mutations[0].body.rulesConfig,{verifiedStudentOnly:false,minimumBasketAmount:0,maxGlobalUses:4,maxUsesPerUser:2,branches:["Main","Giza"]});
  } finally {await f.context.close();}
});
test("clearing a numeric restriction removes only that restriction",async()=>{
  const f=await fixture("stored-rules");
  try {
    await f.page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).click();
    const d=f.page.getByRole("dialog");await d.getByLabel("Total promotion redemptions",{exact:true}).fill("");
    await d.getByRole("button",{name:"Save Promotion",exact:true}).click();await d.waitFor({state:"hidden"});
    assert.equal("maxGlobalUses" in f.mutations[0].body.rulesConfig,false);assert.equal(f.mutations[0].body.rulesConfig.maxUsesPerUser,2);
  } finally {await f.context.close();}
});
test("invalid limits are rejected before a durable mutation is admitted",async()=>{
  const f=await fixture("success");
  try {
    await f.page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).click();
    const d=f.page.getByRole("dialog");await d.getByRole("button",{name:/Additional settings/}).click();await d.getByLabel("Total promotion redemptions",{exact:true}).fill("0");
    await d.getByRole("button",{name:"Save Promotion",exact:true}).click();
    await d.getByRole("alert").first().waitFor();assert.equal(f.mutations.length,0);
  } finally {await f.context.close();}
});
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

test("one-minute automatic creation defaults to everyone with no schedule or advanced restrictions",async()=>{
 const f=await fixture("success");try{
  await f.page.getByRole("button",{name:"Add Promotion",exact:true}).click();const d=f.page.getByRole("dialog");
  await d.getByLabel("Promotion name",{exact:true}).fill("Simple offer");
  assert.equal(await d.getByRole("switch",{name:"Verified students only",exact:true}).isChecked(),false);
  assert.equal(await d.getByRole("switch",{name:"First package purchase only",exact:true}).count(),0);
  assert.equal(await d.getByRole("radio",{name:"All eligible purchases",exact:true}).count(),0);
  assert.equal(await d.getByLabel("Total promotion redemptions",{exact:true}).isVisible(),false);
  assert.equal(await d.getByLabel("Promo code",{exact:true}).count(),0);
  assert.match(await d.getByRole("region",{name:"Promotion summary"}).innerText(),/10%.*For everyone[\s\S]*Starts immediately; no end date/s);
  await d.getByRole("button",{name:"Save Promotion",exact:true}).click();await d.waitFor({state:"hidden"});
  assert.equal(f.mutations.length,1);assert.equal(f.mutations[0].method,"POST");
  assert.deepEqual(f.mutations[0].body.rulesConfig,{});assert.equal(f.mutations[0].body.startDate,null);assert.equal(f.mutations[0].body.endDate,null);
 }finally{await f.context.close();}
});
test("manual fixed-amount creation preserves distinct code and promotion limits and immediate summary",async()=>{
 const f=await fixture("success");try{
  await f.page.getByRole("button",{name:"Add Promotion",exact:true}).click();const d=f.page.getByRole("dialog");
  await d.getByLabel("Promotion name",{exact:true}).fill("Welcome");await d.getByLabel("How customers receive it").click();await f.page.getByRole("option",{name:"Promo code",exact:true}).click();
  await d.getByLabel("Promo code",{exact:true}).fill("WELCOME25");await d.getByLabel("Discount type",{exact:true}).click();await f.page.getByRole("option",{name:"Fixed EGP amount off",exact:true}).click();await d.getByLabel("Discount (EGP)").fill("25");
  await d.getByRole("button",{name:/Additional settings/}).click();await d.getByLabel("Total code uses").fill("3");await d.getByLabel("Code uses per customer").fill("1");await d.getByLabel("Total promotion redemptions").fill("5");
  assert.match(await d.getByRole("region",{name:"Promotion summary"}).innerText(),/EGP 25[\s\S]*WELCOME25[\s\S]*Promotion limit: 5[\s\S]*Code limit: 3/);
  await d.getByRole("button",{name:/Additional settings/}).click();await d.getByRole("button",{name:"Save Promotion",exact:true}).click();await d.waitFor({state:"hidden"});
  assert.equal(f.mutations[0].body.maxUses,3);assert.equal(f.mutations[0].body.usesPerUser,1);assert.equal(f.mutations[0].body.rulesConfig.maxGlobalUses,5);
 }finally{await f.context.close();}
});
test("saved verified-only eligibility survives editing while new forms default to everyone",async()=>{
 const f=await fixture("verified-rules");try{await f.page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).click();const d=f.page.getByRole("dialog");assert.equal(await d.getByRole("switch",{name:"Verified students only",exact:true}).isChecked(),true);await d.getByRole("button",{name:"Save Promotion",exact:true}).click();await d.waitFor({state:"hidden"});assert.deepEqual(f.mutations[0].body.rulesConfig,{verifiedStudentOnly:true});}finally{await f.context.close();}
});
test("package targeting is absent and class-only summary is explicit",async()=>{
 const f=await fixture("success");try{await f.page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).click();const d=f.page.getByRole("dialog");assert.equal(await d.getByRole("radio",{name:"Specific packages",exact:true}).count(),0);assert.match(await d.getByRole("region",{name:"Promotion summary"}).innerText(),/Direct Single Class purchases only/);await d.getByRole("button",{name:"Save Promotion",exact:true}).click();await d.waitFor({state:"hidden"});assert.equal("packageIds" in f.mutations[0].body.rulesConfig,false);}finally{await f.context.close();}
});
test("advanced errors reopen collapsed controls and invalid discounts and dates stay inline",async()=>{
 const f=await fixture("success");try{await f.page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).click();const d=f.page.getByRole("dialog");await d.getByRole("button",{name:/Additional settings/}).click();await d.getByLabel("Total promotion redemptions").fill("0");await d.getByRole("button",{name:/Additional settings/}).click();await d.getByLabel("Discount (%)").fill("110");await d.getByLabel("Start date (optional)").fill("2026-12-02T12:00");await d.getByLabel("End date (optional)").fill("2026-12-01T12:00");await d.getByRole("button",{name:"Save Promotion",exact:true}).click();await d.getByLabel("Total promotion redemptions").waitFor({state:"visible"});assert.equal(await d.getByLabel("Discount (%)").getAttribute("aria-invalid"),"true");await d.getByText("End date cannot precede start date.",{exact:true}).waitFor();assert.equal(f.mutations.length,0);}finally{await f.context.close();}
});
for(const mode of ["null-rules","legacy-limit"]){test(`legacy safety: ${mode} is preserved and rejected without normalizing`,async()=>{
 const f=await fixture(mode);try{await f.page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).click();const d=f.page.getByRole("dialog");await d.getByRole("button",{name:"Save Promotion",exact:true}).click();assert.equal(f.mutations.length,0);if(mode==="null-rules"){await d.getByText("View preserved legacy conditions").click();assert.equal(await d.locator("pre").innerText(),"null");}else assert.equal(await d.getByLabel("Total promotion redemptions").inputValue(),"2");}finally{await f.context.close();}
});}
test("obsolete package conditions cannot be silently saved or stripped",async()=>{
 const f=await fixture("package-rules");try{await f.page.getByRole("button",{name:"Edit promotion Review fixture",exact:true}).click();const d=f.page.getByRole("dialog");await d.getByRole("button",{name:"Save Promotion",exact:true}).click();assert.equal(f.mutations.length,0);await d.getByText("View preserved legacy conditions").click();const rules=JSON.parse(await d.locator("pre").innerText());assert.deepEqual(rules,{packageIds:[8,99],firstPackagePurchaseOnly:true});}finally{await f.context.close();}
});
test("view-only permissions expose no creation, editing or deactivation controls",async()=>{
 const f=await fixture("readonly");try{assert.equal(await f.page.getByRole("button",{name:"Add Promotion",exact:true}).count(),0);assert.equal(await f.page.getByRole("button",{name:/Edit promotion/}).count(),0);assert.equal(await f.page.getByRole("button",{name:/Deactivate promotion/}).count(),0);assert.equal(f.mutations.length,0);}finally{await f.context.close();}
});
for(const theme of ["dark","light"]){for(const width of [390,1280]){test(`visual and keyboard verification: ${theme}, ${width}px`,async()=>{
 const f=await fixture("success");try{
  await f.page.setViewportSize({width,height:900});await f.page.evaluate(theme=>{document.documentElement.classList.toggle("night",theme==="light");document.documentElement.setAttribute("data-theme",theme==="light"?"night":"dark");},theme);
  await f.page.getByRole("button",{name:"Add Promotion",exact:true}).click();const d=f.page.getByRole("dialog");await d.getByLabel("Promotion name",{exact:true}).fill("Weekend welcome");
  await d.getByRole("switch",{name:"Verified students only",exact:true}).focus();await f.page.keyboard.press("Space");assert.equal(await d.getByRole("switch",{name:"Verified students only",exact:true}).isChecked(),true);
  const toggle=d.getByRole("button",{name:/Additional settings/});await toggle.focus();await f.page.keyboard.press("Enter");await d.getByLabel("Minimum purchase (EGP)").waitFor({state:"visible"});await d.getByLabel("Minimum purchase (EGP)").fill("100");assert.match(await d.getByRole("region",{name:"Promotion summary"}).innerText(),/Minimum purchase: EGP 100/);await toggle.click();
  assert.equal(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  await d.getByRole("button",{name:"Save Promotion",exact:true}).scrollIntoViewIfNeeded();const box=await d.getByRole("button",{name:"Save Promotion",exact:true}).boundingBox();assert.ok(box && box.x>=0 && box.x+box.width<=width+1);
  if(process.env.PROMOTIONS_UX_SCREENSHOTS){await mkdir(process.env.PROMOTIONS_UX_SCREENSHOTS,{recursive:true});await d.evaluate(el=>{el.scrollTop=0;});await f.page.screenshot({path:`${process.env.PROMOTIONS_UX_SCREENSHOTS}/promotion-${theme}-${width}.png`});await d.getByRole("region",{name:"Promotion summary"}).scrollIntoViewIfNeeded();await f.page.screenshot({path:`${process.env.PROMOTIONS_UX_SCREENSHOTS}/summary-${theme}-${width}.png`});}
  await f.page.keyboard.press("Escape");await d.waitFor({state:"hidden"});assert.equal(f.mutations.length,0);
 }finally{await f.context.close();}
});}}
