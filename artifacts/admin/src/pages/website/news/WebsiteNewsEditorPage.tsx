/**
 * Website → News → Create/Edit (/website/news/new, /website/news/:slug/edit)
 * — Website CMS Wave 2.
 *
 * A DEDICATED PAGE, not a Dialog — News' full editorial content model (flat
 * fields + repeatable structured sections with nested paragraphs/quote/
 * bullets/image + tags + gallery + related content) is too large for the
 * project's established Dialog UX, matching the same precedent as
 * ApplicationDetailPage / BalletRequirementsSectionPage.
 *
 * Structured content is authored with repeatable controls only (react-
 * hook-form's useFieldArray) — no HTML/Markdown/rich-text editor anywhere,
 * preserving the exact { leadParagraph, sections[] } block model
 * ArticleDetailView already renders.
 *
 * publishedDate (exact display string, e.g. "July 18, 2026") and
 * publishedAt (sortable timestamp) are both derived from ONE date picker
 * value here — see formatPublishedDate below — so the two columns can never
 * drift apart for Admin-created/edited posts.
 */
import { useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useForm, useFieldArray, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useGetAdminWebsiteNews,
  useCreateWebsiteNewsPost,
  useUpdateWebsiteNewsPost,
  useListAdminWebsiteNews,
  useListAdminWebsitePerformances,
  getListAdminWebsiteNewsQueryKey,
  getGetAdminWebsiteNewsQueryKey,
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
import { ChevronLeft, Loader2, Plus, Save, Trash2, ChevronUp, ChevronDown, ImageOff } from "lucide-react";

// ─── Form schema ────────────────────────────────────────────────────────────

const textItemSchema = z.object({ value: z.string().min(1, "Required") });

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
  category: z.string().min(1, "Required"),
  categoryLabel: z.string().min(1, "Required"),
  title: z.string().min(1, "Required"),
  subtitle: z.string().min(1, "Required"),
  excerpt: z.string().optional(),
  heroImageUrl: z.string().min(1, "Required"),
  listingImageUrl: z.string().optional(),
  publishedDateInput: z.string().min(1, "Required"),
  readTime: z.string().optional(),
  isFeatured: z.boolean(),
  authorName: z.string().min(1, "Required"),
  authorRole: z.string().min(1, "Required"),
  authorAvatarUrl: z.string().optional(),
  tags: z.array(textItemSchema),
  galleryImages: z.array(textItemSchema),
  leadParagraph: z.string().min(1, "Required"),
  sections: z.array(sectionSchema).min(1, "At least one section is required"),
  relatedRefs: z.array(relatedRefSchema),
  isActive: z.boolean(),
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
  category: "",
  categoryLabel: "",
  title: "",
  subtitle: "",
  excerpt: "",
  heroImageUrl: "",
  listingImageUrl: "",
  publishedDateInput: new Date().toISOString().slice(0, 10),
  readTime: "",
  isFeatured: false,
  authorName: "",
  authorRole: "",
  authorAvatarUrl: "",
  tags: [],
  galleryImages: [],
  leadParagraph: "",
  sections: [EMPTY_SECTION],
  relatedRefs: [],
  isActive: true,
};

