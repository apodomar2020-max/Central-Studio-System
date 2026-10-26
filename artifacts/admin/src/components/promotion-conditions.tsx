import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { changePromotionCondition, readPromotionConditions } from "@/lib/promotionConditions";
import type { PromotionFormErrors } from "@/lib/promotionForm";

export function NumberCondition({ label, value, whole, error, onChange }: { label: string; value: unknown; whole?: boolean; error?: string; onChange: (value: unknown) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const emitted = useRef(value);
  useEffect(() => { if (value !== emitted.current) setDraft(value == null ? "" : String(value)); emitted.current = value; }, [value]);
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>
    <Input id={id} type="number" min={whole ? 1 : 0} step={whole ? 1 : "any"} placeholder={whole ? "No limit" : "No minimum"}
      aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} value={draft}
      onChange={event => { const raw = event.target.value; setDraft(raw); const next = raw.trim() === "" ? undefined : Number(raw); emitted.current = next; onChange(next); }} />
    {error && <p id={`${id}-error`} className="text-sm text-destructive">{error}</p>}
  </div>;
}

type PackageOption = { id: number; name: string; isActive?: boolean };
export function PromotionConditions({ value, onChange, section, errors, specific = false, setSpecific, packages = [], loading, failed, retry }: {
  value: string; onChange: (value: string) => void; section: "audience" | "packages" | "advanced";
  errors: PromotionFormErrors; specific?: boolean; setSpecific?: (value: boolean) => void; packages?: PackageOption[]; loading?: boolean; failed?: boolean; retry?: () => void;
}) {
  const id = useId();
  let rules: Record<string, unknown> = {};
  try { rules = readPromotionConditions(value); } catch { /* Parent blocks malformed legacy rules. */ }
  const update = (key: string, next: unknown) => onChange(changePromotionCondition(value, key, next));
  const selected = Array.isArray(rules.packageIds) ? rules.packageIds.filter((x): x is number => typeof x === "number") : [];
  const [branchDraft, setBranchDraft] = useState(Array.isArray(rules.branches) ? rules.branches.join("\n") : "");
  const historical = selected.filter(packageId => !packages.some(p => p.id === packageId && p.isActive));
  if (section === "audience") return <section aria-label="Customer eligibility" className="space-y-3">
    <h3 className="font-semibold">3. Customer eligibility</h3>
    <p className="text-sm text-muted-foreground">{rules.verifiedStudentOnly || rules.firstPackagePurchaseOnly ? "Customers must meet every selected condition." : "Everyone — no customer restrictions selected."}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex items-center gap-3 text-sm"><Switch checked={rules.verifiedStudentOnly === true} onCheckedChange={v => update("verifiedStudentOnly", v)} />Verified students only</label>
      <label className="flex items-center gap-3 text-sm"><Switch checked={rules.firstPackagePurchaseOnly === true} onCheckedChange={v => update("firstPackagePurchaseOnly", v)} />First package purchase only</label>
    </div>
    {rules.firstPackagePurchaseOnly === true && <p className="text-sm text-muted-foreground">Checks all non-cancelled package orders, including unpaid orders. Direct-class purchases are excluded.</p>}
    {[errors.verifiedStudentOnly, errors.firstPackagePurchaseOnly].filter(Boolean).map(message => <p key={message} className="text-sm text-destructive">{message}</p>)}
  </section>;
  if (section === "packages") return <section aria-label="Applies to" className="space-y-3">
    <h3 className="font-semibold">4. Applies to</h3>
    <RadioGroup aria-label="Purchase selection" value={specific ? "specific" : "all"} onValueChange={v => { setSpecific?.(v === "specific"); if (v === "all") update("packageIds", undefined); }} className="sm:flex sm:gap-6">
      <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="all" />All eligible purchases</label>
      <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="specific" />Specific packages</label>
    </RadioGroup>
    <p className="text-sm text-muted-foreground">{specific ? "Only selected packages qualify. Direct-class purchases are excluded." : "Includes eligible packages and direct-class purchases, subject to the other conditions. Package-credit bookings are excluded."}</p>
    {specific && <div className="space-y-3 rounded-lg border border-border p-3">
      {loading && <p role="status" className="text-sm">Loading packages…</p>}
      {failed && <div className="text-sm text-destructive">Packages could not be loaded. Saved selections are preserved. <Button type="button" variant="outline" size="sm" onClick={retry}>Retry packages</Button></div>}
      {!loading && !failed && !packages.some(p => p.isActive) && <p className="text-sm text-muted-foreground">No active packages are available.</p>}
      <div className="grid max-h-48 gap-3 overflow-y-auto sm:grid-cols-2">
        {packages.filter(p => p.isActive).map(pkg => <label key={pkg.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(pkg.id)} onChange={e => update("packageIds", e.target.checked ? [...selected, pkg.id] : selected.filter(x => x !== pkg.id))} />{pkg.name}</label>)}
      </div>
      {historical.length > 0 && <div className="space-y-2 border-t pt-3"><p className="text-sm text-muted-foreground">Previously selected — inactive or unavailable. Kept unless you remove them.</p>{historical.map(packageId => <label key={packageId} className="flex items-center gap-2 text-sm"><input type="checkbox" checked onChange={() => update("packageIds", selected.filter(x => x !== packageId))} />{packages.find(p => p.id === packageId)?.name ?? `Unavailable package #${packageId}`} (inactive or unavailable)</label>)}</div>}
      {!selected.length && <p role="alert" className="text-sm text-destructive">Select at least one package, or choose All eligible purchases.</p>}
    </div>}
    {errors.packageIds && <p className="text-sm text-destructive">{errors.packageIds}</p>}
  </section>;
  return <div className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <NumberCondition label="Minimum purchase (EGP)" value={rules.minimumBasketAmount} error={errors.minimumBasketAmount} onChange={v => update("minimumBasketAmount", v)} />
      <NumberCondition label="Total promotion redemptions" value={rules.maxGlobalUses} error={errors.maxGlobalUses} whole onChange={v => update("maxGlobalUses", v)} />
      <NumberCondition label="Promotion redemptions per customer" value={rules.maxUsesPerUser} error={errors.maxUsesPerUser} whole onChange={v => update("maxUsesPerUser", v)} />
    </div>
    <div className="space-y-2"><Label htmlFor={id}>Eligible branches (one per line)</Label>
      <Textarea id={id} value={branchDraft} placeholder="All branches" aria-invalid={Boolean(errors.branches)} onChange={e => { setBranchDraft(e.target.value); const branches = e.target.value.split("\n").map(b => b.trim()).filter(Boolean); update("branches", branches.length ? branches : undefined); }} />
      <p className="text-sm text-muted-foreground">Only matching branches qualify. Package purchases without a branch will not qualify when this restriction is set.</p>
      {errors.branches && <p className="text-sm text-destructive">{errors.branches}</p>}
    </div>
  </div>;
}
