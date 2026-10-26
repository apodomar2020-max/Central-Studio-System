import { clearPendingPromotionOperation, readPendingPromotionOperation, persistPromotionOperation, requirePromotionSaveProtocol, sendPromotionOperation, reconcilePromotionSave, type PendingPromotionOperation } from "@/lib/promotionSaveProtocol";
import { promotionMutationFailure, promotionRefreshFailure } from "@/lib/promotionSaveFeedback";
import { useEffect, useMemo, useState, useRef } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { PageHeader } from "@/components/layout/page-header";
import { useAdminConfirm } from "@/components/admin/admin-confirm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Edit, Trash2 } from "lucide-react";
import { PromotionForm } from "@/components/promotion-form";
import { validatePromotionForm, type PromotionFormState as FormState } from "@/lib/promotionForm";
import { validatePromotionConditions } from "@/lib/promotionConditions";

type PromotionCode = {
  id: number;
  code: string;
  maxUses: number | null;
  usesPerUser: number | null;
  currentUses: number;
};

type Promotion = {
  revision?: string;
  id: number;
  name: string;
  description: string | null;
  type: "automatic" | "manual";
  discountType: "percentage" | "fixed_amount";
  discountValue: number;
  priority: number;
  isExclusive: boolean;
  isStackable: boolean;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  rulesConfig: Record<string, unknown>;
  codes?: PromotionCode[];
};

const emptyForm: FormState = {
  name: "",
  description: "",
  type: "automatic",
  discountType: "percentage",
  discountValue: "10",
  priority: "0",
  isExclusive: false,
  isStackable: false,
  isActive: true,
  startDate: "",
  endDate: "",
  code: "",
  maxUses: "",
  usesPerUser: "",
  rulesConfig: JSON.stringify({}),
};

function toDateInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toApiDate(value: string, original?: string | null): string | null {
  // datetime-local displays minutes only. Preserve the exact DB instant (and
  // its fractional seconds) when the user did not change that field.
  if (original != null && value === toDateInput(original)) return original;
  return value ? new Date(value).toISOString() : null;
}

function promotionToForm(row: Promotion): FormState {
  const code = row.codes?.[0];
  return {
    name: row.name,
    description: row.description ?? "",
    type: row.type,
    discountType: row.discountType,
    discountValue: String(row.discountValue),
    priority: String(row.priority),
    isExclusive: row.isExclusive,
    isStackable: row.isStackable,
    isActive: row.isActive,
    startDate: toDateInput(row.startDate),
    endDate: toDateInput(row.endDate),
    code: code?.code ?? "",
    maxUses: code?.maxUses != null ? String(code.maxUses) : "",
    usesPerUser: code?.usesPerUser != null ? String(code.usesPerUser) : "",
    rulesConfig: JSON.stringify(row.rulesConfig, null, 2) ?? "null",
  };
}

