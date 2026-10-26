import { useEffect, useId, useState } from "react";
import { useListPricePackages } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { changePromotionCondition, readPromotionConditions, validatePromotionConditions } from "@/lib/promotionConditions";

function NumberCondition({ label, value, whole, onChange }: { label: string; value: unknown; whole?: boolean; onChange: (value: unknown) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => setDraft(value == null ? "" : String(value)), [value]);
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>
    <Input id={id} type="number" min={whole ? 1 : 0} step={whole ? 1 : "any"} placeholder={whole ? "No limit" : "No minimum"}
      value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => { if (draft !== (value == null ? "" : String(value))) onChange(draft.trim() === "" ? undefined : Number(draft)); }} />
  </div>;
}

export function PromotionConditions({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const packages = useListPricePackages();
  const branchId = useId();
  let rules: Record<string, unknown>;
  let problem: string | null = null;
  try { rules = readPromotionConditions(value); } catch { rules = {}; problem = "Saved conditions are malformed. They have been preserved and require review."; }
  try { validatePromotionConditions(value); } catch (error) { problem ??= error instanceof Error ? error.message : "Review the saved conditions."; }
  const supported = new Set(["verifiedStudentOnly", "firstPackagePurchaseOnly", "minimumBasketAmount", "maxGlobalUses", "maxUsesPerUser", "packageIds", "branches"]);
  const unsafe = Object.keys(rules).some(key => !supported.has(key)) || (() => { try { readPromotionConditions(value); return false; } catch { return true; } })();
  const update = (key: string, next: unknown) => onChange(changePromotionCondition(value, key, next));
  const selected = Array.isArray(rules.packageIds) ? rules.packageIds.filter((id): id is number => typeof id === "number") : [];
  const options = (packages.data ?? []).map(pkg => ({ id: pkg.id, name: pkg.name, inactive: !pkg.isActive }));
  const missing = selected.filter(id => !options.some(pkg => pkg.id === id));
  return <section className="space-y-5 rounded-xl border border-border p-4 md:col-span-2" aria-label="Eligibility conditions">
    <div><h3 className="text-base font-semibold">Eligibility conditions</h3><p className="text-sm text-muted-foreground">Choose who qualifies and where this promotion applies. Empty limits do not restrict usage.</p></div>
    {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
    <fieldset disabled={unsafe} className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex items-center gap-2 text-sm"><Switch checked={rules.verifiedStudentOnly === true} onCheckedChange={checked => update("verifiedStudentOnly", checked)} /> Verified students only</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={rules.firstPackagePurchaseOnly === true} onCheckedChange={checked => update("firstPackagePurchaseOnly", checked)} /> First package purchase only</label>
        <NumberCondition label="Minimum purchase (EGP)" value={rules.minimumBasketAmount} onChange={next => update("minimumBasketAmount", next)} />
        <NumberCondition label="Total promotion redemptions" value={rules.maxGlobalUses} whole onChange={next => update("maxGlobalUses", next)} />
        <NumberCondition label="Promotion redemptions per account" value={rules.maxUsesPerUser} whole onChange={next => update("maxUsesPerUser", next)} />
      </div>
      <div className="space-y-2"><h4 className="text-sm font-medium">Eligible packages</h4><p className="text-sm text-muted-foreground">Leave all unchecked to allow all packages.</p>
        {packages.isError && <p className="text-sm text-destructive">The package list could not be loaded. Existing selections are preserved. Reopen the form to retry.</p>}
        {packages.isLoading && <p className="text-sm text-muted-foreground">Loading packages…</p>}
        <div className="grid max-h-44 gap-2 overflow-y-auto md:grid-cols-2">
          {[...options, ...missing.map(id => ({ id, name: `Unavailable package #${id}`, inactive: true }))].map(pkg => <label key={pkg.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={selected.includes(pkg.id)} onChange={event => update("packageIds", event.target.checked ? [...selected, pkg.id] : selected.filter(id => id !== pkg.id))} />
            {pkg.name}{pkg.inactive ? " (inactive or unavailable)" : ""}
          </label>)}
        </div>
      </div>
      <div className="space-y-2"><Label htmlFor={branchId}>Eligible branches (one per line)</Label>
        <Textarea id={branchId} key={JSON.stringify(rules.branches)} defaultValue={Array.isArray(rules.branches) ? rules.branches.join("\n") : ""}
          placeholder="All branches" onBlur={event => { if (event.target.value === (Array.isArray(rules.branches) ? rules.branches.join("\n") : "")) return; const branches = event.target.value.split("\n").map(branch => branch.trim()).filter(Boolean); update("branches", branches.length ? branches : undefined); }} />
        <p className="text-sm text-muted-foreground">Only matching branches qualify. Package purchases without a branch will not qualify when this restriction is set.</p>
      </div>
    </fieldset>
    {unsafe && <details><summary className="cursor-pointer text-sm">View preserved legacy conditions</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{value}</pre></details>}
  </section>;
}
