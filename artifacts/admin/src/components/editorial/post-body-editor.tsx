/**
 * PostBodyEditor — the Post Editor's body canvas (Wave 2.1D).
 *
 * NO RAW JSON TEXTAREA. Each block renders as its own card with the fields
 * that block type actually has, a live character counter against the real
 * server limit, and keyboard-operable Move up / Move down / Delete controls.
 *
 * NO DRAG AND DROP. Verified by grep before deciding: the repo carries no
 * dnd library (no dnd-kit, no react-beautiful-dnd, nothing), and adding one
 * for this wave would be a new dependency and a new interaction vocabulary
 * for the whole Admin. Reordering is two buttons, which is also the only
 * form of reordering that is keyboard- and screen-reader-operable without
 * extra work.
 *
 * FOCUS MANAGEMENT. After an insert, focus moves to the new block's first
 * field. After a delete, focus moves to the block that took its place (or
 * the new last block, or the insert toolbar when the body is now empty).
 * After a move, focus stays on the button that was pressed so a block can be
 * walked up the document with repeated presses — and the button disables
 * itself at the end of the list, which is why the sibling gets focus then.
 *
 * THE FIFTH BLOCK TYPE, QUOTE (Final Editorial, Phase A), was added the way
 * Wave 2.1D said it would be: one BLOCK_TYPE_DEFINITIONS entry in
 * lib/editorial-post-body.ts and one `BlockFields` case below. The toolbar,
 * the counters, the move/delete controls, the validation sweep and the
 * payload stripper all picked it up with no further edits here. A SIXTH type
 * is the same two edits.
 *
 * Quote introduces NO new design pattern: it reuses Textarea + Counter +
 * FieldError for the quotation, and the same optional Input + Counter pair
 * the image caption uses for each attribution field.
 */
import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  BLOCK_TYPE_DEFINITIONS,
  MAX_BODY_BLOCKS,
  MAX_HEADING_CHARS,
  MAX_IMAGE_ALT_CHARS,
  MAX_IMAGE_BLOCKS,
  MAX_IMAGE_CAPTION_CHARS,
  MAX_LIST_ITEMS,
  MAX_LIST_ITEM_CHARS,
  MAX_PARAGRAPH_CHARS,
  MAX_QUOTE_ATTRIBUTION_CHARS,
  MAX_QUOTE_ATTRIBUTION_ROLE_CHARS,
  MAX_QUOTE_CHARS,
  MIN_LIST_ITEMS,
  addBlock,
  addListItem,
  blockCapMessage,
  blockFieldId,
  blockNoun,
  canAddBlock,
  countImageBlocks,
  deleteLabel,
  firstFieldOf,
  focusIndexAfterDelete,
  moveBlockDown,
  moveBlockUp,
  moveDownLabel,
  moveUpLabel,
  problemFor,
  removeBlock,
  removeListItem,
  setListItem,
  updateBlock,
  type BlockProblem,
  type EditableBlock,
  type EditorialBlockType,
} from "@/lib/editorial-post-body";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";

function Counter({ value, max, id }: { value: number; max: number; id?: string }) {
  const over = value > max;
  return (
    <span
      id={id}
      className={over ? "text-xs tabular-nums text-destructive" : "text-xs tabular-nums text-muted-foreground"}
      data-testid="block-counter"
    >
      {value} / {max}
    </span>
  );
}

function FieldError({ message, id }: { message?: string; id: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive" data-testid="block-field-error">
      {message}
    </p>
  );
}