export default function PromotionsPage() {
  const confirmAction = useAdminConfirm();
  const { can, user, token } = useAdminAuth();
  // Phase 6B: Promotions has its own permission module (legacy alias: offers).
  const canCreate = can("promotions", "create");
  const canEdit = can("promotions", "edit");
  const canDelete = can("promotions", "delete");
  const [rows, setRows] = useState<Promotion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const formErrors = validationAttempted ? validatePromotionForm(form) : {};
  const [pending, setPending] = useState<PendingPromotionOperation | null>(null);
  const pendingRef = useRef<PendingPromotionOperation | null>(null);
  const busy = useRef(false);
  const session = useRef({actorId:user?.id,token});
  session.current = {actorId:user?.id,token};
  useEffect(() => {
    const operation = user ? readPendingPromotionOperation(user.id) : null;
    pendingRef.current = operation;
    setPending(operation);
    if (operation) {
      if (operation.form) { const recovered = operation.form as FormState; setForm(recovered); setEditing(operation.editing as Promotion | null); setOpen(true); }
      setError("A previous promotion operation needs reconciliation. Check its status before saving again.");
    }
  }, [user?.id,token]);

  function retainOperation(operation: PendingPromotionOperation | null) {
    if (operation) persistPromotionOperation(operation); else clearPendingPromotionOperation();
    pendingRef.current = operation; setPending(operation);
  }
  function stillOwns(operation: PendingPromotionOperation, originalToken: string | null) {
    return session.current.actorId === operation.actorId && session.current.token === originalToken;
  }
  async function completeOperation(operation: PendingPromotionOperation) {
    retainOperation(null);
    if (operation.method !== "DELETE") setOpen(false);
    await loadPromotions(operation.method === "DELETE" ? "deactivated" : "saved");
  }
  async function submitOperation(operation: PendingPromotionOperation) {
    const originalToken = token;
    try {
      if (!token || !stillOwns(operation,originalToken)) return;
      await sendPromotionOperation(operation,token);
      if (stillOwns(operation,originalToken)) await completeOperation(operation);
    } catch (err) {
      if (!stillOwns(operation,originalToken)) return;
      const failure = promotionMutationFailure(err,operation.method === "DELETE" ? "deactivate" : "save");
      // 401/403 can result from revocation while waiting, after admission. Keep
      // recovery context until authentication changes; never invent a new key.
      const status = err && typeof err === "object" && "status" in err ? err.status : null;
      const code = err && typeof err === "object" && "data" in err ? (err.data as {code?:string} | null)?.code : undefined;
      if (failure.outcome === "rejected" && status !== 401 && status !== 403 && code !== "OPERATION_KEY_REUSED" && code !== "OPERATION_EXPIRED") retainOperation(null);
      if (failure.reload) { try { setRows(await customFetch<Promotion[]>("/api/promotions")); } catch { /* Keep rejection visible. */ } }
      setError(failure.message);
    }
  }
  async function reconcilePending(retry = false) {
    const operation = pendingRef.current;
    if (!operation || busy.current) return;
    busy.current=true; setSaving(true); const originalToken=token;
    try {
      if (!token) return;
      const result = await reconcilePromotionSave(operation,token);
      if (!stillOwns(operation,originalToken)) return;
      if (result.state === "succeeded" || (result.state === "expired" && result.outcome === "succeeded")) { await completeOperation(operation); return; }
      if (result.state === "rejected") {
        retainOperation(null);
        const failure=promotionMutationFailure(Object.assign(new Error(result.response?.error || "Promotion rejected."),{name:"ApiError",status:result.status,data:result.response}),operation.method === "DELETE" ? "deactivate" : "save");
        if(failure.reload) {try {setRows(await customFetch<Promotion[]>("/api/promotions"));}catch{}}
        setError(failure.message);return;
      }
      if (result.state === "expired") { retainOperation(null); setError("The previous operation expired without a saved result. Review the current promotion before starting a new save."); return; }
      if (retry) { await requirePromotionSaveProtocol(token!); await submitOperation(operation); }
      else setError("The previous operation is pending. You can check again or retry its original request with the same identity. Your current entries are preserved.");
    } catch(err) {
      if (!stillOwns(operation,originalToken)) return;
      const status=err && typeof err === "object" && "status" in err ? err.status : null;
      // A missing reservation is safe only for the SAME immutable request/key.
      if(retry && status === 404) {try {await requirePromotionSaveProtocol(token!);await submitOperation(operation);}catch {setError("Recovery is unavailable. Keep this operation and check again.");}}
      else setError("The previous operation could not be reconciled. Keep this operation and check again before starting another save.");
    } finally {busy.current=false;setSaving(false);}
  }


  const activeCount = useMemo(() => rows.filter((row) => row.isActive).length, [rows]);

  async function loadPromotions(confirmed?: "saved" | "deactivated") {
    setIsLoading(true);
    setError(null);
    try {
      setRows(await customFetch<Promotion[]>("/api/promotions"));
    } catch (err) {
      setError(promotionRefreshFailure(err, confirmed));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadPromotions();
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function generateCode() {
    const prefix = form.name.trim().replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase() || "PROMO";
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    update("code", `${prefix}${suffix}`);
  }

  function openCreate() {
    if (pendingRef.current) { setError("Reconcile the previous operation before starting another save."); return; }
    setError(null);
    setEditing(null);
    setValidationAttempted(false);

    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(row: Promotion) {
    if (pendingRef.current) { setError("Reconcile the previous operation before starting another save."); return; }
    setError(null);
    setEditing(row);
    setValidationAttempted(false);
    setForm(promotionToForm(row));
    setOpen(true);
  }

  async function save() {
    if (pendingRef.current) { await reconcilePending(); return; }
    if (busy.current || !user) return;
    setValidationAttempted(true);
    const errors = validatePromotionForm(form);
    if (Object.keys(errors).length) { setError("Please review the highlighted fields before saving."); return; }
    let rulesConfig: Record<string, unknown>;
    try {
      rulesConfig = validatePromotionConditions(form.rulesConfig);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Review the eligibility conditions.");
      return;
    }
    busy.current=true; setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        description: form.description || null,
        type: form.type,
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        priority: Number(form.priority),
        isExclusive: form.isExclusive,
        isStackable: form.isStackable,
        isActive: form.isActive,
        startDate: toApiDate(form.startDate, editing?.startDate),
        endDate: toApiDate(form.endDate, editing?.endDate),
        rulesConfig,
        code: form.type === "manual" ? form.code : "",
        maxUses: form.maxUses ? Number(form.maxUses) : null,
        usesPerUser: form.usesPerUser ? Number(form.usesPerUser) : null,
      };
      await requirePromotionSaveProtocol(token!);
      if (session.current.actorId !== user.id || session.current.token !== token) return;
      const operation: PendingPromotionOperation = { version:1, actorId:user.id, id:crypto.randomUUID(), method:editing ? "PATCH" : "POST", path:editing ? `/api/promotions/${editing.id}` : "/api/promotions", body:JSON.stringify(body), revision:editing?.revision ? `"${editing.revision}"` : undefined, form:{...form}, editing:editing ? {...editing} : null };
      retainOperation(operation);
      await submitOperation(operation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare the promotion save.");
    } finally { busy.current=false;setSaving(false); }
  }

  async function deactivate(row: Promotion) {
    if (pendingRef.current) { await reconcilePending(); return; }
    if (busy.current || !user) return;
    if (!await confirmAction({ title: "Deactivate promotion?", description: `${row.name} will no longer be available for new redemptions.`, confirmLabel: "Deactivate" })) return;
    if(busy.current || pendingRef.current) return;
    busy.current=true;setSaving(true);
    try {
      await requirePromotionSaveProtocol(token!);
      if (session.current.actorId !== user.id || session.current.token !== token) return;
      const operation: PendingPromotionOperation = {version:1,actorId:user.id,id:crypto.randomUUID(),method:"DELETE",path:`/api/promotions/${row.id}`,revision:row.revision ? `"${row.revision}"` : undefined};
      retainOperation(operation);await submitOperation(operation);
    } catch(err) {setError(err instanceof Error ? err.message : "Could not prepare deactivation.");}
    finally {busy.current=false;setSaving(false);}
  }

  const errorNotice = error || pending ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error || "A previous promotion operation needs reconciliation."}{pending && <div className="mt-2 flex gap-2"><Button variant="outline" disabled={saving} onClick={()=>reconcilePending()}>Check previous save</Button><Button variant="outline" disabled={saving} onClick={()=>reconcilePending(true)}>Retry original request</Button></div>}</div> : null;

  return (
    <div className="admin2-final-page admin2-marketing-registry space-y-6">
      <PageHeader
        title="Promotion Center"
        description="Automatic promotions, promo codes, and checkout validation"
        mode="studio"
        addLabel="Add Promotion"
        onAdd={canCreate ? openCreate : undefined}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-md border bg-card p-4">
          <div className="text-sm text-muted-foreground">Total Promotions</div>
          <div className="mt-2 text-2xl font-bold">{rows.length}</div>
        </div>
        <div className="rounded-md border bg-card p-4">
          <div className="text-sm text-muted-foreground">Active</div>
          <div className="mt-2 text-2xl font-bold">{activeCount}</div>
        </div>
        <div className="rounded-md border bg-card p-4">
          <div className="text-sm text-muted-foreground">Manual Codes</div>
          <div className="mt-2 text-2xl font-bold">{rows.filter((row) => row.type === "manual").length}</div>
        </div>
      </div>

      {!open && errorNotice}

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Discount</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Usage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center">Loading...</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No promotions yet.</TableCell></TableRow>
            ) : rows.map((row) => {
              const code = row.codes?.[0];
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium">{row.name}</div>
                    <div className="line-clamp-1 text-xs text-muted-foreground">{row.description}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{row.type}</Badge></TableCell>
                  <TableCell>
                    {row.discountType === "percentage" ? `${row.discountValue}%` : `EGP ${row.discountValue}`}
                  </TableCell>
                  <TableCell>{code?.code ?? "Automatic"}</TableCell>
                  <TableCell>{code ? `${code.currentUses}/${code.maxUses ?? "∞"}` : "Rule-based"}</TableCell>
                  <TableCell><Badge variant={row.isActive ? "default" : "secondary"}>{row.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right">
                    {canEdit && <Button variant="ghost" size="icon" aria-label={`Edit promotion ${row.name}`} onClick={() => openEdit(row)}><Edit className="h-4 w-4" /></Button>}
                    {canDelete && <Button variant="ghost" size="icon" aria-label={`Deactivate promotion ${row.name}`} onClick={() => deactivate(row)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Promotion" : "Add Promotion"}</DialogTitle>
          </DialogHeader>
          {errorNotice}
          <fieldset disabled={Boolean(pending) || saving} className="contents">
          <PromotionForm form={form} update={update} generateCode={generateCode} errors={formErrors} />
          </fieldset>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || Boolean(pending) || !form.name.trim()}>{saving ? "Saving..." : "Save Promotion"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
import "./admin2-final.css";
