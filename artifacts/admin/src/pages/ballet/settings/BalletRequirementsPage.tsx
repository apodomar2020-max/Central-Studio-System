/**
 * Ballet → General Settings → Program Requirements — Overview
 * (/ballet/settings/requirements)
 *
 * First screen of the requirements management flow: a list of sections
 * (title, order, active/inactive, item count, edit action) plus adding a
 * new section. Editing a section's fields and managing its items happens on
 * the focused Section Detail page (/ballet/settings/requirements/:id).
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  BALLET_REQUIREMENTS_QUERY_KEY,
  parseSortOrder,
  type RequirementSection,
} from "./balletSettingsApi";

type NewSectionDraft = { title: string; description: string; sortOrder: string };
const EMPTY_SECTION_DRAFT: NewSectionDraft = { title: "", description: "", sortOrder: "0" };

export default function BalletRequirementsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token, can } = useAdminAuth();
  const [, navigate] = useLocation();
  const canEdit = can("ballet.settings", "edit");

  const [newSection, setNewSection] = useState<NewSectionDraft>(EMPTY_SECTION_DRAFT);

  const { data, isLoading, isError } = useQuery({
    queryKey: [BALLET_REQUIREMENTS_QUERY_KEY, token],
    queryFn: () => adminFetch<{ sections: RequirementSection[] }>(balletApiUrl("/program-requirement-sections"), {}, token),
    refetchOnWindowFocus: false,
  });

  const sections = data?.sections ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: [BALLET_REQUIREMENTS_QUERY_KEY] });

  const createSectionMutation = useMutation({
    mutationFn: (body: object) =>
      adminFetch(balletApiUrl("/program-requirement-sections"), { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      invalidate();
      setNewSection(EMPTY_SECTION_DRAFT);
      toast({ title: "Requirement section created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to create section", variant: "destructive" }),
  });

  const toggleSectionMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      adminFetch(balletApiUrl(`/program-requirement-sections/${id}`), { method: "PATCH", body: JSON.stringify({ isActive }) }, token),
    onSuccess: () => {
      invalidate();
      toast({ title: "Section updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update section", variant: "destructive" }),
  });

  function createSection() {
    const title = newSection.title.trim();
    if (!title) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    createSectionMutation.mutate({
      title,
      description: newSection.description.trim() || null,
      sortOrder: parseSortOrder(newSection.sortOrder),
      isActive: true,
    });
  }

  return (
    <div className="admin2-ballet-page admin2-ballet-settings space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/ballet/settings")} className="-ml-2 text-muted-foreground">
          <ChevronLeft className="mr-1 h-4 w-4" /> Back to General Settings
        </Button>
      </div>

      <PageHeader
        title="Ballet Program Requirements"
        description="Manage the sections shown on the mobile Ballet Requirements page. Open a section to edit its details and requirement items."
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
          <span className="text-sm">Failed to load program requirements. Please refresh.</span>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-5">
          {canEdit && (
            <fieldset className="rounded-lg border border-border bg-card p-4 space-y-3">
              <legend className="px-1 text-sm font-semibold text-foreground">Add Section</legend>
              <div className="grid gap-3 md:grid-cols-[1fr_120px]">
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wide">Title</Label>
                  <Input
                    value={newSection.title}
                    onChange={(e) => setNewSection((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="Dress Code"
                    className="bg-background text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wide">Order</Label>
                  <Input
                    type="number"
                    value={newSection.sortOrder}
                    onChange={(e) => setNewSection((prev) => ({ ...prev, sortOrder: e.target.value }))}
                    className="bg-background text-foreground"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase tracking-wide">Description</Label>
                <Textarea
                  rows={2}
                  value={newSection.description}
                  onChange={(e) => setNewSection((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Optional short intro for this section"
                  className="bg-background text-foreground"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={createSection}
                  disabled={createSectionMutation.isPending || !newSection.title.trim()}
                  className="gap-2 bg-[#00B6D6] hover:bg-[#0097B2] text-white"
                >
                  {createSectionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Create Section
                </Button>
              </div>
            </fieldset>
          )}

          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sections.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      No Ballet program requirement sections yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  sections.map((section) => (
                    <TableRow key={section.id}>
                      <TableCell className="font-medium">{section.title}</TableCell>
                      <TableCell>{section.sortOrder}</TableCell>
                      <TableCell>
                        <Badge variant={section.isActive ? "default" : "secondary"}>
                          {section.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>{section.items.length}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleSectionMutation.mutate({ id: section.id, isActive: !section.isActive })}
                              className={section.isActive ? "text-green-400 hover:text-green-300" : "text-muted-foreground hover:text-white"}
                            >
                              {section.isActive ? <ToggleRight className="h-4 w-4 mr-1" /> : <ToggleLeft className="h-4 w-4 mr-1" />}
                              {section.isActive ? "Deactivate" : "Activate"}
                            </Button>
                          )}
                          <Button asChild variant="outline" size="sm" className="gap-1">
                            <Link href={`/ballet/settings/requirements/${section.id}`}>
                              Edit
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
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
