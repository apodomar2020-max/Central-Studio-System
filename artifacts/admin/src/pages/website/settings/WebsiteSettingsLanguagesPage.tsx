/**
 * Website → Configuration → Languages (/website/settings/languages) —
 * Wave 2.1B.
 *
 * Replaces the Wave 2.1A placeholder for this one route. Languages are a
 * short, flat entity (code, name, native name, direction, order) so create
 * and edit are inline Dialogs, matching the project's established
 * "simple entity → Dialog" convention (schedules.tsx, branches.tsx) rather
 * than the "complex entity → dedicated page" convention News uses.
 *
 * Policy, enforced by the backend and reflected here:
 *  · A language is NEVER deleted. There is no delete control on this screen.
 *  · `code` is immutable — every stored translation is keyed to it.
 *  · isActive / isDefault are lifecycle transitions with their own endpoints,
 *    not fields on the generic PATCH.
 *  · INACTIVE languages are retained and shown by default; deactivating one
 *    changes no translation's stored status.
 *
 * Conflicts (duplicate code, "the default cannot be deactivated", "the last
 * active language cannot be deactivated", a single-default race) are decided
 * by the server. This screen never predicts them: it renders the backend's
 * own 4xx message verbatim through `lib/editorial-errors.ts`.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEditorialLanguages,
  useCreateEditorialLanguage,
  useUpdateEditorialLanguage,
  useActivateEditorialLanguage,
  useDeactivateEditorialLanguage,
  useSetDefaultEditorialLanguage,
  getListEditorialLanguagesQueryKey,
} from "@workspace/api-client-react";
import type { EditorialLanguageWithUsage } from "@workspace/api-client-react";
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
import { useAdminConfirm } from "@/components/admin/admin-confirm";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { editorialErrorMessage } from "@/lib/editorial-errors";
import {
  DIRECTION_OPTIONS,
  EMPTY_LANGUAGE_FORM,
  LANGUAGE_CODE_IMMUTABLE_EXPLANATION,
  activateConfirmationMessage,
  canonicalizeEditorialLanguageCode,
  deactivateConfirmation,
  directionLabel,
  hasFormErrors,
  setDefaultConfirmation,
  sortLanguagesForDisplay,
  validateLanguageForm,
  type LanguageFormErrors,
  type LanguageFormValues,
} from "@/lib/editorial-languages";
import { Plus, Pencil, EyeOff, RotateCcw, Star } from "lucide-react";
import "../../admin2-final.css";

type DialogMode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; language: EditorialLanguageWithUsage };

export default function WebsiteSettingsLanguagesPage() {
  const { toast } = useToast();
  const { can } = useAdminAuth();
  const confirmAction = useAdminConfirm();
  const queryClient = useQueryClient();

  // Route access is website.settings:view (Wave 2.1A). Every mutation control
  // on this page additionally requires website.settings:edit; a view-only
  // admin sees the whole list, read-only.
  const canEdit = can("website.settings", "edit");

  // No activeOnly param: inactive languages are retained content-bearing rows
  // and must be visible by default.
  const { data: rows, isLoading, isError } = useListEditorialLanguages();

  const createLanguage = useCreateEditorialLanguage();
  const updateLanguage = useUpdateEditorialLanguage();
  const activateLanguage = useActivateEditorialLanguage();
  const deactivateLanguage = useDeactivateEditorialLanguage();
  const setDefaultLanguage = useSetDefaultEditorialLanguage();

  const [dialog, setDialog] = useState<DialogMode>({ kind: "closed" });
  const [form, setForm] = useState<LanguageFormValues>(EMPTY_LANGUAGE_FORM);
  const [errors, setErrors] = useState<LanguageFormErrors>({});
  /** A conflict the server reported for the code field, rendered inline. */
  const [codeConflict, setCodeConflict] = useState<string | null>(null);

  const languages = useMemo(() => sortLanguagesForDisplay(rows ?? []), [rows]);
  const currentDefaultName = useMemo(
    () => languages.find((l) => l.isDefault)?.name ?? null,
    [languages],
  );

  /**
   * Only the languages list is invalidated. Authors, topics and posts are
   * untouched by any mutation on this screen.
   */
  const invalidateLanguages = () =>
    queryClient.invalidateQueries({ queryKey: getListEditorialLanguagesQueryKey() });

  const failWith = (title: string) => (err: unknown) => {
    toast({ title, description: editorialErrorMessage(err), variant: "destructive" });
  };

  const openCreate = () => {
    setForm(EMPTY_LANGUAGE_FORM);
    setErrors({});
    setCodeConflict(null);
    setDialog({ kind: "create" });
  };

  const openEdit = (language: EditorialLanguageWithUsage) => {
    setForm({
      code: language.code,
      name: language.name,
      nativeName: language.nativeName,
      direction: language.direction,
      displayOrder: String(language.displayOrder),
    });
    setErrors({});
    setCodeConflict(null);
    setDialog({ kind: "edit", language });
  };

  const closeDialog = () => setDialog({ kind: "closed" });

  const isCreate = dialog.kind === "create";
  const codePreview = isCreate ? canonicalizeEditorialLanguageCode(form.code) : form.code;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (dialog.kind === "closed") return;

    const nextErrors = validateLanguageForm(form, { requireCode: isCreate });
    setErrors(nextErrors);
    setCodeConflict(null);
    if (hasFormErrors(nextErrors)) return;

    if (dialog.kind === "create") {
      createLanguage.mutate(
        {
          data: {
            // Sent canonicalised; the server canonicalises again and its
            // response is what the table then renders.
            code: canonicalizeEditorialLanguageCode(form.code),
            name: form.name.trim(),
            nativeName: form.nativeName.trim(),
            direction: form.direction,
            displayOrder: Number(form.displayOrder.trim()),
          },
        },
        {
          onSuccess: (created) => {
            invalidateLanguages();
            // `created.code` is the server's canonical spelling, not the
            // operator's raw input.
            toast({ title: `Added ${created.name} (${created.code})` });
            closeDialog();
          },
          onError: (err: unknown) => {
            const message = editorialErrorMessage(err);
            const status = (err as { status?: number } | null)?.status;
            if (status === 409) {
              // A duplicate code is the only conflict create can produce —
              // show the backend's own words next to the field.
              setCodeConflict(message);
              return;
            }
            toast({ title: "Could not add language", description: message, variant: "destructive" });
          },
        },
      );
      return;
    }

    const target = dialog.language;
    updateLanguage.mutate(
      {
        id: target.id,
        // Presentation only — `code`, `isActive` and `isDefault` are never sent.
        data: {
          name: form.name.trim(),
          nativeName: form.nativeName.trim(),
          direction: form.direction,
          displayOrder: Number(form.displayOrder.trim()),
        },
      },
      {
        onSuccess: (saved) => {
          invalidateLanguages();
          toast({ title: `Saved ${saved.name}` });
          closeDialog();
        },
        onError: failWith("Could not save language"),
      },
    );
  };

  const handleActivate = (language: EditorialLanguageWithUsage) => {
    activateLanguage.mutate(
      { id: language.id },
      {
        onSuccess: () => {
          invalidateLanguages();
          toast({
            title: `Activated ${language.name}`,
            description: activateConfirmationMessage(language),
          });
        },
        onError: failWith("Could not activate language"),
      },
    );
  };

  const handleDeactivate = async (language: EditorialLanguageWithUsage) => {
    const copy = deactivateConfirmation(language);
    if (!(await confirmAction(copy))) return;
    deactivateLanguage.mutate(
      { id: language.id },
      {
        onSuccess: () => {
          invalidateLanguages();
          toast({ title: `Deactivated ${language.name}` });
        },
        onError: failWith("Could not deactivate language"),
      },
    );
  };

  const handleSetDefault = async (language: EditorialLanguageWithUsage) => {
    const copy = setDefaultConfirmation(language, currentDefaultName);
    if (!(await confirmAction(copy))) return;
    setDefaultLanguage.mutate(
      { id: language.id },
      {
        onSuccess: () => {
          invalidateLanguages();
          toast({ title: `${language.name} is now the default language` });
        },
        onError: failWith("Could not change the default language"),
      },
    );
  };

  const saving = createLanguage.isPending || updateLanguage.isPending;

  return (
    <div className="admin2-final-page admin2-cms-workspace space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">Languages</h2>
          <p className="text-sm text-muted-foreground">
            Editorial publishing languages and the default language for new translations.
            Languages are never deleted — retire one by deactivating it, which keeps every
            existing translation exactly as it is.
          </p>
        </div>
        {canEdit && (
          <Button className="gap-2 shrink-0" data-testid="button-add-language" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add language
          </Button>
        )}
      </div>

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Native name</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Default</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Draft</TableHead>
              <TableHead className="text-right">Published</TableHead>
              <TableHead className="text-right">Archived</TableHead>
              <TableHead className="text-right">Order</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8">Loading…</TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-destructive">
                  Languages could not be loaded.
                </TableCell>
              </TableRow>
            ) : languages.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                  No languages registered yet.
                </TableCell>
              </TableRow>
            ) : (
              languages.map((language) => (
                <TableRow key={language.id} data-testid={`row-language-${language.code}`}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{language.code}</TableCell>
                  <TableCell className="font-medium">{language.name}</TableCell>
                  <TableCell>{language.nativeName}</TableCell>
                  <TableCell className="whitespace-nowrap">{directionLabel(language.direction)}</TableCell>
                  <TableCell>
                    {language.isDefault && (
                      <Badge variant="outline" className="gap-1" data-testid={`badge-default-${language.code}`}>
                        <Star className="h-3 w-3" aria-hidden="true" /> Default
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={language.isActive ? "default" : "outline"} data-testid={`badge-state-${language.code}`}>
                      {language.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{language.translationCounts.draft}</TableCell>
                  <TableCell className="text-right tabular-nums">{language.translationCounts.published}</TableCell>
                  <TableCell className="text-right tabular-nums">{language.translationCounts.archived}</TableCell>
                  <TableCell className="text-right tabular-nums">{language.displayOrder}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {canEdit && (
                      <>
                        <Button
                          variant="ghost" size="icon"
                          aria-label={`Edit ${language.name}`}
                          data-testid={`button-edit-language-${language.code}`}
                          onClick={() => openEdit(language)}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {!language.isDefault && language.isActive && (
                          <Button
                            variant="ghost" size="compact"
                            data-testid={`button-default-language-${language.code}`}
                            disabled={setDefaultLanguage.isPending}
                            onClick={() => handleSetDefault(language)}
                          >
                            Make default
                          </Button>
                        )}
                        {language.isActive ? (
                          <Button
                            variant="ghost" size="icon"
                            aria-label={`Deactivate ${language.name}`}
                            data-testid={`button-deactivate-language-${language.code}`}
                            disabled={deactivateLanguage.isPending}
                            onClick={() => handleDeactivate(language)}
                          >
                            <EyeOff className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost" size="icon"
                            aria-label={`Activate ${language.name}`}
                            data-testid={`button-activate-language-${language.code}`}
                            disabled={activateLanguage.isPending}
                            onClick={() => handleActivate(language)}
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
              <DialogTitle>{isCreate ? "Add language" : `Edit ${dialog.kind === "edit" ? dialog.language.name : ""}`}</DialogTitle>
              <DialogDescription>
                {isCreate
                  ? "Register a publishing language. It becomes active straight away; making it the default is a separate action from the list."
                  : "Presentation only. Activation and the default language are changed from the list."}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="language-code">Language code</Label>
                {isCreate ? (
                  <>
                    <Input
                      id="language-code"
                      name="code"
                      value={form.code}
                      autoComplete="off"
                      placeholder="en-GB"
                      aria-invalid={Boolean(errors.code || codeConflict) || undefined}
                      aria-describedby="language-code-help"
                      data-testid="input-language-code"
                      onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                    />
                    <p id="language-code-help" className="text-xs text-muted-foreground">
                      {errors.code ?? codeConflict ?? (
                        codePreview && codePreview !== form.code
                          ? `A locale tag like "en", "ar" or "en-GB". Will be stored as ${codePreview}.`
                          : 'A locale tag like "en", "ar" or "en-GB".'
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <Input
                      id="language-code"
                      value={form.code}
                      readOnly
                      disabled
                      aria-describedby="language-code-help"
                      data-testid="input-language-code"
                    />
                    <p id="language-code-help" className="text-xs text-muted-foreground">
                      {LANGUAGE_CODE_IMMUTABLE_EXPLANATION}
                    </p>
                  </>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="language-name">Name</Label>
                <Input
                  id="language-name"
                  name="name"
                  value={form.name}
                  placeholder="English"
                  aria-invalid={Boolean(errors.name) || undefined}
                  aria-describedby={errors.name ? "language-name-error" : undefined}
                  data-testid="input-language-name"
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
                {errors.name && (
                  <p id="language-name-error" className="text-xs text-destructive">{errors.name}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="language-native-name">Native name</Label>
                <Input
                  id="language-native-name"
                  name="nativeName"
                  value={form.nativeName}
                  placeholder="English"
                  aria-invalid={Boolean(errors.nativeName) || undefined}
                  aria-describedby={errors.nativeName ? "language-native-name-error" : undefined}
                  data-testid="input-language-native-name"
                  onChange={(e) => setForm((f) => ({ ...f, nativeName: e.target.value }))}
                />
                {errors.nativeName && (
                  <p id="language-native-name-error" className="text-xs text-destructive">{errors.nativeName}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="language-direction">Text direction</Label>
                <Select
                  value={form.direction}
                  onValueChange={(value) => setForm((f) => ({ ...f, direction: value as typeof f.direction }))}
                >
                  <SelectTrigger id="language-direction" data-testid="select-language-direction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIRECTION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="language-display-order">Display order</Label>
                <Input
                  id="language-display-order"
                  name="displayOrder"
                  inputMode="numeric"
                  value={form.displayOrder}
                  aria-invalid={Boolean(errors.displayOrder) || undefined}
                  aria-describedby={errors.displayOrder ? "language-display-order-error" : undefined}
                  data-testid="input-language-display-order"
                  onChange={(e) => setForm((f) => ({ ...f, displayOrder: e.target.value }))}
                />
                {errors.displayOrder && (
                  <p id="language-display-order-error" className="text-xs text-destructive">{errors.displayOrder}</p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button type="submit" disabled={saving} data-testid="button-save-language">
                {isCreate ? "Add language" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
