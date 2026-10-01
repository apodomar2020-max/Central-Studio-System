/**
 * Website → Editorial → New post (/editorial/posts/new) — Wave 2.1D.
 *
 * ─── ONE REQUEST, NOT A WIZARD ───────────────────────────────────────────
 *
 * Re-verified against `POST /admin/editorial/posts`: the body carries the
 * shared spine (channel, optional authorId, optional featureImageUrl) AND an
 * optional first DRAFT translation in the SAME request. So no wizard is
 * needed and no half-created post can exist — the operator answers the few
 * questions that are genuinely unanswerable later (channel, first language,
 * a title) and lands in the real editor.
 *
 * Author and feature image are offered here because the create contract
 * accepts them, but both are optional: they are shared fields the editor
 * edits just as well, and demanding them up front would turn a two-field
 * form into a gate.
 *
 * On success this navigates STRAIGHT to
 * /editorial/posts/:id/:languageCode — never to an intermediary screen.
 *
 * Slug (D6): the field is optional. Left blank, the payload sends
 * `slug: null` and the SERVER generates it from the title and applies its
 * own deterministic collision suffixing. The preview below the field is
 * display only and is never submitted. Once the operator types in the field,
 * the preview stops overwriting it.
 */
import { useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateEditorialPost,
  getListEditorialPostsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { useEditorialReferenceData } from "@/hooks/use-editorial-reference-data";
import { EditorialPageShell } from "@/components/editorial/editorial-page-shell";
import { editorialErrorMessage } from "@/lib/editorial-errors";
import { bylineState, bylineStatusLabel } from "@/lib/editorial-authors";
import {
  SHARED_ACROSS_LANGUAGES_LABEL,
  SLUG_AUTO_HINT,
  channelLabel,
  describeSlugProblem,
  postCapabilities,
  slugPreview,
} from "@/lib/editorial-posts";
import {
  EMPTY_CREATE_FORM,
  toCreatePostPayload,
  validateCreateForm,
  type CreateFormErrors,
  type CreatePostFormValues,
} from "@/lib/editorial-post-form";
import { ArrowLeft, Info } from "lucide-react";
import "../admin2-final.css";

export default function EditorialPostCreatePage() {
  const { can } = useAdminAuth();
  const capabilities = postCapabilities(can);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const reference = useEditorialReferenceData();
  const createPost = useCreateEditorialPost();

  const [form, setForm] = useState<CreatePostFormValues>(EMPTY_CREATE_FORM);
  const [errors, setErrors] = useState<CreateFormErrors>({});
  /** True once the operator types in the slug field — the preview stops then. */
  const [slugTouched, setSlugTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  /** Only ACTIVE languages: a new translation in a retired language is refused. */
  const languages = useMemo(
    () => (reference.languages.data ?? []).filter((language) => language.isActive),
    [reference.languages.data],
  );

  /** Authors are channel-scoped, and only an ACTIVE author can be assigned. */
  const authors = useMemo(
    () =>
      (reference.authors.data ?? []).filter(
        (author) => author.channel === form.channel && author.status === "active",
      ),
    [reference.authors.data, form.channel],
  );

  const preview = slugTouched ? form.slug.trim() : slugPreview(form.title);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setServerError(null);
    const nextErrors = validateCreateForm(form, describeSlugProblem);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    createPost.mutate(
      { data: toCreatePostPayload(form) },
      {
        onSuccess: (result) => {
          // Narrow invalidation: only the posts list is now stale. Reference
          // data (languages/authors/topics) is untouched by a post create.
          queryClient.invalidateQueries({ queryKey: getListEditorialPostsQueryKey() });
          const languageCode = result.translation?.languageCode ?? form.languageCode;
          toast({
            title: "Post created",
            description: "It is an Editorial draft. Publishing it does not automatically make it public.",
          });
          navigate(`/editorial/posts/${result.post.id}/${languageCode}`);
        },
        onError: (err) => setServerError(editorialErrorMessage(err)),
      },
    );
  };

  if (!capabilities.canCreate) {
    return (
      <EditorialPageShell heading="New post" description="Create a unified Editorial post.">
        <div
          className="rounded-md border border-border bg-card px-4 py-6 text-sm text-muted-foreground"
          data-testid="post-create-forbidden"
        >
          You do not have permission to create posts. Creating a post needs the Create permission on
          Website Editorial Posts.
        </div>
      </EditorialPageShell>
    );
  }

  return (
    <EditorialPageShell
      heading="New post"
      description="A post starts as a draft in one language. Every other language is added afterwards, and each one is published on its own."
      actions={
        <Button asChild variant="outline" size="compact" className="gap-1.5 shrink-0">
          <Link href="/editorial/posts" data-testid="link-back-to-posts">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to posts
          </Link>
        </Button>
      }
    >
      <form onSubmit={submit} noValidate className="max-w-2xl space-y-5">
        {serverError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            data-testid="post-create-server-error"
          >
            {serverError}
          </div>
        )}

        <div className="grid gap-2">
          <Label>Channel</Label>
          <Badge variant="outline" className="w-fit">News</Badge>
          <p className="text-xs text-muted-foreground" data-testid="new-post-channel-help">
            New Editorial posts start in News. Editorial Experience is not connected to the public website; manage
            live Central Experience content from the <Link href="/website/performances" className="underline">Performance section</Link>.
          </p>
        </div>

        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
          data-testid="editorial-news-guidance"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">
            Migrated News posts are live on the public website. Public News still uses Legacy News compatibility
            metadata and provenance. New Editorial News posts are not automatically public.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="create-post-language">First language</Label>
          <Select
            value={form.languageCode}
            onValueChange={(value) => setForm((f) => ({ ...f, languageCode: value }))}
          >
            <SelectTrigger id="create-post-language" data-testid="select-post-language" aria-describedby="create-post-language-help">
              <SelectValue placeholder="Choose a language" />
            </SelectTrigger>
            <SelectContent>
              {languages.map((language) => (
                <SelectItem key={language.code} value={language.code}>
                  {language.name} ({language.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p
            id="create-post-language-help"
            className={errors.languageCode ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
          >
            {errors.languageCode ??
              "Only active languages are offered — a translation cannot be created in a retired one. You can add the other languages from the editor."}
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="create-post-title">Title</Label>
          <Input
            id="create-post-title"
            value={form.title}
            placeholder="Opening night at the studio"
            autoComplete="off"
            aria-invalid={Boolean(errors.title) || undefined}
            aria-describedby={errors.title ? "create-post-title-error" : undefined}
            data-testid="input-post-title"
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          {errors.title && (
            <p id="create-post-title-error" className="text-xs text-destructive">{errors.title}</p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="create-post-slug">Address (optional)</Label>
          <Input
            id="create-post-slug"
            value={form.slug}
            placeholder={slugPreview(form.title) || "opening-night"}
            autoComplete="off"
            dir="auto"
            aria-invalid={Boolean(errors.slug) || undefined}
            aria-describedby="create-post-slug-help"
            data-testid="input-post-slug"
            onChange={(e) => {
              setSlugTouched(true);
              setForm((f) => ({ ...f, slug: e.target.value }));
            }}
          />
          <p
            id="create-post-slug-help"
            className={errors.slug ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
            data-testid="post-slug-message"
          >
            {errors.slug ?? SLUG_AUTO_HINT}
          </p>
          {preview.length > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="post-slug-preview">
              Address preview: <span className="font-mono" dir="auto">/{preview}</span>
              {!slugTouched && " — the server confirms the final address when you save."}
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="create-post-author">Author (optional)</Label>
            <Badge variant="outline" className="text-[10px]">{SHARED_ACROSS_LANGUAGES_LABEL}</Badge>
          </div>
          <Select
            value={form.authorId == null ? "none" : String(form.authorId)}
            onValueChange={(value) =>
              setForm((f) => ({ ...f, authorId: value === "none" ? null : Number(value) }))
            }
          >
            <SelectTrigger id="create-post-author" data-testid="select-post-author" aria-describedby="create-post-author-help">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No author yet</SelectItem>
              {authors.map((author) => (
                <SelectItem key={author.id} value={String(author.id)}>
                  {author.publicName} — {bylineStatusLabel(author)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id="create-post-author-help" className="text-xs text-muted-foreground">
            {authors.length === 0 ? (
              <>
                No active {channelLabel(form.channel)} authors exist yet. You can add one in{" "}
                <Link href="/editorial/authors" className="underline">Authors</Link> and assign it from the editor.
              </>
            ) : (
              <>
                Only active {channelLabel(form.channel)} authors can be assigned. An author must have a
                biography before a post under their byline can be published.
              </>
            )}
          </p>
          {form.authorId != null && (() => {
            const chosen = authors.find((author) => author.id === form.authorId);
            if (!chosen || bylineState(chosen) === "ready") return null;
            return (
              <p className="text-xs text-muted-foreground" data-testid="post-author-byline-warning">
                {bylineStatusLabel(chosen)} — this does not block saving, only publishing.
              </p>
            );
          })()}
        </div>

        <div
          role="note"
          className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
          data-testid="post-create-next-step"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">
            The post is created as a draft with an empty body. You write the body, add the feature image
            and publish it from the editor, which opens next.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={createPost.isPending} data-testid="button-create-post">
            {createPost.isPending ? "Creating…" : "Create draft"}
          </Button>
          <Button asChild type="button" variant="outline">
            <Link href="/editorial/posts">Cancel</Link>
          </Button>
        </div>
      </form>
    </EditorialPageShell>
  );
}
