/**
 * Ballet → General Settings → FAQ (/ballet/settings/faq)
 *
 * Focused, isolated FAQ management extracted from the former single stacked
 * BalletSettingsPage.tsx: list existing entries, create, edit, activate/
 * deactivate, and edit display order.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronLeft, Loader2, Plus, ToggleLeft, ToggleRight } from "lucide-react";
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
  BALLET_FAQS_QUERY_KEY,
  parseSortOrder,
  type BalletFaq,
} from "./balletSettingsApi";

type FaqDraft = { question: string; answer: string; sortOrder: string };
const EMPTY_FAQ_DRAFT: FaqDraft = { question: "", answer: "", sortOrder: "0" };

export default function BalletFaqPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token, can } = useAdminAuth();
  const [, navigate] = useLocation();
  const canEdit = can("ballet.settings", "edit");

  const [newFaq, setNewFaq] = useState<FaqDraft>(EMPTY_FAQ_DRAFT);
  const [faqDrafts, setFaqDrafts] = useState<Record<number, FaqDraft>>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: [BALLET_FAQS_QUERY_KEY, token],
    queryFn: () => adminFetch<{ faqs: BalletFaq[] }>(balletApiUrl("/faqs"), {}, token),
    refetchOnWindowFocus: false,
  });

  const faqs = data?.faqs ?? [];

  useEffect(() => {
    const nextFaqDrafts: Record<number, FaqDraft> = {};
    for (const faq of faqs) {
      nextFaqDrafts[faq.id] = { question: faq.question, answer: faq.answer, sortOrder: String(faq.sortOrder) };
    }
    setFaqDrafts(nextFaqDrafts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: [BALLET_FAQS_QUERY_KEY] });

  const createFaqMutation = useMutation({
    mutationFn: (body: object) =>
      adminFetch(balletApiUrl("/faqs"), { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      invalidate();
      setNewFaq(EMPTY_FAQ_DRAFT);
      toast({ title: "FAQ created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to create FAQ", variant: "destructive" }),
  });

  const updateFaqMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      adminFetch(balletApiUrl(`/faqs/${id}`), { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      invalidate();
      toast({ title: "FAQ updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update FAQ", variant: "destructive" }),
  });

  function createFaq() {
    const question = newFaq.question.trim();
    const answer = newFaq.answer.trim();
    if (!question || !answer) {
      toast({ title: "Question and answer are required", variant: "destructive" });
      return;
    }
    createFaqMutation.mutate({ question, answer, sortOrder: parseSortOrder(newFaq.sortOrder), isActive: true });
  }

  function saveFaq(faq: BalletFaq) {
    const draft = faqDrafts[faq.id];
    if (!draft?.question.trim() || !draft?.answer.trim()) {
      toast({ title: "Question and answer are required", variant: "destructive" });
      return;
    }
    updateFaqMutation.mutate({
      id: faq.id,
      body: { question: draft.question.trim(), answer: draft.answer.trim(), sortOrder: parseSortOrder(draft.sortOrder) },
    });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/ballet/settings")} className="-ml-2 text-muted-foreground">
          <ChevronLeft className="mr-1 h-4 w-4" /> Back to General Settings
        </Button>
      </div>

      <PageHeader
        title="Ballet FAQ"
        description="Manage the ordered FAQ questions shown on the mobile Ballet FAQ page."
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
          <span className="text-sm">Failed to load FAQs. Please refresh.</span>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-5">
          {canEdit && (
            <fieldset className="rounded-lg border border-border bg-card p-4 space-y-3">
              <legend className="px-1 text-sm font-semibold text-foreground">Add FAQ</legend>
              <div className="grid gap-3 md:grid-cols-[1fr_120px]">
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wide">Question</Label>
                  <Input
                    value={newFaq.question}
                    onChange={(e) => setNewFaq((prev) => ({ ...prev, question: e.target.value }))}
                    placeholder="What age can my child start?"
                    className="bg-background text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wide">Order</Label>
                  <Input
                    type="number"
                    value={newFaq.sortOrder}
                    onChange={(e) => setNewFaq((prev) => ({ ...prev, sortOrder: e.target.value }))}
                    className="bg-background text-foreground"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase tracking-wide">Answer</Label>
                <Textarea
                  rows={3}
                  value={newFaq.answer}
                  onChange={(e) => setNewFaq((prev) => ({ ...prev, answer: e.target.value }))}
                  placeholder="Write the answer displayed in the mobile FAQ accordion"
                  className="bg-background text-foreground"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={createFaq}
                  disabled={createFaqMutation.isPending || !newFaq.question.trim() || !newFaq.answer.trim()}
                  className="gap-2 bg-[#00B6D6] hover:bg-[#0097B2] text-white"
                >
                  {createFaqMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Create FAQ
                </Button>
              </div>
            </fieldset>
          )}

          {faqs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              No Ballet FAQs yet.
            </div>
          ) : (
            <div className="space-y-3">
              {faqs.map((faq) => {
                const draft = faqDrafts[faq.id] ?? { question: faq.question, answer: faq.answer, sortOrder: String(faq.sortOrder) };
                return (
                  <div key={faq.id} className="rounded-lg border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={faq.isActive ? "default" : "secondary"}>{faq.isActive ? "Active" : "Inactive"}</Badge>
                        <span className="text-xs text-muted-foreground">FAQ ID {faq.id}</span>
                      </div>
                      {canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => updateFaqMutation.mutate({ id: faq.id, body: { isActive: !faq.isActive } })}
                          className={faq.isActive ? "text-green-400 hover:text-green-300" : "text-muted-foreground hover:text-white"}
                        >
                          {faq.isActive ? <ToggleRight className="h-4 w-4 mr-2" /> : <ToggleLeft className="h-4 w-4 mr-2" />}
                          {faq.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      )}
                    </div>
                    <fieldset disabled={!canEdit} className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-[1fr_110px]">
                        <div className="space-y-1.5">
                          <Label className="text-muted-foreground text-xs uppercase tracking-wide">Question</Label>
                          <Input
                            value={draft.question}
                            onChange={(e) => setFaqDrafts((prev) => ({ ...prev, [faq.id]: { ...draft, question: e.target.value } }))}
                            className="bg-background text-foreground"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-muted-foreground text-xs uppercase tracking-wide">Order</Label>
                          <Input
                            type="number"
                            value={draft.sortOrder}
                            onChange={(e) => setFaqDrafts((prev) => ({ ...prev, [faq.id]: { ...draft, sortOrder: e.target.value } }))}
                            className="bg-background text-foreground"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-muted-foreground text-xs uppercase tracking-wide">Answer</Label>
                        <Textarea
                          rows={3}
                          value={draft.answer}
                          onChange={(e) => setFaqDrafts((prev) => ({ ...prev, [faq.id]: { ...draft, answer: e.target.value } }))}
                          className="bg-background text-foreground"
                        />
                      </div>
                      {canEdit && (
                        <div className="flex justify-end">
                          <Button type="button" variant="outline" size="sm" onClick={() => saveFaq(faq)} disabled={updateFaqMutation.isPending}>
                            Save FAQ
                          </Button>
                        </div>
                      )}
                    </fieldset>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
