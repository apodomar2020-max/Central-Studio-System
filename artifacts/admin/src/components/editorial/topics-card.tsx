/**
 * Topics card — extracted verbatim from EditorialPostTranslationPage so the
 * one-screen Add News page can reuse it before the post exists.
 *
 * Searchable multi-select with removable chips. Options are ACTIVE topics in
 * the post's channel, unioned with any currently-assigned topic id so an
 * archived-but-assigned topic still renders (with a badge, not selectable for
 * a NEW assignment). Saving sends the complete desired set: the route
 * replaces rather than merges.
 *
 * Two modes, one rendering:
 *  - persisted (Edit page): `onSave` is supplied, so the card has its own
 *    dirty badge, error slot and Save button — the scoped-save pattern;
 *  - pending (Add News): `onSave` is omitted. The selection is plain local
 *    state that the create orchestration applies right after the post is
 *    created, so the card renders no Save button of its own.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SHARED_ACROSS_LANGUAGES_LABEL } from "@/lib/editorial-posts";
import { Plus, X } from "lucide-react";

export function TopicsCard({
  channel,
  topics,
  selected,
  dirty = false,
  saving = false,
  disabled,
  error = null,
  onChange,
  onSave,
}: {
  channel: string;
  topics: ReadonlyArray<{ id: number; name: string; channel: string; status: "active" | "archived" }>;
  selected: number[];
  dirty?: boolean;
  saving?: boolean;
  disabled?: boolean;
  error?: string | null;
  onChange: (next: number[]) => void;
  /** Omitted in pending (no-post-yet) mode: nothing to save to yet. */
  onSave?: () => void;
}) {
  const [search, setSearch] = useState("");
  const inChannel = topics.filter((topic) => topic.channel === channel);
  const byId = new Map(inChannel.map((topic) => [topic.id, topic]));
  const needle = search.trim().toLowerCase();

  const options = inChannel.filter(
    (topic) =>
      topic.status === "active" &&
      !selected.includes(topic.id) &&
      (needle.length === 0 || topic.name.toLowerCase().includes(needle)),
  );

  return (
    <section className="rounded-md border border-border bg-card p-3 space-y-3" data-testid="topics-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Topics</h3>
        {dirty && <Badge variant="outline" className="text-[10px]" data-testid="topics-dirty">Unsaved</Badge>}
      </div>
      <p className="text-[11px] text-muted-foreground">{SHARED_ACROSS_LANGUAGES_LABEL}</p>

      <div className="flex flex-wrap gap-1.5" data-testid="topic-chips">
        {selected.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">No topics assigned.</span>
        ) : (
          selected.map((id) => {
            const topic = byId.get(id);
            return (
              <Badge key={id} variant="outline" className="gap-1" data-testid={`topic-chip-${id}`}>
                {topic?.name ?? `Topic #${id}`}
                {topic && topic.status !== "active" && <span className="opacity-70">(archived)</span>}
                {!disabled && (
                  <button
                    type="button"
                    aria-label={`Remove topic ${topic?.name ?? id}`}
                    data-testid={`button-remove-topic-${id}`}
                    onClick={() => onChange(selected.filter((current) => current !== id))}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </Badge>
            );
          })
        )}
      </div>

      {inChannel.length === 0 ? (
        <p className="text-[11px] text-muted-foreground" data-testid="no-topics-empty-state">
          No {channel} topics exist yet. Create one in{" "}
          <Link href="/editorial/topics" className="underline">Topics</Link>.
        </p>
      ) : (
        <>
          <Input
            value={search}
            disabled={disabled}
            placeholder="Search topics…"
            aria-label="Search topics to add"
            data-testid="input-topic-search"
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
            {options.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">No more matching topics.</span>
            ) : (
              options.map((topic) => (
                <Button
                  key={topic.id}
                  type="button"
                  size="compact"
                  variant="outline"
                  className="gap-1"
                  disabled={disabled}
                  data-testid={`button-add-topic-${topic.id}`}
                  onClick={() => onChange([...selected, topic.id])}
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  {topic.name}
                </Button>
              ))
            )}
          </div>
        </>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
          data-testid="topics-error-alert"
        >
          {error}
        </div>
      )}

      {onSave && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={disabled || !dirty || saving}
          data-testid="button-save-topics"
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save topics"}
        </Button>
      )}
    </section>
  );
}
