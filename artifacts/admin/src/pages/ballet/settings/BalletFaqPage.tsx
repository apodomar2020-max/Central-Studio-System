/**
 * Ballet → General Settings → FAQ (/ballet/settings/faq)
 *
 * Full-width CMS-style FAQ content management workspace:
 *   * Category-grouped sections (following category sort order, uncategorized last)
 *   * Search and category/status client-side filtering
 *   * Compact scannable FAQ row cards with truncated answer previews
 *   * Right-side Sheet/Drawer for creating and editing FAQs
 *   * Inactive category indicator preservation
 *   * Quick activate/deactivate toggle and full edit drawer
 */
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronLeft,
  FileQuestion,
  Filter,
  FolderCog,
  Loader2,
  Pencil,
  Plus,
  Search,
  ToggleLeft,
  ToggleRight,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  adminFetch,
  balletApiUrl,
  BALLET_FAQS_QUERY_KEY,
  BALLET_FAQ_CATEGORIES_QUERY_KEY,
  parseSortOrder,
  type BalletFaq,
  type BalletFaqCategory,
} from "./balletSettingsApi";

type FaqDraft = {
  question: string;
  answer: string;
  sortOrder: string;
  categoryId: number | null;
  isActive: boolean;
};

const EMPTY_FAQ_DRAFT: FaqDraft = {
  question: "",
  answer: "",
  sortOrder: "0",
  categoryId: null,
  isActive: true,
};

const NO_CATEGORY_VALUE = "__none__";
const ALL_FILTER_VALUE = "__all__";

type DrawerState =
  | { isOpen: false; mode: "create"; faq?: undefined }
  | { isOpen: true; mode: "create"; faq?: undefined }
  | { isOpen: true; mode: "edit"; faq: BalletFaq };

