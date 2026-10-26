import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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

export function PromotionConditions({ value, onChange, section, errors }: {
  value: string; onChange: (value: string) => void; section: "audience" | "advanced";
  errors: PromotionFormErrors;
}) {
  const id = useId();
  let rules: Record<string, unknown> = {};
  try { rules = readPromotionConditions(value); } catch { /* Parent blocks malformed legacy rules. */ }
  const update = (key: string, next: unknown) => onChange(changePromotionCondition(value, key, next));
  const [branchDraft, setBranchDraft] = useState(Array.isArray(rules.branches) ? rules.branches.join("\n") : "");
  if (section === "audience") return <section aria-label="Customer eligibility" className="space-y-3">
    <h3 className="font-semibold">3. Customer eligibility</h3>
    <p className="text-sm text-muted-foreground">{rules.verifiedStudentOnly ? "Customers must meet every selected condition." : "Everyone — no customer restrictions selected."}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex items-center gap-3 text-sm"><Switch checked={rules.verifiedStudentOnly === true} onCheckedChange={v => update("verifiedStudentOnly", v)} />Verified students only</label>
    </div>
    {errors.verifiedStudentOnly && <p className="text-sm text-destructive">{errors.verifiedStudentOnly}</p>}
  </section>;
  return <div className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <NumberCondition label="Minimum purchase (EGP)" value={rules.minimumBasketAmount} error={errors.minimumBasketAmount} onChange={v => update("minimumBasketAmount", v)} />
      <NumberCondition label="Total promotion redemptions" value={rules.maxGlobalUses} error={errors.maxGlobalUses} whole onChange={v => update("maxGlobalUses", v)} />
      <NumberCondition label="Promotion redemptions per customer" value={rules.maxUsesPerUser} error={errors.maxUsesPerUser} whole onChange={v => update("maxUsesPerUser", v)} />
    </div>
    <div className="space-y-2"><Label htmlFor={id}>Eligible branches (one per line)</Label>
      <Textarea id={id} value={branchDraft} placeholder="All branches" aria-invalid={Boolean(errors.branches)} onChange={e => { setBranchDraft(e.target.value); const branches = e.target.value.split("\n").map(b => b.trim()).filter(Boolean); update("branches", branches.length ? branches : undefined); }} />
      <p className="text-sm text-muted-foreground">Only Direct Single Class purchases at matching branches qualify.</p>
      {errors.branches && <p className="text-sm text-destructive">{errors.branches}</p>}
    </div>
  </div>;
}
