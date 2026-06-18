import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Save } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

type FormState = {
  title: string;
  subtitle: string;
  content: string;
  isActive: boolean;
};

const PAGE_LABELS: Record<string, string> = {
  "help-support": "Help & Support",
  "privacy-policy": "Privacy & Policy",
  "terms-conditions": "Terms & Conditions",
};

export default function AppContentPage() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    title: "",
    subtitle: "",
    content: "",
    isActive: true,
  });

  const { data: pages = [], isLoading } = useQuery<AppContentPage[]>({
    queryKey: ["admin-app-content-pages", token],
    queryFn: () =>
      adminFetch<AppContentPage[]>(
        `${API}/api/admin/content/pages`,
        { method: "GET" },
        token,
      ),
  });

  const selectedPage = pages.find((page) => page.slug === selectedSlug) ?? pages[0] ?? null;

  useEffect(() => {
    if (!selectedSlug && pages.length > 0) {
      setSelectedSlug(pages[0].slug);
    }
  }, [pages, selectedSlug]);

  useEffect(() => {
    if (!selectedPage) return;
    setForm({
      title: selectedPage.title,
      subtitle: selectedPage.subtitle ?? "",
      content: selectedPage.content,
      isActive: selectedPage.isActive,
    });
  }, [selectedPage?.slug, selectedPage?.updatedAt]);

  const updateMutation = useMutation({
    mutationFn: (data: FormState) => {
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
      queryClient.invalidateQueries({ queryKey: ["admin-app-content-pages", token] });
      setSelectedSlug(updated.slug);
      toast({ title: "Content saved", description: `${updated.title} was updated.` });
    },
    onError: (e: { error?: string; message?: string }) => {
      toast({
        title: "Could not save content",
        description: e?.message ?? e?.error ?? "Please check the page content and try again.",
        variant: "destructive",
      });
    },
  });

  const canSave = form.title.trim().length > 0 && form.content.trim().length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="App Content"
        description="Manage the plain-text support and legal pages shown in the mobile app."
        mode="stage"
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <section className="rounded-md border">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Pages</h2>
            <p className="text-xs text-muted-foreground">Mobile app content source of truth</p>
          </div>
          <div className="p-2">
            {isLoading ? (
              <div className="px-3 py-8 text-sm text-muted-foreground">Loading pages...</div>
            ) : pages.length === 0 ? (
              <div className="px-3 py-8 text-sm text-muted-foreground">No content pages configured.</div>
            ) : (
              pages.map((page) => (
                <button
                  key={page.slug}
                  onClick={() => setSelectedSlug(page.slug)}
                  className="mb-1 flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-white/5"
                  style={{
                    background: selectedPage?.slug === page.slug ? "rgba(0, 182, 214, 0.10)" : undefined,
                    color: selectedPage?.slug === page.slug ? "#FFFFFF" : "#8A9AB0",
                  }}
                >
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    {PAGE_LABELS[page.slug] ?? page.title}
                  </span>
                  <Badge variant={page.isActive ? "default" : "outline"}>
                    {page.isActive ? "Active" : "Inactive"}
                  </Badge>
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
                  <h2 className="text-lg font-semibold text-white">{selectedPage.title}</h2>
                  <p className="font-mono text-xs text-muted-foreground">{selectedPage.slug}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="content-active" className="text-sm text-muted-foreground">Active</Label>
                  <Switch
                    id="content-active"
                    checked={form.isActive}
                    onCheckedChange={(isActive) => setForm((prev) => ({ ...prev, isActive }))}
                  />
                </div>
              </div>

              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="content-title">Title</Label>
                  <Input
                    id="content-title"
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="content-subtitle">Subtitle</Label>
                  <Input
                    id="content-subtitle"
                    value={form.subtitle}
                    onChange={(e) => setForm((prev) => ({ ...prev, subtitle: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="content-body">Content</Label>
                  <Textarea
                    id="content-body"
                    value={form.content}
                    onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
                    className="min-h-[420px] font-mono text-sm leading-6"
                  />
                  <p className="text-xs text-muted-foreground">
                    Plain text only. Line breaks are preserved in the mobile app.
                  </p>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => updateMutation.mutate(form)}
                  disabled={!canSave || updateMutation.isPending}
                  className="gap-2"
                >
                  <Save className="h-4 w-4" />
                  {updateMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>

            <aside className="rounded-md border p-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-white">Mobile Preview</h3>
                <p className="text-xs text-muted-foreground">Approximate plaintext rendering</p>
              </div>
              <div className="rounded-2xl border border-[#1E2E38] bg-[#050B0E] p-4">
                <div className="mb-4 rounded-xl border border-[#00B6D733] bg-[#00B6D715] p-3">
                  <p className="text-base font-bold text-white">{form.title || "Untitled"}</p>
                  {form.subtitle.trim() && (
                    <p className="mt-1 text-xs text-[#8A9AB0]">{form.subtitle}</p>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[#9CA3AF]">
                  {form.content || "No content yet."}
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
    </div>
  );
}
