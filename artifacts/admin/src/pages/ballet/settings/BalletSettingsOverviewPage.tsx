import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  HelpCircle,
  Image as ImageIcon,
  ListChecks,
  Phone,
  Banknote,
  Save,
  Loader2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  adminFetch,
  balletApiUrl,
  BALLET_FAQS_QUERY_KEY,
  BALLET_REQUIREMENTS_QUERY_KEY,
  BALLET_SETTINGS_QUERY_KEY,
  type BalletFaq,
  type BalletSettings,
  type RequirementSection,
} from "./balletSettingsApi";

function SettingsCard({
  href,
  icon: Icon,
  title,
  description,
  status,
  summary,
  isLoading,
  isError,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
  status: { label: string; tone: "default" | "outline" | "secondary" };
  summary: string;
  isLoading: boolean;
  isError: boolean;
}) {
  return (
    <article className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-card p-5">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#00B6D7]/25 bg-[#00B6D7]/10">
            <Icon className="h-5 w-5 text-[#00B6D7]" />
          </div>
          {!isLoading && !isError && <Badge variant={status.tone}>{status.label}</Badge>}
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {isLoading ? (
          <Skeleton className="h-4 w-40" />
        ) : isError ? (
          <p className="text-xs text-red-400">Failed to load current status.</p>
        ) : (
          <p className="text-xs text-muted-foreground">{summary}</p>
        )}
      </div>
      <Button asChild variant="outline" size="sm" className="w-fit gap-2">
        <Link href={href}>
          Manage
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </Button>
    </article>
  );
}

