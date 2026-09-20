/**
 * Website → Editorial → Post (/editorial/posts/:id) — Wave 2.1D.
 *
 * D8: a bare post id is not an editing surface of its own. A post has no
 * title, slug, body or status — all of that is per-translation — so there is
 * nothing here to edit that the translation editor does not already show
 * alongside the language it belongs to. Duplicating the shared-settings cards
 * on a second route would create two places to change one value and two
 * dirty states for one endpoint.
 *
 * So this route RESOLVES and redirects: to the published translation when
 * there is one, else a draft, else an archived one, each tie broken by the
 * language registry's own display order.
 *
 * The one case that cannot redirect is a post with ZERO translations — which
 * is reachable, because `POST /admin/editorial/posts` accepts a body with no
 * `translation` at all. That gets a real recovery screen rather than a
 * redirect loop or a blank page.
 */
import { useEffect, useMemo } from "react";
import { Link, useLocation, useRoute } from "wouter";
import {
  useGetEditorialPost,
  getGetEditorialPostQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useEditorialReferenceData } from "@/hooks/use-editorial-reference-data";
import { EditorialPageShell } from "@/components/editorial/editorial-page-shell";
import {
  INACTIVE_LANGUAGE_ADD_BLOCKED,
  buildLanguageSlots,
  canAddTranslation,
  channelLabel,
  postCapabilities,
  preferredTranslationCode,
} from "@/lib/editorial-posts";
import { ArrowLeft, Plus } from "lucide-react";
import "../admin2-final.css";

export default function EditorialPostDetailPage() {
  const [match, params] = useRoute("/editorial/posts/:id");
  const postId = Number(params?.id ?? 0);

  const { can } = useAdminAuth();
  const capabilities = postCapabilities(can);
  const [, navigate] = useLocation();

  const reference = useEditorialReferenceData();
  // The generated options object spreads the caller's `query` last, so the
  // key must be supplied whenever any query option is passed — the same
  // convention hooks/use-editorial-reference-data.ts follows.
  const post = useGetEditorialPost(postId, {
    query: { queryKey: getGetEditorialPostQueryKey(postId), enabled: postId > 0 },
  });

  const slots = useMemo(
    () =>
      buildLanguageSlots(
        reference.languages.data ?? [],
        (post.data?.translations ?? []).map((row) => ({
          languageCode: row.languageCode,
          title: row.title,
          status: row.status,
        })),
      ),
    [reference.languages.data, post.data?.translations],
  );

  const target = useMemo(() => preferredTranslationCode(slots), [slots]);

  useEffect(() => {
    if (!post.data || slots.length === 0 || !target) return;
    // `replace` so the browser Back button returns to the list rather than
    // bouncing through this resolver again.
    navigate(`/editorial/posts/${postId}/${target}`, { replace: true });
  }, [post.data, slots.length, target, postId, navigate]);

  if (!match || postId <= 0) return null;

  if (post.isLoading || reference.languages.isLoading) {
    return (
      <EditorialPageShell heading="Post">
        <div className="rounded-md border border-border bg-card px-4 py-8 text-sm text-muted-foreground">
          Loading…
        </div>
      </EditorialPageShell>
    );
  }

  if (post.isError || !post.data) {
    return (
      <EditorialPageShell heading="Post">
        <div
          className="rounded-md border border-border bg-card px-4 py-8 text-sm text-destructive"
          data-testid="post-detail-error"
        >
          This post could not be loaded. It may have been removed, or you may not have permission to see it.
        </div>
      </EditorialPageShell>
    );
  }

  // Redirecting — render nothing rather than flashing the recovery screen.
  if (target) return null;

  const postRow = post.data.post;
  const addable = slots.filter(canAddTranslation);

  return (
    <EditorialPageShell
      heading="This post has no languages yet"
      description={`${channelLabel(postRow.channel)} · post #${postRow.id}. A post is only a shared spine — its title, address and body all live on a translation, so nothing is readable until one language exists.`}
      actions={
        <Button asChild variant="outline" size="compact" className="gap-1.5 shrink-0">
          <Link href="/editorial/posts" data-testid="link-back-to-posts">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to posts
          </Link>
        </Button>
      }
    >
      <section
        className="rounded-md border border-border bg-card p-4 space-y-3"
        data-testid="post-no-translations-recovery"
      >
        <h3 className="text-sm font-semibold text-foreground">Add the first language</h3>

        {!capabilities.canCreate ? (
          <p className="text-sm text-muted-foreground">
            Adding a translation needs the Create permission on Website Editorial Posts.
          </p>
        ) : addable.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="no-addable-languages">
            {INACTIVE_LANGUAGE_ADD_BLOCKED}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {addable.map((slot) => (
              <Button
                key={slot.code}
                type="button"
                variant="outline"
                size="compact"
                className="gap-1.5"
                data-testid={`button-add-language-${slot.code}`}
                onClick={() => navigate(`/editorial/posts/${postId}/${slot.code}`)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {slot.name}
              </Button>
            ))}
          </div>
        )}

        {slots.some((slot) => slot.state === "missing-inactive") && (
          <p className="text-xs text-muted-foreground">
            Retired languages are not offered:{" "}
            {slots
              .filter((slot) => slot.state === "missing-inactive")
              .map((slot) => slot.name)
              .join(", ")}
            .
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground">Shared settings so far:</span>
          <Badge variant="outline">{channelLabel(postRow.channel)}</Badge>
          <Badge variant="outline">
            {postRow.authorId == null ? "No author" : `Author #${postRow.authorId}`}
          </Badge>
          <Badge variant="outline">
            {postRow.featureImageUrl ? "Feature image set" : "No feature image"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Author, feature image and topics are edited from the language editor, which opens once a
          translation exists.
        </p>
      </section>
    </EditorialPageShell>
  );
}
