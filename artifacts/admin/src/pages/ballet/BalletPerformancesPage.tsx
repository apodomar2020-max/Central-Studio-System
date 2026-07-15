/**
 * Ballet → Performance Opportunities — /ballet/performances
 *
 * Admin-managed events (recitals, galas, competitions) ballet students can
 * be invited to perform at.
 *
 * Uses the raw-fetch pattern established by the other Ballet admin pages
 * rather than the generated @workspace/api-client-react hooks.
 */

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Edit, Image as ImageIcon, Loader2, Trash2 } from "lucide-react";
import { normalizeMediaUrl } from "@workspace/api-client-react";

// ─── API helpers ──────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY  = import.meta.env.VITE_API_KEY  as string | undefined ?? "";

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
    throw { data };
  }
  return res.json() as Promise<T>;
}

const CATALOG_LIMIT = 100;

// ─── Types ────────────────────────────────────────────────────────────────────

interface BalletPerformance {
  id: number;
  eventTitle: string;
  description?: string | null;
  imageUrl?: string | null;
  eventType: string;
  locationName?: string | null;
  eventDate: string;
  startTime: string;
  endTime: string;
  requirements: string[];
  externalCtaUrl?: string | null;
  status: "active" | "inactive";
}

interface ListResponse<T> { data: T[]; total: number; page: number; limit: number; totalPages: number; }

