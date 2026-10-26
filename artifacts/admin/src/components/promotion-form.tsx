import { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PromotionConditions } from "./promotion-conditions";
import { readPromotionConditions } from "@/lib/promotionConditions";
import { conditionLabels, promotionSummary, type PromotionFormErrors, type PromotionFormState } from "@/lib/promotionForm";

export function PromotionForm({ form, update, generateCode, errors }: {
  form: PromotionFormState; update: <K extends keyof PromotionFormState>(key: K, value: PromotionFormState[K]) => void;
  generateCode: () => void; errors: PromotionFormErrors;
}) {
  const id = useId();
  let rules: Record<string, unknown> = {}, malformed = false;
  try { rules = readPromotionConditions(form.rulesConfig); } catch { malformed = true; }
  const unsafe = malformed || Object.keys(rules).some(key => !Object.prototype.hasOwnProperty.call(conditionLabels, key));
  const advancedKeys = ["minimumBasketAmount", "maxGlobalUses", "maxUsesPerUser", "branches"];
  const configured = [
    ...advancedKeys.filter(key => Array.isArray(rules[key]) ? (rules[key] as unknown[]).length : rules[key] != null),
    ...(form.maxUses ? ["codeTotal"] : []), ...(form.usesPerUser ? ["codeCustomer"] : []),
    ...(form.isStackable ? ["stacking"] : []), ...(form.isExclusive ? ["exclusive"] : []), ...(Number(form.priority) ? ["priority"] : []),
  ].length;
  const [advancedOpen, setAdvancedOpen] = useState(configured > 0);
  const advancedError = [...advancedKeys, "maxUses", "usesPerUser", "priority"].some(key => errors[key]);
  useEffect(() => { if (advancedError) setAdvancedOpen(true); }, [advancedError, errors]);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const field = (key: keyof PromotionFormState, label: string, type = "text", placeholder?: string) => <div className="min-w-0 space-y-2">
    <Label htmlFor={`${id}-${key}`}>{label}</Label>
    <Input id={`${id}-${key}`} type={type} value={String(form[key])} placeholder={placeholder}
      step={type === "number" ? "any" : undefined} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
      onChange={event => update(key, (key === "code" ? event.target.value.toUpperCase() : event.target.value) as never)} />
    {errors[key] && <p id={`${id}-${key}-error`} className="text-sm text-destructive">{errors[key]}</p>}
  </div>;
  const summary = promotionSummary(form);
  const conditionProps = { value: form.rulesConfig, onChange: (value: string) => update("rulesConfig", value), errors };
  return <div className="min-w-0 space-y-6">
    <section aria-label="Promotion identity" className="space-y-4">
      <h3 className="font-semibold">1. Name and type</h3>
      {field("name", "Promotion name", "text", "e.g. Welcome offer")}
      <details className="text-sm" open={form.description ? true : undefined}><summary className="cursor-pointer text-muted-foreground">Optional description</summary><Label htmlFor={`${id}-description`} className="sr-only">Description</Label><Textarea id={`${id}-description`} className="mt-2" value={form.description} onChange={e => update("description", e.target.value)} /></details>
      <div className="space-y-2"><Label htmlFor={`${id}-type`}>How customers receive it</Label><Select value={form.type} onValueChange={(v: "automatic" | "manual") => update("type", v)}><SelectTrigger id={`${id}-type`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="automatic">Automatic discount</SelectItem><SelectItem value="manual">Promo code</SelectItem></SelectContent></Select>
        <p className="text-sm text-muted-foreground">{form.type === "manual" ? "Customers enter this promotion’s code at checkout." : "Eligible purchases receive this promotion automatically. No promo code is required."}</p>
        {errors.type && <p className="text-sm text-destructive">{errors.type}</p>}
      </div>
      {form.type === "manual" && <div className="flex items-end gap-2"><div className="min-w-0 flex-1">{field("code", "Promo code", "text", "e.g. WELCOME10")}</div><Button type="button" variant="outline" onClick={generateCode}>Generate</Button></div>}
    </section>
    <section aria-label="Discount" className="space-y-3 border-t border-border pt-5">
      <h3 className="font-semibold">2. Discount</h3>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor={`${id}-discountType`}>Discount type</Label><Select value={form.discountType} onValueChange={(v: "percentage" | "fixed_amount") => update("discountType", v)}><SelectTrigger id={`${id}-discountType`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="percentage">Percentage off</SelectItem><SelectItem value="fixed_amount">Fixed EGP amount off</SelectItem></SelectContent></Select></div>
      {field("discountValue", form.discountType === "percentage" ? "Discount (%)" : "Discount (EGP)", "number")}</div>
      <p className="text-sm text-muted-foreground">Discounts never exceed the eligible purchase amount.</p>
    </section>
    {unsafe && <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">Saved conditions need review. Package-specific or unsupported conditions are preserved; saving is blocked. You can deactivate this promotion from the list and create a new Direct Single Class promotion.<details className="mt-2"><summary className="cursor-pointer">View preserved legacy conditions</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{form.rulesConfig}</pre></details></div>}
    <fieldset disabled={unsafe} className="min-w-0 space-y-5 border-t border-border pt-5">
      <PromotionConditions {...conditionProps} section="audience" />
      <section aria-label="Applies to" className="space-y-2"><h3 className="font-semibold">4. Applies to</h3><p className="text-sm text-muted-foreground">Direct Single Class purchases only. Packages and bookings paid with package credits never receive promotion discounts.</p></section>
    </fieldset>
    <section aria-label="Schedule" className="space-y-3 border-t border-border pt-5">
      <h3 className="font-semibold">5. Schedule</h3>
      <p className="text-sm text-muted-foreground">Times use your browser timezone: {timezone}. Leave dates blank to start immediately with no end date.</p>
      <div className="grid gap-4 sm:grid-cols-2">{field("startDate", "Start date (optional)", "datetime-local")}{field("endDate", "End date (optional)", "datetime-local")}</div>
      <label className="flex items-center gap-3 text-sm"><Switch checked={form.isActive} onCheckedChange={v => update("isActive", v)} />Available at checkout</label>
      {!form.isActive && <p className="text-sm text-muted-foreground">Inactive promotions cannot be used, regardless of their schedule.</p>}
    </section>
    <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="rounded-lg border border-border">
      <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="h-auto w-full justify-between gap-2 whitespace-normal p-4 text-left"><span>Additional settings <span className="font-normal text-muted-foreground">{configured ? `(${configured} configured)` : "(optional)"}</span></span><ChevronDown aria-hidden className={`h-4 w-4 shrink-0 ${advancedOpen ? "rotate-180" : ""}`} /></Button></CollapsibleTrigger>
      <CollapsibleContent className="space-y-5 px-4 pb-4">
        <fieldset disabled={unsafe}><PromotionConditions {...conditionProps} section="advanced" /></fieldset>
        {form.type === "manual" && <div className="space-y-3 border-t pt-4"><h4 className="text-sm font-medium">Promo code limits</h4><p className="text-sm text-muted-foreground">These apply to this code separately from promotion-wide limits. Both limits must allow the purchase.</p><div className="grid gap-4 sm:grid-cols-2">{field("maxUses", "Total code uses", "number", "No limit")}{field("usesPerUser", "Code uses per customer", "number", "No limit")}</div></div>}
        <div className="space-y-3 border-t pt-4"><label className="flex items-center gap-3 text-sm"><Switch checked={form.isStackable} onCheckedChange={v => update("isStackable", v)} />Allow combining discounts</label><p className="text-sm text-muted-foreground">Combines only when all eligible promotions allow it. Otherwise, checkout selects the best discount.</p>
        {field("priority", "Priority", "number")}<p className="text-sm text-muted-foreground">A higher priority breaks ties between equal discounts.</p>
        <label className="flex items-center gap-3 text-sm"><Switch checked={form.isExclusive} onCheckedChange={v => update("isExclusive", v)} />Exclusive flag</label><p className="text-sm text-muted-foreground">Saved for compatibility. This flag does not independently block other discounts.</p></div>
      </CollapsibleContent>
    </Collapsible>
    <section aria-label="Promotion summary" aria-live="polite" aria-atomic="true" className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <h3 className="mb-2 font-semibold">At a glance</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{summary.map((line, index) => <li key={index}>{line}</li>)}</ul>
      <p className="mt-2 text-xs text-muted-foreground">Schedule shown in {timezone}. Eligibility and the final discount are checked at checkout.</p>
    </section>
  </div>;
}
