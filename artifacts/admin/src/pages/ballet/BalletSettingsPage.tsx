/**
 * Ballet → General Settings
 *
 * Currently stores the mobile Home entry card background image only.
 * Ballet pricing is managed by Ballet Packages, and availability is managed
 * by Ballet Classes/Schedules.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Image as ImageIcon, Loader2, Plus, Save, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { normalizeMediaUrl } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

const API     = import.meta.env.VITE_API_URL ?? "";
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";

function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token   ? { "x-admin-token": token } : {}),
  };
}

async function adminFetch<T>(url: string, init: RequestInit, token: string | null): Promise<T> {
  const res = await fetch(url, { ...init, headers: makeHeaders(token) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw { data };
  }
  return res.json() as Promise<T>;
}

interface Settings {
  id: number;
  homeCardImageUrl: string | null;
  whatsappNumber: string | null;
  phoneNumber: string | null;
  email: string | null;
  studioLocationUrl: string | null;
  updatedAt: string;
}

interface RequirementItem {
  id: number;
  sectionId: number;
  text: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RequirementSection {
  id: number;
  title: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  items: RequirementItem[];
}

interface BalletFaq {
  id: number;
  question: string;
  answer: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type SectionDraft = {
  title: string;
  description: string;
  sortOrder: string;
};

type ItemDraft = {
  text: string;
  sortOrder: string;
};

type FaqDraft = {
  question: string;
  answer: string;
  sortOrder: string;
};

const EMPTY_SECTION_DRAFT: SectionDraft = { title: "", description: "", sortOrder: "0" };
const EMPTY_FAQ_DRAFT: FaqDraft = { question: "", answer: "", sortOrder: "0" };

function normalizeHomeCardImageUrlInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = normalizeMediaUrl(trimmed, "image");
  if (!normalized) {
    throw new Error("Enter a direct image URL or a supported public Google Drive sharing URL.");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Enter a valid image URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Image URL must use HTTPS.");
  }

  return parsed.toString();
}

function normalizePhoneInput(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[\s().-]+/g, "").replace(/^00/, "+");
  if (!/^\+?[0-9]{7,15}$/.test(normalized)) {
    throw new Error(`${label} must contain 7 to 15 digits and may start with +.`);
  }
  return normalized;
}

function normalizeEmailInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error("Enter a valid email address.");
  }
  return trimmed.toLowerCase();
}

function normalizeHttpsUrlInput(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include credentials.`);
  }
  return parsed.toString();
}

export default function BalletSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token, can } = useAdminAuth();
  const canEdit = can("ballet.settings", "edit");

  const [homeCardImageUrl, setHomeCardImageUrl] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [studioLocationUrl, setStudioLocationUrl] = useState("");
  const [dirty, setDirty] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [contactValidationMessage, setContactValidationMessage] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [newSection, setNewSection] = useState<SectionDraft>(EMPTY_SECTION_DRAFT);
  const [sectionDrafts, setSectionDrafts] = useState<Record<number, SectionDraft>>({});
  const [newItemTextBySection, setNewItemTextBySection] = useState<Record<number, string>>({});
  const [itemDrafts, setItemDrafts] = useState<Record<number, ItemDraft>>({});
  const [newFaq, setNewFaq] = useState<FaqDraft>(EMPTY_FAQ_DRAFT);
  const [faqDrafts, setFaqDrafts] = useState<Record<number, FaqDraft>>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ballet-settings", token],
    queryFn: () => adminFetch<{ settings: Settings }>(`${API}/api/admin/ballet/settings`, {}, token),
    refetchOnWindowFocus: false,
  });

  const {
    data: requirementData,
    isLoading: requirementsLoading,
    isError: requirementsError,
  } = useQuery({
    queryKey: ["admin-ballet-program-requirements", token],
    queryFn: () => adminFetch<{ sections: RequirementSection[] }>(`${API}/api/admin/ballet/program-requirement-sections`, {}, token),
    refetchOnWindowFocus: false,
  });

  const requirementSections = requirementData?.sections ?? [];

  const {
    data: faqData,
    isLoading: faqsLoading,
    isError: faqsError,
  } = useQuery({
    queryKey: ["admin-ballet-faqs", token],
    queryFn: () => adminFetch<{ faqs: BalletFaq[] }>(`${API}/api/admin/ballet/faqs`, {}, token),
    refetchOnWindowFocus: false,
  });

  const faqs = faqData?.faqs ?? [];

  useEffect(() => {
    if (data?.settings) {
      setHomeCardImageUrl(data.settings.homeCardImageUrl ?? "");
      setWhatsappNumber(data.settings.whatsappNumber ?? "");
      setPhoneNumber(data.settings.phoneNumber ?? "");
      setEmail(data.settings.email ?? "");
      setStudioLocationUrl(data.settings.studioLocationUrl ?? "");
      setDirty(false);
      setValidationMessage(null);
      setContactValidationMessage(null);
      setPreviewFailed(false);
    }
  }, [data]);

  const previewUrl = useMemo(() => {
    try {
      return normalizeHomeCardImageUrlInput(homeCardImageUrl);
    } catch {
      return null;
    }
  }, [homeCardImageUrl]);

  useEffect(() => {
    setPreviewFailed(false);
  }, [previewUrl]);

  useEffect(() => {
    const nextSectionDrafts: Record<number, SectionDraft> = {};
    const nextItemDrafts: Record<number, ItemDraft> = {};
    for (const section of requirementSections) {
      nextSectionDrafts[section.id] = {
        title: section.title,
        description: section.description ?? "",
        sortOrder: String(section.sortOrder),
      };
      for (const item of section.items) {
        nextItemDrafts[item.id] = {
          text: item.text,
          sortOrder: String(item.sortOrder),
        };
      }
    }
    setSectionDrafts(nextSectionDrafts);
    setItemDrafts(nextItemDrafts);
  }, [requirementData]);

  useEffect(() => {
    const nextFaqDrafts: Record<number, FaqDraft> = {};
    for (const faq of faqs) {
      nextFaqDrafts[faq.id] = {
        question: faq.question,
        answer: faq.answer,
        sortOrder: String(faq.sortOrder),
      };
    }
    setFaqDrafts(nextFaqDrafts);
  }, [faqData]);

  const saveMutation = useMutation({
    mutationFn: (body: {
      homeCardImageUrl: string | null;
      whatsappNumber: string | null;
      phoneNumber: string | null;
      email: string | null;
      studioLocationUrl: string | null;
    }) =>
      adminFetch<{ settings: Settings }>(
        `${API}/api/admin/ballet/settings`,
        { method: "PATCH", body: JSON.stringify(body) },
        token,
      ),
    onSuccess: (result) => {
      qc.setQueryData(["admin-ballet-settings", token], result);
      qc.invalidateQueries({ queryKey: ["admin-ballet-settings"] });
      toast({ title: "Settings saved" });
      setHomeCardImageUrl(result.settings.homeCardImageUrl ?? "");
      setWhatsappNumber(result.settings.whatsappNumber ?? "");
      setPhoneNumber(result.settings.phoneNumber ?? "");
      setEmail(result.settings.email ?? "");
      setStudioLocationUrl(result.settings.studioLocationUrl ?? "");
      setDirty(false);
      setValidationMessage(null);
      setContactValidationMessage(null);
      setPreviewFailed(false);
    },
    onError: (e: any) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to save settings", variant: "destructive" }),
  });

  const invalidateRequirements = () => qc.invalidateQueries({ queryKey: ["admin-ballet-program-requirements"] });

  const createSectionMutation = useMutation({
    mutationFn: (body: object) =>
      adminFetch(`${API}/api/admin/ballet/program-requirement-sections`, { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      invalidateRequirements();
      setNewSection(EMPTY_SECTION_DRAFT);
      toast({ title: "Requirement section created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to create section", variant: "destructive" }),
  });

  const updateSectionMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      adminFetch(`${API}/api/admin/ballet/program-requirement-sections/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      invalidateRequirements();
      toast({ title: "Requirement section updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update section", variant: "destructive" }),
  });

  const createItemMutation = useMutation({
    mutationFn: (body: object) =>
      adminFetch(`${API}/api/admin/ballet/program-requirement-items`, { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: (_result, body: any) => {
      invalidateRequirements();
      setNewItemTextBySection((prev) => ({ ...prev, [body.sectionId]: "" }));
      toast({ title: "Requirement item added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to add item", variant: "destructive" }),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      adminFetch(`${API}/api/admin/ballet/program-requirement-items/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      invalidateRequirements();
      toast({ title: "Requirement item updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update item", variant: "destructive" }),
  });

  const invalidateFaqs = () => qc.invalidateQueries({ queryKey: ["admin-ballet-faqs"] });

  const createFaqMutation = useMutation({
    mutationFn: (body: object) =>
      adminFetch(`${API}/api/admin/ballet/faqs`, { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      invalidateFaqs();
      setNewFaq(EMPTY_FAQ_DRAFT);
      toast({ title: "FAQ created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to create FAQ", variant: "destructive" }),
  });

  const updateFaqMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      adminFetch(`${API}/api/admin/ballet/faqs/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      invalidateFaqs();
      toast({ title: "FAQ updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update FAQ", variant: "destructive" }),
  });

  function update(value: string) {
    setHomeCardImageUrl(value);
    setDirty(true);
    setValidationMessage(null);
  }

  function updateContact(field: "whatsappNumber" | "phoneNumber" | "email" | "studioLocationUrl", value: string) {
    if (field === "whatsappNumber") setWhatsappNumber(value);
    if (field === "phoneNumber") setPhoneNumber(value);
    if (field === "email") setEmail(value);
    if (field === "studioLocationUrl") setStudioLocationUrl(value);
    setDirty(true);
    setContactValidationMessage(null);
  }

  function clearImage() {
    setHomeCardImageUrl("");
    setDirty(true);
    setValidationMessage(null);
    setPreviewFailed(false);
  }

  function handleSave() {
    try {
      const normalized = normalizeHomeCardImageUrlInput(homeCardImageUrl);
      const normalizedWhatsapp = normalizePhoneInput(whatsappNumber, "WhatsApp number");
      const normalizedPhone = normalizePhoneInput(phoneNumber, "Phone number");
      const normalizedEmail = normalizeEmailInput(email);
      const normalizedLocation = normalizeHttpsUrlInput(studioLocationUrl, "Studio location link");
      setValidationMessage(null);
      setContactValidationMessage(null);
      saveMutation.mutate({
        homeCardImageUrl: normalized,
        whatsappNumber: normalizedWhatsapp,
        phoneNumber: normalizedPhone,
        email: normalizedEmail,
        studioLocationUrl: normalizedLocation,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid settings value.";
      if (message.includes("image")) setValidationMessage(message);
      else setContactValidationMessage(message);
    }
  }

  function parseSortOrder(value: string): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

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

  function saveSection(section: RequirementSection) {
    const draft = sectionDrafts[section.id];
    if (!draft?.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    updateSectionMutation.mutate({
      id: section.id,
      body: {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        sortOrder: parseSortOrder(draft.sortOrder),
      },
    });
  }

  function addItem(section: RequirementSection) {
    const text = newItemTextBySection[section.id]?.trim();
    if (!text) {
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
      body: {
        text: draft.text.trim(),
        sortOrder: parseSortOrder(draft.sortOrder),
      },
    });
  }

  function createFaq() {
    const question = newFaq.question.trim();
    const answer = newFaq.answer.trim();
    if (!question || !answer) {
      toast({ title: "Question and answer are required", variant: "destructive" });
      return;
    }
    createFaqMutation.mutate({
      question,
      answer,
      sortOrder: parseSortOrder(newFaq.sortOrder),
      isActive: true,
    });
  }

  function saveFaq(faq: BalletFaq) {
    const draft = faqDrafts[faq.id];
    if (!draft?.question.trim() || !draft?.answer.trim()) {
      toast({ title: "Question and answer are required", variant: "destructive" });
      return;
    }
    updateFaqMutation.mutate({
      id: faq.id,
      body: {
        question: draft.question.trim(),
        answer: draft.answer.trim(),
        sortOrder: parseSortOrder(draft.sortOrder),
      },
    });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">Ballet General Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure the Ballet Home card image shown in the mobile app.
          </p>
        </div>
        {canEdit && dirty && (
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="bg-[#00B6D6] hover:bg-[#0097B2] text-white gap-2"
          >
            {saveMutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Save className="h-4 w-4" />}
            Save Changes
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[#00B6D6]" />
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm">Failed to load settings. Please refresh.</span>
        </div>
      )}

      {!isLoading && !isError && (
        <fieldset disabled={!canEdit} className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-foreground">Ballet Home Card Background Image</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Use a public HTTPS image URL or a public Google Drive sharing link.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Image URL</Label>
              <div className="flex gap-2">
                <Input
                  type="url"
                  value={homeCardImageUrl}
                  onChange={(e) => update(e.target.value)}
                  placeholder="https://example.com/ballet-card.jpg or https://drive.google.com/file/d/..."
                  className="bg-background text-foreground"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={clearImage}
                  disabled={!homeCardImageUrl.trim() || saveMutation.isPending}
                  className="gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear
                </Button>
              </div>
              {validationMessage && (
                <p className="text-xs text-red-400">{validationMessage}</p>
              )}
              {!validationMessage && previewUrl && previewUrl !== homeCardImageUrl.trim() && (
                <p className="text-xs text-muted-foreground">Google Drive link will be saved as: {previewUrl}</p>
              )}
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-background">
              {previewUrl && !previewFailed ? (
                <img
                  src={previewUrl}
                  alt="Ballet Home card preview"
                  className="h-56 w-full object-cover"
                  onError={() => setPreviewFailed(true)}
                />
              ) : (
                <div className="flex h-56 flex-col items-center justify-center gap-2 text-muted-foreground">
                  <ImageIcon className="h-8 w-8" />
                  <span className="text-sm">
                    {homeCardImageUrl.trim() && previewFailed
                      ? "Preview failed. Check that the image is public."
                      : "No image configured. Mobile will use the bundled fallback."}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-foreground">Ballet Contact Information</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Configure the contact actions shown on the mobile Ballet Contact page.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase tracking-wide">WhatsApp Number</Label>
                <Input
                  value={whatsappNumber}
                  onChange={(e) => updateContact("whatsappNumber", e.target.value)}
                  placeholder="+201123456789"
                  className="bg-background text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase tracking-wide">Phone Number</Label>
                <Input
                  value={phoneNumber}
                  onChange={(e) => updateContact("phoneNumber", e.target.value)}
                  placeholder="+201123456789"
                  className="bg-background text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase tracking-wide">Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => updateContact("email", e.target.value)}
                  placeholder="ballet@centralstudio.eg"
                  className="bg-background text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase tracking-wide">Studio Location Link</Label>
                <Input
                  type="url"
                  value={studioLocationUrl}
                  onChange={(e) => updateContact("studioLocationUrl", e.target.value)}
                  placeholder="https://maps.google.com/?q=Central+Studio"
                  className="bg-background text-foreground"
                />
              </div>
            </div>

            {contactValidationMessage && (
              <p className="text-xs text-red-400">{contactValidationMessage}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Phone numbers are saved in compact international format where possible. Location links must use HTTPS.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-foreground">Ballet Program Requirements</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Manage the sections and ordered requirement items shown on the mobile Ballet Requirements page.
              </p>
            </div>

            {requirementsLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-[#00B6D6]" />
              </div>
            )}

            {requirementsError && (
              <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-400">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span className="text-sm">Failed to load program requirements. Please refresh.</span>
              </div>
            )}

            {!requirementsLoading && !requirementsError && (
              <div className="space-y-5">
                <div className="rounded-lg border border-border bg-background p-4 space-y-3">
                  <div className="grid gap-3 md:grid-cols-[1fr_120px]">
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground text-xs uppercase tracking-wide">New Section Title</Label>
                      <Input
                        value={newSection.title}
                        onChange={(e) => setNewSection((prev) => ({ ...prev, title: e.target.value }))}
                        placeholder="Dress Code"
                        className="bg-card text-foreground"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground text-xs uppercase tracking-wide">Order</Label>
                      <Input
                        type="number"
                        value={newSection.sortOrder}
                        onChange={(e) => setNewSection((prev) => ({ ...prev, sortOrder: e.target.value }))}
                        className="bg-card text-foreground"
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
                      className="bg-card text-foreground"
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
                </div>

                {requirementSections.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-background px-4 py-10 text-center text-sm text-muted-foreground">
                    No Ballet program requirement sections yet.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {requirementSections.map((section) => {
                      const sectionDraft = sectionDrafts[section.id] ?? {
                        title: section.title,
                        description: section.description ?? "",
                        sortOrder: String(section.sortOrder),
                      };
                      const newItemText = newItemTextBySection[section.id] ?? "";

                      return (
                        <div key={section.id} className="rounded-lg border border-border bg-background p-4 space-y-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-semibold text-foreground">{section.title}</h3>
                                <Badge variant={section.isActive ? "default" : "secondary"}>
                                  {section.isActive ? "Active" : "Inactive"}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">Section ID {section.id}</p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => updateSectionMutation.mutate({ id: section.id, body: { isActive: !section.isActive } })}
                              className={section.isActive ? "text-green-400 hover:text-green-300" : "text-muted-foreground hover:text-white"}
                            >
                              {section.isActive ? <ToggleRight className="h-4 w-4 mr-2" /> : <ToggleLeft className="h-4 w-4 mr-2" />}
                              {section.isActive ? "Deactivate" : "Activate"}
                            </Button>
                          </div>

                          <div className="grid gap-3 md:grid-cols-[1fr_110px]">
                            <div className="space-y-1.5">
                              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Section Title</Label>
                              <Input
                                value={sectionDraft.title}
                                onChange={(e) => setSectionDrafts((prev) => ({ ...prev, [section.id]: { ...sectionDraft, title: e.target.value } }))}
                                className="bg-card text-foreground"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Order</Label>
                              <Input
                                type="number"
                                value={sectionDraft.sortOrder}
                                onChange={(e) => setSectionDrafts((prev) => ({ ...prev, [section.id]: { ...sectionDraft, sortOrder: e.target.value } }))}
                                className="bg-card text-foreground"
                              />
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <Label className="text-muted-foreground text-xs uppercase tracking-wide">Description</Label>
                            <Textarea
                              rows={2}
                              value={sectionDraft.description}
                              onChange={(e) => setSectionDrafts((prev) => ({ ...prev, [section.id]: { ...sectionDraft, description: e.target.value } }))}
                              className="bg-card text-foreground"
                            />
                          </div>

                          <div className="flex justify-end">
                            <Button type="button" variant="outline" size="sm" onClick={() => saveSection(section)} disabled={updateSectionMutation.isPending}>
                              Save Section
                            </Button>
                          </div>

                          <div className="space-y-3 border-t border-border pt-4">
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Items</Label>
                              <span className="text-xs text-muted-foreground">{section.items.length} total</span>
                            </div>

                            {section.items.length === 0 ? (
                              <p className="text-sm text-muted-foreground italic">No items in this section yet.</p>
                            ) : (
                              <div className="space-y-2">
                                {section.items.map((item) => {
                                  const itemDraft = itemDrafts[item.id] ?? { text: item.text, sortOrder: String(item.sortOrder) };
                                  return (
                                    <div key={item.id} className="rounded-md border border-border bg-card p-3 space-y-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <Badge variant={item.isActive ? "default" : "secondary"}>
                                          {item.isActive ? "Active" : "Inactive"}
                                        </Badge>
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
                                      </div>
                                      <div className="grid gap-2 md:grid-cols-[1fr_100px_auto]">
                                        <Textarea
                                          rows={2}
                                          value={itemDraft.text}
                                          onChange={(e) => setItemDrafts((prev) => ({ ...prev, [item.id]: { ...itemDraft, text: e.target.value } }))}
                                          className="bg-background text-foreground"
                                        />
                                        <Input
                                          type="number"
                                          value={itemDraft.sortOrder}
                                          onChange={(e) => setItemDrafts((prev) => ({ ...prev, [item.id]: { ...itemDraft, sortOrder: e.target.value } }))}
                                          className="bg-background text-foreground"
                                          aria-label="Item sort order"
                                        />
                                        <Button type="button" variant="outline" onClick={() => saveItem(item)} disabled={updateItemMutation.isPending}>
                                          Save
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                              <Textarea
                                rows={2}
                                value={newItemText}
                                onChange={(e) => setNewItemTextBySection((prev) => ({ ...prev, [section.id]: e.target.value }))}
                                placeholder="Add a new requirement item"
                                className="bg-card text-foreground"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => addItem(section)}
                                disabled={createItemMutation.isPending || !newItemText.trim()}
                                className="gap-2"
                              >
                                {createItemMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                Add Item
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-foreground">Ballet FAQ</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Manage the ordered FAQ questions shown on the mobile Ballet FAQ page.
              </p>
            </div>

            {faqsLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-[#00B6D6]" />
              </div>
            )}

            {faqsError && (
              <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-400">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span className="text-sm">Failed to load FAQs. Please refresh.</span>
              </div>
            )}

            {!faqsLoading && !faqsError && (
              <div className="space-y-5">
                <div className="rounded-lg border border-border bg-background p-4 space-y-3">
                  <div className="grid gap-3 md:grid-cols-[1fr_120px]">
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground text-xs uppercase tracking-wide">New Question</Label>
                      <Input
                        value={newFaq.question}
                        onChange={(e) => setNewFaq((prev) => ({ ...prev, question: e.target.value }))}
                        placeholder="What age can my child start?"
                        className="bg-card text-foreground"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground text-xs uppercase tracking-wide">Order</Label>
                      <Input
                        type="number"
                        value={newFaq.sortOrder}
                        onChange={(e) => setNewFaq((prev) => ({ ...prev, sortOrder: e.target.value }))}
                        className="bg-card text-foreground"
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
                      className="bg-card text-foreground"
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
                </div>

                {faqs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-background px-4 py-10 text-center text-sm text-muted-foreground">
                    No Ballet FAQs yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {faqs.map((faq) => {
                      const draft = faqDrafts[faq.id] ?? {
                        question: faq.question,
                        answer: faq.answer,
                        sortOrder: String(faq.sortOrder),
                      };
                      return (
                        <div key={faq.id} className="rounded-lg border border-border bg-background p-4 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={faq.isActive ? "default" : "secondary"}>
                                {faq.isActive ? "Active" : "Inactive"}
                              </Badge>
                              <span className="text-xs text-muted-foreground">FAQ ID {faq.id}</span>
                            </div>
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
                          </div>
                          <div className="grid gap-3 md:grid-cols-[1fr_110px]">
                            <div className="space-y-1.5">
                              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Question</Label>
                              <Input
                                value={draft.question}
                                onChange={(e) => setFaqDrafts((prev) => ({ ...prev, [faq.id]: { ...draft, question: e.target.value } }))}
                                className="bg-card text-foreground"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Order</Label>
                              <Input
                                type="number"
                                value={draft.sortOrder}
                                onChange={(e) => setFaqDrafts((prev) => ({ ...prev, [faq.id]: { ...draft, sortOrder: e.target.value } }))}
                                className="bg-card text-foreground"
                              />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-muted-foreground text-xs uppercase tracking-wide">Answer</Label>
                            <Textarea
                              rows={3}
                              value={draft.answer}
                              onChange={(e) => setFaqDrafts((prev) => ({ ...prev, [faq.id]: { ...draft, answer: e.target.value } }))}
                              className="bg-card text-foreground"
                            />
                          </div>
                          <div className="flex justify-end">
                            <Button type="button" variant="outline" size="sm" onClick={() => saveFaq(faq)} disabled={updateFaqMutation.isPending}>
                              Save FAQ
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {canEdit && dirty && (
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="bg-[#00B6D6] hover:bg-[#0097B2] text-white gap-2"
              >
                {saveMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Save className="h-4 w-4" />}
                Save Changes
              </Button>
            </div>
          )}

          {data?.settings.updatedAt && (
            <p className="text-xs text-muted-foreground text-right">
              Last updated: {new Date(data.settings.updatedAt).toLocaleString()}
            </p>
          )}
        </fieldset>
      )}
    </div>
  );
}