export function PostBodyEditor({
  blocks,
  problems,
  disabled,
  onChange,
}: {
  blocks: EditableBlock[];
  problems: readonly BlockProblem[];
  disabled?: boolean;
  onChange: (next: EditableBlock[]) => void;
}) {
  /** Which DOM id to focus after the next render, if any. */
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const element = document.getElementById(id);
    if (element instanceof HTMLElement) element.focus();
  });

  const insert = useCallback(
    (type: EditorialBlockType) => {
      const next = addBlock(blocks, type);
      const created = next[next.length - 1]!;
      pendingFocus.current = blockFieldId(created.key, firstFieldOf(type));
      onChange(next);
    },
    [blocks, onChange],
  );

  const remove = useCallback(
    (index: number) => {
      const next = removeBlock(blocks, index);
      const focusIndex = focusIndexAfterDelete(index, next.length);
      pendingFocus.current =
        focusIndex == null
          ? "post-body-add-paragraph"
          : blockFieldId(next[focusIndex]!.key, firstFieldOf(next[focusIndex]!.type));
      onChange(next);
    },
    [blocks, onChange],
  );

  const imageCount = countImageBlocks(blocks);
  const capMessage = blockCapMessage(blocks);

  return (
    <section className="space-y-3" aria-label="Post body">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Body</h3>
          <Badge variant="outline" className="tabular-nums" data-testid="body-block-count">
            {blocks.length} / {MAX_BODY_BLOCKS} blocks
          </Badge>
          <Badge variant="outline" className="tabular-nums" data-testid="body-image-count">
            {imageCount} / {MAX_IMAGE_BLOCKS} images
          </Badge>
        </div>
      </div>

      {capMessage && (
        <p role="status" className="text-xs text-destructive" data-testid="body-cap-message">
          {capMessage}
        </p>
      )}

      {blocks.length === 0 ? (
        <div
          className="rounded-md border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground"
          data-testid="body-empty-state"
        >
          This language has no body yet. Add a paragraph to start writing — a translation needs at least
          one block before it can be published.
        </div>
      ) : (
        <ol className="space-y-3" data-testid="body-block-list">
          {blocks.map((block, index) => (
            <li key={block.key}>
              <article
                className="rounded-md border border-border bg-card p-3 space-y-2"
                data-testid={`block-card-${index}`}
                aria-label={`${blockNoun(block.type)} block ${index + 1} of ${blocks.length}`}
              >
                <header className="flex items-center justify-between gap-2">
                  <Badge variant="outline" data-testid={`block-type-${index}`}>
                    {blockNoun(block.type)}
                  </Badge>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      id={`block-move-up-${index}`}
                      aria-label={moveUpLabel(index, block.type)}
                      data-testid={`button-block-up-${index}`}
                      disabled={disabled || index === 0}
                      onClick={() => {
                        pendingFocus.current = `block-move-up-${index - 1}`;
                        onChange(moveBlockUp(blocks, index));
                      }}
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      id={`block-move-down-${index}`}
                      aria-label={moveDownLabel(index, block.type)}
                      data-testid={`button-block-down-${index}`}
                      disabled={disabled || index === blocks.length - 1}
                      onClick={() => {
                        pendingFocus.current = `block-move-down-${index + 1}`;
                        onChange(moveBlockDown(blocks, index));
                      }}
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={deleteLabel(index, block.type)}
                      data-testid={`button-block-delete-${index}`}
                      disabled={disabled}
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </header>

                <BlockFields
                  block={block}
                  index={index}
                  problems={problems}
                  disabled={disabled}
                  onPatch={(patch) => onChange(updateBlock(blocks, index, patch))}
                  onListAdd={() => onChange(addListItem(blocks, index))}
                  onListRemove={(itemIndex) => onChange(removeListItem(blocks, index, itemIndex))}
                  onListSet={(itemIndex, value) => onChange(setListItem(blocks, index, itemIndex, value))}
                />
              </article>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Add a block">
        {BLOCK_TYPE_DEFINITIONS.map((definition) => (
          <Button
            key={definition.type}
            type="button"
            variant="outline"
            size="compact"
            className="gap-1.5"
            id={definition.type === "paragraph" ? "post-body-add-paragraph" : undefined}
            data-testid={`button-add-${definition.type}`}
            disabled={disabled || !canAddBlock(blocks, definition.type)}
            onClick={() => insert(definition.type)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {definition.label}
          </Button>
        ))}
      </div>
    </section>
  );
}

function BlockFields({
  block,
  index,
  problems,
  disabled,
  onPatch,
  onListAdd,
  onListRemove,
  onListSet,
}: {
  block: EditableBlock;
  index: number;
  problems: readonly BlockProblem[];
  disabled?: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
  onListAdd: () => void;
  onListRemove: (itemIndex: number) => void;
  onListSet: (itemIndex: number, value: string) => void;
}) {
  const errorId = (field: string) => `block-${block.key}-${field}-error`;
  const problem = (field: Parameters<typeof problemFor>[2]) => problemFor(problems, index, field);

  switch (block.type) {
    case "paragraph":
      return (
        <div className="grid gap-1.5">
          <Label htmlFor={blockFieldId(block.key, "text")} className="sr-only">
            Paragraph {index + 1}
          </Label>
          <Textarea
            id={blockFieldId(block.key, "text")}
            rows={4}
            dir="auto"
            value={block.text}
            disabled={disabled}
            placeholder="Write a paragraph…"
            aria-invalid={Boolean(problem("text")) || undefined}
            aria-describedby={problem("text") ? errorId("text") : undefined}
            data-testid={`input-block-text-${index}`}
            onChange={(e) => onPatch({ text: e.target.value })}
          />
          <div className="flex justify-end">
            <Counter value={block.text.length} max={MAX_PARAGRAPH_CHARS} />
          </div>
          <FieldError message={problem("text")} id={errorId("text")} />
        </div>
      );

    case "heading":
      return (
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* 2 and 3 only: the post title is the page h1, so a body outline
                can never skip a level upward. */}
            <div className="flex items-center gap-1" role="group" aria-label={`Heading level for block ${index + 1}`}>
              {([2, 3] as const).map((level) => (
                <Button
                  key={level}
                  type="button"
                  size="compact"
                  variant={block.level === level ? "default" : "outline"}
                  aria-pressed={block.level === level}
                  disabled={disabled}
                  data-testid={`button-heading-level-${index}-${level}`}
                  onClick={() => onPatch({ level })}
                >
                  H{level}
                </Button>
              ))}
            </div>
            <Input
              id={blockFieldId(block.key, "text")}
              className="flex-1 min-w-[12rem]"
              dir="auto"
              value={block.text}
              disabled={disabled}
              placeholder="Section heading"
              aria-label={`Heading text for block ${index + 1}`}
              aria-invalid={Boolean(problem("text")) || undefined}
              aria-describedby={problem("text") ? errorId("text") : undefined}
              data-testid={`input-block-text-${index}`}
              onChange={(e) => onPatch({ text: e.target.value })}
            />
          </div>
          <div className="flex justify-end">
            <Counter value={block.text.length} max={MAX_HEADING_CHARS} />
          </div>
          <FieldError message={problem("text")} id={errorId("text")} />
          <FieldError message={problem("level")} id={errorId("level")} />
        </div>
      );

    case "image":
      return (
        <div className="grid gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor={blockFieldId(block.key, "url")}>Image link</Label>
            <Input
              id={blockFieldId(block.key, "url")}
              value={block.url}
              disabled={disabled}
              autoComplete="off"
              placeholder="https://images.unsplash.com/…"
              aria-invalid={Boolean(problem("url")) || undefined}
              aria-describedby={`${blockFieldId(block.key, "url")}-help`}
              data-testid={`input-block-url-${index}`}
              onChange={(e) => onPatch({ url: e.target.value })}
            />
            {/* The same allowlist-hint pattern the Authors avatar field uses:
                guidance only. The SERVER owns the host allowlist, redirects,
                DNS and content-type checks, and its 400 is shown verbatim. */}
            <p
              id={`${blockFieldId(block.key, "url")}-help`}
              className={problem("url") ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
              data-testid={`block-url-message-${index}`}
            >
              {problem("url") ??
                "Must be an https link on an approved image host: picsum.photos, images.unsplash.com, res.cloudinary.com, static.wixstatic.com, lh3.googleusercontent.com. The link is checked when you save."}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={blockFieldId(block.key, "alt")}>
              Alt text <span className="text-destructive">*</span>
            </Label>
            <Input
              id={blockFieldId(block.key, "alt")}
              value={block.alt}
              disabled={disabled}
              placeholder="What this image shows, for a reader who cannot see it"
              dir="auto"
              aria-invalid={Boolean(problem("alt")) || undefined}
              aria-describedby={problem("alt") ? errorId("alt") : undefined}
              data-testid={`input-block-alt-${index}`}
              onChange={(e) => onPatch({ alt: e.target.value })}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Required on every image, on every save — not only at publish.
              </span>
              <Counter value={block.alt.length} max={MAX_IMAGE_ALT_CHARS} />
            </div>
            <FieldError message={problem("alt")} id={errorId("alt")} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={blockFieldId(block.key, "caption")}>Caption (optional)</Label>
            <Input
              id={blockFieldId(block.key, "caption")}
              value={block.caption ?? ""}
              disabled={disabled}
              dir="auto"
              aria-invalid={Boolean(problem("caption")) || undefined}
              data-testid={`input-block-caption-${index}`}
              onChange={(e) => onPatch({ caption: e.target.value })}
            />
            <div className="flex justify-end">
              <Counter value={(block.caption ?? "").length} max={MAX_IMAGE_CAPTION_CHARS} />
            </div>
            <FieldError message={problem("caption")} id={errorId("caption")} />
          </div>

          {block.url.trim().length > 0 && !problem("url") && (
            /* Decorative here: the operator's own alt text is the field above. */
            <img
              src={block.url.trim()}
              alt=""
              className="max-h-40 w-auto rounded-md border border-border object-cover"
              data-testid={`block-image-preview-${index}`}
            />
          )}
        </div>
      );

    case "bulleted-list":
      return (
        <div className="grid gap-2">
          <ul className="space-y-2" data-testid={`block-list-items-${index}`}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="flex items-start gap-2">
                <Input
                  id={blockFieldId(block.key, `item-${itemIndex}`)}
                  value={item}
                  disabled={disabled}
                  dir="auto"
                  placeholder={`Item ${itemIndex + 1}`}
                  aria-label={`List item ${itemIndex + 1} of block ${index + 1}`}
                  data-testid={`input-block-item-${index}-${itemIndex}`}
                  onChange={(e) => onListSet(itemIndex, e.target.value)}
                />
                <Counter value={item.length} max={MAX_LIST_ITEM_CHARS} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove list item ${itemIndex + 1} of block ${index + 1}`}
                  data-testid={`button-remove-item-${index}-${itemIndex}`}
                  // A bulleted list needs at least MIN_LIST_ITEMS server-side,
                  // so the control disables at the floor rather than letting a
                  // save fail.
                  disabled={disabled || block.items.length <= MIN_LIST_ITEMS}
                  onClick={() => onListRemove(itemIndex)}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="compact"
              className="gap-1.5"
              data-testid={`button-add-item-${index}`}
              disabled={disabled || block.items.length >= MAX_LIST_ITEMS}
              onClick={onListAdd}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add item
            </Button>
            <Counter value={block.items.length} max={MAX_LIST_ITEMS} />
          </div>
          <FieldError message={problem("items")} id={errorId("items")} />
        </div>
      );

    case "quote":
      return (
        <div className="grid gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor={blockFieldId(block.key, "text")}>
              Quote <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id={blockFieldId(block.key, "text")}
              rows={3}
              dir="auto"
              value={block.text}
              disabled={disabled}
              placeholder="The words being quoted…"
              aria-invalid={Boolean(problem("text")) || undefined}
              aria-describedby={problem("text") ? errorId("text") : undefined}
              data-testid={`input-block-text-${index}`}
              onChange={(e) => onPatch({ text: e.target.value })}
            />
            <div className="flex justify-end">
              <Counter value={block.text.length} max={MAX_QUOTE_CHARS} />
            </div>
            <FieldError message={problem("text")} id={errorId("text")} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={blockFieldId(block.key, "attribution")}>Attribution (optional)</Label>
            <Input
              id={blockFieldId(block.key, "attribution")}
              value={block.attribution ?? ""}
              disabled={disabled}
              dir="auto"
              placeholder="Who said it"
              aria-invalid={Boolean(problem("attribution")) || undefined}
              aria-describedby={problem("attribution") ? errorId("attribution") : undefined}
              data-testid={`input-block-attribution-${index}`}
              onChange={(e) => onPatch({ attribution: e.target.value })}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Leave blank for a pull-quote taken from the article itself.
              </span>
              <Counter value={(block.attribution ?? "").length} max={MAX_QUOTE_ATTRIBUTION_CHARS} />
            </div>
            <FieldError message={problem("attribution")} id={errorId("attribution")} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={blockFieldId(block.key, "attributionRole")}>
              Attribution role (optional)
            </Label>
            <Input
              id={blockFieldId(block.key, "attributionRole")}
              value={block.attributionRole ?? ""}
              disabled={disabled}
              dir="auto"
              placeholder="What they are — e.g. Artistic Director"
              aria-invalid={Boolean(problem("attributionRole")) || undefined}
              aria-describedby={problem("attributionRole") ? errorId("attributionRole") : undefined}
              data-testid={`input-block-attribution-role-${index}`}
              onChange={(e) => onPatch({ attributionRole: e.target.value })}
            />
            <div className="flex justify-end">
              <Counter
                value={(block.attributionRole ?? "").length}
                max={MAX_QUOTE_ATTRIBUTION_ROLE_CHARS}
              />
            </div>
            <FieldError message={problem("attributionRole")} id={errorId("attributionRole")} />
          </div>
        </div>
      );

    default:
      // A body written by a future wave. Preserved on save rather than
      // dropped, but not editable by this build.
      return (
        <p className="text-xs text-muted-foreground" data-testid={`block-unknown-${index}`}>
          This block type is not editable in this version of the Admin. It is kept exactly as it is when
          you save.
        </p>
      );
  }
}
