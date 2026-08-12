/**
 * Ballet → General Settings → Ballet FAQ → Categories
 * (/ballet/settings/faq/categories)
 *
 * Focused category-management page, consistent with the existing Ballet
 * Program Requirements overview experience (BalletRequirementsPage.tsx):
 * an always-visible "Add Category" form above a Name/Order/Status/Actions
 * table. Categories have no nested child data (unlike Requirement
 * sections' items), so editing happens inline in the row rather than on a
 * separate detail page — no dialog is introduced, matching the approved
 * inline-focused pattern already used throughout Ballet Settings.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronLeft, Loader2, Pencil, Plus, ToggleLeft, ToggleRight, X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  adminFetch,
  balletApiUrl,
  BALLET_FAQS_QUERY_KEY,
  BALLET_FAQ_CATEGORIES_QUERY_KEY,
  parseSortOrder,
  type BalletFaqCategory,
} from "./balletSettingsApi";

type CategoryDraft = { name: string; sortOrder: string };
const EMPTY_CATEGORY_DRAFT: CategoryDraft = { name: "", sortOrder: "0" };

export default function BalletFaqCategoriesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token, can } = useAdminAuth();
  const [, navigate] = useLocation();
  const canEdit = can("ballet.settings", "edit");

  const [newCategory, setNewCategory] = useState<CategoryDraft>(EMPTY_CATEGORY_DRAFT);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<CategoryDraft>(EMPTY_CATEGORY_DRAFT);

  const { data, isLoading, isError } = useQuery({
    queryKey: [BALLET_FAQ_CATEGORIES_QUERY_KEY, token],
    queryFn: () => adminFetch<{ categories: BalletFaqCategory[] }>(balletApiUrl("/faq-categories"), {}, token),
    refetchOnWindowFocus: false,
  });

  const categories = data?.categories ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [BALLET_FAQ_CATEGORIES_QUERY_KEY] });
    // Category rename/reorder/activate/deactivate must be reflected in the
    // Ballet FAQ page's category indicator immediately — the two lists are
    // not independent once a FAQ references a category, so the FAQ query
    // is invalidated alongside the category query (mirrors the equivalent
    // cross-invalidation already established for App Content FAQ
    // Categories; this page's own query has never needed this before).
    qc.invalidateQueries({ queryKey: [BALLET_FAQS_QUERY_KEY] });
  };

  const createCategoryMutation = useMutation({
    mutationFn: (body: object) =>
      adminFetch(balletApiUrl("/faq-categories"), { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      invalidate();
      setNewCategory(EMPTY_CATEGORY_DRAFT);
      toast({ title: "Category created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to create category", variant: "destructive" }),
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      adminFetch(balletApiUrl(`/faq-categories/${id}`), { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      toast({ title: "Category updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update category", variant: "destructive" }),
  });

  function createCategory() {
    const name = newCategory.name.trim();
    if (!name) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    createCategoryMutation.mutate({ name, sortOrder: parseSortOrder(newCategory.sortOrder), isActive: true });
  }

  function startEdit(category: BalletFaqCategory) {
    setEditingId(category.id);
    setEditDraft({ name: category.name, sortOrder: String(category.sortOrder) });
  }

  function saveEdit(id: number) {
    const name = editDraft.name.trim();
    if (!name) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    updateCategoryMutation.mutate({ id, body: { name, sortOrder: parseSortOrder(editDraft.sortOrder) } });
  }

  return (
    <div className="admin2-ballet-page admin2-ballet-settings space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/ballet/settings/faq")} className="-ml-2 text-muted-foreground">
          <ChevronLeft className="mr-1 h-4 w-4" /> Back to Ballet FAQ
        </Button>
      </div>

      <PageHeader
        title="Ballet FAQ Categories"
        description="Group the FAQ questions shown on the mobile Ballet FAQ page."
        mode="stage"
      />

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[#00B6D6]" />
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm">Failed to load Ballet FAQ categories. Please refresh.</span>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-5">
          {canEdit && (
            <fieldset className="rounded-lg border border-border bg-card p-4 space-y-3">
              <legend className="px-1 text-sm font-semibold text-foreground">Add Category</legend>
              <div className="grid gap-3 md:grid-cols-[1fr_120px]">
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wide">Category Name</Label>
                  <Input
                    value={newCategory.name}
                    onChange={(e) => setNewCategory((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Assessments"
                    className="bg-background text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wide">Order</Label>
                  <Input
                    type="number"
                    value={newCategory.sortOrder}
                    onChange={(e) => setNewCategory((prev) => ({ ...prev, sortOrder: e.target.value }))}
                    className="bg-background text-foreground"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={createCategory}
                  disabled={createCategoryMutation.isPending || !newCategory.name.trim()}
                  className="gap-2 bg-[#00B6D6] hover:bg-[#0097B2] text-white"
                >
                  {createCategoryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add Category
                </Button>
              </div>
            </fieldset>
          )}

          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      No Ballet FAQ categories yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  categories.map((category) => {
                    const isEditing = editingId === category.id;
                    return (
                      <TableRow key={category.id}>
                        <TableCell className="font-medium">
                          {isEditing ? (
                            <Input
                              value={editDraft.name}
                              onChange={(e) => setEditDraft((prev) => ({ ...prev, name: e.target.value }))}
                              className="bg-background text-foreground h-8"
                              autoFocus
                            />
                          ) : (
                            category.name
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              type="number"
                              value={editDraft.sortOrder}
                              onChange={(e) => setEditDraft((prev) => ({ ...prev, sortOrder: e.target.value }))}
                              className="bg-background text-foreground h-8 w-24"
                            />
                          ) : (
                            category.sortOrder
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={category.isActive ? "default" : "secondary"}>
                            {category.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {canEdit && isEditing ? (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => saveEdit(category.id)}
                                  disabled={updateCategoryMutation.isPending}
                                >
                                  Save
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                                  <X className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                              canEdit && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => updateCategoryMutation.mutate({ id: category.id, body: { isActive: !category.isActive } })}
                                    className={category.isActive ? "text-green-400 hover:text-green-300" : "text-muted-foreground hover:text-white"}
                                  >
                                    {category.isActive ? <ToggleRight className="h-4 w-4 mr-1" /> : <ToggleLeft className="h-4 w-4 mr-1" />}
                                    {category.isActive ? "Deactivate" : "Activate"}
                                  </Button>
                                  <Button variant="outline" size="sm" onClick={() => startEdit(category)} className="gap-1">
                                    <Pencil className="h-3.5 w-3.5" />
                                    Edit
                                  </Button>
                                </>
                              )
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
import "../admin2-ballet.css";