const formSchema = z.object({
  eventTitle: z.string().min(1, "Event title is required"),
  description: z.string().nullish(),
  imageUrl: z.string().nullish(),
  eventType: z.string().min(1, "Event type is required"),
  locationName: z.string().nullish(),
  eventDate: z.string().min(1, "Date is required"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  requirements: z.string().nullish(),
  externalCtaUrl: z.string().nullish(),
  status: z.enum(["active", "inactive"]),
});

type FormValues = z.infer<typeof formSchema>;

const EMPTY_VALUES: FormValues = {
  eventTitle: "",
  description: "",
  imageUrl: "",
  eventType: "",
  locationName: "",
  eventDate: "",
  startTime: "",
  endTime: "",
  requirements: "",
  externalCtaUrl: "",
  status: "active",
};

function normalizePerformanceImageUrlInput(value?: string | null): string | null {
  const trimmed = value?.trim();
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

function normalizeExternalCtaUrlInput(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid external CTA URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("External CTA URL must use HTTPS.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("External CTA URL must not include credentials.");
  }

  return parsed.toString();
}

export default function BalletPerformancesPage() {
  const { token, can } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canCreate = can("ballet.performances", "create");
  const canEdit = can("ballet.performances", "edit");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BalletPerformance | null>(null);
  const [imageValidationMessage, setImageValidationMessage] = useState<string | null>(null);
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-ballet-performances", token],
    queryFn: () => adminFetch<ListResponse<BalletPerformance>>(`${API_BASE}/api/admin/ballet/performances?limit=${CATALOG_LIMIT}`, {}, token),
    refetchOnWindowFocus: false,
  });
  const performances = data?.data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-ballet-performances"] });

  const createMutation = useMutation({
    mutationFn: (body: object) => adminFetch(`${API_BASE}/api/admin/ballet/performances`, { method: "POST", body: JSON.stringify(body) }, token),
    onSuccess: () => { invalidate(); toast({ title: "Performance opportunity created" }); setOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to create performance opportunity", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => adminFetch(`${API_BASE}/api/admin/ballet/performances/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => { invalidate(); toast({ title: "Performance opportunity updated" }); setOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Failed to update performance opportunity", variant: "destructive" }),
  });

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: EMPTY_VALUES });

  const openCreate = () => {
    setEditing(null);
    form.reset(EMPTY_VALUES);
    setImageValidationMessage(null);
    setImagePreviewFailed(false);
    setOpen(true);
  };

  const openEdit = (p: BalletPerformance) => {
    setEditing(p);
    form.reset({
      eventTitle: p.eventTitle,
      description: p.description ?? "",
      imageUrl: p.imageUrl ?? "",
      eventType: p.eventType,
      locationName: p.locationName ?? "",
      eventDate: p.eventDate,
      startTime: p.startTime,
      endTime: p.endTime,
      requirements: p.requirements?.join("\n") ?? "",
      externalCtaUrl: p.externalCtaUrl ?? "",
      status: p.status ?? "active",
    });
    setImageValidationMessage(null);
    setImagePreviewFailed(false);
    setOpen(true);
  };

  const nullIfEmpty = (v?: string | null) => (v?.trim() ? v.trim() : null);

  const onSubmit = (values: FormValues) => {
    let imageUrl: string | null = null;
    let externalCtaUrl: string | null = null;
    try {
      imageUrl = normalizePerformanceImageUrlInput(values.imageUrl);
      externalCtaUrl = normalizeExternalCtaUrlInput(values.externalCtaUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid URL.";
      toast({ title: "Invalid URL", description: message, variant: "destructive" });
      return;
    }

    const body = {
      ...values,
      description: nullIfEmpty(values.description),
      imageUrl,
      locationName: nullIfEmpty(values.locationName),
      requirements: values.requirements?.split("\n").map((s) => s.trim()).filter(Boolean) ?? [],
      externalCtaUrl,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const imageUrlInput = form.watch("imageUrl");
  const imagePreviewUrl = useMemo(() => {
    try {
      return normalizePerformanceImageUrlInput(imageUrlInput);
    } catch {
      return null;
    }
  }, [imageUrlInput]);

  return (
    <div className="space-y-6">
      <PageHeader title="Ballet Performance Opportunities" description="Recitals, galas, and competitions students can perform at" mode="stage" addLabel="Add Opportunity" addTestId="button-add-ballet-performance" onAdd={canCreate ? openCreate : undefined} />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Image</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Requirements</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : performances.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No performance opportunities yet.</TableCell></TableRow>
            ) : (
              performances.map((p) => (
                <TableRow key={p.id} data-testid={`row-ballet-performance-${p.id}`}>
                  <TableCell>
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" className="h-10 w-14 rounded-md object-cover border border-border bg-muted" />
                    ) : (
                      <div className="h-10 w-14 rounded-md border border-dashed border-border bg-muted/40 flex items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-4 w-4" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{p.eventTitle}</TableCell>
                  <TableCell>
                    <Badge variant={p.status === "active" ? "default" : "secondary"}>
                      {p.status === "active" ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>{p.eventType}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.locationName ?? "—"}</TableCell>
                  <TableCell>{p.eventDate}</TableCell>
                  <TableCell>{p.startTime} – {p.endTime}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap max-w-xs">
                      {p.requirements.slice(0, 2).map((r, i) => <Badge variant="secondary" key={i}>{r}</Badge>)}
                      {p.requirements.length > 2 && <Badge variant="outline">+{p.requirements.length - 2}</Badge>}
                      {p.requirements.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <Button variant="ghost" size="icon" data-testid={`button-edit-ballet-performance-${p.id}`} onClick={() => openEdit(p)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Performance Opportunity" : "Add Performance Opportunity"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="eventTitle" render={({ field }) => (
                <FormItem>
                  <FormLabel>Event Title</FormLabel>
                  <FormControl><Input data-testid="input-ballet-performance-title" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Textarea rows={3} placeholder="Short mobile card description" data-testid="input-ballet-performance-description" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? "active"}>
                    <FormControl><SelectTrigger data-testid="select-ballet-performance-status"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="imageUrl" render={({ field }) => (
                <FormItem>
                  <FormLabel>Image URL</FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input
                        placeholder="https://example.com/event.jpg or public Google Drive share link"
                        data-testid="input-ballet-performance-image"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) => {
                          field.onChange(e);
                          setImageValidationMessage(null);
                          setImagePreviewFailed(false);
                        }}
                        onBlur={() => {
                          field.onBlur();
                          try {
                            normalizePerformanceImageUrlInput(field.value);
                            setImageValidationMessage(null);
                          } catch (err) {
                            setImageValidationMessage(err instanceof Error ? err.message : "Invalid image URL.");
                          }
                        }}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={!field.value?.trim()}
                      onClick={() => {
                        form.setValue("imageUrl", "");
                        setImageValidationMessage(null);
                        setImagePreviewFailed(false);
                      }}
                      aria-label="Clear performance image"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Use a public HTTPS image URL or a public Google Drive sharing link.</p>
                  {imageValidationMessage && <p className="text-xs text-destructive">{imageValidationMessage}</p>}
                  {!imageValidationMessage && imagePreviewUrl && imagePreviewUrl !== field.value?.trim() && (
                    <p className="text-xs text-muted-foreground">Google Drive link will be saved as: {imagePreviewUrl}</p>
                  )}
                  <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
                    {imagePreviewUrl && !imagePreviewFailed ? (
                      <img
                        src={imagePreviewUrl}
                        alt="Performance preview"
                        className="h-32 w-full rounded-md object-cover"
                        onError={() => setImagePreviewFailed(true)}
                      />
                    ) : (
                      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                        {field.value?.trim() && imagePreviewFailed ? "Image preview failed." : "Image preview will appear here."}
                      </div>
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="eventType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Event Type</FormLabel>
                  <FormControl><Input placeholder="Recital, Gala, Competition…" data-testid="input-ballet-performance-type" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="externalCtaUrl" render={({ field }) => (
                <FormItem>
                  <FormLabel>External CTA URL</FormLabel>
                  <FormControl><Input type="url" placeholder="https://example.com/register" data-testid="input-ballet-performance-cta" {...field} value={field.value ?? ""} /></FormControl>
                  <p className="text-xs text-muted-foreground">Optional public HTTPS link for registration or event details.</p>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="locationName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Location</FormLabel>
                  <FormControl><Input data-testid="input-ballet-performance-location" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FormField control={form.control} name="eventDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl><Input type="date" data-testid="input-ballet-performance-date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="startTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Time</FormLabel>
                    <FormControl><Input type="time" data-testid="input-ballet-performance-start" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="endTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Time</FormLabel>
                    <FormControl><Input type="time" data-testid="input-ballet-performance-end" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="requirements" render={({ field }) => (
                <FormItem>
                  <FormLabel>Requirements (one per line)</FormLabel>
                  <FormControl><Textarea rows={4} placeholder={"Full costume\nHair in a bun\nArrive 30 minutes early"} data-testid="input-ballet-performance-requirements" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-ballet-performance" disabled={isSaving}>
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {editing ? "Save Changes" : "Create Opportunity"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
