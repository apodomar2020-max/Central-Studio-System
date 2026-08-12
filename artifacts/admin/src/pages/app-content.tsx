import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

const API = import.meta.env.VITE_API_URL ?? "";
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";

function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

async function adminFetch<T>(url: string, init: RequestInit, token: string | null): Promise<T> {
  const res = await fetch(url, { ...init, headers: makeHeaders(token) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw data;
  }
  return res.json() as Promise<T>;
}

interface AppContentPage {
  id: number;
  slug: string;
  title: string;
  subtitle?: string | null;
  content: string;
  isActive: boolean;
  updatedBy?: number | null;
  createdAt: string;
  updatedAt: string;
}

interface FaqCategory {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FaqItem {
  id: number;
  question: string;
  answer: string;
  sortOrder: number;
  isActive: boolean;
  // The FAQ's true category assignment, regardless of the category's own
  // active state (admin sees this even when the category is deactivated —
  // only the public Help & Support response nulls it out in that case).
  category: FaqCategory | null;
  createdAt: string;
  updatedAt: string;
}

type ContactType =
  | "whatsapp"
  | "phone"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "youtube"
  | "website"
  | "email";

interface ContactLink {
  id: number;
  type: ContactType;
  label: string;
  value: string;
  icon?: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type PageFormState = {
  title: string;
  subtitle: string;
  content: string;
  isActive: boolean;
};

type FaqFormState = {
  question: string;
  answer: string;
  sortOrder: number;
  isActive: boolean;
  categoryId: number | null;
};

type FaqCategoryFormState = {
  name: string;
  sortOrder: number;
  isActive: boolean;
};

type ContactFormState = {
  type: ContactType;
  label: string;
  value: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
};

const PAGE_LABELS: Record<string, string> = {
  "help-support": "Help & Support",
  "privacy-policy": "Privacy & Policy",
  "terms-conditions": "Terms & Conditions",
};

const CONTACT_TYPES: Array<{ value: ContactType; label: string }> = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "phone", label: "Phone Call" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "website", label: "Website" },
  { value: "email", label: "Email" },
];

const EMPTY_FAQ: FaqFormState = {
  question: "",
  answer: "",
  sortOrder: 0,
  isActive: true,
  categoryId: null,
};

const EMPTY_FAQ_CATEGORY: FaqCategoryFormState = {
  name: "",
  sortOrder: 0,
  isActive: true,
};

// Radix Select does not accept an empty-string item value, so "no category"
// is represented by this sentinel in the <Select> and mapped to/from `null`
// at the form-state boundary.
const NO_CATEGORY_VALUE = "__none__";

const EMPTY_CONTACT: ContactFormState = {
  type: "whatsapp",
  label: "WhatsApp",
  value: "",
  icon: "",
  sortOrder: 0,
  isActive: true,
};

function StatusBadge({ active }: { active: boolean }) {
  return <Badge variant={active ? "default" : "outline"}>{active ? "Active" : "Inactive"}</Badge>;
}

export default function AppContentPage() {
  const { token, can } = useAdminAuth();
  const canCreate = can("appContent", "create");
  const canEdit = can("appContent", "edit");
  const canDelete = can("appContent", "delete");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [pageForm, setPageForm] = useState<PageFormState>({
    title: "",
    subtitle: "",
    content: "",
    isActive: true,
  });
  const [faqDialogOpen, setFaqDialogOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<FaqItem | null>(null);
  const [faqForm, setFaqForm] = useState<FaqFormState>(EMPTY_FAQ);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<FaqCategory | null>(null);
  const [categoryForm, setCategoryForm] = useState<FaqCategoryFormState>(EMPTY_FAQ_CATEGORY);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactLink | null>(null);
  const [contactForm, setContactForm] = useState<ContactFormState>(EMPTY_CONTACT);

  const pagesQuery = useQuery<AppContentPage[]>({
    queryKey: ["admin-app-content-pages", token],
    queryFn: () =>
      adminFetch<AppContentPage[]>(`${API}/api/admin/content/pages`, { method: "GET" }, token),
  });

  const faqsQuery = useQuery<FaqItem[]>({
    queryKey: ["admin-app-content-faqs", token],
    queryFn: () =>
      adminFetch<FaqItem[]>(`${API}/api/admin/content/faqs`, { method: "GET" }, token),
  });

  const categoriesQuery = useQuery<FaqCategory[]>({
    queryKey: ["admin-app-content-faq-categories", token],
    queryFn: () =>
      adminFetch<FaqCategory[]>(`${API}/api/admin/content/faq-categories`, { method: "GET" }, token),
  });

  const contactsQuery = useQuery<ContactLink[]>({
    queryKey: ["admin-app-content-contact-links", token],
    queryFn: () =>
      adminFetch<ContactLink[]>(`${API}/api/admin/content/contact-links`, { method: "GET" }, token),
  });

  const pages = pagesQuery.data ?? [];
  const faqs = faqsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const contacts = contactsQuery.data ?? [];
  const selectedPage = pages.find((page) => page.slug === selectedSlug) ?? pages[0] ?? null;

  useEffect(() => {
    if (!selectedSlug && pages.length > 0) {
      setSelectedSlug(pages[0].slug);
    }
  }, [pages, selectedSlug]);

  useEffect(() => {
    if (!selectedPage) return;
    setPageForm({
      title: selectedPage.title,
      subtitle: selectedPage.subtitle ?? "",
      content: selectedPage.content,
      isActive: selectedPage.isActive,
    });
  }, [selectedPage?.slug, selectedPage?.updatedAt]);

  const invalidatePages = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-app-content-pages", token] });
  const invalidateFaqs = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-app-content-faqs", token] });
  const invalidateCategories = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-app-content-faq-categories", token] });
  const invalidateContacts = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-app-content-contact-links", token] });

  const updatePageMutation = useMutation({
    mutationFn: (data: PageFormState) => {
      if (!selectedPage) throw new Error("No page selected");
      return adminFetch<AppContentPage>(
        `${API}/api/admin/content/pages/${selectedPage.slug}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: data.title.trim(),
            subtitle: data.subtitle.trim() || null,
            content: data.content.trim(),
            isActive: data.isActive,
          }),
        },
        token,
      );
    },
    onSuccess: (updated) => {
      invalidatePages();
      setSelectedSlug(updated.slug);
      toast({ title: "Content saved", description: `${updated.title} was updated.` });
    },
    onError: (e: { error?: string; message?: string }) =>
      toast({
        title: "Could not save content",
        description: e?.message ?? e?.error ?? "Please check the page content and try again.",
        variant: "destructive",
      }),
  });

  const saveFaqMutation = useMutation({
    mutationFn: (data: FaqFormState) =>
      adminFetch<FaqItem>(
        editingFaq
          ? `${API}/api/admin/content/faqs/${editingFaq.id}`
          : `${API}/api/admin/content/faqs`,
        {
          method: editingFaq ? "PATCH" : "POST",
          body: JSON.stringify(data),
        },
        token,
      ),
    onSuccess: () => {
      invalidateFaqs();
      setFaqDialogOpen(false);
      toast({ title: editingFaq ? "FAQ updated" : "FAQ created" });
    },
    onError: (e: { error?: string; message?: string }) =>
      toast({
        title: "Could not save FAQ",
        description: e?.message ?? e?.error ?? "Please check the FAQ and try again.",
        variant: "destructive",
      }),
  });

  const deleteFaqMutation = useMutation({
    mutationFn: (id: number) =>
      adminFetch<{ success: boolean }>(
        `${API}/api/admin/content/faqs/${id}`,
        { method: "DELETE" },
        token,
      ),
    onSuccess: () => {
      invalidateFaqs();
      toast({ title: "FAQ deactivated" });
    },
  });

  const saveCategoryMutation = useMutation({
    mutationFn: (data: FaqCategoryFormState) =>
      adminFetch<FaqCategory>(
        editingCategory
          ? `${API}/api/admin/content/faq-categories/${editingCategory.id}`
          : `${API}/api/admin/content/faq-categories`,
        {
          method: editingCategory ? "PATCH" : "POST",
          body: JSON.stringify(data),
        },
        token,
      ),
    onSuccess: () => {
      invalidateCategories();
      // A rename or activate/deactivate must be reflected in the FAQ table's
      // Category column immediately — the two lists are not independent
      // once a FAQ references a category, so the FAQ query is invalidated
      // alongside the category query (new cross-invalidation; the other
      // tabs in this file don't need this because they don't reference
      // each other's data).
      invalidateFaqs();
      setCategoryDialogOpen(false);
      toast({ title: editingCategory ? "Category updated" : "Category created" });
    },
    onError: (e: { error?: string; message?: string }) =>
      toast({
        title: "Could not save category",
        description: e?.message ?? e?.error ?? "Please check the category and try again.",
        variant: "destructive",
      }),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: number) =>
      adminFetch<{ success: boolean }>(
        `${API}/api/admin/content/faq-categories/${id}`,
        { method: "DELETE" },
        token,
      ),
    onSuccess: () => {
      invalidateCategories();
      invalidateFaqs();
      toast({ title: "Category deactivated" });
    },
  });

  const saveContactMutation = useMutation({
    mutationFn: (data: ContactFormState) =>
      adminFetch<ContactLink>(
        editingContact
          ? `${API}/api/admin/content/contact-links/${editingContact.id}`
          : `${API}/api/admin/content/contact-links`,
        {
          method: editingContact ? "PATCH" : "POST",
          body: JSON.stringify({
            ...data,
            icon: data.icon.trim() || null,
          }),
        },
        token,
      ),
    onSuccess: () => {
      invalidateContacts();
      setContactDialogOpen(false);
      toast({ title: editingContact ? "Contact link updated" : "Contact link created" });
    },
    onError: (e: { error?: string; message?: string }) =>
      toast({
        title: "Could not save contact link",
        description: e?.message ?? e?.error ?? "Please check the link and try again.",
        variant: "destructive",
      }),
  });

  const deleteContactMutation = useMutation({
    mutationFn: (id: number) =>
      adminFetch<{ success: boolean }>(
        `${API}/api/admin/content/contact-links/${id}`,
        { method: "DELETE" },
        token,
      ),
    onSuccess: () => {
      invalidateContacts();
      toast({ title: "Contact link deactivated" });
    },
  });

  function openNewFaq() {
    setEditingFaq(null);
    setFaqForm({ ...EMPTY_FAQ, sortOrder: (faqs.length + 1) * 10 });
    setFaqDialogOpen(true);
  }

  function openEditFaq(item: FaqItem) {
    setEditingFaq(item);
    setFaqForm({
      question: item.question,
      answer: item.answer,
      sortOrder: item.sortOrder,
      isActive: item.isActive,
      categoryId: item.category?.id ?? null,
    });
    setFaqDialogOpen(true);
  }

  function openNewCategory() {
    setEditingCategory(null);
    setCategoryForm({ ...EMPTY_FAQ_CATEGORY, sortOrder: (categories.length + 1) * 10 });
    setCategoryDialogOpen(true);
  }

  function openEditCategory(item: FaqCategory) {
    setEditingCategory(item);
    setCategoryForm({
      name: item.name,
      sortOrder: item.sortOrder,
      isActive: item.isActive,
    });
    setCategoryDialogOpen(true);
  }

  function openNewContact() {
    setEditingContact(null);
    setContactForm({ ...EMPTY_CONTACT, sortOrder: (contacts.length + 1) * 10 });
    setContactDialogOpen(true);
  }

  function openEditContact(item: ContactLink) {
    setEditingContact(item);
    setContactForm({
      type: item.type,
      label: item.label,
      value: item.value,
      icon: item.icon ?? "",
      sortOrder: item.sortOrder,
      isActive: item.isActive,
    });
    setContactDialogOpen(true);
  }

  const canSavePage = pageForm.title.trim().length > 0 && pageForm.content.trim().length > 0;
  // Category assignment is optional — an uncategorized FAQ remains fully
  // valid and editable (see NO_CATEGORY_VALUE / the "No category" option).
  const canSaveFaq = faqForm.question.trim().length > 0 && faqForm.answer.trim().length > 0;
  const canSaveCategory = categoryForm.name.trim().length > 0;
  const canSaveContact = contactForm.label.trim().length > 0 && contactForm.value.trim().length > 0;

  return (
    <div className="admin2-final-page admin2-cms-workspace admin2-app-content space-y-6">
      <PageHeader
        title="App Content"
        description="Manage mobile support, legal, FAQ, and contact content."
        mode="stage"
      />

      {(pagesQuery.isError || faqsQuery.isError || categoriesQuery.isError || contactsQuery.isError) && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Some App Content could not be loaded. Existing content has not been replaced with an empty state.
        </div>
      )}

      <Tabs defaultValue="pages" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pages">Pages</TabsTrigger>
          <TabsTrigger value="faq">FAQ</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="contacts">Contact Links</TabsTrigger>
        </TabsList>

        <TabsContent value="pages">
          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            <section className="rounded-md border">
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">Pages</h2>
                <p className="text-xs text-muted-foreground">Mobile app content source of truth</p>
              </div>
              <div className="p-2">
                {pagesQuery.isLoading ? (
                  <div className="px-3 py-8 text-sm text-muted-foreground">Loading pages...</div>
                ) : pages.length === 0 ? (
                  <div className="px-3 py-8 text-sm text-muted-foreground">No content pages configured.</div>
                ) : (
                  pages.map((page) => (
                    <button
                      key={page.slug}
                      onClick={() => setSelectedSlug(page.slug)}
                      className="mb-1 flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                      style={{
                        background: selectedPage?.slug === page.slug ? "hsl(var(--accent))" : undefined,
                        color: selectedPage?.slug === page.slug ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        {PAGE_LABELS[page.slug] ?? page.title}
                      </span>
                      <StatusBadge active={page.isActive} />
                    </button>
                  ))
                )}
              </div>
            </section>

            {selectedPage && (
              <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-4 rounded-md border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">{selectedPage.title}</h2>
                      <p className="font-mono text-xs text-muted-foreground">{selectedPage.slug}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="content-active" className="text-sm text-muted-foreground">Active</Label>
                      <Switch
                        id="content-active"
                        checked={pageForm.isActive}
                        onCheckedChange={(isActive) => setPageForm((prev) => ({ ...prev, isActive }))}
                        disabled={!canEdit}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="content-title">Title</Label>
                      <Input
                        id="content-title"
                        value={pageForm.title}
                        onChange={(e) => setPageForm((prev) => ({ ...prev, title: e.target.value }))}
                        disabled={!canEdit}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="content-subtitle">Subtitle</Label>
                      <Input
                        id="content-subtitle"
                        value={pageForm.subtitle}
                        onChange={(e) => setPageForm((prev) => ({ ...prev, subtitle: e.target.value }))}
                        placeholder="Optional"
                        disabled={!canEdit}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="content-body">Content</Label>
                      <Textarea
                        id="content-body"
                        value={pageForm.content}
                        onChange={(e) => setPageForm((prev) => ({ ...prev, content: e.target.value }))}
                        className="min-h-[420px] font-mono text-sm leading-6"
                        disabled={!canEdit}
                      />
                      <p className="text-xs text-muted-foreground">
                        Plain text only. FAQ and contact buttons are managed in their own tabs.
                      </p>
                    </div>
                  </div>

                  {canEdit && <div className="flex justify-end">
                    <Button
                      onClick={() => updatePageMutation.mutate(pageForm)}
                      disabled={!canSavePage || updatePageMutation.isPending}
                      className="gap-2"
                    >
                      <Save className="h-4 w-4" />
                      {updatePageMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                  </div>}
                </div>

                <aside className="rounded-md border p-4">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-foreground">Mobile Preview</h3>
                    <p className="text-xs text-muted-foreground">Approximate plaintext rendering</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <div className="mb-4 rounded-xl border border-primary/25 bg-primary/10 p-3">
                      <p className="text-base font-bold text-foreground">{pageForm.title || "Untitled"}</p>
                      {pageForm.subtitle.trim() && (
                        <p className="mt-1 text-xs text-muted-foreground">{pageForm.subtitle}</p>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {pageForm.content || "No content yet."}
                    </p>
                  </div>
                  {selectedPage.updatedAt && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Last updated: {new Date(selectedPage.updatedAt).toLocaleString()}
                    </p>
                  )}
                </aside>
              </section>
            )}
          </div>
        </TabsContent>

        <TabsContent value="faq">
          <section className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">FAQ</h2>
                <p className="text-sm text-muted-foreground">Questions shown on mobile Help & Support.</p>
              </div>
              {canCreate && (
                <Button onClick={openNewFaq} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add FAQ
                </Button>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Question</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {faqsQuery.isLoading ? (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center">Loading...</TableCell></TableRow>
                ) : faqs.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No FAQs yet.</TableCell></TableRow>
                ) : (
                  faqs.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.question}</TableCell>
                      <TableCell>
                        {item.category ? (
                          <span className="inline-flex items-center gap-1.5">
                            {item.category.name}
                            {!item.category.isActive && (
                              <Badge variant="outline" className="text-xs">Category inactive</Badge>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{item.sortOrder}</TableCell>
                      <TableCell><StatusBadge active={item.isActive} /></TableCell>
                      <TableCell className="text-right">
                        {canEdit && (
                          <Button variant="ghost" size="icon" onClick={() => openEditFaq(item)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button variant="ghost" size="icon" onClick={() => deleteFaqMutation.mutate(item.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </section>
        </TabsContent>

        <TabsContent value="categories">
          <section className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">FAQ Categories</h2>
                <p className="text-sm text-muted-foreground">Group FAQs shown on mobile Help & Support.</p>
              </div>
              {canCreate && (
                <Button onClick={openNewCategory} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add Category
                </Button>
              )}
            </div>
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
                {categoriesQuery.isLoading ? (
                  <TableRow><TableCell colSpan={4} className="py-8 text-center">Loading...</TableCell></TableRow>
                ) : categories.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No categories yet.</TableCell></TableRow>
                ) : (
                  categories.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>{item.sortOrder}</TableCell>
                      <TableCell><StatusBadge active={item.isActive} /></TableCell>
                      <TableCell className="text-right">
                        {canEdit && (
                          <Button variant="ghost" size="icon" onClick={() => openEditCategory(item)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button variant="ghost" size="icon" onClick={() => deleteCategoryMutation.mutate(item.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </section>
        </TabsContent>

        <TabsContent value="contacts">
          <section className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Contact Links</h2>
                <p className="text-sm text-muted-foreground">Buttons shown on mobile Help & Support.</p>
              </div>
              {canCreate && (
                <Button onClick={openNewContact} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add Contact
                </Button>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contactsQuery.isLoading ? (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center">Loading...</TableCell></TableRow>
                ) : contacts.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No contact links yet.</TableCell></TableRow>
                ) : (
                  contacts.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="capitalize">{item.type}</TableCell>
                      <TableCell className="font-medium">{item.label}</TableCell>
                      <TableCell className="max-w-[360px] truncate font-mono text-xs text-muted-foreground">{item.value}</TableCell>
                      <TableCell>{item.sortOrder}</TableCell>
                      <TableCell><StatusBadge active={item.isActive} /></TableCell>
                      <TableCell className="text-right">
                        {canEdit && (
                          <Button variant="ghost" size="icon" onClick={() => openEditContact(item)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button variant="ghost" size="icon" onClick={() => deleteContactMutation.mutate(item.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </section>
        </TabsContent>
      </Tabs>

      <Dialog open={(canCreate || canEdit) && faqDialogOpen} onOpenChange={setFaqDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingFaq ? "Edit FAQ" : "Add FAQ"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="faq-question">Question</Label>
              <Input
                id="faq-question"
                value={faqForm.question}
                onChange={(e) => setFaqForm((prev) => ({ ...prev, question: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="faq-answer">Answer</Label>
              <Textarea
                id="faq-answer"
                value={faqForm.answer}
                onChange={(e) => setFaqForm((prev) => ({ ...prev, answer: e.target.value }))}
                className="min-h-32"
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={faqForm.categoryId != null ? String(faqForm.categoryId) : NO_CATEGORY_VALUE}
                onValueChange={(value) =>
                  setFaqForm((prev) => ({
                    ...prev,
                    categoryId: value === NO_CATEGORY_VALUE ? null : Number(value),
                  }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CATEGORY_VALUE}>No category</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={String(category.id)}>
                      {category.name}
                      {!category.isActive ? " (inactive)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Optional. Manage categories from the Categories tab.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="faq-order">Sort Order</Label>
                <Input
                  id="faq-order"
                  type="number"
                  value={faqForm.sortOrder}
                  onChange={(e) => setFaqForm((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))}
                />
              </div>
              <div className="flex items-end gap-2">
                <Switch
                  id="faq-active"
                  checked={faqForm.isActive}
                  onCheckedChange={(isActive) => setFaqForm((prev) => ({ ...prev, isActive }))}
                />
                <Label htmlFor="faq-active" className="pb-0.5">Active</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFaqDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => saveFaqMutation.mutate(faqForm)}
              disabled={!canSaveFaq || saveFaqMutation.isPending}
            >
              {saveFaqMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={(canCreate || canEdit) && categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCategory ? "Edit Category" : "Add Category"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="category-name">Name</Label>
              <Input
                id="category-name"
                value={categoryForm.name}
                onChange={(e) => setCategoryForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="category-order">Sort Order</Label>
                <Input
                  id="category-order"
                  type="number"
                  value={categoryForm.sortOrder}
                  onChange={(e) => setCategoryForm((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))}
                />
              </div>
              <div className="flex items-end gap-2">
                <Switch
                  id="category-active"
                  checked={categoryForm.isActive}
                  onCheckedChange={(isActive) => setCategoryForm((prev) => ({ ...prev, isActive }))}
                />
                <Label htmlFor="category-active" className="pb-0.5">Active</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => saveCategoryMutation.mutate(categoryForm)}
              disabled={!canSaveCategory || saveCategoryMutation.isPending}
            >
              {saveCategoryMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={(canCreate || canEdit) && contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingContact ? "Edit Contact Link" : "Add Contact Link"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={contactForm.type}
                  onValueChange={(type: ContactType) => {
                    const label = CONTACT_TYPES.find((item) => item.value === type)?.label ?? type;
                    setContactForm((prev) => ({ ...prev, type, label: prev.label || label }));
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONTACT_TYPES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-label">Label</Label>
                <Input
                  id="contact-label"
                  value={contactForm.label}
                  onChange={(e) => setContactForm((prev) => ({ ...prev, label: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-value">Value</Label>
              <Input
                id="contact-value"
                value={contactForm.value}
                onChange={(e) => setContactForm((prev) => ({ ...prev, value: e.target.value }))}
                placeholder="Phone number, email, or URL"
              />
              <p className="text-xs text-muted-foreground">
                WhatsApp and phone can be plain numbers; the mobile app formats them.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="contact-icon">Icon</Label>
                <Input
                  id="contact-icon"
                  value={contactForm.icon}
                  onChange={(e) => setContactForm((prev) => ({ ...prev, icon: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-order">Sort Order</Label>
                <Input
                  id="contact-order"
                  type="number"
                  value={contactForm.sortOrder}
                  onChange={(e) => setContactForm((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))}
                />
              </div>
              <div className="flex items-end gap-2">
                <Switch
                  id="contact-active"
                  checked={contactForm.isActive}
                  onCheckedChange={(isActive) => setContactForm((prev) => ({ ...prev, isActive }))}
                />
                <Label htmlFor="contact-active" className="pb-0.5">Active</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => saveContactMutation.mutate(contactForm)}
              disabled={!canSaveContact || saveContactMutation.isPending}
            >
              {saveContactMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
import "./admin2-final.css";
