/**
 * Website → Performance → Create/Edit (/website/performances/new,
 * /website/performances/:slug/edit) — Website CMS Wave 3.
 *
 * A DEDICATED PAGE, not a Dialog — Performance's editorial content model is
 * even larger than News' (adds card fields, a hero override, a
 * performance-details block, highlights, schedule overview, cast/faculty,
 * and ticketing on top of everything News already has), so the "dedicated
 * page for a complex entity" precedent (WebsiteNewsEditorPage,
 * ApplicationDetailPage) applies even more strongly here.
 *
 * Structured content reuses the exact News editor model (react-hook-form's
 * useFieldArray, no HTML/Markdown/rich-text anywhere) — see SectionEditor
 * below, copied verbatim from WebsiteNewsEditorPage.tsx.
 *
 * CARD vs. DETAIL fields are deliberately separate form fields (cardTitle/
 * title, cardDescription/subtitle, cardImageUrl/heroImageUrl, cardVenue/
 * venue, cardDatesDisplay/eventDateDisplay, cardBadgeLabel/
 * detailBadgeLabel) — the Wave 3 investigation proved these genuinely
 * diverge for real seeded content (most notably YAGP's), so this editor
 * never collapses them into one shared input.
 *
 * badgeVariant is a closed 3-value enum (cyan/purple/gold) — never a raw
 * CSS/Tailwind class input. scheduleOverview is clearly labeled as stored
 * but not publicly displayed, matching the locked Wave 3 decision.
 */
