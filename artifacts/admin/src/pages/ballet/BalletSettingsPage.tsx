/**
 * Ballet → Pricing & Settings
 *
 * Displays and edits admin-managed ballet settings:
 *   - Pre-Ballet price (EGP) and monthly hours
 *   - Levels 1–9 price (EGP) and monthly hours
 *   - Few-seats threshold (controls when "few seats left" badge appears)
 *   - Assessment instructions (shown to parents on the mobile form)
 *   - Requirements (eligibility requirements)
 *   - Acceptance message template (sent when a child is accepted)
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertCircle, Save } from "lucide-react";
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface Settings {
  id: number;
  preBalletPriceEgp: number;
  preBalletHoursMonthly: number;
  levelsPriceEgp: number;
  levelsHoursMonthly: number;
  fewSeatsThreshold: number;
  assessmentInstructions: string | null;
  requirements: string | null;
  acceptanceMessageTemplate: string | null;
  updatedAt: string;
}

interface SettingsForm {
  preBalletPriceEgp: string;
  preBalletHoursMonthly: string;
  levelsPriceEgp: string;
  levelsHoursMonthly: string;
  fewSeatsThreshold: string;
  assessmentInstructions: string;
  requirements: string;
  acceptanceMessageTemplate: string;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BalletSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token } = useAdminAuth();

  const [form, setForm] = useState<SettingsForm>({
    preBalletPriceEgp: "",
    preBalletHoursMonthly: "",
    levelsPriceEgp: "",
    levelsHoursMonthly: "",
    fewSeatsThreshold: "",
    assessmentInstructions: "",
    requirements: "",
    acceptanceMessageTemplate: "",
  });
  const [dirty, setDirty] = useState(false);

  // ── Data ────────────────────────────────────────────────────────────────────

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ballet-settings", token],
    queryFn: () => adminFetch<{ settings: Settings }>(`${API}/api/admin/ballet/settings`, {}, token),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (data?.settings) {
      const s = data.settings;
      setForm({
        preBalletPriceEgp:          String(s.preBalletPriceEgp),
        preBalletHoursMonthly:      String(s.preBalletHoursMonthly),
        levelsPriceEgp:             String(s.levelsPriceEgp),
        levelsHoursMonthly:         String(s.levelsHoursMonthly),
        fewSeatsThreshold:          String(s.fewSeatsThreshold),
        assessmentInstructions:     s.assessmentInstructions ?? "",
        requirements:               s.requirements ?? "",
        acceptanceMessageTemplate:  s.acceptanceMessageTemplate ?? "",
      });
      setDirty(false);
    }
  }, [data]);

  // ── Mutation ─────────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: (body: object) =>
      adminFetch(`${API}/api/admin/ballet/settings`, { method: "PATCH", body: JSON.stringify(body) }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-ballet-settings"] });
      toast({ title: "Settings saved" });
      setDirty(false);
    },
    onError: (e: any) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to save settings", variant: "destructive" }),
  });

  function update(key: keyof SettingsForm, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  function handleSave() {
    const preBalletPriceEgp     = parseInt(form.preBalletPriceEgp, 10);
    const preBalletHoursMonthly = parseInt(form.preBalletHoursMonthly, 10);
    const levelsPriceEgp        = parseInt(form.levelsPriceEgp, 10);
    const levelsHoursMonthly    = parseInt(form.levelsHoursMonthly, 10);
    const fewSeatsThreshold     = parseInt(form.fewSeatsThreshold, 10);

    if ([preBalletPriceEgp, preBalletHoursMonthly, levelsPriceEgp, levelsHoursMonthly].some(isNaN)) {
      toast({ title: "Invalid", description: "Prices and hours must be positive numbers.", variant: "destructive" });
      return;
    }
    if (isNaN(fewSeatsThreshold) || fewSeatsThreshold < 1 || fewSeatsThreshold > 20) {
      toast({ title: "Invalid", description: "Few-seats threshold must be between 1 and 20.", variant: "destructive" });
      return;
    }

    saveMutation.mutate({
      preBalletPriceEgp,
      preBalletHoursMonthly,
      levelsPriceEgp,
      levelsHoursMonthly,
      fewSeatsThreshold,
      assessmentInstructions:    form.assessmentInstructions.trim() || null,
      requirements:              form.requirements.trim() || null,
      acceptanceMessageTemplate: form.acceptanceMessageTemplate.trim() || null,
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Ballet Pricing &amp; Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure pricing, monthly hours, and assessment instructions.
          </p>
        </div>
        {dirty && (
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="bg-[#8A5CFF] hover:bg-[#7A4CEF] text-white gap-2"
          >
            {saveMutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Save className="h-4 w-4" />}
            Save Changes
          </Button>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[#8A5CFF]" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm">Failed to load settings. Please refresh.</span>
        </div>
      )}

      {/* Form */}
      {!isLoading && !isError && (
        <div className="space-y-8">
          {/* Pricing */}
          <div className="rounded-lg border border-border bg-card p-6 space-y-5">
            <h2 className="text-base font-semibold text-white">Pricing</h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase tracking-wide">Pre-Ballet — Price (EGP)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.preBalletPriceEgp}
                  onChange={(e) => update("preBalletPriceEgp", e.target.value)}
                  className="bg-[#1A2535] border-border text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase tracking-wide">Pre-Ballet — Monthly Hours</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.preBalletHoursMonthly}
                  onChange={(e) => update("preBalletHoursMonthly", e.target.value)}
                  className="bg-[#1A2535] border-border text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase tracking-wide">Levels 1–9 — Price (EGP)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.levelsPriceEgp}
                  onChange={(e) => update("levelsPriceEgp", e.target.value)}
                  className="bg-[#1A2535] border-border text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase tracking-wide">Levels 1–9 — Monthly Hours</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.levelsHoursMonthly}
                  onChange={(e) => update("levelsHoursMonthly", e.target.value)}
                  className="bg-[#1A2535] border-border text-white"
                />
              </div>
            </div>
          </div>

          {/* Slot availability */}
          <div className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-base font-semibold text-white">Slot Availability</h2>
            <div className="space-y-1.5 max-w-xs">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">
                "Few Seats" Threshold
              </Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={form.fewSeatsThreshold}
                onChange={(e) => update("fewSeatsThreshold", e.target.value)}
                className="bg-[#1A2535] border-border text-white"
              />
              <p className="text-xs text-muted-foreground">
                Slots with ≤ this many available seats show an amber "few seats" warning on mobile.
              </p>
            </div>
          </div>

          {/* Assessment content */}
          <div className="rounded-lg border border-border bg-card p-6 space-y-5">
            <h2 className="text-base font-semibold text-white">Assessment Content</h2>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Assessment Instructions</Label>
              <Textarea
                value={form.assessmentInstructions}
                onChange={(e) => update("assessmentInstructions", e.target.value)}
                placeholder="Instructions shown to parents before they book an assessment slot…"
                rows={4}
                className="bg-[#1A2535] border-border text-white resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Eligibility Requirements</Label>
              <Textarea
                value={form.requirements}
                onChange={(e) => update("requirements", e.target.value)}
                placeholder="Age range, health requirements, attire, etc…"
                rows={3}
                className="bg-[#1A2535] border-border text-white resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Acceptance Message Template</Label>
              <Textarea
                value={form.acceptanceMessageTemplate}
                onChange={(e) => update("acceptanceMessageTemplate", e.target.value)}
                placeholder="Message sent to parents when their child is accepted…"
                rows={4}
                className="bg-[#1A2535] border-border text-white resize-none"
              />
            </div>
          </div>

          {/* Sticky save bar */}
          {dirty && (
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="bg-[#8A5CFF] hover:bg-[#7A4CEF] text-white gap-2"
              >
                {saveMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Save className="h-4 w-4" />}
                Save Changes
              </Button>
            </div>
          )}

          {/* Last updated */}
          {data?.settings.updatedAt && (
            <p className="text-xs text-muted-foreground text-right">
              Last updated: {new Date(data.settings.updatedAt).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