/** e.g. "2026-07-05" -> "July 05, 2026" (zero-padded day — matches the 6 migrated posts' exact source format). */
function formatPublishedDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const month = d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${month} ${day}, ${d.getUTCFullYear()}`;
}

const KNOWN_CATEGORIES = [
  { value: "awards", label: "Competition & Awards" },
  { value: "auditions", label: "Auditions & Masterclasses" },
  { value: "events", label: "Studio Events" },
  { value: "press", label: "Press & Media" },
];

// ─── Component ──────────────────────────────────────────────────────────────

export default function WebsiteNewsEditorPage() {
  const { slug: editingSlug } = useParams<{ slug?: string }>();
  const isEdit = Boolean(editingSlug);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { can } = useAdminAuth();
  const queryClient = useQueryClient();

  const canSave = can("website.news", isEdit ? "edit" : "create");

  const { data: existing, isLoading: loadingExisting, isError: loadError } = useGetAdminWebsiteNews(editingSlug ?? "", {
    query: { enabled: isEdit, queryKey: getGetAdminWebsiteNewsQueryKey(editingSlug ?? "") },
  });
  const { data: allPosts } = useListAdminWebsiteNews();
  // Wave 3: the Performance CMS now exists — the related-content picker
  // below uses a real catalog dropdown instead of the Wave-2 raw-slug
  // input, matching the News picker's own pattern.
  const { data: allPerformances } = useListAdminWebsitePerformances();
  const createPost = useCreateWebsiteNewsPost();
  const updatePost = useUpdateWebsiteNewsPost();
  const saving = createPost.isPending || updatePost.isPending;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: DEFAULT_VALUES,
  });
  const { control, register, handleSubmit, reset, watch, formState: { errors } } = form;

  useEffect(() => {
    if (isEdit && existing) {
      reset({
        slug: existing.slug,
        category: existing.category,
        categoryLabel: existing.categoryLabel,
        title: existing.title,
        subtitle: existing.subtitle,
        excerpt: existing.excerpt ?? "",
        heroImageUrl: existing.heroImageUrl,
        listingImageUrl: existing.listingImageUrl ?? "",
        publishedDateInput: existing.publishedAt.slice(0, 10),
        readTime: existing.readTime ?? "",
        isFeatured: existing.isFeatured,
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
        relatedRefs: existing.relatedRefs,
        isActive: existing.isActive,
      });
    }
    // Only re-sync from server data when the record identity/content
    // actually changes — not on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, existing?.slug, existing?.updatedAt]);

  const sectionsArray = useFieldArray({ control, name: "sections" });
  const relatedArray = useFieldArray({ control, name: "relatedRefs" });

  const heroImageUrl = watch("heroImageUrl");
  const currentSlug = watch("slug");

  const relatedNewsOptions = (allPosts ?? []).filter((p) => p.slug !== (editingSlug ?? currentSlug));
  const relatedPerformanceOptions = allPerformances ?? [];

  const onSubmit = (values: FormValues) => {
    const body = {
      category: values.category.trim(),
      categoryLabel: values.categoryLabel.trim(),
      title: values.title.trim(),
      subtitle: values.subtitle.trim(),
      excerpt: values.excerpt?.trim() || null,
      heroImageUrl: values.heroImageUrl.trim(),
      listingImageUrl: values.listingImageUrl?.trim() || null,
      publishedDate: formatPublishedDate(values.publishedDateInput),
      publishedAt: new Date(`${values.publishedDateInput}T00:00:00.000Z`).toISOString(),
      readTime: values.readTime?.trim() || null,
      isFeatured: values.isFeatured,
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
      relatedRefs: values.relatedRefs,
      isActive: values.isActive,
    };

    const onSuccess = () => {
      queryClient.invalidateQueries({ queryKey: getListAdminWebsiteNewsQueryKey() });
      if (isEdit && editingSlug) {
        queryClient.invalidateQueries({ queryKey: getGetAdminWebsiteNewsQueryKey(editingSlug) });
      }
      toast({ title: isEdit ? "News post updated" : "News post created" });
      navigate("/website/news");
    };
    const onError = (err: unknown) => {
      toast({ title: "Could not save News post", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    };

    if (isEdit && editingSlug) {
      updatePost.mutate({ slug: editingSlug, data: body }, { onSuccess, onError });
    } else {
      createPost.mutate({ data: { ...body, slug: values.slug.trim() } }, { onSuccess, onError });
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
        News post not found. It may have been removed.
      </div>
    );
  }

  return (
    <div className="admin2-final-page admin2-cms-workspace admin2-website-news-editor space-y-6 max-w-4xl">
      <Button variant="ghost" size="sm" onClick={() => navigate("/website/news")} className="-ml-2 text-muted-foreground">
        <ChevronLeft className="mr-1 h-4 w-4" /> Back to News
      </Button>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <fieldset disabled={!canSave} className="space-y-6">
          {/* ── Basic info ─────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Basic Info</h2>

            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input {...register("title")} data-testid="input-news-title" />
              {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Slug {isEdit && <span className="text-muted-foreground font-normal">(read-only — cannot be changed)</span>}</Label>
                <Input {...register("slug")} disabled={isEdit} data-testid="input-news-slug" placeholder="my-news-post" />
                {errors.slug && <p className="text-xs text-destructive">{errors.slug.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Published Date</Label>
                <Input type="date" {...register("publishedDateInput")} data-testid="input-news-published-date" />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Input {...register("category")} list="news-category-options" placeholder="e.g. awards" data-testid="input-news-category" />
                <datalist id="news-category-options">
                  {KNOWN_CATEGORIES.map((c) => <option key={c.value} value={c.value} />)}
                </datalist>
                {errors.category && <p className="text-xs text-destructive">{errors.category.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Category Label</Label>
                <Input {...register("categoryLabel")} placeholder="e.g. Competition & Awards" data-testid="input-news-category-label" />
                {errors.categoryLabel && <p className="text-xs text-destructive">{errors.categoryLabel.message}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Subtitle</Label>
              <Textarea rows={2} {...register("subtitle")} data-testid="input-news-subtitle" />
              {errors.subtitle && <p className="text-xs text-destructive">{errors.subtitle.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Excerpt <span className="text-muted-foreground font-normal">(optional — falls back to Subtitle on the public site)</span></Label>
              <Textarea rows={2} {...register("excerpt")} data-testid="input-news-excerpt" />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Read Time <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input {...register("readTime")} placeholder="e.g. 4 min read" data-testid="input-news-read-time" />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 mt-6">
                <Label className="mb-0">Featured</Label>
                <Switch
                  checked={watch("isFeatured")}
                  onCheckedChange={(v) => form.setValue("isFeatured", v)}
                  data-testid="switch-news-featured"
                />
              </div>
            </div>
            {watch("isFeatured") && (
              <p className="text-xs text-muted-foreground">
                Setting this post as featured will automatically un-feature the current featured post, if any.
              </p>
            )}

            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label className="mb-0">Active <span className="text-muted-foreground font-normal">(visible on the public site)</span></Label>
              <Switch
                checked={watch("isActive")}
                onCheckedChange={(v) => form.setValue("isActive", v)}
                data-testid="switch-news-active"
              />
            </div>
          </section>

          {/* ── Images ─────────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Images</h2>
            <div className="grid gap-4 md:grid-cols-[1fr_140px]">
              <div className="space-y-1.5">
                <Label>Hero Image URL</Label>
                <Input {...register("heroImageUrl")} data-testid="input-news-hero-image" />
                {errors.heroImageUrl && <p className="text-xs text-destructive">{errors.heroImageUrl.message}</p>}
                <Label className="mt-2">Listing Image URL <span className="text-muted-foreground font-normal">(optional — falls back to Hero Image)</span></Label>
                <Input {...register("listingImageUrl")} data-testid="input-news-listing-image" />
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

            <RepeatableTextList label="Gallery Images" placeholder="https://..." control={control} register={register} name="galleryImages" testId="news-gallery" />
          </section>

          {/* ── Author ─────────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Author</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input {...register("authorName")} data-testid="input-news-author-name" />
                {errors.authorName && <p className="text-xs text-destructive">{errors.authorName.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Input {...register("authorRole")} data-testid="input-news-author-role" />
                {errors.authorRole && <p className="text-xs text-destructive">{errors.authorRole.message}</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Avatar URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input {...register("authorAvatarUrl")} data-testid="input-news-author-avatar" />
            </div>
          </section>

          {/* ── Tags ───────────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Tags</h2>
            <RepeatableTextList label="" placeholder="e.g. YAGP" control={control} register={register} name="tags" testId="news-tags" inline />
          </section>

          {/* ── Content ────────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Content</h2>
            <div className="space-y-1.5">
              <Label>Lead Paragraph</Label>
              <Textarea rows={3} {...register("leadParagraph")} data-testid="input-news-lead-paragraph" />
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
              {errors.sections?.root && <p className="text-xs text-destructive">{errors.sections.root.message}</p>}

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
                        <SelectTrigger className="flex-1" data-testid={`select-related-slug-${index}`}>
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
            <Button type="button" variant="outline" onClick={() => navigate("/website/news")}>Cancel</Button>
            <Button type="submit" disabled={!canSave || saving} className="gap-2" data-testid="button-save-news">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isEdit ? "Save Changes" : "Create News Post"}
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

// ─── Repeatable plain-text list (tags, gallery images) ─────────────────────

function RepeatableTextList({
  label, placeholder, control, register, name, testId, inline,
}: {
  label: string;
  placeholder: string;
  control: Control<FormValues>;
  register: ReturnType<typeof useForm<FormValues>>["register"];
  name: "tags" | "galleryImages";
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
