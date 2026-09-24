/**
 * Website → Settings → Links (/website/settings/links) —
 * Final Editorial, Phase A.
 *
 * Replaces the last Website → Settings placeholder. Plain Admin page chrome,
 * not <EditorialPageShell>: the approved IA scopes the Editorial
 * coexistence banner to the Editorial group, and this screen configures
 * shared website settings rather than publishing Editorial content. Same
 * decision WebsiteSettingsLanguagesPage made, for the same reason.
 *
 * ─── THE BACKEND IS A SINGLETON, SO THIS IS A FORM, NOT A LIST ───────────
 *
 * Re-verified in source before any UI was designed:
 *   editorial_website_links  ONE row (id = 1, enforced by a CHECK), exactly
 *                            two nullable columns.
 *   GET  /admin/editorial/settings/links   website.settings:view
 *   PATCH /admin/editorial/settings/links  website.settings:edit
 *   No POST. No DELETE.
 *
 * There is therefore nothing to add, remove, reorder or categorise, and this
 * screen invents none of those affordances. It edits two named fields. NO
 * BACKEND CHANGE WAS MADE for this page.
 *
 * ─── EXPLICIT SAVE, ONE PATCH ────────────────────────────────────────────
 *
 * Typing mutates local state only. Save sends ONE PATCH carrying only the
 * fields that actually changed — the same "only changed fields are sent"
 * honesty every other Editorial save follows, so an untouched link never
 * appears in the audit row.
 *
 * ─── VALIDATION IS NOT RELAXED ───────────────────────────────────────────
 *
 * The inline check mirrors the server's `normalizeWebsiteLink` verbatim
 * (https-only, parseable, has a host, no markup characters or whitespace).
 * It is a courtesy so an operator sees the problem while typing; the SERVER
 * stays authoritative and its 400 is rendered verbatim through
 * lib/editorial-errors.ts. Nothing here weakens a rule for UX convenience.
 *
 * ─── NO SERVER-SIDE FETCH OF A LINK TARGET ───────────────────────────────
 *
 * Neither this screen nor the backend ever fetches a stored link. The value
 * is text in, text out — deliberately unlike an Editorial image URL, which
 * DOES go through a live-network media trust boundary. A store link points
 * at apple.com, not at an <img src>, and fetching it would be new SSRF
 * surface for no benefit. The preview below is an ordinary anchor the
 * OPERATOR chooses to click, with rel="noreferrer" and no prefetch.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEditorialWebsiteLinks,
  useUpdateEditorialWebsiteLinks,
  getGetEditorialWebsiteLinksQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { editorialErrorMessage } from "@/lib/editorial-errors";
import {
  EMPTY_WEBSITE_LINKS_FORM,
  WEBSITE_LINKS_EMPTY_STATE,
  WEBSITE_LINKS_HTTPS_NOTE,
  WEBSITE_LINKS_PAGE_DESCRIPTION,
  WEBSITE_LINKS_READ_ONLY_NOTICE,
  WEBSITE_LINKS_SAVE_LABEL,
  WEBSITE_LINK_FIELDS,
  WEBSITE_LINK_HINTS,
  WEBSITE_LINK_LABELS,
  areWebsiteLinksDirty,
  hasWebsiteLinksFormErrors,
  isWebsiteLinksEmpty,
  toWebsiteLinksFormValues,
  toWebsiteLinksPayload,
  validateWebsiteLinksForm,
  type WebsiteLinksFormValues,
} from "@/lib/editorial-website-links";
import "../../admin2-final.css";

export default function WebsiteSettingsLinksPage() {
  const { toast } = useToast();
  const { can } = useAdminAuth();
  const queryClient = useQueryClient();

  // Route access is website.settings:view. Editing additionally requires
  // website.settings:edit — the exact pair the two routes enforce. No new
  // permission catalog entry was introduced for this screen.
  const canEdit = can("website.settings", "edit");

  const { data, isLoading, isError } = useGetEditorialWebsiteLinks();
  const updateLinks = useUpdateEditorialWebsiteLinks();

  const [form, setForm] = useState<WebsiteLinksFormValues>(EMPTY_WEBSITE_LINKS_FORM);
  /** The last SAVED server answer, in form shape — the dirty/payload baseline. */
  const [baseline, setBaseline] = useState<WebsiteLinksFormValues>(EMPTY_WEBSITE_LINKS_FORM);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * Adopt the server's answer once it arrives, and again after a save (the
   * mutation's onSuccess sets both). Keyed on `updatedAt` rather than the
   * object identity so a background refetch that changed nothing cannot
   * silently discard what the operator is typing.
   */
  useEffect(() => {
    if (!data) return;
    const next = toWebsiteLinksFormValues(data);
    setForm(next);
    setBaseline(next);
  }, [data?.updatedAt, data?.googlePlayUrl, data?.appStoreUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = validateWebsiteLinksForm(form);
  const invalid = hasWebsiteLinksFormErrors(errors);
  const dirty = areWebsiteLinksDirty(form, baseline);
  const saving = updateLinks.isPending;

  const save = () => {
    if (!canEdit || !dirty || invalid || saving) return;
    setSaveError(null);
    updateLinks.mutate(
      { data: toWebsiteLinksPayload(form, baseline) },
      {
        onSuccess: (row) => {
          const next = toWebsiteLinksFormValues(row);
          setForm(next);
          setBaseline(next);
          void queryClient.invalidateQueries({ queryKey: getGetEditorialWebsiteLinksQueryKey() });
          toast({ title: "Website links saved" });
        },
        onError: (err) => {
          // Rendered verbatim, inline AND as a toast: the server owns the
          // wording, and a second place tracking backend copy would drift.
          setSaveError(editorialErrorMessage(err));
          toast({
            title: "Website links could not be saved",
            description: editorialErrorMessage(err),
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="admin2-final-page admin2-cms-workspace space-y-6" data-testid="website-links-page">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">Links</h2>
        <p className="text-sm text-muted-foreground">{WEBSITE_LINKS_PAGE_DESCRIPTION}</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground" data-testid="website-links-loading">
          Loading website links…
        </p>
      ) : isError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="website-links-load-error"
        >
          Website links could not be loaded.
        </div>
      ) : (
        <section
          className="max-w-2xl space-y-4 rounded-md border border-border bg-card p-4"
          aria-label="App store download links"
        >
          {isWebsiteLinksEmpty(baseline) && (
            <p className="text-xs text-muted-foreground" data-testid="website-links-empty-state">
              {WEBSITE_LINKS_EMPTY_STATE}
            </p>
          )}

          {WEBSITE_LINK_FIELDS.map((field) => {
            const message = errors[field];
            const value = form[field];
            const trimmed = value.trim();
            return (
              <div className="grid gap-1.5" key={field}>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`website-link-${field}`}>{WEBSITE_LINK_LABELS[field]}</Label>
                  {trimmed.length === 0 && (
                    <Badge variant="outline" className="text-[10px]" data-testid={`website-link-unset-${field}`}>
                      Not configured
                    </Badge>
                  )}
                </div>
                <Input
                  id={`website-link-${field}`}
                  value={value}
                  disabled={!canEdit || saving}
                  autoComplete="off"
                  inputMode="url"
                  placeholder="https://…"
                  aria-invalid={Boolean(message) || undefined}
                  aria-describedby={`website-link-${field}-help`}
                  data-testid={`input-website-link-${field}`}
                  onChange={(e) => setForm((current) => ({ ...current, [field]: e.target.value }))}
                />
                <p
                  id={`website-link-${field}-help`}
                  className={message ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
                  data-testid={`website-link-message-${field}`}
                >
                  {message ?? WEBSITE_LINK_HINTS[field]}
                </p>
                {!message && trimmed.length > 0 && (
                  /* An ordinary anchor the OPERATOR chooses to click. Nothing
                     server-side ever fetches this URL. */
                  <a
                    href={trimmed}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="w-fit text-xs underline text-muted-foreground"
                    data-testid={`website-link-preview-${field}`}
                  >
                    Open this link
                  </a>
                )}
              </div>
            );
          })}

          <p className="text-xs text-muted-foreground" data-testid="website-links-https-note">
            {WEBSITE_LINKS_HTTPS_NOTE}
          </p>

          {saveError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              data-testid="website-links-error-alert"
            >
              {saveError}
            </div>
          )}

          {canEdit ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                disabled={!dirty || invalid || saving}
                data-testid="button-save-website-links"
                onClick={save}
              >
                {saving ? "Saving…" : WEBSITE_LINKS_SAVE_LABEL}
              </Button>
              {dirty && (
                <Badge variant="outline" className="text-[10px]" data-testid="website-links-dirty">
                  Unsaved
                </Badge>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="website-links-read-only">
              {WEBSITE_LINKS_READ_ONLY_NOTICE}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
