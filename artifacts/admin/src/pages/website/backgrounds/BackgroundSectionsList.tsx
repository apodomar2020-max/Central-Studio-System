import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListAdminWebsiteBackgrounds,
  useUpdateWebsiteBackground,
  getListAdminWebsiteBackgroundsQueryKey,
} from "@workspace/api-client-react";
import type { WebsiteBackgroundSetting } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Edit, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Website CMS Wave 1 — Backgrounds only.
 *
 * Shared list/editor for the 4 "Website → Backgrounds → {page}" screens.
 * Modeled on hero-items.tsx's Table + Dialog CRUD pattern, adapted for a
 * FIXED set of rows: no Add button, no Delete action — every row already
 * exists from the seed step (scripts/src/seedWebsiteBackgrounds.ts) and can
 * only be edited or cleared. "Clear / Use Default" is a normal PATCH (sets
 * mediaUrl to null), never a delete — no destructive-action confirmation
 * is used for it, matching the Wave 1 brief's explicit framing.
 *
 * `allowedMediaKind` comes from the API response (server-registry metadata
 * enriched onto each row — see websiteBackgrounds.ts) rather than a
 * duplicated constant here, since Admin cannot import @workspace/db
 * directly (it requires DATABASE_URL at module load, and is a
 * server/Node-only package).
 */

const formSchema = z.object({
  mediaUrl: z.string().trim().max(2000),
});
type FormValues = z.input<typeof formSchema>;

export type WebsiteBackgroundPage = "home" | "about-studio" | "ballet" | "classes";

interface BackgroundSectionsListProps {
  page: WebsiteBackgroundPage;
}

export function BackgroundSectionsList({ page }: BackgroundSectionsListProps) {
  const { toast } = useToast();
  const { can } = useAdminAuth();
  const canEdit = can("website.backgrounds", "edit");
  const { data: allSections, isLoading, isError } = useListAdminWebsiteBackgrounds();
  const updateSection = useUpdateWebsiteBackground();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<WebsiteBackgroundSetting | null>(null);
  const [open, setOpen] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  const sections = (allSections ?? []).filter((s) => s.page === page);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { mediaUrl: "" },
  });

  const watchedUrl = form.watch("mediaUrl");

  const openEdit = (section: WebsiteBackgroundSetting) => {
    setEditing(section);
    form.reset({ mediaUrl: section.mediaUrl ?? "" });
    setPreviewFailed(false);
    setOpen(true);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListAdminWebsiteBackgroundsQueryKey() });
  };

  const onSubmit = (values: FormValues) => {
    if (!editing) return;
    updateSection.mutate(
      { sectionKey: editing.sectionKey, data: { mediaUrl: values.mediaUrl.trim() || null } },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
          toast({ title: "Background updated" });
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          toast({ title: "Could not save background", description: msg, variant: "destructive" });
        },
      },
    );
  };

  const handleClear = (section: WebsiteBackgroundSetting) => {
    updateSection.mutate(
      { sectionKey: section.sectionKey, data: { mediaUrl: null } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: `${section.sectionLabel} reverted to default` });
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          toast({ title: "Could not clear background", description: msg, variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="admin2-final-page admin2-cms-workspace space-y-6">
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Section</TableHead>
              <TableHead>Preview</TableHead>
              <TableHead>Media Kind</TableHead>
              <TableHead>Current URL</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8">Loading...</TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-destructive">Backgrounds could not be loaded.</TableCell>
              </TableRow>
            ) : sections.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No approved sections for this page.</TableCell>
              </TableRow>
            ) : (
              sections.map((section) => (
                <TableRow key={section.sectionKey} data-testid={`row-website-background-${section.sectionKey}`}>
                  <TableCell className="font-medium">{section.sectionLabel}</TableCell>
                  <TableCell>
                    <div className="relative h-14 w-24 rounded overflow-hidden bg-muted flex-shrink-0">
                      {section.mediaUrl ? (
                        section.mediaKind === "video" ? (
                          <video
                            src={section.mediaUrl}
                            muted
                            autoPlay
                            loop
                            playsInline
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : (
                          <img
                            src={section.mediaUrl}
                            alt={`${section.sectionLabel} preview`}
                            className="absolute inset-0 w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        )
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground text-center px-1">
                          Default
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{section.allowedMediaKind}</Badge>
                  </TableCell>
                  <TableCell className="text-sm max-w-[260px] truncate text-muted-foreground">
                    {section.mediaUrl ?? "— (using website default)"}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <>
                        <Button
                          variant="ghost" size="icon"
                          aria-label={`Edit ${section.sectionLabel}`}
                          data-testid={`button-edit-website-background-${section.sectionKey}`}
                          onClick={() => openEdit(section)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          aria-label={`Clear ${section.sectionLabel} (use default)`}
                          data-testid={`button-clear-website-background-${section.sectionKey}`}
                          disabled={!section.mediaUrl || updateSection.isPending}
                          onClick={() => handleClear(section)}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {editing?.sectionLabel}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="mediaUrl" render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Media URL{editing && <span className="text-muted-foreground font-normal"> ({editing.allowedMediaKind} only)</span>}
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://res.cloudinary.com/..."
                      data-testid="input-website-background-url"
                      {...field}
                      onChange={(e) => { field.onChange(e); setPreviewFailed(false); }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="overflow-hidden rounded-lg border border-border bg-background h-40 flex items-center justify-center">
                {watchedUrl && !previewFailed ? (
                  editing?.allowedMediaKind === "video" ? (
                    <video
                      src={watchedUrl}
                      muted
                      autoPlay
                      loop
                      playsInline
                      className="h-full w-full object-cover"
                      onError={() => setPreviewFailed(true)}
                    />
                  ) : (
                    <img
                      src={watchedUrl}
                      alt="Preview"
                      className="h-full w-full object-cover"
                      onError={() => setPreviewFailed(true)}
                    />
                  )
                ) : (
                  <span className="text-muted-foreground text-sm px-4 text-center">
                    {watchedUrl && previewFailed
                      ? "Preview failed. Check the URL and that the file is public."
                      : "No preview yet. Leave blank to use the website's default."}
                  </span>
                )}
              </div>

              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-website-background" disabled={updateSection.isPending}>
                  {updateSection.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
