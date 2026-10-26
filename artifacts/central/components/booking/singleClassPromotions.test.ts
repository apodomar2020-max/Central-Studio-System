import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
// Expo screens follow the existing source-contract testing convention. The
// matching quote/final-price behavior is also tested over real API/PostgreSQL.
const flow=readFileSync("artifacts/central/app/booking/flow.tsx","utf8");
const modal=readFileSync("artifacts/central/components/PackagePurchaseModal.tsx","utf8");
test("class quote starts without manual activation and remains disabled for package credits",()=>{
 assert.match(flow,/enabled: Boolean\(user && cls\?\.scheduleId && !isPackageMode\)/);
 assert.match(flow,/JSON.stringify\(\{ scheduleId: Number\(cls!\.scheduleId\) \}\)/);
 assert.match(flow,/const displayedQuote = promoQuote \?\? \(!promoCode.trim\(\) \? automaticQuote.data : null\)/);
});
test("confirmation refreshes the quote, refuses changed totals and submits the reviewed amount",()=>{
 const confirm=flow.slice(flow.indexOf("async function handleConfirm"),flow.indexOf("const renderPriceSummary"));
 assert.match(confirm,/if \(!isPackageMode\) \{\s*const checked = await validatePromoCode\(\)/);
 assert.match(confirm,/Math.round\(checked.finalSubtotal \* 100\) !== Math.round\(finalPrice \* 100\)/);
 assert.match(confirm,/expectedFinalPriceEgp:[\s\S]*?confirmedPromoQuote.finalSubtotal/);
 assert.match(flow,/!promoExpanded && promoError/);
 assert.match(flow,/request !== promoRequest.current \|\| scope !== latestQuoteScope.current/);
});
test("package modal uses catalog amount and preserves participant selection without promotion calls",()=>{
 assert.doesNotMatch(modal,/promotions\/validate|promoCode|PromotionPreview/);
 assert.match(modal,/pkg.priceEgp.toLocaleString\(\)/);
 assert.match(modal,/participantSelectionFor\(selected\)/);
 assert.match(modal,/styles.participantOption/);
});
