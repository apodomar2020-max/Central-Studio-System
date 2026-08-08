/**
 * Ballet → General Settings → Contact Information (/ballet/settings/contact)
 *
 * Focused, isolated editor extracted from the former single stacked
 * BalletSettingsPage.tsx. Functionality is unchanged — only the surrounding
 * page/URL is now dedicated to this one content area. PATCH /admin/ballet/settings
 * is partial (each field is only updated when present in the body — see
 * adminBallet.ts), so saving here never touches the Home Card image field.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronLeft, Loader2, Save } from "lucide-react";
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
  normalizeEmailInput,
  normalizeHttpsUrlInput,
  normalizePhoneInput,
  type BalletSettings,
} from "./balletSettingsApi";

export default function BalletContactPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token, can } = useAdminAuth();
  const [, navigate] = useLocation();
  const canEdit = can("ballet.settings", "edit");

  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [studioLocationUrl, setStudioLocationUrl] = useState("");
  const [dirty, setDirty] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: [BALLET_SETTINGS_QUERY_KEY, token],
    queryFn: () => adminFetch<{ settings: BalletSettings }>(balletApiUrl("/settings"), {}, token),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (data?.settings) {
      setWhatsappNumber(data.settings.whatsappNumber ?? "");
      setPhoneNumber(data.settings.phoneNumber ?? "");
      setEmail(data.settings.email ?? "");
      setStudioLocationUrl(data.settings.studioLocationUrl ?? "");
      setDirty(false);
      setValidationMessage(null);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (body: {
      whatsappNumber: string | null;
      phoneNumber: string | null;
      email: string | null;
      studioLocationUrl: string | null;
    }) =>
      adminFetch<{ settings: BalletSettings }>(
        balletApiUrl("/settings"),
        { method: "PATCH", body: JSON.stringify(body) },
        token,
      ),
    onSuccess: (result) => {
      qc.setQueryData([BALLET_SETTINGS_QUERY_KEY, token], result);
      qc.invalidateQueries({ queryKey: [BALLET_SETTINGS_QUERY_KEY] });
      toast({ title: "Contact information saved" });
      setWhatsappNumber(result.settings.whatsappNumber ?? "");
      setPhoneNumber(result.settings.phoneNumber ?? "");
      setEmail(result.settings.email ?? "");
      setStudioLocationUrl(result.settings.studioLocationUrl ?? "");
      setDirty(false);
      setValidationMessage(null);
    },
    onError: (e: any) =>
      toast({ title: "Error", description: e?.data?.error ?? "Failed to save contact information", variant: "destructive" }),
  });

  function updateField(field: "whatsappNumber" | "phoneNumber" | "email" | "studioLocationUrl", value: string) {
    if (field === "whatsappNumber") setWhatsappNumber(value);
    if (field === "phoneNumber") setPhoneNumber(value);
    if (field === "email") setEmail(value);
    if (field === "studioLocationUrl") setStudioLocationUrl(value);
    setDirty(true);
    setValidationMessage(null);
  }

  function handleSave() {
    try {
      const normalizedWhatsapp = normalizePhoneInput(whatsappNumber, "WhatsApp number");
      const normalizedPhone = normalizePhoneInput(phoneNumber, "Phone number");
      const normalizedEmail = normalizeEmailInput(email);
      const normalizedLocation = normalizeHttpsUrlInput(studioLocationUrl, "Studio location link");
      setValidationMessage(null);
      saveMutation.mutate({
        whatsappNumber: normalizedWhatsapp,
        phoneNumber: normalizedPhone,
        email: normalizedEmail,
        studioLocationUrl: normalizedLocation,
      });
    } catch (err) {
      setValidationMessage(err instanceof Error ? err.message : "Invalid contact value.");
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/ballet/settings")} className="-ml-2 text-muted-foreground">
          <ChevronLeft className="mr-1 h-4 w-4" /> Back to General Settings
        </Button>
      </div>

      <PageHeader
        title="Ballet Contact Information"
        description="Configure the contact actions shown on the mobile Ballet Contact page."
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
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">WhatsApp Number</Label>
              <Input
                value={whatsappNumber}
                onChange={(e) => updateField("whatsappNumber", e.target.value)}
                placeholder="+201123456789"
                className="bg-background text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Phone Number</Label>
              <Input
                value={phoneNumber}
                onChange={(e) => updateField("phoneNumber", e.target.value)}
                placeholder="+201123456789"
                className="bg-background text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => updateField("email", e.target.value)}
                placeholder="ballet@centralstudio.eg"
                className="bg-background text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">Studio Location Link</Label>
              <Input
                type="url"
                value={studioLocationUrl}
                onChange={(e) => updateField("studioLocationUrl", e.target.value)}
                placeholder="https://maps.google.com/?q=Central+Studio"
                className="bg-background text-foreground"
              />
            </div>
          </div>

          {validationMessage && <p className="text-xs text-red-400">{validationMessage}</p>}
          <p className="text-xs text-muted-foreground">
            Phone numbers are saved in compact international format where possible. Location links must use HTTPS.
          </p>

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