export default function BalletSettingsOverviewPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token, can } = useAdminAuth();
  const canEdit = can("ballet.settings", "edit");

  const [assessmentFee, setAssessmentFee] = useState<string>("");
  const [feeDirty, setFeeDirty] = useState(false);

  const settingsQuery = useQuery({
    queryKey: [BALLET_SETTINGS_QUERY_KEY, token],
    queryFn: () => adminFetch<{ settings: BalletSettings }>(balletApiUrl("/settings"), {}, token),
    refetchOnWindowFocus: false,
  });

  const requirementsQuery = useQuery({
    queryKey: [BALLET_REQUIREMENTS_QUERY_KEY, token],
    queryFn: () => adminFetch<{ sections: RequirementSection[] }>(balletApiUrl("/program-requirement-sections"), {}, token),
    refetchOnWindowFocus: false,
  });

  const faqsQuery = useQuery({
    queryKey: [BALLET_FAQS_QUERY_KEY, token],
    queryFn: () => adminFetch<{ faqs: BalletFaq[] }>(balletApiUrl("/faqs"), {}, token),
    refetchOnWindowFocus: false,
  });

  const settings = settingsQuery.data?.settings;
  const sections = requirementsQuery.data?.sections ?? [];
  const faqs = faqsQuery.data?.faqs ?? [];

  useEffect(() => {
    if (settings) {
      setAssessmentFee(settings.assessmentFeeEgp != null ? String(settings.assessmentFeeEgp) : "");
      setFeeDirty(false);
    }
  }, [settings]);

  const saveFeeMutation = useMutation({
    mutationFn: (feeValue: number | null) =>
      adminFetch<{ settings: BalletSettings }>(
        balletApiUrl("/settings"),
        {
          method: "PATCH",
          body: JSON.stringify({ assessmentFeeEgp: feeValue }),
        },
        token,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [BALLET_SETTINGS_QUERY_KEY] });
      toast({ title: "Assessment fee saved successfully" });
      setFeeDirty(false);
    },
    onError: (err: { data?: { error?: string } }) => {
      toast({
        title: "Failed to save assessment fee",
        description: err?.data?.error ?? "An unexpected error occurred.",
        variant: "destructive",
      });
    },
  });

  const handleSaveFee = () => {
    const trimmed = assessmentFee.trim();
    if (!trimmed) {
      saveFeeMutation.mutate(null);
      return;
    }
    const parsed = parseInt(trimmed, 10);
    if (isNaN(parsed) || parsed < 0) {
      toast({
        title: "Invalid fee amount",
        description: "Assessment fee must be 0 or a positive whole number.",
        variant: "destructive",
      });
      return;
    }
    saveFeeMutation.mutate(parsed);
  };

  const hasImage = !!settings?.homeCardImageUrl;
  const contactFieldsFilled = settings
    ? [settings.whatsappNumber, settings.phoneNumber, settings.email, settings.studioLocationUrl].filter(Boolean).length
    : 0;
  const activeSections = sections.filter((s) => s.isActive).length;
  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
  const activeFaqs = faqs.filter((f) => f.isActive).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ballet General Settings"
        description="Manage the Ballet Home card image, contact information, program requirements, FAQ, and assessment fee."
        mode="stage"
      />

      {/* Assessment Fee Card */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#00B6D7]/25 bg-[#00B6D7]/10">
              <Banknote className="h-5 w-5 text-[#00B6D7]" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Ballet Assessment Fee (EGP)</h2>
              <p className="text-sm text-muted-foreground">
                Configurable intake assessment price displayed to parents during appointment booking.
              </p>
            </div>
          </div>
          {settings?.assessmentFeeEgp != null ? (
            <Badge variant="default">{settings.assessmentFeeEgp} EGP</Badge>
          ) : (
            <Badge variant="outline">Not Set / Free</Badge>
          )}
        </div>

        <div className="flex items-end gap-3 max-w-md">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="assessmentFee">Assessment Fee Amount (EGP)</Label>
            <Input
              id="assessmentFee"
              type="number"
              min={0}
              placeholder="e.g. 300 (leave blank for free)"
              value={assessmentFee}
              disabled={!canEdit || settingsQuery.isLoading || saveFeeMutation.isPending}
              onChange={(e) => {
                setAssessmentFee(e.target.value);
                setFeeDirty(true);
              }}
            />
          </div>
          {canEdit && (
            <Button
              type="button"
              disabled={!feeDirty || saveFeeMutation.isPending}
              onClick={handleSaveFee}
              className="gap-2"
            >
              {saveFeeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Fee
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SettingsCard
          href="/ballet/settings/home-card"
          icon={ImageIcon}
          title="Ballet Home Card Background Image"
          description="The background image behind the Ballet entry card on the mobile Home tab."
          status={hasImage ? { label: "Configured", tone: "default" } : { label: "Not set", tone: "outline" }}
          summary={hasImage ? "A custom background image is configured." : "Mobile will use the bundled fallback image."}
          isLoading={settingsQuery.isLoading}
          isError={settingsQuery.isError}
        />

        <SettingsCard
          href="/ballet/settings/contact"
          icon={Phone}
          title="Ballet Contact Information"
          description="WhatsApp, phone, email, and studio location shown on the mobile Ballet Contact page."
          status={
            contactFieldsFilled === 0
              ? { label: "Not set", tone: "outline" }
              : contactFieldsFilled === 4
                ? { label: "Complete", tone: "default" }
                : { label: "Partially set", tone: "secondary" }
          }
          summary={`${contactFieldsFilled} of 4 contact fields configured.`}
          isLoading={settingsQuery.isLoading}
          isError={settingsQuery.isError}
        />

        <SettingsCard
          href="/ballet/settings/requirements"
          icon={ListChecks}
          title="Ballet Program Requirements"
          description="Sections and ordered requirement items shown on the mobile Ballet Requirements page."
          status={sections.length === 0 ? { label: "Empty", tone: "outline" } : { label: `${activeSections} active`, tone: "default" }}
          summary={`${sections.length} section${sections.length === 1 ? "" : "s"}, ${totalItems} item${totalItems === 1 ? "" : "s"} total.`}
          isLoading={requirementsQuery.isLoading}
          isError={requirementsQuery.isError}
        />

        <SettingsCard
          href="/ballet/settings/faq"
          icon={HelpCircle}
          title="Ballet FAQ"
          description="Ordered FAQ questions shown on the mobile Ballet FAQ page."
          status={faqs.length === 0 ? { label: "Empty", tone: "outline" } : { label: `${activeFaqs} active`, tone: "default" }}
          summary={`${faqs.length} FAQ${faqs.length === 1 ? "" : "s"} total.`}
          isLoading={faqsQuery.isLoading}
          isError={faqsQuery.isError}
        />
      </div>
    </div>
  );
}
