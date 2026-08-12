/**
 * Ballet → General Settings → Home Card Background Image
 * (/ballet/settings/home-card)
 *
 * Focused, isolated editor extracted from the former single stacked
 * BalletSettingsPage.tsx. Functionality is unchanged — only the surrounding
 * page/URL is now dedicated to this one content area.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronLeft, Image as ImageIcon, Loader2, Save, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  adminFetch,
  balletApiUrl,
  BALLET_SETTINGS_QUERY_KEY,
  normalizeHomeCardImageUrlInput,
  type BalletSettings,
} from "./balletSettingsApi";

export default function BalletHomeCardPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token, can } = useAdminAuth();
  const [, navigate] = useLocation();
  const canEdit = can("ballet.settings", "edit");

  const [homeCardImageUrl, setHomeCardImageUrl] = useState("");
  const [dirty, setDirty] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: [BALLET_SETTINGS_QUERY_KEY, token],
    queryFn: () => adminFetch<{ settings: BalletSettings }>(balletApiUrl("/settings"), {}, token),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (data?.settings) {
      setHomeCardImageUrl(data.settings.homeCardImageUrl ?? "");
      setDirty(false);
      setValidationMessage(null);
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

  const saveMutation = useMutation({
    mutationFn: (homeCardImageUrl: string | null) =>
      adminFetch<{ settings: BalletSettings }>(
        balletApiUrl("/settings"),
        { method: "PATCH", body: JSON.stringify({ homeCardImageUrl }) },
        token,
      ),
    onSuccess: (result) => {
      qc.setQueryData([BALLET_SETTINGS_QUERY_KEY, token], result);
      qc.invalidateQueries({ queryKey: [BALLET_SETTINGS_QUERY_KEY] });
      toast({ title: "Home card image saved" });
      setHomeCardImageUrl(result.settings.homeCardImageUrl ?? "");
      setDirty(false);
      setValidationMessage(null);
      setPreviewFailed(false);
    },
    onError: (e: any) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to save image", variant: "destructive" }),
  });

  function update(value: string) {
    setHomeCardImageUrl(value);
    setDirty(true);
    setValidationMessage(null);
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
      setValidationMessage(null);
      saveMutation.mutate(normalized);
    } catch (err) {
      setValidationMessage(err instanceof Error ? err.message : "Invalid image URL.");
    }
  }

  return (
    <div className="admin2-ballet-page admin2-ballet-settings space-y-6 max-w-2xl">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/ballet/settings")} className="-ml-2 text-muted-foreground">
          <ChevronLeft className="mr-1 h-4 w-4" /> Back to General Settings
        </Button>
      </div>

      <PageHeader
        title="Ballet Home Card Background Image"
        description="Use a public HTTPS image URL or a public Google Drive sharing link."
        mode="stage"
      >
        {canEdit && dirty && (
          <Button onClick={handleSave} disabled={saveMutation.isPending} className="bg-[#00B6D6] hover:bg-[#0097B2] text-white gap-2">
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Changes
          </Button>
        )}
      </PageHeader>

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
        <fieldset disabled={!canEdit} className="space-y-5 rounded-lg border border-border bg-card p-6">
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
            {validationMessage && <p className="text-xs text-red-400">{validationMessage}</p>}
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

          {canEdit && dirty && (
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saveMutation.isPending} className="bg-[#00B6D6] hover:bg-[#0097B2] text-white gap-2">
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
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
import "../admin2-ballet.css";
