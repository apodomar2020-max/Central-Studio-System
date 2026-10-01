/**
 * Website → Editorial → Topics (/editorial/topics) — Wave 2.1C.
 *
 * Replaces the Wave 2.1A placeholder for this one route. A topic is a flat,
 * four-field entity (channel, name, slug, status), so create and edit are
 * inline Dialogs — the project's established "simple entity → Dialog"
 * convention, the same shape Wave 2.1B used for Languages.
 *
 * Policy, enforced by the backend and reflected here:
 *  · A topic is NEVER deleted. There is no delete control on this screen and
 *    no DELETE route exists in adminEditorial.ts.
 *  · `channel` is immutable — it decides which posts may carry the tag. It is
 *    structurally absent from UpdateEditorialTopicBody. NOTE: unlike authors,
 *    there is NO database trigger backing this; the API shape is the only
 *    enforcement. Do not assume a DB guarantee here.
 *  · `status` is a LIFECYCLE transition, never a field on the edit form.
 *    Authors and Topics have no dedicated activate/archive endpoints — both
 *    transitions ride the same generic PATCH as the content fields, so putting
 *    status in the dialog would let an ordinary profile edit silently double
 *    as an unconfirmed lifecycle change. Archive/Reactivate are row actions
 *    with their own confirm flow.
 *  · ARCHIVED topics are retained content-bearing rows and are shown by
 *    default (the State filter defaults to "All").
 *
 * Conflicts are decided by the server. This screen never predicts them: a
 * duplicate slug 409 is rendered verbatim inline beside the slug field through
 * `lib/editorial-errors.ts`. The backend's 23505 message currently says
 * "...for this channel and language" — the word "language" is wrong for a
 * topic (topics have no language dimension). That is a pre-existing backend
 * copy defect, deliberately NOT corrected here: Editorial renders backend 4xx
 * verbatim, and a second place tracking backend copy would be worse. The fix
 * belongs in a backend wave.
 *
 * Cache contract (load-bearing — see hooks/use-editorial-reference-data.ts):
 * the list hook is called with NO params and every mutation invalidates with
 * `getListEditorialTopicsQueryKey()` and NO arguments. That keeps this page's
 * cache entry byte-identical to the one `useEditorialReferenceData()` caches
 * with a 5-minute staleTime, so a future Post Editor's topic picker can never
 * go stale after an edit made here. All filtering is therefore client-side
 * over the complete unpaginated array.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEditorialTopics,
  useCreateEditorialTopic,
  useUpdateEditorialTopic,
  getListEditorialTopicsQueryKey,
} from "@workspace/api-client-react";
import type { EditorialTopic } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TableToolbar } from "@/components/admin/table-toolbar";
import { useAdminConfirm } from "@/components/admin/admin-confirm";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useToast } from "@/hooks/use-toast";
import { EditorialPageShell } from "@/components/editorial/editorial-page-shell";
import { EditorialWorkspaceNav } from "@/components/editorial/editorial-workspace-nav";
import { editorialErrorMessage } from "@/lib/editorial-errors";
import {
  CHANNEL_OPTIONS,
  DEFAULT_TOPIC_FILTERS,
  EMPTY_TOPIC_FORM,
  TOPIC_CHANNEL_IMMUTABLE_EXPLANATION,
  TOPIC_SLUG_EDIT_EXPLANATION,
  activeTopicFilterCount,
  archiveTopicConfirmation,
  channelLabel,
  filterTopics,
  hasTopicFormErrors,
  nextSlugForNameChange,
  reactivateTopicMessage,
  validateTopicForm,
  type ChannelFilter,
  type StatusFilter,
  type TopicFormErrors,
  type TopicFormValues,
} from "@/lib/editorial-topics";
import { Plus, Pencil, Archive, RotateCcw } from "lucide-react";
import "../admin2-final.css";
import "../admin2-operations.css";

type DialogMode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; topic: EditorialTopic };

const CHANNEL_FILTER_OPTIONS: ReadonlyArray<{ value: ChannelFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "news", label: "News" },
  { value: "experience", label: "Experience" },
];

const STATE_FILTER_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

function formatUpdated(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toISOString().slice(0, 10);
}

export default function EditorialTopicsPage() {
  const { toast } = useToast();
  const { can } = useAdminAuth();
  const confirmAction = useAdminConfirm();
  const queryClient = useQueryClient();

  // Route access is website.posts:view (Wave 2.1A, unchanged). The backend
  // separates create from edit on this family, so the page mirrors it with two
  // flags rather than collapsing to one as the Languages page could.
  const canCreate = can("website.posts", "create");
  const canEdit = can("website.posts", "edit");

  // NO PARAMS. See the cache contract in the file header — filtering is
  // client-side precisely so this key stays identical to the reference-data
  // hook's default entry.
  const { data: rows, isLoading, isError } = useListEditorialTopics();

  const createTopic = useCreateEditorialTopic();
  const updateTopic = useUpdateEditorialTopic();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>(DEFAULT_TOPIC_FILTERS.channel);
  // Defaults to "all": archived topics are retained rows and are never
  // silently hidden.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(DEFAULT_TOPIC_FILTERS.status);

  const [dialog, setDialog] = useState<DialogMode>({ kind: "closed" });
  const [form, setForm] = useState<TopicFormValues>(EMPTY_TOPIC_FORM);
  const [errors, setErrors] = useState<TopicFormErrors>({});
  /** True once the operator types in the slug field themselves (D5). */
  const [slugTouched, setSlugTouched] = useState(false);
  /** A conflict the server reported for the slug field, rendered inline. */
  const [slugConflict, setSlugConflict] = useState<string | null>(null);

  const filters = useMemo(
    () => ({ search: debouncedSearch, channel: channelFilter, status: statusFilter }),
    [debouncedSearch, channelFilter, statusFilter],
  );
  const topics = useMemo(() => filterTopics(rows ?? [], filters), [rows, filters]);
  const filterCount = activeTopicFilterCount(filters);

  /**
   * Topics only. No mutation on this screen changes a language, author,
   * post or placement. The key builder is called with NO arguments so React
   * Query's prefix match also catches any parameterised sibling entry.
   */
  const invalidateTopics = () =>
    queryClient.invalidateQueries({ queryKey: getListEditorialTopicsQueryKey() });

  const failWith = (title: string) => (err: unknown) => {
    toast({ title, description: editorialErrorMessage(err), variant: "destructive" });
  };

  const openCreate = () => {
    setForm(EMPTY_TOPIC_FORM);
    setErrors({});
    setSlugTouched(false);
    setSlugConflict(null);
    setDialog({ kind: "create" });
  };

  const openEdit = (topic: EditorialTopic) => {
    setForm({ channel: topic.channel, name: topic.name, slug: topic.slug });
    setErrors({});
    // An existing slug is never auto-rewritten from the name (D5).
    setSlugTouched(true);
    setSlugConflict(null);
    setDialog({ kind: "edit", topic });
  };

  const closeDialog = () => setDialog({ kind: "closed" });

  const isCreate = dialog.kind === "create";

  const handleNameChange = (nextName: string) => {
    setForm((f) => ({
      ...f,
      name: nextName,
      slug: nextSlugForNameChange(
        { name: f.name, slug: f.slug, slugTouched },
        nextName,
        isCreate ? "create" : "edit",
      ),
    }));
  };

  const handleSlugChange = (nextSlug: string) => {
    setSlugTouched(true);
    setSlugConflict(null);
    setForm((f) => ({ ...f, slug: nextSlug }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (dialog.kind === "closed") return;

    const nextErrors = validateTopicForm(form, { requireChannel: isCreate });
    setErrors(nextErrors);
    setSlugConflict(null);
    if (hasTopicFormErrors(nextErrors)) return;

    if (dialog.kind === "create") {
      createTopic.mutate(
        {
          // `status` is deliberately not sent — the route defaults a new topic
          // to "active" and lifecycle is a row action, never a form field.
          data: { channel: form.channel, name: form.name.trim(), slug: form.slug.trim() },
        },
        {
          onSuccess: (created) => {
            invalidateTopics();
            toast({ title: `Added ${created.name}` });
            closeDialog();
          },
          onError: (err: unknown) => {
            const message = editorialErrorMessage(err);
            const status = (err as { status?: number } | null)?.status;
            if (status === 409) {
              // A duplicate slug for this channel is the only conflict create
              // can produce — show the backend's own words next to the field,
              // verbatim and uncorrected.
              setSlugConflict(message);
              return;
            }
            toast({ title: "Could not add topic", description: message, variant: "destructive" });
          },
        },
      );
      return;
    }

    const target = dialog.topic;
    updateTopic.mutate(
      // `channel` and `status` are never sent from this dialog.
      { id: target.id, data: { name: form.name.trim(), slug: form.slug.trim() } },
      {
        onSuccess: (saved) => {
          invalidateTopics();
          toast({ title: `Saved ${saved.name}` });
          closeDialog();
        },
        onError: (err: unknown) => {
          const message = editorialErrorMessage(err);
          const status = (err as { status?: number } | null)?.status;
          if (status === 409) {
            setSlugConflict(message);
            return;
          }
          toast({ title: "Could not save topic", description: message, variant: "destructive" });
        },
      },
    );
  };

  /** Archive: the generic PATCH with {status: "archived"}, behind a confirm. */
  const handleArchive = async (topic: EditorialTopic) => {
    if (!(await confirmAction(archiveTopicConfirmation(topic)))) return;
    updateTopic.mutate(
      { id: topic.id, data: { status: "archived" } },
      {
        onSuccess: () => {
          invalidateTopics();
          toast({ title: `Archived ${topic.name}` });
        },
        onError: failWith("Could not archive topic"),
      },
    );
  };

  /** Reactivate: non-destructive and immediately reversible — no confirm. */
  const handleReactivate = (topic: EditorialTopic) => {
    updateTopic.mutate(
      { id: topic.id, data: { status: "active" } },
      {
        onSuccess: () => {
          invalidateTopics();
          toast({ title: `Reactivated ${topic.name}`, description: reactivateTopicMessage(topic) });
        },
        onError: failWith("Could not reactivate topic"),
      },
    );
  };

  const saving = createTopic.isPending || updateTopic.isPending;

  return (
    <EditorialPageShell
      actions={
        canCreate ? (
          <Button className="gap-2 shrink-0" data-testid="button-add-topic" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add topic
          </Button>
        ) : undefined
      }
    >
      <EditorialWorkspaceNav />
      <TableToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search topics by name or slug"
        searchTestId="input-search-topics"
        activeFilterCount={filterCount}
        onClear={() => {
          setSearch("");
          setChannelFilter(DEFAULT_TOPIC_FILTERS.channel);
          setStatusFilter(DEFAULT_TOPIC_FILTERS.status);
        }}
        filtersContent={
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">Channel</legend>
              <div className="flex flex-wrap gap-1.5">
                {CHANNEL_FILTER_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    size="compact"
                    variant={channelFilter === option.value ? "default" : "outline"}
                    aria-pressed={channelFilter === option.value}
                    data-testid={`filter-topic-channel-${option.value}`}
                    onClick={() => setChannelFilter(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">State</legend>
              <div className="flex flex-wrap gap-1.5">
                {STATE_FILTER_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    size="compact"
                    variant={statusFilter === option.value ? "default" : "outline"}
                    aria-pressed={statusFilter === option.value}
                    data-testid={`filter-topic-state-${option.value}`}
                    onClick={() => setStatusFilter(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Archived topics are shown by default — they stay on the posts already tagged with them.
              </p>
            </fieldset>
          </div>
        }
      />

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">Loading…</TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-destructive">
                  Topics could not be loaded.
                </TableCell>
              </TableRow>
            ) : topics.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {(rows ?? []).length === 0
                    ? "No topics yet."
                    : "No topics match the current search and filters."}
                </TableCell>
              </TableRow>
            ) : (
              topics.map((topic) => (
                <TableRow key={topic.id} data-testid={`row-topic-${topic.id}`}>
                  <TableCell className="font-medium">{topic.name}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{topic.slug}</TableCell>
                  <TableCell>
                    <Badge variant="outline" data-testid={`badge-channel-topic-${topic.id}`}>
                      {channelLabel(topic.channel)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={topic.status === "active" ? "default" : "outline"}
                      data-testid={`badge-state-topic-${topic.id}`}
                    >
                      {topic.status === "active" ? "Active" : "Archived"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatUpdated(topic.updatedAt)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {canEdit && (
                      <>
                        <Button
                          variant="ghost" size="icon"
                          aria-label={`Edit ${topic.name}`}
                          data-testid={`button-edit-topic-${topic.id}`}
                          onClick={() => openEdit(topic)}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {topic.status === "active" ? (
                          <Button
                            variant="ghost" size="icon"
                            aria-label={`Archive ${topic.name}`}
                            data-testid={`button-archive-topic-${topic.id}`}
                            disabled={updateTopic.isPending}
                            onClick={() => handleArchive(topic)}
                          >
                            <Archive className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost" size="icon"
                            aria-label={`Reactivate ${topic.name}`}
                            data-testid={`button-reactivate-topic-${topic.id}`}
                            disabled={updateTopic.isPending}
                            onClick={() => handleReactivate(topic)}
                          >
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        )}
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialog.kind !== "closed"} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleSubmit} noValidate>
            <DialogHeader>
              <DialogTitle>
                {isCreate ? "Add topic" : `Edit ${dialog.kind === "edit" ? dialog.topic.name : ""}`}
              </DialogTitle>
              <DialogDescription>
                {isCreate
                  ? "Register a topic for one channel. It becomes active straight away; archiving is a separate action from the list."
                  : "Presentation only. Archiving and reactivating are done from the list."}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="topic-channel">Channel</Label>
                {isCreate ? (
                  <>
                    <Select
                      value={form.channel}
                      onValueChange={(value) =>
                        setForm((f) => ({ ...f, channel: value as typeof f.channel }))
                      }
                    >
                      <SelectTrigger id="topic-channel" data-testid="select-topic-channel" aria-describedby="topic-channel-help">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CHANNEL_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p id="topic-channel-help" className="text-xs text-muted-foreground">
                      {errors.channel ?? "A topic belongs to one channel and can only be added to posts on that channel. The same label on both surfaces is two separate topics."}
                    </p>
                  </>
                ) : (
                  <>
                    <Input
                      id="topic-channel"
                      value={channelLabel(form.channel)}
                      readOnly
                      disabled
                      aria-describedby="topic-channel-help"
                      data-testid="input-topic-channel"
                    />
                    <p id="topic-channel-help" className="text-xs text-muted-foreground">
                      {TOPIC_CHANNEL_IMMUTABLE_EXPLANATION}
                    </p>
                  </>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="topic-name">Name</Label>
                <Input
                  id="topic-name"
                  name="name"
                  value={form.name}
                  placeholder="Behind the scenes"
                  aria-invalid={Boolean(errors.name) || undefined}
                  aria-describedby={errors.name ? "topic-name-error" : undefined}
                  data-testid="input-topic-name"
                  onChange={(e) => handleNameChange(e.target.value)}
                />
                {errors.name && (
                  <p id="topic-name-error" className="text-xs text-destructive">{errors.name}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="topic-slug">Slug</Label>
                <Input
                  id="topic-slug"
                  name="slug"
                  value={form.slug}
                  autoComplete="off"
                  placeholder="behind-the-scenes"
                  className="font-mono"
                  aria-invalid={Boolean(errors.slug || slugConflict) || undefined}
                  aria-describedby="topic-slug-help"
                  data-testid="input-topic-slug"
                  onChange={(e) => handleSlugChange(e.target.value)}
                />
                {/* The 409 is the server's own words, rendered verbatim here
                    rather than as a toast so the operator sees which field to
                    change. */}
                <p
                  id="topic-slug-help"
                  className={errors.slug || slugConflict ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
                  data-testid="topic-slug-message"
                >
                  {errors.slug ?? slugConflict ?? (
                    isCreate
                      ? "Suggested from the name while you type — edit it and the suggestion stops. Lowercase letters, numbers and hyphens only."
                      : TOPIC_SLUG_EDIT_EXPLANATION
                  )}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button type="submit" disabled={saving} data-testid="button-save-topic">
                {saving ? "Saving…" : isCreate ? "Add topic" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </EditorialPageShell>
  );
}
