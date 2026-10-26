import assert from "node:assert/strict";
import { test } from "node:test";
import { promotionSummary, validatePromotionForm, type PromotionFormState } from "./promotionForm";
const base: PromotionFormState = {name:"Welcome",description:"",type:"automatic",discountType:"percentage",discountValue:"10",priority:"0",isExclusive:false,isStackable:false,isActive:true,startDate:"",endDate:"",code:"",maxUses:"",usesPerUser:"",rulesConfig:"{}"};
test("simple automatic form has no restrictions or validation errors",()=>{
 assert.deepEqual(validatePromotionForm(base),{});const text=promotionSummary(base).join(" ");assert.match(text,/For everyone/);assert.match(text,/Direct Single Class purchases/);assert.match(text,/Starts immediately; no end date/);
});
test("summary explains class-only eligibility and matching branch restrictions",()=>{
 const text=promotionSummary({...base,rulesConfig:JSON.stringify({verifiedStudentOnly:true,branches:["Main"],maxGlobalUses:5,maxUsesPerUser:1})}).join(" ");
 for(const part of [/verified student/,/Direct Single Class purchases only/,/Packages and package-credit bookings are excluded/,/without a matching branch do not qualify/,/5 total/,/1 redemptions per customer/])assert.match(text,part);
});
test("summary distinguishes code limits, stacking, priority and non-enforced exclusive flag",()=>{
 const text=promotionSummary({...base,type:"manual",code:"WELCOME",discountType:"fixed_amount",discountValue:"25.5",maxUses:"3",usesPerUser:"1",isExclusive:true,isStackable:true,priority:"2",rulesConfig:'{"maxGlobalUses":4}'}).join(" ");
 for(const part of [/EGP 25.5/,/WELCOME/,/Promotion limit: 4/,/Code limit: 3/,/Code limit: 1/,/all eligible promotions/,/Priority 2 breaks ties/,/does not independently/])assert.match(text,part);
});
test("invalid discount, date range and code are caught before mutation",()=>{
 for(const value of ["","0","-1","101","Infinity"]){assert.ok(validatePromotionForm({...base,discountValue:value}).discountValue);}
 assert.ok(validatePromotionForm({...base,type:"manual",code:"A"}).code);
 assert.ok(validatePromotionForm({...base,startDate:"2026-12-01T12:00",endDate:"2026-11-01T12:00"}).endDate);
 assert.ok(validatePromotionForm({...base,startDate:"bad"}).startDate);
 assert.deepEqual(validatePromotionForm({...base,discountType:"fixed_amount",discountValue:"101"}),{});
});
test("advanced validation retains exact legacy types and rejects invalid limits",()=>{
 for(const value of [0,1.5,"2",null]) assert.ok(validatePromotionForm({...base,rulesConfig:JSON.stringify({maxGlobalUses:value})}).maxGlobalUses);
 assert.ok(validatePromotionForm({...base,type:"manual",code:"TEST",maxUses:"0",usesPerUser:"1.5"}).maxUses);
 assert.ok(validatePromotionForm({...base,maxUses:"3"}).type);
 assert.ok(validatePromotionForm({...base,priority:"1.5"}).priority);
});
test("unknown and malformed conditions cannot be summarized as unrestricted",()=>{
 for(const rulesConfig of ['{"packageIds":[7]}','{"firstPackagePurchaseOnly":true}','{"legacy":true}',"null","[]","{broken"]){assert.ok(Object.keys(validatePromotionForm({...base,rulesConfig})).length);assert.match(promotionSummary({...base,rulesConfig}).join(" "),/need review/);}
});
test("summary preserves inactive and scheduled meaning without assuming eligibility",()=>{
 assert.match(promotionSummary({...base,isActive:false}).join(" "),/Inactive — not available/);
 assert.match(promotionSummary({...base,startDate:"2026-12-01T12:00",endDate:"2026-12-02T12:00"}).join(" "),/Starts.*ends/);
 assert.match(promotionSummary({...base,rulesConfig:'{"verifiedStudentOnly":false,"minimumBasketAmount":0}'}).join(" "),/Minimum purchase: EGP 0/);
});
