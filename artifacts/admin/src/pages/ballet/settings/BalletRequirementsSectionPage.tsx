/**
 * Ballet → General Settings → Program Requirements → Section Detail
 * (/ballet/settings/requirements/:sectionId)
 *
 * Second screen of the requirements management flow: edit one section's
 * title/description/order/active state, and manage its requirement items
 * (add, edit, order, activate/deactivate) — all previously stacked inline
 * inside the monolithic settings page, now isolated to this section.
 */
import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronLeft, Loader2, Plus, Save, ToggleLeft, ToggleRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  adminFetch,
  balletApiUrl,
  BALLET_REQUIREMENTS_QUERY_KEY,
  parseSortOrder,
  type RequirementItem,
  type RequirementSection,
} from "./balletSettingsApi";

type SectionDraft = { title: string; description: string; sortOrder: string };
type ItemDraft = { text: string; sortOrder: string };

export default function BalletRequirementsSectionPage() {
  const { sectionId } = useParams<{ sectionId: string }>();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token, can } = useAdminAuth();
  const [, navigate] = useLocation();
  const canEdit = can("ballet.settings", "edit");

  const [sectionDraft, setSectionDraft] = useState<SectionDraft | null>(null);
  const [newItemText, setNewItemText] = useState("");
  const [itemDrafts, setItemDrafts] = useState<Record<number, ItemDraft>>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: [BALLET_REQUIREMENTS_QUERY_KEY, token],
    queryFn: () => adminFetch<{ sections: RequirementSection[] }>(balletApiUrl("/program-requirement-sections"), {}, token),
    refetchOnWindowFocus: false,
  });

  const section = data?.sections.find((s) => String(s.id) === sectionId) ?? null;

  useEffect(() => {
    if (section) {
      setSectionDraft({
        title: section.title,
        description: section.description ?? "",
        sortOrder: String(section.sortOrder),
      });
      const nextItemDrafts: Record<number, ItemDraft> = {};
      for (const item of section.items) {
        nextItemDrafts[item.id] = { text: item.text, sortOrder: String(item.sortOrder) };
      }
      setItemDrafts(nextItemDrafts);
    }
    // Only re-sync from server data when the section identity/content
    // actually changes — not on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section?.id, section?.updatedAt]);

  const invalidate = () => qc.invalidateQueries({ queryKey: [BALLET_REQUIREMENTS_QUERY_KEY] });

  const updateSectionMutation = useMutation({
    mutationFn: (body: object) =>
      adminFetch(balletApiUrl(`/program-requirement-sections/${sectionId}`), { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      invalidate();
      toast({ title: "Section updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update section", variant: "destructive" }),
  });

  const createItemMutation = useMutation({
    mutationFn: (body: object) =>
      adminFetch(balletApiUrl("/program-requirement-items"), { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      invalidate();
      setNewItemText("");
      toast({ title: "Requirement item added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to add item", variant: "destructive" }),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      adminFetch(balletApiUrl(`/program-requirement-items/${id}`), { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      invalidate();
      toast({ title: "Requirement item updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update item", variant: "destructive" }),
  });

  function saveSection() {
    if (!sectionDraft?.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    updateSectionMutation.mutate({
      title: sectionDraft.title.trim(),
      description: sectionDraft.description.trim() || null,
      sortOrder: parseSortOrder(sectionDraft.sortOrder),
    });
  }

  function addItem() {
    const text = newItemText.trim();
    if (!text || !section) {
      toast({ title: "Item text is required", variant: "destructive" });
      return;
    }
    const maxSort = section.items.reduce((max, item) => Math.max(max, item.sortOrder), 0);
    createItemMutation.mutate({
      sectionId: section.id,
      text,
      sortOrder: maxSort + 10,
      isActive: true,
    });
  }

  function saveItem(item: RequirementItem) {
    const draft = itemDrafts[item.id];
    if (!draft?.text.trim()) {
      toast({ title: "Item text is required", variant: "destructive" });
      return;
    }
    updateItemMutation.mutate({
      id: item.id,
      body: { text: draft.text.trim(), sortOrder: parseSortOrder(draft.sortOrder) },
    });
  }

  return (
    <div className="admin2-ballet-page admin2-ballet-settings space-y-6 max-w-3xl">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/ballet/settings/requirements")} className="-ml-2 text-muted-foreground">
          <ChevronLeft className="mr-1 h-4 w-4" /> Back to Program Requirements
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[#00B6D6]" />
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm">Failed to load program requirements. Please refresh.</span>
        </div>
      )}

      {!isLoading && !isError && !section && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm">Section not found. It may have been removed.</span>
        </div>
      )}

      {!isLoading && !isError && section && sectionDraft && (
        <>
          <PageHeader
            title={section.title}
            description="Edit this section's details and manage its requirement items."
            mode="stage"
          >
            <div className="flex items-center gap-2">
              <Badge variant={section.isActive ? "default" : "secondary"}>{section.isActive ? "Active" : "Inactive"}</Badge>
              {canEdit && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => updateSectionMutation.mutate({ isActive: !section.isActive })}
                  className={section.isActive ? "text-green-400 hover:text-green-300" : "text-muted-foreground hover:text-white"}
                >
                  {section.isActive ? <ToggleRight className="h-4 w-4 mr-2" /> : <ToggleLeft className="h-4 w-4 mr-2" />}
                  {section.isActive ? "Deactivate" : "Activate"}
                </Button>
              )}
            </div>
          </PageHeader>

          <fieldset disabled={!canEdit} className="space-y-5 rounded-lg border border-border bg-card p-6">
            <h2 className="text-sm font-semibold text-foreground">Section Details</h2>
            <div className="grid gap-3 md:grid-cols-[1fr_110px]">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase tracking-wide">Section Title</Label>
                <Input
                  value={sectionDraft.title}
                  onChange={(e) => setSectionDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                  className="bg-background text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase tracking-wide">Order</Label>
                <Input
                  type="number"
                  value={sectionDraft.sortOrder}
                  onChange={(e) => setSectionDraft((prev) => (prev ? { ...prev, sortOrder: e.target.value } : prev))}
                  className="bg-background text-foreground"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Description</Label>
              <Textarea
                rows={2}
                value={sectionDraft.description}
                onChange={(e) => setSectionDraft((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                className="bg-background text-foreground"
              />
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={saveSection} disabled={updateSectionMutation.isPending} className="gap-2 bg-[#00B6D6] hover:bg-[#0097B2] text-white">
                {updateSectionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Section
              </Button>
            </div>
          </fieldset>

          <div className="space-y-4 rounded-lg border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">Requirement Items</h2>
              <span className="text-xs text-muted-foreground">{section.items.length} total</span>
            </div>

            {section.items.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No items in this section yet.</p>
            ) : (
              <div className="space-y-2">
                {section.items.map((item) => {
                  const itemDraft = itemDrafts[item.id] ?? { text: item.text, sortOrder: String(item.sortOrder) };
                  return (
                    <div key={item.id} className="rounded-md border border-border bg-background p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant={item.isActive ? "default" : "secondary"}>{item.isActive ? "Active" : "Inactive"}</Badge>
                        {canEdit && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => updateItemMutation.mutate({ id: item.id, body: { isActive: !item.isActive } })}
                            className={item.isActive ? "text-green-400 hover:text-green-300" : "text-muted-foreground hover:text-white"}
                          >
                            {item.isActive ? <ToggleRight className="h-4 w-4 mr-2" /> : <ToggleLeft className="h-4 w-4 mr-2" />}
                            {item.isActive ? "Deactivate" : "Activate"}
                          </Button>
                        )}
                      </div>
                      <fieldset disabled={!canEdit} className="grid gap-2 md:grid-cols-[1fr_100px_auto]">
                        <Textarea
                          rows={2}
                          value={itemDraft.text}
                          onChange={(e) => setItemDrafts((prev) => ({ ...prev, [item.id]: { ...itemDraft, text: e.target.value } }))}
                          className="bg-card text-foreground"
                        />
                        <Input
                          type="number"
                          value={itemDraft.sortOrder}
                          onChange={(e) => setItemDrafts((prev) => ({ ...prev, [item.id]: { ...itemDraft, sortOrder: e.target.value } }))}
                          className="bg-card text-foreground"
                          aria-label="Item sort order"
                        />
                        <Button type="button" variant="outline" onClick={() => saveItem(item)} disabled={updateItemMutation.isPending}>
                          Save
                        </Button>
                      </fieldset>
                    </div>
                  );
                })}
              </div>
            )}

            {canEdit && (
              <div className="grid gap-2 md:grid-cols-[1fr_auto] border-t border-border pt-4">
                <Textarea
                  rows={2}
                  value={newItemText}
                  onChange={(e) => setNewItemText(e.target.value)}
                  placeholder="Add a new requirement item"
                  className="bg-background text-foreground"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addItem}
                  disabled={createItemMutation.isPending || !newItemText.trim()}
                  className="gap-2"
                >
                  {createItemMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add Item
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
import "../admin2-ballet.css";
