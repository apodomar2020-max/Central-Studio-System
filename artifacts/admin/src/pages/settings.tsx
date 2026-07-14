/**
 * Admin → Settings
 *
 * Sections:
 *   - Class Pricing — manage the global regular-class single-session price.
 *   - Dance Types   — manage the canonical list of dance categories.
 *     Changes here propagate to the Classes page category dropdown and (via
 *     the mobile API) to the student-facing Classes screen.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, GripVertical, CheckCircle2, XCircle, Save, Music2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

// ─── API helpers ──────────────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface DanceType {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  iconUrl?: string | null;
  iconSvg?: string | null;
  iconMime?: string | null;
  coverImageUrl?: string | null;
  color?: string | null;
  hasIconSvg?: boolean;
  iconSvgUrl?: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface ClassPricingSettings {
  id: number;
  singleClassPriceEgp: number;
  createdAt: string;
  updatedAt: string;
}

interface BackgroundMusicSettings {
  enabled: boolean;
  sourceUrl: string | null;
  sourceTitle: string | null;
  volume: number;
  loop: boolean;
  version: number;
  updatedAt: string;
}

interface BackgroundMusicTestResult {
  sourceUrl: string;
  sourceTitle: string | null;
  sourceType: "google_drive" | "direct";
  contentType: string | null;
  contentLength: number | null;
}

// ─── Form schema ──────────────────────────────────────────────────────────────

const danceTypeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().max(2000).optional().or(z.literal("")),
  color: z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex color, e.g. #00B6D7")
    .optional()
    .or(z.literal("")),
  iconUrl: z.string().max(2000).optional().or(z.literal("")),
  coverImageUrl: z.string().max(2000).optional().or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});
type DanceTypeForm = z.input<typeof danceTypeSchema>;

const classPricingSchema = z.object({
  singleClassPriceEgp: z.coerce.number().int().min(0, "Price must be 0 or greater"),
});
type ClassPricingForm = z.input<typeof classPricingSchema>;

const backgroundMusicSchema = z.object({
  enabled: z.boolean().default(false),
  sourceUrl: z.string().max(4000).optional().or(z.literal("")),
  sourceTitle: z.string().max(200).optional().or(z.literal("")),
  volume: z.coerce.number().min(0, "Volume must be between 0 and 1").max(1, "Volume must be between 0 and 1"),
  loop: z.boolean().default(true),
});
type BackgroundMusicForm = z.input<typeof backgroundMusicSchema>;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { token, can } = useAdminAuth();
  const canEdit = can("settings", "edit");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DanceType | null>(null);
  // Pending uploaded SVG (file text) + flag to clear an existing stored SVG.
  const [iconSvgText, setIconSvgText] = useState<string | null>(null);
  const [iconCleared, setIconCleared] = useState(false);
  const [iconFileName, setIconFileName] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: danceTypes, isLoading } = useQuery<DanceType[]>({
    queryKey: ["admin-dance-types"],
    queryFn: () =>
      adminFetch<DanceType[]>(
        `${API}/api/admin/settings/dance-types`,
        { method: "GET" },
        token,
      ),
  });

  const { data: classPricing, isLoading: isLoadingClassPricing } = useQuery<ClassPricingSettings>({
    queryKey: ["admin-class-pricing"],
    queryFn: () =>
      adminFetch<ClassPricingSettings>(
        `${API}/api/admin/settings/class-pricing`,
        { method: "GET" },
        token,
      ),
  });

  const { data: backgroundMusic, isLoading: isLoadingBackgroundMusic } = useQuery<BackgroundMusicSettings>({
    queryKey: ["admin-background-music"],
    queryFn: () =>
      adminFetch<BackgroundMusicSettings>(
        `${API}/api/admin/settings/background-music`,
        { method: "GET" },
        token,
      ),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-dance-types"] });
  const invalidateClassPricing = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-class-pricing"] });
  const invalidateBackgroundMusic = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-background-music"] });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data: DanceTypeForm) =>
      adminFetch<DanceType>(
        `${API}/api/admin/settings/dance-types`,
        { method: "POST", body: JSON.stringify(data) },
        token,
      ),
    onSuccess: () => { invalidate(); setOpen(false); toast({ title: "Dance type created" }); },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to create", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<DanceTypeForm> }) =>
      adminFetch<DanceType>(
        `${API}/api/admin/settings/dance-types/${id}`,
        { method: "PATCH", body: JSON.stringify(data) },
        token,
      ),
    onSuccess: () => { invalidate(); setOpen(false); toast({ title: "Dance type updated" }); },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to update", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      adminFetch<{ success: boolean }>(
        `${API}/api/admin/settings/dance-types/${id}`,
        { method: "DELETE" },
        token,
      ),
    onSuccess: () => { invalidate(); toast({ title: "Dance type deactivated" }); },
    onError: () =>
      toast({ title: "Error", description: "Failed to deactivate", variant: "destructive" }),
  });

  const updateClassPricingMutation = useMutation({
    mutationFn: (data: ClassPricingForm) =>
      adminFetch<ClassPricingSettings>(
        `${API}/api/admin/settings/class-pricing`,
        { method: "PATCH", body: JSON.stringify(data) },
        token,
      ),
    onSuccess: () => {
      invalidateClassPricing();
      toast({ title: "Class pricing updated" });
    },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to save class pricing", variant: "destructive" }),
  });

  const testBackgroundMusicMutation = useMutation({
    mutationFn: (data: Pick<BackgroundMusicForm, "sourceUrl" | "sourceTitle">) =>
      adminFetch<BackgroundMusicTestResult>(
        `${API}/api/admin/settings/background-music/test`,
        { method: "POST", body: JSON.stringify(data) },
        token,
      ),
    onSuccess: (result) => {
      setPreviewUrl(result.sourceUrl);
      toast({ title: "Music URL validated", description: result.contentType ?? result.sourceType });
    },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Music URL rejected", description: e?.data?.error ?? "Could not validate this URL", variant: "destructive" }),
  });

  const updateBackgroundMusicMutation = useMutation({
    mutationFn: (data: BackgroundMusicForm) =>
      adminFetch<BackgroundMusicSettings>(
        `${API}/api/admin/settings/background-music`,
        {
          method: "PATCH",
          body: JSON.stringify({
            enabled: data.enabled,
            sourceUrl: data.sourceUrl?.trim() || undefined,
            sourceTitle: data.sourceTitle?.trim() || null,
            volume: data.volume,
            loop: data.loop,
          }),
        },
        token,
      ),
    onSuccess: (settings) => {
      invalidateBackgroundMusic();
      setPreviewUrl(settings.sourceUrl);
      toast({ title: "Background music updated", description: `Revision ${settings.version}` });
    },
    onError: (e: { data?: { error?: string } }) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to save background music", variant: "destructive" }),
  });

  // ── Form ──────────────────────────────────────────────────────────────────
  const form = useForm<DanceTypeForm>({
    resolver: zodResolver(danceTypeSchema),
    defaultValues: { name: "", description: "", color: "", iconUrl: "", coverImageUrl: "", sortOrder: 0, isActive: true },
  });

  const classPricingForm = useForm<ClassPricingForm>({
    resolver: zodResolver(classPricingSchema),
    values: { singleClassPriceEgp: classPricing?.singleClassPriceEgp ?? 300 },
  });

  const backgroundMusicForm = useForm<BackgroundMusicForm>({
    resolver: zodResolver(backgroundMusicSchema),
    values: {
      enabled: backgroundMusic?.enabled ?? false,
      sourceUrl: backgroundMusic?.sourceUrl ?? "",
      sourceTitle: backgroundMusic?.sourceTitle ?? "",
      volume: backgroundMusic?.volume ?? 0.25,
      loop: backgroundMusic?.loop ?? true,
    },
  });

  useEffect(() => {
    return () => {
      previewAudioRef.current?.pause();
      previewAudioRef.current = null;
    };
  }, []);

  const resetIconState = () => { setIconSvgText(null); setIconCleared(false); setIconFileName(""); };

  const openCreate = () => {
    setEditing(null);
    resetIconState();
    form.reset({ name: "", description: "", color: "", iconUrl: "", coverImageUrl: "", sortOrder: (danceTypes?.length ?? 0) + 1, isActive: true });
    setOpen(true);
  };

  const openEdit = (dt: DanceType) => {
    setEditing(dt);
    resetIconState();
    form.reset({
      name: dt.name,
      description: dt.description ?? "",
      color: dt.color ?? "",
      iconUrl: dt.iconUrl ?? "",
      coverImageUrl: dt.coverImageUrl ?? "",
      sortOrder: dt.sortOrder,
      isActive: dt.isActive,
    });
    setOpen(true);
  };

  /** Persist a pending SVG upload / clear for the saved record id. */
  const saveIconFor = async (id: number) => {
    if (iconSvgText) {
      await adminFetch<DanceType>(
        `${API}/api/admin/settings/dance-types/${id}/icon`,
        { method: "POST", body: JSON.stringify({ svg: iconSvgText }) },
        token,
      );
    } else if (iconCleared && editing?.hasIconSvg) {
      await adminFetch<DanceType>(
        `${API}/api/admin/settings/dance-types/${id}/icon`,
        { method: "DELETE" },
        token,
      );
    }
  };

  const onSubmit = async (values: DanceTypeForm) => {
    // Normalize empty strings to undefined so we don't overwrite with "".
    const payload = {
      ...values,
      description: values.description || undefined,
      color: values.color || undefined,
      iconUrl: values.iconUrl || undefined,
      coverImageUrl: values.coverImageUrl || undefined,
    };
    const saved = editing
      ? await updateMutation.mutateAsync({ id: editing.id, data: payload }).catch(() => null)
      : await createMutation.mutateAsync(payload).catch(() => null);
    if (!saved) return; // mutation's onError already surfaced the failure
    try {
      await saveIconFor(saved.id);
      resetIconState();
      invalidate();
    } catch (e: unknown) {
      const err = e as { data?: { error?: string } };
      toast({ title: "Icon not saved", description: err?.data?.error ?? "SVG was rejected", variant: "destructive" });
    }
  };

  const onIconFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    setIconSvgText(text);
    setIconCleared(false);
    setIconFileName(file.name);
  };

  const handleToggleActive = (dt: DanceType) => {
    updateMutation.mutate({ id: dt.id, data: { isActive: !dt.isActive } });
  };

  const handleDelete = (id: number) => {
    if (confirm("Deactivate this dance type? It will no longer appear in the Classes dropdown.")) {
      deleteMutation.mutate(id);
    }
  };

  const onClassPricingSubmit = (values: ClassPricingForm) => {
    updateClassPricingMutation.mutate(values);
  };

  const onBackgroundMusicSubmit = (values: BackgroundMusicForm) => {
    updateBackgroundMusicMutation.mutate(values);
  };

  const stopPreview = () => {
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    setIsPreviewPlaying(false);
  };

  const testPreview = async () => {
    const values = backgroundMusicForm.getValues();
    if (!values.sourceUrl?.trim()) {
      toast({ title: "Music URL required", description: "Add a public HTTPS audio URL first.", variant: "destructive" });
      return;
    }
    stopPreview();
    const result = await testBackgroundMusicMutation.mutateAsync({
      sourceUrl: values.sourceUrl,
      sourceTitle: values.sourceTitle,
    }).catch(() => null);
    if (!result) return;
    const audio = new Audio(result.sourceUrl);
    audio.volume = Math.max(0, Math.min(1, Number(values.volume ?? 0.25)));
    audio.loop = Boolean(values.loop);
    audio.addEventListener("ended", () => setIsPreviewPlaying(false), { once: true });
    previewAudioRef.current = audio;
    try {
      await audio.play();
      setIsPreviewPlaying(true);
    } catch {
      setIsPreviewPlaying(false);
      toast({ title: "Preview blocked", description: "The browser could not start playback. Try again after interacting with the page.", variant: "destructive" });
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Manage studio-wide configuration"
        mode="studio"
        addLabel="Add Dance Type"
        addTestId="button-add-dance-type"
        onAdd={canEdit ? openCreate : undefined}
      />

      {/* ── Class Pricing section ───────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Class Pricing</h2>
          <p className="text-sm text-muted-foreground">
            Global single-session price for regular studio classes. Package pricing remains managed separately.
          </p>
        </div>

        <div className="border rounded-md p-4">
          <Form {...classPricingForm}>
            <form onSubmit={classPricingForm.handleSubmit(onClassPricingSubmit)} className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <FormField
                control={classPricingForm.control}
                name="singleClassPriceEgp"
                render={({ field }) => (
                  <FormItem className="sm:w-72">
                    <FormLabel>Single Class Price (EGP)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        data-testid="input-single-class-price"
                        disabled={isLoadingClassPricing || !canEdit}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {canEdit && <Button
                type="submit"
                data-testid="button-save-class-pricing"
                disabled={isLoadingClassPricing || updateClassPricingMutation.isPending}
              >
                <Save className="h-4 w-4 mr-2" />
                Save Pricing
              </Button>}
            </form>
          </Form>
          {classPricing?.updatedAt && (
            <p className="text-xs text-muted-foreground mt-3">
              Last updated: {new Date(classPricing.updatedAt).toLocaleString()}
            </p>
          )}
        </div>
      </section>

      {/* ── Background Music section ───────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Background Music</h2>
          <p className="text-sm text-muted-foreground">
            Remotely manage the low-volume soundtrack used by the Central Studio mobile app.
          </p>
        </div>

        <div className="border rounded-md p-4">
          <Form {...backgroundMusicForm}>
            <form onSubmit={backgroundMusicForm.handleSubmit(onBackgroundMusicSubmit)} className="space-y-5">
              <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                <FormField
                  control={backgroundMusicForm.control}
                  name="sourceUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Public HTTPS Audio URL</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://drive.google.com/file/d/..."
                          disabled={isLoadingBackgroundMusic || !canEdit}
                          data-testid="input-background-music-url"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={backgroundMusicForm.control}
                  name="sourceTitle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display Title</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Optional"
                          disabled={isLoadingBackgroundMusic || !canEdit}
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-5 md:grid-cols-3">
                <FormField
                  control={backgroundMusicForm.control}
                  name="enabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3 rounded-md border p-3">
                      <div>
                        <FormLabel className="!mt-0">Enabled</FormLabel>
                        <p className="text-xs text-muted-foreground">Global mobile playback</p>
                      </div>
                      <FormControl>
                        <Switch disabled={!canEdit} checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={backgroundMusicForm.control}
                  name="loop"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3 rounded-md border p-3">
                      <div>
                        <FormLabel className="!mt-0">Loop</FormLabel>
                        <p className="text-xs text-muted-foreground">Repeat continuously</p>
                      </div>
                      <FormControl>
                        <Switch disabled={!canEdit} checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <div className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <Label>Revision</Label>
                    <Badge variant="outline">{backgroundMusic?.version ?? 1}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {backgroundMusic?.updatedAt ? new Date(backgroundMusic.updatedAt).toLocaleString() : "Not saved yet"}
                  </p>
                </div>
              </div>

              <FormField
                control={backgroundMusicForm.control}
                name="volume"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Volume</FormLabel>
                      <span className="text-sm text-muted-foreground">{Math.round(Number(field.value ?? 0.25) * 100)}%</span>
                    </div>
                    <FormControl>
                      <Slider
                        value={[Number(field.value ?? 0.25)]}
                        min={0}
                        max={1}
                        step={0.01}
                        disabled={!canEdit}
                        onValueChange={(value) => field.onChange(value[0] ?? 0.25)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex flex-wrap items-center gap-2">
                {canEdit && (
                  <Button
                    type="submit"
                    data-testid="button-save-background-music"
                    disabled={isLoadingBackgroundMusic || updateBackgroundMusicMutation.isPending}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Save Music
                  </Button>
                )}
                {canEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { void testPreview(); }}
                    disabled={testBackgroundMusicMutation.isPending}
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Test Preview
                  </Button>
                )}
                {isPreviewPlaying && (
                  <Button type="button" variant="secondary" onClick={stopPreview}>
                    <Square className="h-4 w-4 mr-2" />
                    Stop Preview
                  </Button>
                )}
                {previewUrl && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Music2 className="h-3.5 w-3.5" />
                    Preview uses the normalized mobile URL
                  </span>
                )}
              </div>
            </form>
          </Form>
        </div>
      </section>

      {/* ── Dance Types section ──────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Dance Types</h2>
          <p className="text-sm text-muted-foreground">
            The category list used in the Classes form and the student-facing app.
            Active types appear in dropdowns; inactive types are hidden but their
            existing classes are unaffected.
          </p>
        </div>

        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">Loading…</TableCell>
                </TableRow>
              ) : !danceTypes?.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No dance types configured. Add one above to populate the Classes dropdown.
                  </TableCell>
                </TableRow>
              ) : (
                [...danceTypes]
                  .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
                  .map((dt) => (
                    <TableRow key={dt.id} data-testid={`row-dance-type-${dt.id}`}>
                      <TableCell className="text-muted-foreground">
                        <GripVertical className="h-4 w-4" />
                      </TableCell>
                      <TableCell className="font-medium">{dt.name}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{dt.slug}</TableCell>
                      <TableCell>{dt.sortOrder}</TableCell>
                      <TableCell>
                        {dt.isActive ? (
                          <Badge variant="default" className="flex w-fit items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="flex w-fit items-center gap-1 text-muted-foreground">
                            <XCircle className="h-3 w-3" /> Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {canEdit && <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(dt)}
                          data-testid={`button-toggle-dance-type-${dt.id}`}
                        >
                          {dt.isActive ? "Deactivate" : "Activate"}
                        </Button>}
                        {canEdit && <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(dt)}
                          data-testid={`button-edit-dance-type-${dt.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>}
                        {canEdit && <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(dt.id)}
                          data-testid={`button-delete-dance-type-${dt.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>}
                      </TableCell>
                    </TableRow>
                  ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ── Create / Edit dialog ─────────────────────────────────────────── */}
      <Dialog open={canEdit && open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Dance Type" : "Add Dance Type"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        data-testid="input-dance-type-name"
                        placeholder="e.g. Hip Hop"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Short description (optional)" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="color"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand Color</FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          aria-label="Brand color"
                          value={field.value || "#00B6D7"}
                          onChange={(e) => field.onChange(e.target.value)}
                          className="h-9 w-10 shrink-0 rounded border bg-transparent p-0"
                        />
                        <Input placeholder="#00B6D7" {...field} value={field.value ?? ""} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {/* Icon SVG upload + preview */}
              <FormItem>
                <Label>Icon (SVG)</Label>
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
                    {iconSvgText ? (
                      <img src={`data:image/svg+xml;utf8,${encodeURIComponent(iconSvgText)}`} alt="" className="h-8 w-8" />
                    ) : !iconCleared && editing?.iconSvg ? (
                      <img src={`data:image/svg+xml;utf8,${encodeURIComponent(editing.iconSvg)}`} alt="" className="h-8 w-8" />
                    ) : form.watch("iconUrl") ? (
                      <img src={form.watch("iconUrl") || ""} alt="" className="h-8 w-8 object-contain" />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">none</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Input
                      type="file"
                      accept=".svg,image/svg+xml"
                      onChange={(e) => onIconFile(e.target.files?.[0])}
                      className="text-xs"
                    />
                    {(iconFileName || (editing?.hasIconSvg && !iconCleared)) && (
                      <button
                        type="button"
                        onClick={() => { setIconSvgText(null); setIconFileName(""); setIconCleared(true); }}
                        className="self-start text-xs text-destructive"
                      >
                        Remove icon
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Sanitized &amp; stored on save. Falls back to Icon URL, then the first letter.</p>
              </FormItem>
              <FormField
                control={form.control}
                name="iconUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Icon URL (fallback)</FormLabel>
                    <FormControl>
                      <Input placeholder="https://… .svg or .png" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="coverImageUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cover Image URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://… (optional)" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sortOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sort Order</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        data-testid="input-dance-type-sort-order"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="!mt-0">Active</FormLabel>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  data-testid="button-submit-dance-type"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {editing ? "Save Changes" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
