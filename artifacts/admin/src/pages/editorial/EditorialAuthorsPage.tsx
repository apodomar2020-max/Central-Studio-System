/**
 * Website → Editorial → Authors (/editorial/authors) — Wave 2.1C.
 *
 * Replaces the Wave 2.1A placeholder for this one route, reusing the shape
 * proven by EditorialTopicsPage in the same wave.
 *
 * Policy, enforced by the backend and reflected here:
 *  · An author is NEVER deleted. There is no delete control on this screen and
 *    no DELETE route exists in adminEditorial.ts.
 *  · `channel` is immutable: it is absent from UpdateEditorialAuthorBody, and
 *    the database refuses the change through
 *    guard_editorial_author_channel_immutable whenever any post already
 *    carries the byline. Select on create, readOnly + disabled on edit.
 *  · `status` is a LIFECYCLE transition, never a field on the edit form.
 *    There are no dedicated activate/archive endpoints — both transitions ride
 *    the same generic PATCH as the content fields, so putting status in the
 *    dialog would let an ordinary profile edit silently double as an
 *    unconfirmed lifecycle change. Archive/Reactivate are row actions.
 *  · ARCHIVED authors are retained content-bearing rows and are shown by
 *    default (the State filter defaults to "All"). An archived author actively
 *    blocks publishing, so hiding them would be dangerous, not tidy.
 *  · `systemUserId` is deliberately NOT exposed anywhere on this screen.
 *    Nothing in the Admin reads it, no publish rule consumes it, and surfacing
 *    it would require the /api/admin/users directory and a second permission
 *    family (adminUsers) on a page guarded only by website.posts. The backend
 *    field itself is untouched.
 *  · `biography` stays OPTIONAL to save, matching the API (`nullish`, no max).
 *    It is required only at PUBLISH time, which the derived Byline column
 *    reports per-author. Nothing here is ever labelled "publish-ready": a post
 *    has several further rules (feature image, alt text, title, body blocks,
 *    an active language) this screen cannot see.
 *
 * Avatar: the server is the trust boundary. It validates HTTPS, an explicit
 * host allowlist, up to 3 redirect hops, DNS private-range rejection and an
 * image/* content type, with a ~4s timeout — so a save can be slow and can
 * fail with an unfamiliar 400. The client does a cheap https shape check only
 * (never a host block) and renders the server's 400 verbatim beside the field.
 *
 * Cache contract (load-bearing — see hooks/use-editorial-reference-data.ts):
 * the list hook is called with NO params and every mutation invalidates with
 * `getListEditorialAuthorsQueryKey()` and NO arguments, keeping this page's
 * cache entry byte-identical to the one `useEditorialReferenceData()` caches
 * with a 5-minute staleTime. All filtering is client-side for that reason.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEditorialAuthors,
  useCreateEditorialAuthor,
  useUpdateEditorialAuthor,
  getListEditorialAuthorsQueryKey,
} from "@workspace/api-client-react";
import type { EditorialAuthor } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { editorialErrorMessage } from "@/lib/editorial-errors";
import {
  AUTHOR_AVATAR_ALLOWED_HOSTS_HINT,
  AUTHOR_BIOGRAPHY_HELP,
  AUTHOR_CHANNEL_IMMUTABLE_EXPLANATION,
  AUTHOR_FROZEN_BYLINE_NOTICE,
  BYLINE_COLUMN_EXPLANATION,
  CHANNEL_OPTIONS,
  DEFAULT_AUTHOR_FILTERS,
  EMPTY_AUTHOR_FORM,
  activeAuthorFilterCount,
  archiveAuthorConfirmation,
  bylineState,
  bylineStatusLabel,
  channelLabel,
  filterAuthors,
  hasAuthorFormErrors,
  isAvatarMediaError,
  reactivateAuthorMessage,
  toAuthorCreatePayload,
  toAuthorUpdatePayload,
  validateAuthorForm,
  type AuthorFormErrors,
  type AuthorFormValues,
  type ChannelFilter,
  type StatusFilter,
} from "@/lib/editorial-authors";
import { Plus, Pencil, Archive, RotateCcw, Info } from "lucide-react";
import "../admin2-final.css";

type DialogMode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; author: EditorialAuthor };

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

export default function EditorialAuthorsPage() {
  const { toast } = useToast();
  const { can } = useAdminAuth();
  const confirmAction = useAdminConfirm();
  const queryClient = useQueryClient();

  // Route access is website.posts:view (Wave 2.1A, unchanged). The backend
  // puts POST on website.posts:create and PATCH on website.posts:edit, so the
  // page mirrors that with TWO flags rather than collapsing to one as the
  // Wave 2.1B Languages page could (its create and edit share one action).
  const canCreate = can("website.posts", "create");
  const canEdit = can("website.posts", "edit");

  // NO PARAMS. See the cache contract in the file header.
  const { data: rows, isLoading, isError } = useListEditorialAuthors();

  const createAuthor = useCreateEditorialAuthor();
  const updateAuthor = useUpdateEditorialAuthor();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>(DEFAULT_AUTHOR_FILTERS.channel);
  // Defaults to "all": archived authors are retained rows and block publishing.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(DEFAULT_AUTHOR_FILTERS.status);

  const [dialog, setDialog] = useState<DialogMode>({ kind: "closed" });
  const [form, setForm] = useState<AuthorFormValues>(EMPTY_AUTHOR_FORM);
  const [errors, setErrors] = useState<AuthorFormErrors>({});
  /** A media-validation 400 the server reported for the avatar, rendered inline. */
  const [avatarServerError, setAvatarServerError] = useState<string | null>(null);

  const filters = useMemo(
    () => ({ search: debouncedSearch, channel: channelFilter, status: statusFilter }),
    [debouncedSearch, channelFilter, statusFilter],
  );
  const authors = useMemo(() => filterAuthors(rows ?? [], filters), [rows, filters]);
  const filterCount = activeAuthorFilterCount(filters);

  /**
   * Authors only. Archiving an author affects which posts CAN publish, but
   * changes no post row — a Post Editor re-derives that from the author list
   * it re-fetches. The key builder is called with NO arguments so React
   * Query's prefix match also catches any parameterised sibling entry.
   */
  const invalidateAuthors = () =>
    queryClient.invalidateQueries({ queryKey: getListEditorialAuthorsQueryKey() });

  const failWith = (title: string) => (err: unknown) => {
    toast({ title, description: editorialErrorMessage(err), variant: "destructive" });
  };

  const openCreate = () => {
    setForm(EMPTY_AUTHOR_FORM);
    setErrors({});
    setAvatarServerError(null);
    setDialog({ kind: "create" });
  };

  const openEdit = (author: EditorialAuthor) => {
    setForm({
      channel: author.channel,
      publicName: author.publicName,
      role: author.role,
      biography: author.biography ?? "",
      avatarUrl: author.avatarUrl ?? "",
    });
    setErrors({});
    setAvatarServerError(null);
    setDialog({ kind: "edit", author });
  };

  const closeDialog = () => setDialog({ kind: "closed" });

  const isCreate = dialog.kind === "create";

  /**
   * A media 400 is the one failure that belongs next to a field rather than
   * only in a toast — but ONLY when the message is actually about the
   * avatar. A 400 is routed there solely by checking the server's own
   * "<url>: <reason>" prefix against the URL this form actually submitted
   * (see isAvatarMediaError) — not merely "status is 400 and the avatar
   * field happens to be non-empty", which would misattribute an unrelated
   * 400 (e.g. a future validation rule on another field) to this one.
   */
  const routeMutationError = (title: string) => (err: unknown) => {
    const message = editorialErrorMessage(err);
    const status = (err as { status?: number } | null)?.status;
    if (status === 400 && isAvatarMediaError(message, form.avatarUrl)) {
      setAvatarServerError(message);
      return;
    }
    toast({ title, description: message, variant: "destructive" });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (dialog.kind === "closed") return;

    const nextErrors = validateAuthorForm(form, { requireChannel: isCreate });
    setErrors(nextErrors);
    setAvatarServerError(null);
    if (hasAuthorFormErrors(nextErrors)) return;

    if (dialog.kind === "create") {
      createAuthor.mutate(
        // `status` is not sent — the route defaults a new author to "active"
        // and lifecycle is a row action. `systemUserId` is never sent.
        { data: toAuthorCreatePayload(form) },
        {
          onSuccess: (created) => {
            invalidateAuthors();
            toast({ title: `Added ${created.publicName}` });
            closeDialog();
          },
          onError: routeMutationError("Could not add author"),
        },
      );
      return;
    }

    const target = dialog.author;
    updateAuthor.mutate(
      { id: target.id, data: toAuthorUpdatePayload(form, target) },
      {
        onSuccess: (saved) => {
          invalidateAuthors();
          toast({ title: `Saved ${saved.publicName}` });
          closeDialog();
        },
        onError: routeMutationError("Could not save author"),
      },
    );
  };

  /** Archive: the generic PATCH with {status: "archived"}, behind a confirm. */
  const handleArchive = async (author: EditorialAuthor) => {
    if (!(await confirmAction(archiveAuthorConfirmation(author)))) return;
    updateAuthor.mutate(
      { id: author.id, data: { status: "archived" } },
      {
        onSuccess: () => {
          invalidateAuthors();
          toast({ title: `Archived ${author.publicName}` });
        },
        onError: failWith("Could not archive author"),
      },
    );
  };

  /** Reactivate: non-destructive and immediately reversible — no confirm. */
  const handleReactivate = (author: EditorialAuthor) => {
    updateAuthor.mutate(
      { id: author.id, data: { status: "active" } },
      {
        onSuccess: () => {
          invalidateAuthors();
          toast({
            title: `Reactivated ${author.publicName}`,
            description: reactivateAuthorMessage(author),
          });
        },
        onError: failWith("Could not reactivate author"),
      },
    );
  };

  const saving = createAuthor.isPending || updateAuthor.isPending;
  const avatarPreview = form.avatarUrl.trim();

  return (
    <EditorialPageShell
      heading="Authors"
      description="Author profiles credited on unified Editorial posts. An author belongs to one channel and is never deleted — retire one by archiving it, which leaves every already-published byline exactly as it is."
      actions={
        canCreate ? (
          <Button className="gap-2 shrink-0" data-testid="button-add-author" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add author
          </Button>
        ) : undefined
      }
    >
      <TableToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search authors by name or role"
        searchTestId="input-search-authors"
        activeFilterCount={filterCount}
        onClear={() => {
          setSearch("");
          setChannelFilter(DEFAULT_AUTHOR_FILTERS.channel);
          setStatusFilter(DEFAULT_AUTHOR_FILTERS.status);
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
                    data-testid={`filter-author-channel-${option.value}`}
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
                    data-testid={`filter-author-state-${option.value}`}
                    onClick={() => setStatusFilter(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Archived authors are shown by default — an archived author blocks publishing, so they are never hidden.
              </p>
            </fieldset>
          </div>
        }
      />

      <p className="text-xs text-muted-foreground" data-testid="byline-column-explanation">
        {BYLINE_COLUMN_EXPLANATION}
      </p>

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Byline</TableHead>
              <TableHead>Avatar</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">Loading…</TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-destructive">
                  Authors could not be loaded.
                </TableCell>
              </TableRow>
            ) : authors.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {(rows ?? []).length === 0
                    ? "No authors yet."
                    : "No authors match the current search and filters."}
                </TableCell>
              </TableRow>
            ) : (
              authors.map((author) => (
                <TableRow key={author.id} data-testid={`row-author-${author.id}`}>
                  <TableCell className="font-medium">{author.publicName}</TableCell>
                  <TableCell>{author.role}</TableCell>
                  <TableCell>
                    <Badge variant="outline" data-testid={`badge-channel-author-${author.id}`}>
                      {channelLabel(author.channel)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={bylineState(author) === "ready" ? "default" : "outline"}
                      data-testid={`badge-byline-author-${author.id}`}
                    >
                      {bylineStatusLabel(author)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {author.avatarUrl ? (
                      /* Decorative: the author's name is in the adjacent cell. */
                      <img
                        src={author.avatarUrl}
                        alt=""
                        className="h-8 w-8 rounded-full object-cover border border-border"
                        data-testid={`avatar-author-${author.id}`}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={author.status === "active" ? "default" : "outline"}
                      data-testid={`badge-state-author-${author.id}`}
                    >
                      {author.status === "active" ? "Active" : "Archived"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatUpdated(author.updatedAt)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {canEdit && (
                      <>
                        <Button
                          variant="ghost" size="icon"
                          aria-label={`Edit ${author.publicName}`}
                          data-testid={`button-edit-author-${author.id}`}
                          onClick={() => openEdit(author)}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {author.status === "active" ? (
                          <Button
                            variant="ghost" size="icon"
                            aria-label={`Archive ${author.publicName}`}
                            data-testid={`button-archive-author-${author.id}`}
                            disabled={updateAuthor.isPending}
                            onClick={() => handleArchive(author)}
                          >
                            <Archive className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost" size="icon"
                            aria-label={`Reactivate ${author.publicName}`}
                            data-testid={`button-reactivate-author-${author.id}`}
                            disabled={updateAuthor.isPending}
                            onClick={() => handleReactivate(author)}
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
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <form onSubmit={handleSubmit} noValidate>
            <DialogHeader>
              <DialogTitle>
                {isCreate ? "Add author" : `Edit ${dialog.kind === "edit" ? dialog.author.publicName : ""}`}
              </DialogTitle>
              <DialogDescription>
                {isCreate
                  ? "Create an author profile for one channel. It becomes active straight away; archiving is a separate action from the list."
                  : "Presentation only. Archiving and reactivating are done from the list."}
              </DialogDescription>
            </DialogHeader>

            {!isCreate && (
              <div
                role="note"
                className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
                data-testid="author-frozen-byline-notice"
              >
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <p className="text-xs text-muted-foreground">{AUTHOR_FROZEN_BYLINE_NOTICE}</p>
              </div>
            )}

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="author-channel">Channel</Label>
                {isCreate ? (
                  <>
                    <Select
                      value={form.channel}
                      onValueChange={(value) =>
                        setForm((f) => ({ ...f, channel: value as typeof f.channel }))
                      }
                    >
                      <SelectTrigger id="author-channel" data-testid="select-author-channel" aria-describedby="author-channel-help">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CHANNEL_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p id="author-channel-help" className="text-xs text-muted-foreground">
                      {errors.channel ?? "An author belongs to one channel. The same person writing for both surfaces is two separate author profiles."}
                    </p>
                  </>
                ) : (
                  <>
                    <Input
                      id="author-channel"
                      value={channelLabel(form.channel)}
                      readOnly
                      disabled
                      aria-describedby="author-channel-help"
                      data-testid="input-author-channel"
                    />
                    <p id="author-channel-help" className="text-xs text-muted-foreground">
                      {AUTHOR_CHANNEL_IMMUTABLE_EXPLANATION}
                    </p>
                  </>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="author-public-name">Public name</Label>
                <Input
                  id="author-public-name"
                  name="publicName"
                  value={form.publicName}
                  placeholder="Nour Hassan"
                  aria-invalid={Boolean(errors.publicName) || undefined}
                  aria-describedby={errors.publicName ? "author-public-name-error" : undefined}
                  data-testid="input-author-public-name"
                  onChange={(e) => setForm((f) => ({ ...f, publicName: e.target.value }))}
                />
                {errors.publicName && (
                  <p id="author-public-name-error" className="text-xs text-destructive">{errors.publicName}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="author-role">Role</Label>
                <Input
                  id="author-role"
                  name="role"
                  value={form.role}
                  placeholder="Resident choreographer"
                  aria-invalid={Boolean(errors.role) || undefined}
                  aria-describedby={errors.role ? "author-role-error" : undefined}
                  data-testid="input-author-role"
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                />
                {errors.role && (
                  <p id="author-role-error" className="text-xs text-destructive">{errors.role}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="author-biography">Biography</Label>
                <Textarea
                  id="author-biography"
                  name="biography"
                  rows={4}
                  value={form.biography}
                  placeholder="A short paragraph shown with this byline."
                  aria-describedby="author-biography-help"
                  data-testid="input-author-biography"
                  onChange={(e) => setForm((f) => ({ ...f, biography: e.target.value }))}
                />
                {/* Optional to SAVE (D3) — required only by the publish gate. */}
                <p id="author-biography-help" className="text-xs text-muted-foreground">
                  {AUTHOR_BIOGRAPHY_HELP}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="author-avatar-url">Avatar URL</Label>
                <Input
                  id="author-avatar-url"
                  name="avatarUrl"
                  value={form.avatarUrl}
                  autoComplete="off"
                  placeholder="https://images.unsplash.com/…"
                  aria-invalid={Boolean(errors.avatarUrl || avatarServerError) || undefined}
                  aria-describedby="author-avatar-url-help"
                  data-testid="input-author-avatar-url"
                  onChange={(e) => {
                    setAvatarServerError(null);
                    setForm((f) => ({ ...f, avatarUrl: e.target.value }));
                  }}
                />
                {/* The server's media 400 is shown verbatim, right here, because
                    it is always about this one value. */}
                <p
                  id="author-avatar-url-help"
                  className={errors.avatarUrl || avatarServerError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
                  data-testid="author-avatar-message"
                >
                  {errors.avatarUrl ?? avatarServerError ?? AUTHOR_AVATAR_ALLOWED_HOSTS_HINT}
                </p>
                {avatarPreview.length > 0 && !errors.avatarUrl && (
                  <img
                    src={avatarPreview}
                    alt=""
                    className="h-16 w-16 rounded-full object-cover border border-border"
                    data-testid="author-avatar-preview"
                  />
                )}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button type="submit" disabled={saving} data-testid="button-save-author">
                {/* Saving can take several seconds: the server fetches and
                    validates the avatar link before answering. */}
                {saving ? "Saving…" : isCreate ? "Add author" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </EditorialPageShell>
  );
}
