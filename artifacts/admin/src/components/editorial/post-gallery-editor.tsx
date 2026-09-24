/**
 * PostGalleryEditor — the Post Editor's gallery card (Final Editorial —
 * Phase B).
 *
 * MINIMAL BY DESIGN. This is not an editor redesign: it is one more card in
 * the existing left column, built from the same primitives PostBodyEditor
 * uses (Button, Input, Label, Badge, Counter, FieldError), wired into the
 * same `translation` dirty scope and the same save button. Nothing about
 * the surrounding editor changes.
 *
 * NO DRAG AND DROP, for the same verified reason the body canvas has none:
 * the repo carries no dnd library, adding one would be a new dependency and
 * a new interaction vocabulary for the whole Admin, and two Move buttons are
 * the only form of reordering that is keyboard- and screen-reader-operable
 * without extra work.
 *
 * FOCUS MANAGEMENT mirrors PostBodyEditor exactly: after an insert focus
 * moves to the new item's url field; after a delete to the item that took
 * its place (or the add button when the gallery is now empty); after a move
 * focus stays on the pressed button so an image can be walked up the list.
 *
 * TWO FIELDS, NOT THREE. There is no caption input because there is no
 * caption field — see lib/editorial-post-gallery.ts for why the legacy
 * source makes one unjustifiable.
 */
import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  GALLERY_ALT_HELP,
  GALLERY_EMPTY_STATE,
  GALLERY_MEDIA_NOTE,
  GALLERY_ORDER_HELP,
  MAX_GALLERY_ALT_CHARS,
  MAX_GALLERY_ITEMS,
  addGalleryItem,
  canAddGalleryItem,
  galleryCapMessage,
  galleryDeleteLabel,
  galleryFieldId,
  galleryMoveDownLabel,
  galleryMoveUpLabel,
  galleryProblemFor,
  moveGalleryItemDown,
  moveGalleryItemUp,
  removeGalleryItem,
  updateGalleryItem,
  type EditableGalleryItem,
  type GalleryProblem,
} from "@/lib/editorial-post-gallery";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

function Counter({ value, max, id }: { value: number; max: number; id?: string }) {
  const over = value > max;
  return (
    <span
      id={id}
      className={over ? "text-xs tabular-nums text-destructive" : "text-xs tabular-nums text-muted-foreground"}
      data-testid="gallery-counter"
    >
      {value} / {max}
    </span>
  );
}

function FieldError({ message, id }: { message?: string; id: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive" data-testid="gallery-field-error">
      {message}
    </p>
  );
}

const ADD_BUTTON_ID = "post-gallery-add-image";

export function PostGalleryEditor({
  items,
  problems,
  disabled,
  onChange,
}: {
  items: EditableGalleryItem[];
  problems: readonly GalleryProblem[];
  disabled?: boolean;
  onChange: (next: EditableGalleryItem[]) => void;
}) {
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const element = document.getElementById(id);
    if (element instanceof HTMLElement) element.focus();
  });

  const insert = useCallback(() => {
    const next = addGalleryItem(items);
    const created = next[next.length - 1];
    if (created) pendingFocus.current = galleryFieldId(created.key, "url");
    onChange(next);
  }, [items, onChange]);

  const remove = useCallback(
    (index: number) => {
      const next = removeGalleryItem(items, index);
      if (next.length === 0) {
        pendingFocus.current = ADD_BUTTON_ID;
      } else {
        const focusIndex = Math.min(index, next.length - 1);
        pendingFocus.current = galleryFieldId(next[focusIndex]!.key, "url");
      }
      onChange(next);
    },
    [items, onChange],
  );

  const capMessage = galleryCapMessage(items);

  return (
    <section className="space-y-3" aria-label="Gallery">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Gallery</h3>
          <Badge variant="outline" className="tabular-nums" data-testid="gallery-item-count">
            {items.length} / {MAX_GALLERY_ITEMS} images
          </Badge>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          id={ADD_BUTTON_ID}
          data-testid="button-gallery-add"
          disabled={disabled || !canAddGalleryItem(items)}
          onClick={insert}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Add image
        </Button>
      </div>

      <p className="text-xs text-muted-foreground" data-testid="gallery-order-help">
        {GALLERY_ORDER_HELP}
      </p>

      {capMessage && (
        <p role="status" className="text-xs text-destructive" data-testid="gallery-cap-message">
          {capMessage}
        </p>
      )}

      {items.length === 0 ? (
        <div
          className="rounded-md border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground"
          data-testid="gallery-empty-state"
        >
          {GALLERY_EMPTY_STATE}
        </div>
      ) : (
        <ol className="space-y-3" data-testid="gallery-item-list">
          {items.map((item, index) => {
            const urlId = galleryFieldId(item.key, "url");
            const altId = galleryFieldId(item.key, "alt");
            const urlError = galleryProblemFor(problems, index, "url");
            const altError = galleryProblemFor(problems, index, "alt");
            return (
              <li key={item.key}>
                <article
                  className="rounded-md border border-border bg-card p-3 space-y-2"
                  data-testid={`gallery-card-${index}`}
                  aria-label={`Gallery image ${index + 1} of ${items.length}`}
                >
                  <header className="flex items-center justify-between gap-2">
                    <Badge variant="outline" data-testid={`gallery-position-${index}`}>
                      Image {index + 1}
                    </Badge>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        id={`gallery-move-up-${index}`}
                        aria-label={galleryMoveUpLabel(index)}
                        data-testid={`button-gallery-up-${index}`}
                        disabled={disabled || index === 0}
                        onClick={() => {
                          pendingFocus.current = `gallery-move-up-${index - 1}`;
                          onChange(moveGalleryItemUp(items, index));
                        }}
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        id={`gallery-move-down-${index}`}
                        aria-label={galleryMoveDownLabel(index)}
                        data-testid={`button-gallery-down-${index}`}
                        disabled={disabled || index === items.length - 1}
                        onClick={() => {
                          pendingFocus.current = `gallery-move-down-${index + 1}`;
                          onChange(moveGalleryItemDown(items, index));
                        }}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={galleryDeleteLabel(index)}
                        data-testid={`button-gallery-delete-${index}`}
                        disabled={disabled}
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </header>

                  <div className="space-y-1">
                    <Label htmlFor={urlId}>Image link</Label>
                    <Input
                      id={urlId}
                      value={item.url}
                      disabled={disabled}
                      data-testid={`input-gallery-url-${index}`}
                      aria-invalid={urlError ? true : undefined}
                      aria-describedby={urlError ? `${urlId}-error` : undefined}
                      onChange={(e) => onChange(updateGalleryItem(items, index, { url: e.target.value }))}
                    />
                    <FieldError message={urlError} id={`${urlId}-error`} />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor={altId}>Alt text</Label>
                      <Counter value={item.alt.trim().length} max={MAX_GALLERY_ALT_CHARS} />
                    </div>
                    <Input
                      id={altId}
                      value={item.alt}
                      disabled={disabled}
                      data-testid={`input-gallery-alt-${index}`}
                      aria-invalid={altError ? true : undefined}
                      aria-describedby={altError ? `${altId}-error` : undefined}
                      onChange={(e) => onChange(updateGalleryItem(items, index, { alt: e.target.value }))}
                    />
                    <FieldError message={altError} id={`${altId}-error`} />
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}

      <p className="text-xs text-muted-foreground" data-testid="gallery-alt-help">
        {GALLERY_ALT_HELP}
      </p>
      <p className="text-xs text-muted-foreground" data-testid="gallery-media-note">
        {GALLERY_MEDIA_NOTE}
      </p>
    </section>
  );
}
