/**
 * Ballet → Performance Opportunities — /ballet/performances
 *
 * Admin-managed events (recitals, galas, competitions) ballet students can
 * be invited to perform at.
 *
 * Uses the raw-fetch pattern established by the other Ballet admin pages
 * rather than the generated @workspace/api-client-react hooks.
 */

import { useState } from "react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Edit, Loader2 } from "lucide-react";

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
  eventType: string;
  locationName?: string | null;
  eventDate: string;
  startTime: string;
  endTime: string;
  requirements: string[];
}

interface ListResponse<T> { data: T[]; total: number; page: number; limit: number; totalPages: number; }

const formSchema = z.object({
  eventTitle: z.string().min(1, "Event title is required"),
  eventType: z.string().min(1, "Event type is required"),
  locationName: z.string().nullish(),
  eventDate: z.string().min(1, "Date is required"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  requirements: z.string().nullish(),
});

type FormValues = z.infer<typeof formSchema>;

const EMPTY_VALUES: FormValues = {
  eventTitle: "", eventType: "", locationName: "", eventDate: "",
  startTime: "", endTime: "", requirements: "",
};

export default function BalletPerformancesPage() {
  const { token, can } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canCreate = can("ballet.performances", "create");
  const canEdit = can("ballet.performances", "edit");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BalletPerformance | null>(null);

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
    setOpen(true);
  };

  const openEdit = (p: BalletPerformance) => {
    setEditing(p);
    form.reset({
      eventTitle: p.eventTitle,
      eventType: p.eventType,
      locationName: p.locationName ?? "",
      eventDate: p.eventDate,
      startTime: p.startTime,
      endTime: p.endTime,
      requirements: p.requirements?.join("\n") ?? "",
    });
    setOpen(true);
  };

  const nullIfEmpty = (v?: string | null) => (v?.trim() ? v.trim() : null);

  const onSubmit = (values: FormValues) => {
    const body = {
      ...values,
      locationName: nullIfEmpty(values.locationName),
      requirements: values.requirements?.split("\n").map((s) => s.trim()).filter(Boolean) ?? [],
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader title="Ballet Performance Opportunities" description="Recitals, galas, and competitions students can perform at" mode="stage" addLabel="Add Opportunity" addTestId="button-add-ballet-performance" onAdd={canCreate ? openCreate : undefined} />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
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
              <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : performances.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No performance opportunities yet.</TableCell></TableRow>
            ) : (
              performances.map((p) => (
                <TableRow key={p.id} data-testid={`row-ballet-performance-${p.id}`}>
                  <TableCell className="font-medium">{p.eventTitle}</TableCell>
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
              <FormField control={form.control} name="eventType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Event Type</FormLabel>
                  <FormControl><Input placeholder="Recital, Gala, Competition…" data-testid="input-ballet-performance-type" {...field} /></FormControl>
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
