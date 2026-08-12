import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { PageHeader } from "@/components/layout/page-header";
import { useAdminConfirm } from "@/components/admin/admin-confirm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Edit, Trash2 } from "lucide-react";

type PromotionCode = {
  id: number;
  code: string;
  maxUses: number | null;
  usesPerUser: number | null;
  currentUses: number;
};

type Promotion = {
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

type FormState = {
  name: string;
  description: string;
  type: "automatic" | "manual";
  discountType: "percentage" | "fixed_amount";
  discountValue: string;
  priority: string;
  isExclusive: boolean;
  isStackable: boolean;
  isActive: boolean;
  startDate: string;
  endDate: string;
  code: string;
  maxUses: string;
  usesPerUser: string;
  rulesConfig: string;
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
  rulesConfig: JSON.stringify({ verifiedStudentOnly: true }, null, 2),
};

function toDateInput(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 16);
}

function toApiDate(value: string): string | null {
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
    rulesConfig: JSON.stringify(row.rulesConfig ?? {}, null, 2),
  };
}

export default function PromotionsPage() {
  const confirmAction = useAdminConfirm();
  const { can } = useAdminAuth();
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

  const activeCount = useMemo(() => rows.filter((row) => row.isActive).length, [rows]);

  async function loadPromotions() {
    setIsLoading(true);
    setError(null);
    try {
      setRows(await customFetch<Promotion[]>("/api/promotions"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load promotions.");
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
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(row: Promotion) {
    setEditing(row);
    setForm(promotionToForm(row));
    setOpen(true);
  }

  async function save() {
    let rulesConfig: Record<string, unknown>;
    try {
      rulesConfig = form.rulesConfig.trim() ? JSON.parse(form.rulesConfig) : {};
    } catch {
      setError("Rules config must be valid JSON.");
      return;
    }
    setSaving(true);
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
        startDate: toApiDate(form.startDate),
        endDate: toApiDate(form.endDate),
        rulesConfig,
        code: form.type === "manual" ? form.code : "",
        maxUses: form.maxUses ? Number(form.maxUses) : null,
        usesPerUser: form.usesPerUser ? Number(form.usesPerUser) : null,
      };
      if (editing) {
        await customFetch(`/api/promotions/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await customFetch("/api/promotions", { method: "POST", body: JSON.stringify(body) });
      }
      setOpen(false);
      await loadPromotions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save promotion.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(row: Promotion) {
    if (!await confirmAction({ title: "Deactivate promotion?", description: `${row.name} will no longer be available for new redemptions.`, confirmLabel: "Deactivate" })) return;
    await customFetch(`/api/promotions/${row.id}`, { method: "DELETE" });
    await loadPromotions();
  }

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

      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

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
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Promotion" : "Add Promotion"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(event) => update("name", event.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(event) => update("description", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(value: "automatic" | "manual") => update("type", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="automatic">Automatic</SelectItem>
                  <SelectItem value="manual">Manual Code</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Discount Type</Label>
              <Select value={form.discountType} onValueChange={(value: "percentage" | "fixed_amount") => update("discountType", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="fixed_amount">Fixed Amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Value</Label>
              <Input type="number" value={form.discountValue} onChange={(event) => update("discountValue", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Input type="number" value={form.priority} onChange={(event) => update("priority", event.target.value)} />
            </div>
            {form.type === "manual" && (
              <>
                <div className="space-y-2">
                  <Label>Promo Code</Label>
                  <div className="flex gap-2">
                    <Input value={form.code} onChange={(event) => update("code", event.target.value.toUpperCase())} />
                    <Button type="button" variant="outline" onClick={generateCode}>Generate</Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Max Uses</Label>
                    <Input type="number" value={form.maxUses} onChange={(event) => update("maxUses", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Per User</Label>
                    <Input type="number" value={form.usesPerUser} onChange={(event) => update("usesPerUser", event.target.value)} />
                  </div>
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label>Start</Label>
              <Input type="datetime-local" value={form.startDate} onChange={(event) => update("startDate", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End</Label>
              <Input type="datetime-local" value={form.endDate} onChange={(event) => update("endDate", event.target.value)} />
            </div>
            <div className="flex items-center gap-6 md:col-span-2">
              <label className="flex items-center gap-2 text-sm"><Switch checked={form.isActive} onCheckedChange={(value) => update("isActive", value)} /> Active</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={form.isExclusive} onCheckedChange={(value) => update("isExclusive", value)} /> Exclusive</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={form.isStackable} onCheckedChange={(value) => update("isStackable", value)} /> Stackable</label>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Rules Config JSON</Label>
              <Textarea className="min-h-44 font-mono text-xs" value={form.rulesConfig} onChange={(event) => update("rulesConfig", event.target.value)} />
              <p className="text-xs text-muted-foreground">
                Supported keys: verifiedStudentOnly, firstPackagePurchaseOnly, minimumBasketAmount, packageIds, branches, maxGlobalUses, maxUsesPerUser.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>{saving ? "Saving..." : "Save Promotion"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
import "./admin2-final.css";
