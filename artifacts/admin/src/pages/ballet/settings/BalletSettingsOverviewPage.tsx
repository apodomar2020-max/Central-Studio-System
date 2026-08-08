/**
 * Ballet → General Settings — Overview (/ballet/settings)
 *
 * Entry point for Ballet General Settings. Replaces the former single long
 * stacked form (all four content areas in one page) with a management
 * dashboard: four distinct cards, one per content area, each showing a
 * status/summary and a "Manage" action into its own focused page.
 */
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  HelpCircle,
  Image as ImageIcon,
  ListChecks,
  Phone,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  const { token } = useAdminAuth();

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
        description="Manage the Ballet Home card image, contact information, program requirements, and FAQ shown in the mobile app."
        mode="stage"
      />

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