export default function BalletFaqPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token, can } = useAdminAuth();
  const [, navigate] = useLocation();
  const canEdit = can("ballet.settings", "edit");

  // Filtering states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>(ALL_FILTER_VALUE);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>(ALL_FILTER_VALUE);

  // Drawer / Sheet state
  const [drawerState, setDrawerState] = useState<DrawerState>({ isOpen: false, mode: "create" });
  const [faqDraft, setFaqDraft] = useState<FaqDraft>(EMPTY_FAQ_DRAFT);

  // Data fetching
  const { data, isLoading, isError } = useQuery({
    queryKey: [BALLET_FAQS_QUERY_KEY, token],
    queryFn: () => adminFetch<{ faqs: BalletFaq[] }>(balletApiUrl("/faqs"), {}, token),
    refetchOnWindowFocus: false,
  });

  const categoriesQuery = useQuery({
    queryKey: [BALLET_FAQ_CATEGORIES_QUERY_KEY, token],
    queryFn: () => adminFetch<{ categories: BalletFaqCategory[] }>(balletApiUrl("/faq-categories"), {}, token),
    refetchOnWindowFocus: false,
  });

  const faqs = data?.faqs ?? [];
  const categories = categoriesQuery.data?.categories ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: [BALLET_FAQS_QUERY_KEY] });

  // Mutations
  const createFaqMutation = useMutation({
    mutationFn: (body: object) =>
      adminFetch(balletApiUrl("/faqs"), { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      invalidate();
      closeDrawer();
      toast({ title: "FAQ created successfully" });
    },
    onError: (e: any) =>
      toast({
        title: "Error",
        description: e?.data?.error ?? "Failed to create FAQ",
        variant: "destructive",
      }),
  });

  const updateFaqMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      adminFetch(balletApiUrl(`/faqs/${id}`), { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      invalidate();
      closeDrawer();
      toast({ title: "FAQ updated successfully" });
    },
    onError: (e: any) =>
      toast({
        title: "Error",
        description: e?.data?.error ?? "Failed to update FAQ",
        variant: "destructive",
      }),
  });

  // Drawer handlers
  function openCreateDrawer() {
    setFaqDraft(EMPTY_FAQ_DRAFT);
    setDrawerState({ isOpen: true, mode: "create" });
  }

  function openEditDrawer(faq: BalletFaq) {
    setFaqDraft({
      question: faq.question,
      answer: faq.answer,
      sortOrder: String(faq.sortOrder),
      categoryId: faq.category?.id ?? null,
      isActive: faq.isActive,
    });
    setDrawerState({ isOpen: true, mode: "edit", faq });
  }

  function closeDrawer() {
    setDrawerState({ isOpen: false, mode: "create" });
    setFaqDraft(EMPTY_FAQ_DRAFT);
  }

  function handleSaveFaq() {
    const question = faqDraft.question.trim();
    const answer = faqDraft.answer.trim();
    if (!question || !answer) {
      toast({ title: "Question and answer are required", variant: "destructive" });
      return;
    }

    if (drawerState.mode === "create") {
      createFaqMutation.mutate({
        question,
        answer,
        sortOrder: parseSortOrder(faqDraft.sortOrder),
        isActive: faqDraft.isActive,
        categoryId: faqDraft.categoryId,
      });
    } else if (drawerState.mode === "edit" && drawerState.faq) {
      updateFaqMutation.mutate({
        id: drawerState.faq.id,
        body: {
          question,
          answer,
          sortOrder: parseSortOrder(faqDraft.sortOrder),
          isActive: faqDraft.isActive,
          categoryId: faqDraft.categoryId,
        },
      });
    }
  }

  // Quick toggle status handler
  function handleToggleStatus(faq: BalletFaq) {
    updateFaqMutation.mutate({
      id: faq.id,
      body: { isActive: !faq.isActive },
    });
  }

  // Filtering & Grouping logic
  const filteredFaqs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return faqs.filter((faq) => {
      // Search filter (matches question or answer)
      if (query) {
        const matchQ = faq.question.toLowerCase().includes(query);
        const matchA = faq.answer.toLowerCase().includes(query);
        if (!matchQ && !matchA) return false;
      }

      // Category filter
      if (selectedCategoryFilter !== ALL_FILTER_VALUE) {
        if (selectedCategoryFilter === NO_CATEGORY_VALUE) {
          if (faq.category != null) return false;
        } else {
          const catId = Number(selectedCategoryFilter);
          if (faq.category?.id !== catId) return false;
        }
      }

      // Status filter
      if (selectedStatusFilter !== ALL_FILTER_VALUE) {
        const isActiveFilter = selectedStatusFilter === "active";
        if (faq.isActive !== isActiveFilter) return false;
      }

      return true;
    });
  }, [faqs, searchQuery, selectedCategoryFilter, selectedStatusFilter]);

  // Sorted Categories (following sortOrder ascending)
  const sortedCategories = useMemo(() => {
    return [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }, [categories]);

  // Grouped FAQs map: categoryId (number) -> BalletFaq[], plus uncategorized key 'none'
  const groupedFaqs = useMemo(() => {
    const groups: {
      categorized: Array<{ category: BalletFaqCategory; faqs: BalletFaq[] }>;
      uncategorized: BalletFaq[];
    } = {
      categorized: [],
      uncategorized: [],
    };

    // Initialize mapped categories in sort order
    const catMap = new Map<number, BalletFaq[]>();
    for (const cat of sortedCategories) {
      catMap.set(cat.id, []);
    }

    const uncategorizedList: BalletFaq[] = [];

    // Distribute filtered FAQs
    for (const faq of filteredFaqs) {
      if (faq.category && catMap.has(faq.category.id)) {
        catMap.get(faq.category.id)!.push(faq);
      } else {
        uncategorizedList.push(faq);
      }
    }

    // Build finalized categorized list (only include categories that have matching FAQs or match category filter)
    for (const cat of sortedCategories) {
      const catFaqs = catMap.get(cat.id) ?? [];
      if (catFaqs.length > 0) {
        // Sort FAQs inside category by sortOrder asc, then id asc
        catFaqs.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
        groups.categorized.push({ category: cat, faqs: catFaqs });
      }
    }

    // Sort uncategorized FAQs
    uncategorizedList.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    groups.uncategorized = uncategorizedList;

    return groups;
  }, [filteredFaqs, sortedCategories]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    selectedCategoryFilter !== ALL_FILTER_VALUE ||
    selectedStatusFilter !== ALL_FILTER_VALUE;

  return (
    <div className="w-full space-y-6">
      {/* Header Back Navigation */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/ballet/settings")}
          className="-ml-2 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> Back to General Settings
        </Button>
      </div>

      {/* Page Header */}
      <PageHeader
        title="Ballet FAQ"
        description="Manage and organize FAQ content shown in the Ballet mobile experience."
        mode="stage"
      >
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="gap-2 border-border bg-card hover:bg-accent">
            <Link href="/ballet/settings/faq/categories">
              <FolderCog className="h-4 w-4 text-muted-foreground" />
              Manage Categories
            </Link>
          </Button>

          {canEdit && (
            <Button
              type="button"
              size="sm"
              onClick={openCreateDrawer}
              className="gap-2 bg-[#00B6D6] hover:bg-[#0097B2] text-white font-medium shadow-sm"
              data-testid="button-add-faq"
            >
              <Plus className="h-4 w-4" />
              Add FAQ
            </Button>
          )}
        </div>
      </PageHeader>

      {/* Toolbar / Search & Filter Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search FAQs by question or answer..."
              className="pl-9 bg-background text-foreground border-border placeholder:text-muted-foreground focus-visible:ring-[#00B6D6]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Category Filter */}
          <Select value={selectedCategoryFilter} onValueChange={setSelectedCategoryFilter}>
            <SelectTrigger className="w-full sm:w-[200px] bg-background text-foreground border-border">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>All Categories</SelectItem>
              <SelectItem value={NO_CATEGORY_VALUE}>Uncategorized Only</SelectItem>
              {sortedCategories.map((cat) => (
                <SelectItem key={cat.id} value={String(cat.id)}>
                  {cat.name}
                  {!cat.isActive ? " (inactive)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={selectedStatusFilter} onValueChange={setSelectedStatusFilter}>
            <SelectTrigger className="w-full sm:w-[150px] bg-background text-foreground border-border">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>All Status</SelectItem>
              <SelectItem value="active">Active Only</SelectItem>
              <SelectItem value="inactive">Inactive Only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Total Count & Clear Filters */}
        <div className="flex items-center justify-between sm:justify-end gap-3 border-t md:border-t-0 pt-3 md:pt-0 border-border">
          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                setSelectedCategoryFilter(ALL_FILTER_VALUE);
                setSelectedStatusFilter(ALL_FILTER_VALUE);
              }}
              className="text-xs text-muted-foreground hover:text-foreground h-8"
            >
              Clear Filters
            </Button>
          )}
          <Badge variant="outline" className="text-xs border-border bg-background/50 px-2.5 py-1">
            {filteredFaqs.length} {filteredFaqs.length === 1 ? "FAQ" : "FAQs"}
          </Badge>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-24 rounded-xl border border-border bg-card">
          <Loader2 className="h-8 w-8 animate-spin text-[#00B6D6] mb-3" />
          <p className="text-sm text-muted-foreground">Loading Ballet FAQs...</p>
        </div>
      )}

      {/* Error State */}
      {isError && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-5 py-4 text-red-400">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm font-medium">Failed to load Ballet FAQs. Please refresh the page.</span>
        </div>
      )}

      {/* Content Workspace */}
      {!isLoading && !isError && (
        <>
          {/* Main Empty State: No FAQs exist in database */}
          {faqs.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-12 text-center">
              <div className="rounded-full bg-accent p-4 mb-4">
                <FileQuestion className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-1">No Ballet FAQs yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm mb-6">
                Get started by creating your first FAQ question to display in the Ballet mobile app.
              </p>
              {canEdit && (
                <Button
                  type="button"
                  onClick={openCreateDrawer}
                  className="gap-2 bg-[#00B6D6] hover:bg-[#0097B2] text-white font-medium"
                >
                  <Plus className="h-4 w-4" />
                  Add FAQ
                </Button>
              )}
            </div>
          ) : filteredFaqs.length === 0 ? (
            /* Filter Empty State: Search/filters return 0 matches */
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-12 text-center">
              <div className="rounded-full bg-accent p-3 mb-3">
                <Filter className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-1">No matching FAQs found</h3>
              <p className="text-sm text-muted-foreground max-w-md mb-4">
                No FAQs match your search query or selected filter criteria. Try adjusting your search term or clearing filters.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategoryFilter(ALL_FILTER_VALUE);
                  setSelectedStatusFilter(ALL_FILTER_VALUE);
                }}
              >
                Reset Filters
              </Button>
            </div>
          ) : (
            /* Category-First Grouped List */
            <div className="space-y-8">
              {/* Categorized Groups */}
              {groupedFaqs.categorized.map(({ category, faqs: groupFaqs }) => (
                <section key={category.id} className="space-y-3">
                  {/* Category Header */}
                  <div className="flex items-center justify-between border-b border-border pb-2 px-1">
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {category.name}
                      </h2>
                      {!category.isActive && (
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-amber-400 border-amber-500/30 bg-amber-500/10">
                          Category Inactive
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">
                      {groupFaqs.length} {groupFaqs.length === 1 ? "FAQ" : "FAQs"}
                    </span>
                  </div>

                  {/* Category FAQ Cards */}
                  <div className="space-y-2.5">
                    {groupFaqs.map((faq) => (
                      <FaqRowCard
                        key={faq.id}
                        faq={faq}
                        canEdit={canEdit}
                        onEdit={() => openEditDrawer(faq)}
                        onToggleStatus={() => handleToggleStatus(faq)}
                        isMutating={updateFaqMutation.isPending}
                      />
                    ))}
                  </div>
                </section>
              ))}

              {/* Uncategorized Group (Always Rendered Last) */}
              {groupedFaqs.uncategorized.length > 0 && (
                <section className="space-y-3 pt-2">
                  {/* Uncategorized Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border pb-2 px-1 gap-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        UNCATEGORIZED
                      </h2>
                      <span className="text-xs text-muted-foreground/70 hidden sm:inline">
                        — These FAQs appear under “Other Questions” in the mobile app.
                      </span>
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">
                      {groupedFaqs.uncategorized.length} {groupedFaqs.uncategorized.length === 1 ? "FAQ" : "FAQs"}
                    </span>
                  </div>

                  {/* Uncategorized FAQ Cards */}
                  <div className="space-y-2.5">
                    {groupedFaqs.uncategorized.map((faq) => (
                      <FaqRowCard
                        key={faq.id}
                        faq={faq}
                        canEdit={canEdit}
                        onEdit={() => openEditDrawer(faq)}
                        onToggleStatus={() => handleToggleStatus(faq)}
                        isMutating={updateFaqMutation.isPending}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </>
      )}

      {/* Side Sheet / Drawer for Create & Edit FAQ */}
      <Sheet open={drawerState.isOpen} onOpenChange={(open) => !open && closeDrawer()}>
        <SheetContent side="right" className="w-full sm:max-w-md bg-card border-border p-6 flex flex-col justify-between overflow-y-auto">
    <div className="admin2-ballet-page admin2-ballet-settings space-y-6">
            <SheetHeader className="text-left space-y-1.5 border-b border-border pb-4">
              <SheetTitle className="text-xl font-bold text-foreground">
                {drawerState.mode === "create" ? "Add New FAQ" : "Edit FAQ"}
              </SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground">
                {drawerState.mode === "create"
                  ? "Create a new question and answer pair for the Ballet mobile FAQ section."
                  : `Update FAQ #${drawerState.faq?.id} content, ordering, or category assignment.`}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4">
              {/* Question Field */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Question <span className="text-red-400">*</span>
                </Label>
                <Input
                  value={faqDraft.question}
                  onChange={(e) => setFaqDraft((prev) => ({ ...prev, question: e.target.value }))}
                  placeholder="e.g. What age can my child start?"
                  className="bg-background text-foreground border-border focus-visible:ring-[#00B6D6]"
                />
              </div>

              {/* Answer Field */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Answer <span className="text-red-400">*</span>
                </Label>
                <Textarea
                  rows={4}
                  value={faqDraft.answer}
                  onChange={(e) => setFaqDraft((prev) => ({ ...prev, answer: e.target.value }))}
                  placeholder="Write the detailed answer displayed in the mobile app accordion..."
                  className="bg-background text-foreground border-border focus-visible:ring-[#00B6D6]"
                />
              </div>

              {/* Category Field */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Category
                </Label>
                <Select
                  value={faqDraft.categoryId != null ? String(faqDraft.categoryId) : NO_CATEGORY_VALUE}
                  onValueChange={(value) =>
                    setFaqDraft((prev) => ({
                      ...prev,
                      categoryId: value === NO_CATEGORY_VALUE ? null : Number(value),
                    }))
                  }
                >
                  <SelectTrigger className="bg-background text-foreground border-border">
                    <SelectValue placeholder="Select Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY_VALUE}>No category (Uncategorized)</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={String(cat.id)}>
                        {cat.name}
                        {!cat.isActive ? " (inactive)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Categories organize FAQs into accordion groups on the mobile FAQ screen.
                </p>
              </div>

              {/* Display Order Field */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Display Order
                </Label>
                <Input
                  type="number"
                  value={faqDraft.sortOrder}
                  onChange={(e) => setFaqDraft((prev) => ({ ...prev, sortOrder: e.target.value }))}
                  className="bg-background text-foreground border-border focus-visible:ring-[#00B6D6]"
                />
                <p className="text-[11px] text-muted-foreground">
                  Numerical sort order within the selected category (lowest first).
                </p>
              </div>

              {/* Status Selector in Edit Mode */}
              <div className="space-y-1.5 pt-2 border-t border-border">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Visibility Status
                </Label>
                <Select
                  value={faqDraft.isActive ? "active" : "inactive"}
                  onValueChange={(val) => setFaqDraft((prev) => ({ ...prev, isActive: val === "active" }))}
                >
                  <SelectTrigger className="bg-background text-foreground border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active (Visible in mobile app)</SelectItem>
                    <SelectItem value="inactive">Inactive (Hidden from mobile app)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <SheetFooter className="border-t border-border pt-4 flex flex-row items-center justify-end gap-3 mt-6">
            <Button type="button" variant="outline" size="sm" onClick={closeDrawer}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveFaq}
              disabled={
                createFaqMutation.isPending ||
                updateFaqMutation.isPending ||
                !faqDraft.question.trim() ||
                !faqDraft.answer.trim()
              }
              className="bg-[#00B6D6] hover:bg-[#0097B2] text-white font-medium gap-2"
            >
              {(createFaqMutation.isPending || updateFaqMutation.isPending) && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {drawerState.mode === "create" ? "Create FAQ" : "Save Changes"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * Compact FAQ Row Card Component
 */
function FaqRowCard({
  faq,
  canEdit,
  onEdit,
  onToggleStatus,
  isMutating,
}: {
  faq: BalletFaq;
  canEdit: boolean;
  onEdit: () => void;
  onToggleStatus: () => void;
  isMutating: boolean;
}) {
  return (
    <div className="group rounded-xl border border-border bg-card p-4 transition-all hover:border-border/90 hover:shadow-sm">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        {/* Main Content */}
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm text-foreground group-hover:text-[#00B6D6] transition-colors leading-snug">
              {faq.question}
            </h3>
          </div>

          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {faq.answer}
          </p>

          {/* Meta Bar */}
          <div className="flex items-center gap-3 pt-1 text-[11px] text-muted-foreground flex-wrap">
            <span className="font-mono bg-accent/60 px-1.5 py-0.5 rounded text-muted-foreground/80">
              Order {faq.sortOrder}
            </span>

            <span className="text-muted-foreground/40">•</span>

            <span>ID {faq.id}</span>

            {faq.category ? (
              <>
                <span className="text-muted-foreground/40">•</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-foreground/80 font-medium">{faq.category.name}</span>
                  {!faq.category.isActive && (
                    <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 bg-amber-500/10 px-1.5 py-0">
                      Category Inactive
                    </Badge>
                  )}
                </span>
              </>
            ) : (
              <>
                <span className="text-muted-foreground/40">•</span>
                <span className="italic text-muted-foreground/70">Uncategorized</span>
              </>
            )}
          </div>
        </div>

        {/* Right Actions & Status */}
        <div className="flex items-center gap-3 justify-end flex-shrink-0 border-t md:border-t-0 pt-2 md:pt-0 border-border">
          {/* Status Badge */}
          <Badge
            variant={faq.isActive ? "default" : "secondary"}
            className={
              faq.isActive
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 font-medium text-xs px-2.5 py-0.5"
                : "bg-muted text-muted-foreground text-xs px-2.5 py-0.5"
            }
          >
            {faq.isActive ? "Active" : "Inactive"}
          </Badge>

          {canEdit && (
            <div className="flex items-center gap-1">
              {/* Activate / Deactivate Toggle */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onToggleStatus}
                disabled={isMutating}
                title={faq.isActive ? "Deactivate FAQ" : "Activate FAQ"}
                className={`h-8 px-2 ${
                  faq.isActive
                    ? "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {faq.isActive ? (
                  <ToggleRight className="h-4 w-4" />
                ) : (
                  <ToggleLeft className="h-4 w-4" />
                )}
              </Button>

              {/* Edit Drawer Button */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onEdit}
                className="h-8 gap-1.5 text-xs border-border bg-background hover:bg-accent hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                Edit
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
import "../admin2-ballet.css";