import { useEffect, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useForm, useFieldArray, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useGetAdminWebsitePerformance,
  useCreateWebsitePerformance,
  useUpdateWebsitePerformance,
  useListAdminWebsitePerformances,
  useListAdminWebsiteNews,
  getListAdminWebsitePerformancesQueryKey,
  getGetAdminWebsitePerformanceQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { ChevronLeft, Loader2, Plus, Save, Trash2, ChevronUp, ChevronDown, ImageOff, Info } from "lucide-react";

// ─── Form schema ────────────────────────────────────────────────────────────

const textItemSchema = z.object({ value: z.string().min(1, "Required") });
const scheduleItemSchema = z.object({ time: z.string().min(1, "Required"), event: z.string().min(1, "Required") });
const castItemSchema = z.object({ name: z.string().min(1, "Required"), role: z.string().min(1, "Required"), imageUrl: z.string().min(1, "Required") });

const sectionSchema = z.object({
  heading: z.string().optional(),
  paragraphs: z.array(textItemSchema).min(1, "At least one paragraph is required"),
  quoteText: z.string().optional(),
  quoteAuthor: z.string().optional(),
  quoteRole: z.string().optional(),
  bulletPoints: z.array(textItemSchema).optional(),
  image: z.string().optional(),
  imageCaption: z.string().optional(),
});

const relatedRefSchema = z.object({
  type: z.enum(["news", "performance"]),
  slug: z.string().min(1, "Slug is required"),
});

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const formSchema = z.object({
  slug: z.string().min(1, "Slug is required").regex(SLUG_RE, "Lowercase letters, numbers, and hyphens only"),
  sortOrder: z.string().regex(/^\d+$/, "Must be a whole number"),
  category: z.string().min(1, "Required"),
  categoryLabel: z.string().min(1, "Required"),
  isFeatured: z.boolean(),
  isActive: z.boolean(),

  cardTitle: z.string().min(1, "Required"),
  cardDescription: z.string().min(1, "Required"),
  cardImageUrl: z.string().min(1, "Required"),
  cardVenue: z.string().min(1, "Required"),
  cardDatesDisplay: z.string().min(1, "Required"),
  cardTime: z.string().min(1, "Required"),
  dateDay: z.string().min(1, "Required"),
  dateMonth: z.string().min(1, "Required"),
  cardBadgeLabel: z.string().min(1, "Required"),

  featuredHeroImageUrl: z.string().optional(),
  featuredHeroDateBadge: z.string().optional(),

  title: z.string().min(1, "Required"),
  subtitle: z.string().min(1, "Required"),
  heroImageUrl: z.string().min(1, "Required"),
  eventDateDisplay: z.string().min(1, "Required"),
  venue: z.string().min(1, "Required"),
  times: z.array(textItemSchema),
  orchestra: z.string().optional(),
  runtime: z.string().min(1, "Required"),
  ticketLink: z.string().optional(),
  ticketPriceRange: z.string().optional(),
  detailBadgeLabel: z.string().min(1, "Required"),
  badgeVariant: z.enum(["cyan", "purple", "gold"]),
  season: z.string().min(1, "Required"),

  authorName: z.string().min(1, "Required"),
  authorRole: z.string().min(1, "Required"),
  authorAvatarUrl: z.string().optional(),

  tags: z.array(textItemSchema),
  galleryImages: z.array(textItemSchema),

  leadParagraph: z.string().min(1, "Required"),
  sections: z.array(sectionSchema).min(1, "At least one section is required"),

  keyHighlights: z.array(textItemSchema),
  scheduleOverview: z.array(scheduleItemSchema),
  castAndFaculty: z.array(castItemSchema),

  relatedRefs: z.array(relatedRefSchema),
});
type FormValues = z.infer<typeof formSchema>;

const EMPTY_SECTION = {
  heading: "",
  paragraphs: [{ value: "" }],
  quoteText: "",
  quoteAuthor: "",
  quoteRole: "",
  bulletPoints: [],
  image: "",
  imageCaption: "",
};

const DEFAULT_VALUES: FormValues = {
  slug: "",
  sortOrder: "1",
  category: "performance",
  categoryLabel: "Stage Repertoire",
  isFeatured: false,
  isActive: true,
  cardTitle: "",
  cardDescription: "",
  cardImageUrl: "",
  cardVenue: "",
  cardDatesDisplay: "",
  cardTime: "",
  dateDay: "",
  dateMonth: "",
  cardBadgeLabel: "",
  featuredHeroImageUrl: "",
  featuredHeroDateBadge: "",
  title: "",
  subtitle: "",
  heroImageUrl: "",
  eventDateDisplay: "",
  venue: "",
  times: [],
  orchestra: "",
  runtime: "",
  ticketLink: "",
  ticketPriceRange: "",
  detailBadgeLabel: "",
  badgeVariant: "cyan",
  season: "",
  authorName: "",
  authorRole: "",
  authorAvatarUrl: "",
  tags: [],
  galleryImages: [],
  leadParagraph: "",
  sections: [EMPTY_SECTION],
  keyHighlights: [],
  scheduleOverview: [],
  castAndFaculty: [],
  relatedRefs: [],
};

const BADGE_VARIANTS = [
  { value: "cyan", label: "Cyan" },
  { value: "purple", label: "Purple" },
  { value: "gold", label: "Gold" },
] as const;

// ─── Component ──────────────────────────────────────────────────────────────

export default function WebsitePerformanceEditorPage() {
  const { slug: editingSlug } = useParams<{ slug?: string }>();
  const isEdit = Boolean(editingSlug);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { can } = useAdminAuth();
  const queryClient = useQueryClient();

  const canSave = can("website.performance", isEdit ? "edit" : "create");

  const { data: existing, isLoading: loadingExisting, isError: loadError } = useGetAdminWebsitePerformance(editingSlug ?? "", {
    query: { enabled: isEdit, queryKey: getGetAdminWebsitePerformanceQueryKey(editingSlug ?? "") },
  });
  const { data: allPerformances } = useListAdminWebsitePerformances();
  const { data: allPosts } = useListAdminWebsiteNews();
  const createPerformance = useCreateWebsitePerformance();
  const updatePerformance = useUpdateWebsitePerformance();
  const saving = createPerformance.isPending || updatePerformance.isPending;

  const nextSortOrder = useMemo(() => {
    const max = (allPerformances ?? []).reduce((m, p) => Math.max(m, p.sortOrder), 0);
    return String(max + 1);
  }, [allPerformances]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: DEFAULT_VALUES,
  });
  const { control, register, handleSubmit, reset, watch, formState: { errors } } = form;

  useEffect(() => {
    if (!isEdit && allPerformances) {
      form.setValue("sortOrder", nextSortOrder);
    }
    // Only pre-fill the suggested sortOrder once the list has loaded, and
    // only in create mode — never overwrite an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, nextSortOrder]);

  useEffect(() => {
    if (isEdit && existing) {
      reset({
        slug: existing.slug,
        sortOrder: String(existing.sortOrder),
        category: existing.category,
        categoryLabel: existing.categoryLabel,
        isFeatured: existing.isFeatured,
        isActive: existing.isActive,
        cardTitle: existing.cardTitle,
        cardDescription: existing.cardDescription,
        cardImageUrl: existing.cardImageUrl,
        cardVenue: existing.cardVenue,
        cardDatesDisplay: existing.cardDatesDisplay,
        cardTime: existing.cardTime,
        dateDay: existing.dateDay,
        dateMonth: existing.dateMonth,
        cardBadgeLabel: existing.cardBadgeLabel,
        featuredHeroImageUrl: existing.featuredHeroImageUrl ?? "",
        featuredHeroDateBadge: existing.featuredHeroDateBadge ?? "",
        title: existing.title,
        subtitle: existing.subtitle,
        heroImageUrl: existing.heroImageUrl,
        eventDateDisplay: existing.eventDateDisplay,
        venue: existing.venue,
        times: existing.times.map((value) => ({ value })),
        orchestra: existing.orchestra ?? "",
        runtime: existing.runtime,
        ticketLink: existing.ticketLink ?? "",
        ticketPriceRange: existing.ticketPriceRange ?? "",
        detailBadgeLabel: existing.detailBadgeLabel,
        badgeVariant: existing.badgeVariant,
        season: existing.season,
        authorName: existing.authorName,
        authorRole: existing.authorRole,
        authorAvatarUrl: existing.authorAvatarUrl ?? "",
        tags: existing.tags.map((value) => ({ value })),
        galleryImages: existing.galleryImages.map((value) => ({ value })),
        leadParagraph: existing.content.leadParagraph,
        sections: existing.content.sections.map((s) => ({
          heading: s.heading ?? "",
          paragraphs: s.paragraphs.map((value) => ({ value })),
          quoteText: s.quote?.text ?? "",
          quoteAuthor: s.quote?.author ?? "",
          quoteRole: s.quote?.role ?? "",
          bulletPoints: (s.bulletPoints ?? []).map((value) => ({ value })),
          image: s.image ?? "",
          imageCaption: s.imageCaption ?? "",
        })),
        keyHighlights: existing.keyHighlights.map((value) => ({ value })),
        scheduleOverview: existing.scheduleOverview,
        castAndFaculty: existing.castAndFaculty,
        relatedRefs: existing.relatedRefs,
      });
    }
    // Only re-sync from server data when the record identity/content
    // actually changes — not on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, existing?.slug, existing?.updatedAt]);

  const sectionsArray = useFieldArray({ control, name: "sections" });
  const relatedArray = useFieldArray({ control, name: "relatedRefs" });
  const scheduleArray = useFieldArray({ control, name: "scheduleOverview" });
  const castArray = useFieldArray({ control, name: "castAndFaculty" });

  const heroImageUrl = watch("heroImageUrl");
  const cardImageUrl = watch("cardImageUrl");
  const currentSlug = watch("slug");

  const relatedNewsOptions = allPosts ?? [];
  const relatedPerformanceOptions = (allPerformances ?? []).filter((p) => p.slug !== (editingSlug ?? currentSlug));

  const onSubmit = (values: FormValues) => {
    const body = {
      sortOrder: Number(values.sortOrder),
      category: values.category.trim(),
      categoryLabel: values.categoryLabel.trim(),
      isFeatured: values.isFeatured,
      isActive: values.isActive,
      cardTitle: values.cardTitle.trim(),
      cardDescription: values.cardDescription.trim(),
      cardImageUrl: values.cardImageUrl.trim(),
      cardVenue: values.cardVenue.trim(),
      cardDatesDisplay: values.cardDatesDisplay.trim(),
      cardTime: values.cardTime.trim(),
      dateDay: values.dateDay.trim(),
      dateMonth: values.dateMonth.trim(),
      cardBadgeLabel: values.cardBadgeLabel.trim(),
      featuredHeroImageUrl: values.featuredHeroImageUrl?.trim() || null,
      featuredHeroDateBadge: values.featuredHeroDateBadge?.trim() || null,
      title: values.title.trim(),
      subtitle: values.subtitle.trim(),
      heroImageUrl: values.heroImageUrl.trim(),
      eventDateDisplay: values.eventDateDisplay.trim(),
      venue: values.venue.trim(),
      times: values.times.map((t) => t.value.trim()).filter(Boolean),
      orchestra: values.orchestra?.trim() || null,
      runtime: values.runtime.trim(),
      ticketLink: values.ticketLink?.trim() || null,
      ticketPriceRange: values.ticketPriceRange?.trim() || null,
      detailBadgeLabel: values.detailBadgeLabel.trim(),
      badgeVariant: values.badgeVariant,
      season: values.season.trim(),
      authorName: values.authorName.trim(),
      authorRole: values.authorRole.trim(),
      authorAvatarUrl: values.authorAvatarUrl?.trim() || null,
      tags: values.tags.map((t) => t.value.trim()).filter(Boolean),
      galleryImages: values.galleryImages.map((g) => g.value.trim()).filter(Boolean),
      content: {
        leadParagraph: values.leadParagraph.trim(),
        sections: values.sections.map((s) => ({
          heading: s.heading?.trim() || undefined,
          paragraphs: s.paragraphs.map((p) => p.value.trim()).filter(Boolean),
          quote: s.quoteText?.trim() && s.quoteAuthor?.trim() && s.quoteRole?.trim()
            ? { text: s.quoteText.trim(), author: s.quoteAuthor.trim(), role: s.quoteRole.trim() }
            : undefined,
          bulletPoints: s.bulletPoints && s.bulletPoints.length > 0
            ? s.bulletPoints.map((b) => b.value.trim()).filter(Boolean)
            : undefined,
          image: s.image?.trim() || undefined,
          imageCaption: s.imageCaption?.trim() || undefined,
        })),
      },
      keyHighlights: values.keyHighlights.map((h) => h.value.trim()).filter(Boolean),
      scheduleOverview: values.scheduleOverview.map((s) => ({ time: s.time.trim(), event: s.event.trim() })),
      castAndFaculty: values.castAndFaculty.map((c) => ({ name: c.name.trim(), role: c.role.trim(), imageUrl: c.imageUrl.trim() })),
      relatedRefs: values.relatedRefs,
    };

    const onSuccess = () => {
      queryClient.invalidateQueries({ queryKey: getListAdminWebsitePerformancesQueryKey() });
      if (isEdit && editingSlug) {
        queryClient.invalidateQueries({ queryKey: getGetAdminWebsitePerformanceQueryKey(editingSlug) });
      }
      toast({ title: isEdit ? "Performance updated" : "Performance created" });
      navigate("/website/performances");
    };
    const onError = (err: unknown) => {
      toast({ title: "Could not save Performance", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    };

    if (isEdit && editingSlug) {
      updatePerformance.mutate({ slug: editingSlug, data: body }, { onSuccess, onError });
    } else {
      createPerformance.mutate({ data: { ...body, slug: values.slug.trim() } }, { onSuccess, onError });
    }
  };

  if (isEdit && loadingExisting) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (isEdit && (loadError || !existing)) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Performance not found. It may have been removed.
      </div>
    );
  }

  return (
    <div className="admin2-final-page admin2-cms-workspace admin2-website-performance-editor space-y-6 max-w-4xl">
      <Button variant="ghost" size="sm" onClick={() => navigate("/website/performances")} className="-ml-2 text-muted-foreground">
        <ChevronLeft className="mr-1 h-4 w-4" /> Back to Performance
      </Button>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <fieldset disabled={!canSave} className="space-y-6">
          {/* ── Basic / Identity ───────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Basic / Identity</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Slug {isEdit && <span className="text-muted-foreground font-normal">(read-only — cannot be changed)</span>}</Label>
                <Input {...register("slug")} disabled={isEdit} data-testid="input-performance-slug" placeholder="my-performance" />
                {errors.slug && <p className="text-xs text-destructive">{errors.slug.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Repertoire Order <span className="text-muted-foreground font-normal">(controls public list order)</span></Label>
                <Input type="number" min={1} {...register("sortOrder")} data-testid="input-performance-sort-order" />
                {errors.sortOrder && <p className="text-xs text-destructive">{errors.sortOrder.message}</p>}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Input {...register("category")} data-testid="input-performance-category" />
              </div>
              <div className="space-y-1.5">
                <Label>Category Label</Label>
                <Input {...register("categoryLabel")} data-testid="input-performance-category-label" />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <Label className="mb-0">Featured</Label>
                <Switch checked={watch("isFeatured")} onCheckedChange={(v) => form.setValue("isFeatured", v)} data-testid="switch-performance-featured" />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <Label className="mb-0">Active <span className="text-muted-foreground font-normal">(visible on the public site)</span></Label>
                <Switch checked={watch("isActive")} onCheckedChange={(v) => form.setValue("isActive", v)} data-testid="switch-performance-active" />
              </div>
            </div>
            {watch("isFeatured") && (
              <p className="text-xs text-muted-foreground">
                Setting this Performance as featured will automatically un-feature the current featured Performance, if any.
              </p>
            )}
          </section>

          {/* ── Card / Repertoire ──────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Card / Repertoire Listing</h2>
            <p className="text-xs text-muted-foreground">
              These drive the repertoire card on the public Performance page — independent of the Detail fields below,
              even when the current values look similar.
            </p>
            <div className="space-y-1.5">
              <Label>Card Title</Label>
              <Input {...register("cardTitle")} data-testid="input-performance-card-title" />
              {errors.cardTitle && <p className="text-xs text-destructive">{errors.cardTitle.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Card Description</Label>
              <Textarea rows={2} {...register("cardDescription")} data-testid="input-performance-card-description" />
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_140px]">
              <div className="space-y-1.5">
                <Label>Card Image URL</Label>
                <Input {...register("cardImageUrl")} data-testid="input-performance-card-image" />
              </div>
              <div className="relative h-24 w-full rounded overflow-hidden bg-muted flex items-center justify-center">
                {cardImageUrl ? (
                  <img src={cardImageUrl} alt="Card preview" className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <ImageOff className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Card Venue</Label>
                <Input {...register("cardVenue")} data-testid="input-performance-card-venue" />
              </div>
              <div className="space-y-1.5">
                <Label>Card Time</Label>
                <Input {...register("cardTime")} data-testid="input-performance-card-time" />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Card Dates Display</Label>
                <Input {...register("cardDatesDisplay")} data-testid="input-performance-card-dates" />
              </div>
              <div className="space-y-1.5">
                <Label>Date Day</Label>
                <Input {...register("dateDay")} placeholder="e.g. 18" data-testid="input-performance-date-day" />
              </div>
              <div className="space-y-1.5">
                <Label>Date Month</Label>
                <Input {...register("dateMonth")} placeholder="e.g. DEC" data-testid="input-performance-date-month" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Card Badge Label</Label>
              <Input {...register("cardBadgeLabel")} data-testid="input-performance-card-badge" />
            </div>
          </section>

          {/* ── Featured Hero ──────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Featured Hero <span className="text-muted-foreground font-normal">(optional overrides)</span></h2>
            <p className="text-xs text-muted-foreground">
              Only used when this Performance is the active featured production. Leave blank to fall back to the
              Hero Image URL and Event Date Display below.
            </p>
            <div className="space-y-1.5">
              <Label>Featured Hero Image URL</Label>
              <Input {...register("featuredHeroImageUrl")} data-testid="input-performance-featured-hero-image" />
            </div>
            <div className="space-y-1.5">
              <Label>Featured Hero Date Badge</Label>
              <Input {...register("featuredHeroDateBadge")} placeholder="e.g. DEC 18 – 22, 2026" data-testid="input-performance-featured-hero-date" />
            </div>
          </section>

          {/* ── Detail ──────────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Detail</h2>
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input {...register("title")} data-testid="input-performance-title" />
              {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Subtitle</Label>
              <Textarea rows={2} {...register("subtitle")} data-testid="input-performance-subtitle" />
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_140px]">
              <div className="space-y-1.5">
                <Label>Hero Image URL</Label>
                <Input {...register("heroImageUrl")} data-testid="input-performance-hero-image" />
              </div>
              <div className="relative h-24 w-full rounded overflow-hidden bg-muted flex items-center justify-center">
                {heroImageUrl ? (
                  <img src={heroImageUrl} alt="Hero preview" className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <ImageOff className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Event Date Display</Label>
                <Input {...register("eventDateDisplay")} data-testid="input-performance-event-date" />
              </div>
              <div className="space-y-1.5">
                <Label>Season</Label>
                <Input {...register("season")} data-testid="input-performance-season" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Venue</Label>
              <Input {...register("venue")} data-testid="input-performance-venue" />
            </div>
            <RepeatableTextList label="Times" placeholder="e.g. Matinee: 2:00 PM" control={control} register={register} name="times" testId="performance-times" />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Orchestra <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input {...register("orchestra")} data-testid="input-performance-orchestra" />
              </div>
              <div className="space-y-1.5">
                <Label>Runtime</Label>
                <Input {...register("runtime")} data-testid="input-performance-runtime" />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Ticket Link <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input {...register("ticketLink")} data-testid="input-performance-ticket-link" />
              </div>
              <div className="space-y-1.5">
                <Label>Ticket Price Range <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input {...register("ticketPriceRange")} data-testid="input-performance-ticket-price" />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Detail Badge Label</Label>
                <Input {...register("detailBadgeLabel")} data-testid="input-performance-detail-badge" />
              </div>
              <div className="space-y-1.5">
                <Label>Badge Color Variant</Label>
                <Select value={watch("badgeVariant")} onValueChange={(v) => form.setValue("badgeVariant", v as FormValues["badgeVariant"])}>
                  <SelectTrigger data-testid="select-performance-badge-variant"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BADGE_VARIANTS.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* ── Author ─────────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Author</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input {...register("authorName")} data-testid="input-performance-author-name" />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Input {...register("authorRole")} data-testid="input-performance-author-role" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Avatar URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input {...register("authorAvatarUrl")} data-testid="input-performance-author-avatar" />
            </div>
          </section>

          {/* ── Structured Content ─────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Content</h2>
            <div className="space-y-1.5">
              <Label>Lead Paragraph</Label>
              <Textarea rows={3} {...register("leadParagraph")} data-testid="input-performance-lead-paragraph" />
              {errors.leadParagraph && <p className="text-xs text-destructive">{errors.leadParagraph.message}</p>}
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="mb-0">Sections</Label>
                <Button type="button" variant="outline" size="sm" className="gap-2"
                  onClick={() => sectionsArray.append(EMPTY_SECTION)} data-testid="button-add-section">
                  <Plus className="h-4 w-4" /> Add Section
                </Button>
              </div>
              {sectionsArray.fields.map((field, index) => (
                <SectionEditor
                  key={field.id}
                  control={control}
                  register={register}
                  index={index}
                  total={sectionsArray.fields.length}
                  onRemove={() => sectionsArray.remove(index)}
                  onMoveUp={() => index > 0 && sectionsArray.move(index, index - 1)}
                  onMoveDown={() => index < sectionsArray.fields.length - 1 && sectionsArray.move(index, index + 1)}
                />
              ))}
            </div>
          </section>

          {/* ── Highlights ─────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Key Highlights</h2>
            <RepeatableTextList label="" placeholder="e.g. Live 40-piece symphony orchestra" control={control} register={register} name="keyHighlights" testId="performance-highlights" />
          </section>

          {/* ── Schedule Overview ──────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Schedule Overview</h2>
            <p className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Stored content — not currently displayed on the public website.
            </p>
            <div className="space-y-2">
              {scheduleArray.fields.map((field, index) => (
                <div key={field.id} className="grid gap-2 md:grid-cols-[1fr_2fr_auto] items-start rounded-md border border-border p-2">
                  <Input {...register(`scheduleOverview.${index}.time`)} placeholder="e.g. Dec 18 - 7:30 PM" data-testid={`input-schedule-${index}-time`} />
                  <Input {...register(`scheduleOverview.${index}.event`)} placeholder="e.g. Opening Night Gala" data-testid={`input-schedule-${index}-event`} />
                  <Button type="button" variant="ghost" size="icon" onClick={() => scheduleArray.remove(index)} aria-label="Remove schedule item">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="gap-2"
              onClick={() => scheduleArray.append({ time: "", event: "" })} data-testid="button-add-schedule">
              <Plus className="h-4 w-4" /> Add Schedule Item
            </Button>
          </section>

          {/* ── Cast & Faculty ─────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Cast & Faculty</h2>
            <div className="space-y-2">
              {castArray.fields.map((field, index) => (
                <div key={field.id} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto] items-start rounded-md border border-border p-2">
                  <Input {...register(`castAndFaculty.${index}.name`)} placeholder="Name" data-testid={`input-cast-${index}-name`} />
                  <Input {...register(`castAndFaculty.${index}.role`)} placeholder="Role" data-testid={`input-cast-${index}-role`} />
                  <Input {...register(`castAndFaculty.${index}.imageUrl`)} placeholder="Image URL" data-testid={`input-cast-${index}-image`} />
                  <Button type="button" variant="ghost" size="icon" onClick={() => castArray.remove(index)} aria-label="Remove cast member">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="gap-2"
              onClick={() => castArray.append({ name: "", role: "", imageUrl: "" })} data-testid="button-add-cast">
              <Plus className="h-4 w-4" /> Add Cast / Faculty Member
            </Button>
          </section>

          {/* ── Gallery ────────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Gallery</h2>
            <RepeatableTextList label="" placeholder="https://..." control={control} register={register} name="galleryImages" testId="performance-gallery" />
          </section>

          {/* ── Tags ───────────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Tags</h2>
            <RepeatableTextList label="" placeholder="e.g. Nutcracker" control={control} register={register} name="tags" testId="performance-tags" inline />
          </section>

          {/* ── Related content ────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Related Content</h2>
            <p className="text-xs text-muted-foreground">
              Order is preserved exactly as shown here. Both News and Performance references are validated against
              existing posts.
            </p>
            <div className="space-y-2">
              {relatedArray.fields.map((field, index) => {
                const type = watch(`relatedRefs.${index}.type`);
                return (
                  <div key={field.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                    <Select
                      value={type}
                      onValueChange={(v) => form.setValue(`relatedRefs.${index}.type`, v as "news" | "performance")}
                    >
                      <SelectTrigger className="w-[140px]" data-testid={`select-related-type-${index}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="news">News</SelectItem>
                        <SelectItem value="performance">Performance</SelectItem>
                      </SelectContent>
                    </Select>
                    {type === "news" ? (
                      <Select
                        value={watch(`relatedRefs.${index}.slug`)}
                        onValueChange={(v) => form.setValue(`relatedRefs.${index}.slug`, v)}
                      >
                        <SelectTrigger className="flex-1" data-testid={`select-related-news-${index}`}>
                          <SelectValue placeholder="Choose a News post" />
                        </SelectTrigger>
                        <SelectContent>
                          {relatedNewsOptions.map((p) => (
                            <SelectItem key={p.slug} value={p.slug}>{p.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select
                        value={watch(`relatedRefs.${index}.slug`)}
                        onValueChange={(v) => form.setValue(`relatedRefs.${index}.slug`, v)}
                      >
                        <SelectTrigger className="flex-1" data-testid={`select-related-performance-${index}`}>
                          <SelectValue placeholder="Choose a Performance" />
                        </SelectTrigger>
                        <SelectContent>
                          {relatedPerformanceOptions.map((p) => (
                            <SelectItem key={p.slug} value={p.slug}>{p.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button type="button" variant="ghost" size="icon" onClick={() => relatedArray.remove(index)} aria-label="Remove related item">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button type="button" variant="outline" size="sm" className="gap-2"
              onClick={() => relatedArray.append({ type: "news", slug: "" })} data-testid="button-add-related">
              <Plus className="h-4 w-4" /> Add Related Content
            </Button>
          </section>

          <div className="flex items-center justify-end gap-2 pb-8">
            {isFeaturedBadge(watch("isFeatured"))}
            <Button type="button" variant="outline" onClick={() => navigate("/website/performances")}>Cancel</Button>
            <Button type="submit" disabled={!canSave || saving} className="gap-2" data-testid="button-save-performance">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isEdit ? "Save Changes" : "Create Performance"}
            </Button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}

function isFeaturedBadge(isFeatured: boolean) {
  return isFeatured ? <Badge variant="outline">Will be set as Featured</Badge> : null;
}

// ─── Repeatable plain-text list (times, tags, gallery, highlights) ────────

function RepeatableTextList({
  label, placeholder, control, register, name, testId, inline,
}: {
  label: string;
  placeholder: string;
  control: Control<FormValues>;
  register: ReturnType<typeof useForm<FormValues>>["register"];
  name: "tags" | "galleryImages" | "keyHighlights" | "times";
  testId: string;
  inline?: boolean;
}) {
  const array = useFieldArray({ control, name });
  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <div className={inline ? "flex flex-wrap gap-2" : "space-y-2"}>
        {array.fields.map((field, index) => (
          <div key={field.id} className={inline ? "flex items-center gap-1" : "flex items-center gap-2"}>
            <Input
              {...register(`${name}.${index}.value` as const)}
              placeholder={placeholder}
              className={inline ? "w-40" : "flex-1"}
              data-testid={`input-${testId}-${index}`}
            />
            <Button type="button" variant="ghost" size="icon" onClick={() => array.remove(index)} aria-label="Remove">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" className="gap-2"
        onClick={() => array.append({ value: "" })} data-testid={`button-add-${testId}`}>
        <Plus className="h-4 w-4" /> Add
      </Button>
    </div>
  );
}

// ─── One content section (heading, paragraphs, quote, bullets, image) ─────
// Identical structure to WebsiteNewsEditorPage.tsx's SectionEditor.

function SectionEditor({
  control, register, index, total, onRemove, onMoveUp, onMoveDown,
}: {
  control: Control<FormValues>;
  register: ReturnType<typeof useForm<FormValues>>["register"];
  index: number;
  total: number;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const paragraphs = useFieldArray({ control, name: `sections.${index}.paragraphs` });
  const bullets = useFieldArray({ control, name: `sections.${index}.bulletPoints` });

  return (
    <div className="rounded-md border border-border bg-background p-4 space-y-3" data-testid={`section-editor-${index}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Section {index + 1}</span>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={onMoveUp} aria-label="Move section up">
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" disabled={index === total - 1} onClick={onMoveDown} aria-label="Move section down">
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" disabled={total === 1} onClick={onRemove} aria-label="Remove section">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Heading <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Input {...register(`sections.${index}.heading`)} data-testid={`input-section-${index}-heading`} />
      </div>

      <div className="space-y-2">
        <Label>Paragraphs</Label>
        {paragraphs.fields.map((field, pIndex) => (
          <div key={field.id} className="flex items-start gap-2">
            <Textarea rows={2} {...register(`sections.${index}.paragraphs.${pIndex}.value`)} className="flex-1" data-testid={`input-section-${index}-paragraph-${pIndex}`} />
            <Button type="button" variant="ghost" size="icon" disabled={paragraphs.fields.length === 1} onClick={() => paragraphs.remove(pIndex)} aria-label="Remove paragraph">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => paragraphs.append({ value: "" })} data-testid={`button-add-section-${index}-paragraph`}>
          <Plus className="h-4 w-4" /> Add Paragraph
        </Button>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Quote Text <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Textarea rows={2} {...register(`sections.${index}.quoteText`)} data-testid={`input-section-${index}-quote-text`} />
        </div>
        <div className="space-y-1.5">
          <Label>Quote Author</Label>
          <Input {...register(`sections.${index}.quoteAuthor`)} data-testid={`input-section-${index}-quote-author`} />
        </div>
        <div className="space-y-1.5">
          <Label>Quote Role</Label>
          <Input {...register(`sections.${index}.quoteRole`)} data-testid={`input-section-${index}-quote-role`} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Fill in all three quote fields to include a quote, or leave all blank to omit it.</p>

      <div className="space-y-2">
        <Label>Bullet Points <span className="text-muted-foreground font-normal">(optional)</span></Label>
        {(bullets.fields ?? []).map((field, bIndex) => (
          <div key={field.id} className="flex items-center gap-2">
            <Input {...register(`sections.${index}.bulletPoints.${bIndex}.value`)} className="flex-1" data-testid={`input-section-${index}-bullet-${bIndex}`} />
            <Button type="button" variant="ghost" size="icon" onClick={() => bullets.remove(bIndex)} aria-label="Remove bullet point">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => bullets.append({ value: "" })} data-testid={`button-add-section-${index}-bullet`}>
          <Plus className="h-4 w-4" /> Add Bullet Point
        </Button>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Section Image URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input {...register(`sections.${index}.image`)} data-testid={`input-section-${index}-image`} />
        </div>
        <div className="space-y-1.5">
          <Label>Image Caption</Label>
          <Input {...register(`sections.${index}.imageCaption`)} data-testid={`input-section-${index}-image-caption`} />
        </div>
      </div>
    </div>
  );
}
import "../../admin2-final.css";
