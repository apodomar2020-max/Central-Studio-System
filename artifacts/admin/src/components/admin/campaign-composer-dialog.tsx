/**
 * Notifications Wave 4 — Manual Push Campaign composer.
 *
 * Flow (matches the backend's own architecture — see notificationCampaigns.ts
 * and notificationCampaignAudience.ts): create/update the draft row with the
 * current title/body/audience config, THEN call the server preview endpoint
 * against that persisted draft. There is no "preview without a saved draft"
 * endpoint — preview always resolves the campaign's ACTUAL stored config, the
 * exact same resolver send() uses later. This is intentional: it is what
 * guarantees preview and send can never drift onto different audiences.
 *
 * The seven audience options shown here are exactly the Wave 3 contract
 * (CreatableAudienceType) — the legacy "all" alias is never offered, only
 * ever resolvable for pre-existing rows.
 */
import { useEffect, useMemo, useState } from "react";
import {
  getListClassesQueryKey,
  getListPricePackagesQueryKey,
  getListSchedulesQueryKey,
  getListStudentsQueryKey,
  useListClasses,
  useListPricePackages,
  useListSchedules,
  useListStudents,
} from "@workspace/api-client-react";
import type { Class, PricePackage, Schedule, Student } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, X, Users, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchCampaignPreview,
  useCreateCampaign,
  useUpdateCampaign,
  type AudiencePreview,
  type CreatableAudienceType,
  type NotificationCampaign,
  type AudienceConfig,
} from "@/lib/notificationCampaigns";

const AUDIENCE_OPTIONS: Array<{ value: CreatableAudienceType; label: string; helper?: string }> = [
  { value: "all_members", label: "All Members", helper: "Every real Central Studio member account." },
  { value: "specific_members", label: "Specific Members", helper: "Choose exact accounts to notify." },
  { value: "students", label: "Students" },
  { value: "parents", label: "Parents" },
  { value: "ballet_families", label: "Ballet Families", helper: "Families with a currently active Ballet enrollment — not applicants." },
  { value: "class_participants", label: "Class Participants", helper: "Confirmed bookings for one class occurrence." },
  { value: "package_holders", label: "Package Holders", helper: "Regular Studio packages only — Ballet subscriptions are excluded." },
];

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);
  return debounced;
}

function errorText(error: unknown, fallback: string): string {
  const value = error as { data?: { error?: string }; message?: string };
  return value?.data?.error ?? value?.message ?? fallback;
}

type SelectedMember = { id: number; name: string; email: string; accountType?: string | null };

type ComposerState = {
  title: string;
  body: string;
  audienceType: CreatableAudienceType;
  specificMembers: SelectedMember[];
  classId: number | null;
  scheduleId: number | null;
  occurrenceDate: string;
  packageScope: "all_active" | "package";
  packageId: number | null;
};

const EMPTY_STATE: ComposerState = {
  title: "",
  body: "",
  audienceType: "all_members",
  specificMembers: [],
  classId: null,
  scheduleId: null,
  occurrenceDate: "",
  packageScope: "all_active",
  packageId: null,
};

function toAudienceConfig(state: ComposerState): AudienceConfig | null {
  switch (state.audienceType) {
    case "all_members":
    case "students":
    case "parents":
    case "ballet_families":
      return {};
    case "specific_members":
      return state.specificMembers.length > 0 ? { studentIds: state.specificMembers.map((m) => m.id) } : null;
    case "class_participants":
      return state.classId && state.scheduleId && state.occurrenceDate
        ? { classId: state.classId, scheduleId: state.scheduleId, occurrenceDate: state.occurrenceDate }
        : null;
    case "package_holders":
      if (state.packageScope === "all_active") return { scope: "all_active" };
      return state.packageId ? { scope: "package", packageId: state.packageId } : null;
    default:
      return null;
  }
}

function isConfigComplete(state: ComposerState): boolean {
  return toAudienceConfig(state) !== null;
}

/** Next 10 upcoming dates matching the schedule's dayOfWeek — display/UX convenience only. The server (scheduleOccursOnDate + effectiveFrom/Until) remains the sole authority on validity; a past date can still be typed directly into the date field. */
function upcomingWeeklyDates(dayOfWeek: number, count = 10): string[] {
  const dates: string[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  for (let i = 0; dates.length < count && i < 120; i += 1) {
    const d = new Date(cursor);
    d.setUTCDate(d.getUTCDate() + i);
    if (d.getUTCDay() === dayOfWeek) dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function CampaignComposerDialog({
  open,
  onOpenChange,
  editing,
  canSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: NotificationCampaign | null;
  canSend: boolean;
}) {
  const { toast } = useToast();
  const [state, setState] = useState<ComposerState>(EMPTY_STATE);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const config = (editing.audienceConfig ?? {}) as Record<string, unknown>;
      setDraftId(editing.id);
      setState({
        title: editing.title,
        body: editing.body,
        audienceType: (editing.audienceType === "all" ? "all_members" : editing.audienceType) as CreatableAudienceType,
        specificMembers: [], // resolved lazily below if specific_members
        classId: typeof config.classId === "number" ? config.classId : null,
        scheduleId: typeof config.scheduleId === "number" ? config.scheduleId : null,
        occurrenceDate: typeof config.occurrenceDate === "string" ? config.occurrenceDate : "",
        packageScope: config.scope === "package" ? "package" : "all_active",
        packageId: typeof config.packageId === "number" ? config.packageId : null,
      });
    } else {
      setDraftId(null);
      setState(EMPTY_STATE);
    }
    setPreview(null);
    setPreviewError(null);
    setMemberSearch("");
  }, [open, editing]);

  // specific_members editing: resolve the already-selected IDs to display
  // names once, via the same safe search endpoint (never a bespoke lookup).
  const editingStudentIds = editing?.audienceType === "specific_members"
    ? ((editing.audienceConfig as SpecificMembersLike | null)?.studentIds ?? [])
    : [];
  const editingMembersParams = { page: 1, pageSize: 100 };
  const { data: editingMembersResponse } = useListStudents(
    editingMembersParams,
    { query: { enabled: open && editingStudentIds.length > 0 && state.specificMembers.length === 0, queryKey: getListStudentsQueryKey(editingMembersParams) } },
  );
  useEffect(() => {
    if (!editingMembersResponse || editingStudentIds.length === 0) return;
    const matched = (editingMembersResponse.students as Student[]).filter((s) => editingStudentIds.includes(s.id));
    if (matched.length > 0) {
      setState((prev) => ({ ...prev, specificMembers: matched.map((s) => ({ id: s.id, name: s.name, email: s.email, accountType: (s as Student & { accountType?: string | null }).accountType })) }));
    }
    // Any ids not found among the first page simply stay unresolved by name
    // (still functionally selected — audienceConfig.studentIds is the source
    // of truth); a search will surface them again if the admin needs to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingMembersResponse]);

  const debouncedSearch = useDebouncedValue(memberSearch.trim(), 300);
  const memberSearchParams = { search: debouncedSearch, page: 1, pageSize: 20 };
  const { data: searchResponse, isFetching: isSearchingMembers, isError: isMemberSearchError, error: memberSearchErrorRaw } = useListStudents(
    memberSearchParams,
    { query: { enabled: open && state.audienceType === "specific_members" && debouncedSearch.length >= 2, queryKey: getListStudentsQueryKey(memberSearchParams), retry: false } },
  );
  const searchResults = ((searchResponse?.students ?? []) as Array<Student & { accountType?: string | null }>).filter(
    (s) => !state.specificMembers.some((m) => m.id === s.id),
  );
  // Review fix: GET /students 403s an admin who holds notifications:create
  // but none of students.view/parents.view/users.view — that must never
  // read as "no accounts found" (searchResults would just silently be
  // empty). Surface the real permission error instead; broad segments
  // (all_members/students/parents/ballet_families/class_participants/
  // package_holders) never call this endpoint at all and remain fully
  // usable regardless of this permission.
  const memberSearchStatus = (memberSearchErrorRaw as { status?: number } | undefined)?.status;
  const isMemberSearchForbidden = isMemberSearchError && memberSearchStatus === 403;

  const { data: classes } = useListClasses({ query: { enabled: open && state.audienceType === "class_participants", queryKey: getListClassesQueryKey() } });
  const schedulesParams = { classId: state.classId ?? undefined };
  const { data: schedules } = useListSchedules(
    schedulesParams,
    { query: { enabled: open && state.audienceType === "class_participants" && state.classId != null, queryKey: getListSchedulesQueryKey(schedulesParams) } },
  );
  const selectedSchedule = (schedules as Schedule[] | undefined)?.find((s) => s.id === state.scheduleId) ?? null;
  const selectableSchedules = ((schedules as Schedule[] | undefined) ?? []).filter((s) => s.status !== "cancelled");

  const { data: packages } = useListPricePackages({ query: { enabled: open && state.audienceType === "package_holders" && state.packageScope === "package", queryKey: getListPricePackagesQueryKey() } });
  // Review fix: do NOT filter to isActive-only. package_holders' scope=package
  // resolver (notificationCampaignAudience.ts) targets EXISTING
  // package_orders holders by packageId — it never reads price_packages.isActive
  // at all. A delisted (isActive=false) package can still have real, currently
  // active holders an admin legitimately needs to message (e.g. "this package
  // is being discontinued"); hiding it here would remove that capability
  // entirely, inconsistent with backend semantics. Shown instead, badge-marked
  // Inactive — same Active/Inactive Badge convention packages.tsx itself uses.
  const packageOptions = (packages as PricePackage[] | undefined) ?? [];

  const debouncedState = useDebouncedValue(state, 500);
  const configComplete = isConfigComplete(state);
  const canPreview = state.title.trim().length > 0 && state.body.trim().length > 0 && configComplete;

  // Auto save-draft + preview whenever the debounced composer state changes
  // and is minimally complete. This is what keeps preview always reflecting
  // the CURRENT config — never a stale one — without sending on every
  // keystroke (the 500ms debounce covers that).
  useEffect(() => {
    if (!open) return;
    const config = toAudienceConfig(debouncedState);
    if (!debouncedState.title.trim() || !debouncedState.body.trim() || !config) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsPreviewing(true);
      setPreviewError(null);
      try {
        const payload = { title: debouncedState.title.trim(), body: debouncedState.body.trim(), audienceType: debouncedState.audienceType, audienceConfig: config };
        const id = draftId
          ? (await updateCampaign.mutateAsync({ id: draftId, data: payload })).id
          : (await createCampaign.mutateAsync(payload)).id;
        if (cancelled) return;
        if (!draftId) setDraftId(id);
        const result = await fetchCampaignPreview(id);
        if (!cancelled) setPreview(result);
      } catch (error) {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(errorText(error, "Could not preview this audience. Check the configuration and try again."));
        }
      } finally {
        if (!cancelled) setIsPreviewing(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
    return () => { cancelled = true; };
  }, [open, debouncedState]);

  const addMember = (student: Student & { accountType?: string | null }) => {
    setState((prev) => (prev.specificMembers.some((m) => m.id === student.id)
      ? prev
      : { ...prev, specificMembers: [...prev.specificMembers, { id: student.id, name: student.name, email: student.email, accountType: student.accountType }] }));
  };
  const removeMember = (id: number) => setState((prev) => ({ ...prev, specificMembers: prev.specificMembers.filter((m) => m.id !== id) }));

  const handleClose = () => onOpenChange(false);

  const handleSaveDraft = async () => {
    const config = toAudienceConfig(state);
    if (!state.title.trim() || !state.body.trim() || !config) {
      toast({ title: "Cannot save draft", description: "Title, message, and a complete audience configuration are required.", variant: "destructive" });
      return;
    }
    try {
      const payload = { title: state.title.trim(), body: state.body.trim(), audienceType: state.audienceType, audienceConfig: config };
      if (draftId) {
        await updateCampaign.mutateAsync({ id: draftId, data: payload });
      } else {
        const created = await createCampaign.mutateAsync(payload);
        setDraftId(created.id);
      }
      toast({ title: "Draft saved" });
      handleClose();
    } catch (error) {
      toast({ title: "Could not save draft", description: errorText(error, "Please try again."), variant: "destructive" });
    }
  };

  const isSaving = createCampaign.isPending || updateCampaign.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin2-ops-dialog max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Manual Push Campaign" : "New Manual Push Campaign"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="campaign-title">Title</Label>
            <Input id="campaign-title" data-testid="input-campaign-title" value={state.title} onChange={(e) => setState((p) => ({ ...p, title: e.target.value }))} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-body">Message</Label>
            <Textarea id="campaign-body" data-testid="input-campaign-body" rows={4} value={state.body} onChange={(e) => setState((p) => ({ ...p, body: e.target.value }))} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-audience">Audience</Label>
            <Select value={state.audienceType} onValueChange={(value) => setState((p) => ({ ...EMPTY_STATE, title: p.title, body: p.body, audienceType: value as CreatableAudienceType }))}>
              <SelectTrigger id="campaign-audience" data-testid="select-campaign-audience"><SelectValue /></SelectTrigger>
              <SelectContent>
                {AUDIENCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} data-testid={`option-audience-${opt.value}`}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {AUDIENCE_OPTIONS.find((o) => o.value === state.audienceType)?.helper && (
              <p className="text-xs text-muted-foreground">{AUDIENCE_OPTIONS.find((o) => o.value === state.audienceType)?.helper}</p>
            )}
          </div>

          {state.audienceType === "specific_members" && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <Label>Selected members ({state.specificMembers.length})</Label>
              {state.specificMembers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {state.specificMembers.map((m) => (
                    <Badge key={m.id} variant="secondary" className="gap-1 pr-1" data-testid={`chip-member-${m.id}`}>
                      {m.name}
                      <button type="button" aria-label={`Remove ${m.name}`} onClick={() => removeMember(m.id)} className="ml-1 rounded-full hover:bg-muted p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search by name, email, or phone…" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} data-testid="input-member-search" aria-label="Search members" />
              </div>
              {isSearchingMembers && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Searching…</div>}
              {isMemberSearchForbidden && (
                <p className="text-xs text-destructive" role="alert" data-testid="text-member-search-forbidden">
                  You don't have permission to search members (requires Students or Parents view access). Ask an admin to grant it, or choose a broad audience segment instead.
                </p>
              )}
              {isMemberSearchError && !isMemberSearchForbidden && (
                <p className="text-xs text-destructive" role="alert">Member search failed. Please try again.</p>
              )}
              {debouncedSearch.length >= 2 && !isSearchingMembers && !isMemberSearchError && searchResults.length === 0 && (
                <p className="text-xs text-muted-foreground">No matching accounts.</p>
              )}
              {searchResults.length > 0 && (
                <div className="max-h-40 overflow-y-auto space-y-1.5">
                  {searchResults.map((student) => (
                    <button
                      key={student.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => addMember(student)}
                      data-testid={`button-add-member-${student.id}`}
                    >
                      <span>{student.name}<span className="ml-2 text-xs text-muted-foreground">{student.email}</span></span>
                      <Badge variant="outline">{student.accountType === "parent" ? "Parent" : "Student"}</Badge>
                    </button>
                  ))}
                </div>
              )}
              {state.specificMembers.length === 0 && (
                <p className="text-xs text-amber-600">Select at least one account to proceed.</p>
              )}
            </div>
          )}

          {state.audienceType === "class_participants" && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="campaign-class">Class</Label>
                <Select
                  value={state.classId != null ? String(state.classId) : undefined}
                  onValueChange={(value) => setState((p) => ({ ...p, classId: Number(value), scheduleId: null, occurrenceDate: "" }))}
                >
                  <SelectTrigger id="campaign-class" data-testid="select-campaign-class"><SelectValue placeholder="Select a class" /></SelectTrigger>
                  <SelectContent>
                    {((classes as Class[] | undefined) ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {state.classId != null && (
                <div className="space-y-1.5">
                  <Label htmlFor="campaign-schedule">Schedule</Label>
                  <Select
                    value={state.scheduleId != null ? String(state.scheduleId) : undefined}
                    onValueChange={(value) => setState((p) => ({ ...p, scheduleId: Number(value), occurrenceDate: "" }))}
                  >
                    <SelectTrigger id="campaign-schedule" data-testid="select-campaign-schedule"><SelectValue placeholder="Select a schedule" /></SelectTrigger>
                    <SelectContent>
                      {selectableSchedules.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.type === "one_time" ? `One-time — ${s.date}` : `${DAY_NAMES[s.dayOfWeek ?? 0]} ${s.startTime}–${s.endTime}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectableSchedules.length === 0 && <p className="text-xs text-muted-foreground">No active schedules for this class.</p>}
                </div>
              )}
              {selectedSchedule && (
                <div className="space-y-1.5">
                  <Label htmlFor="campaign-occurrence">Occurrence date</Label>
                  {selectedSchedule.type === "one_time" ? (
                    <Input id="campaign-occurrence" value={selectedSchedule.date ?? ""} disabled data-testid="input-campaign-occurrence" />
                  ) : (
                    <>
                      <Input
                        id="campaign-occurrence"
                        type="date"
                        value={state.occurrenceDate}
                        onChange={(e) => setState((p) => ({ ...p, occurrenceDate: e.target.value }))}
                        data-testid="input-campaign-occurrence"
                      />
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {upcomingWeeklyDates(selectedSchedule.dayOfWeek ?? 0, 6).map((date) => (
                          <button
                            key={date}
                            type="button"
                            className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-accent"
                            onClick={() => setState((p) => ({ ...p, occurrenceDate: date }))}
                          >
                            {date}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">This schedule runs every {DAY_NAMES[selectedSchedule.dayOfWeek ?? 0]}. A past date is allowed — pick any date directly if needed.</p>
                    </>
                  )}
                </div>
              )}
              {state.classId == null && <p className="text-xs text-amber-600">Select a class, schedule, and occurrence to proceed.</p>}
            </div>
          )}

          {state.audienceType === "package_holders" && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="campaign-package-scope">Scope</Label>
                <Select value={state.packageScope} onValueChange={(value) => setState((p) => ({ ...p, packageScope: value as "all_active" | "package", packageId: null }))}>
                  <SelectTrigger id="campaign-package-scope" data-testid="select-package-scope"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_active">All Active Package Holders</SelectItem>
                    <SelectItem value="package">Specific Package</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {state.packageScope === "package" && (
                <div className="space-y-1.5">
                  <Label htmlFor="campaign-package">Package</Label>
                  <Select value={state.packageId != null ? String(state.packageId) : undefined} onValueChange={(value) => setState((p) => ({ ...p, packageId: Number(value) }))}>
                    <SelectTrigger id="campaign-package" data-testid="select-campaign-package"><SelectValue placeholder="Select a package" /></SelectTrigger>
                    <SelectContent>
                      {packageOptions.map((pkg) => (
                        <SelectItem key={pkg.id} value={String(pkg.id)}>
                          {pkg.name}{!pkg.isActive ? " (Inactive)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {packageOptions.length === 0 && <p className="text-xs text-muted-foreground">No packages found.</p>}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Regular Studio packages only — Ballet subscriptions are never included here.</p>
            </div>
          )}

          {/* Audience Preview */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-foreground flex items-center gap-2"><Users className="h-4 w-4" /> Audience Preview</p>
              {isPreviewing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            {!canPreview && !isPreviewing && (
              <p className="mt-2 text-xs text-muted-foreground">Complete the title, message, and audience configuration to see a live preview.</p>
            )}
            {previewError && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive" role="alert">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span data-testid="text-preview-error">{previewError}</span>
              </div>
            )}
            {preview && !previewError && (
              preview.matchedAccounts === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground" data-testid="text-preview-empty">No accounts currently match this audience.</p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="grid-audience-preview">
                  <PreviewMetric label="Matched accounts" value={preview.matchedAccounts} />
                  <PreviewMetric label="Push-enabled accounts" value={preview.pushEnabledAccounts} />
                  <PreviewMetric label="Active devices" value={preview.activeDevices} />
                  <PreviewMetric label="No active device" value={preview.noActiveDeviceAccounts} />
                </div>
              )
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
          <Button type="button" data-testid="button-save-draft" disabled={isSaving || !state.title.trim() || !state.body.trim() || !configComplete} onClick={handleSaveDraft}>
            {isSaving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Save Draft
          </Button>
        </DialogFooter>
        {!canSend && (
          <p className="text-xs text-muted-foreground text-right">You can save this as a draft. Sending requires the notifications:send permission.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

type SpecificMembersLike = { studentIds?: number[] };

function PreviewMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="text-2xl font-semibold text-foreground" data-testid={`text-preview-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
