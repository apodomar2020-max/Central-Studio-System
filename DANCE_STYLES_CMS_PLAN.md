# Dance Styles — CMS Architecture Plan

**Status:** Investigation + plan for approval. **No code has been changed.**
**Goal:** Make Dance Styles a fully CMS-managed entity (icon/cover/color/order/active), render category icons on mobile from the backend, and have Classes reference a Dance Style by ID instead of a hardcoded category string.

---

## 0. What already exists (key finding)

This is **not** a greenfield build — a `dance_types` entity and most plumbing already exist. The work is an **extension**, which sharply reduces risk.

| Layer | Exists today | Gap to target |
|---|---|---|
| **DB** | `dance_types` table: `id, name, slug, isActive, sortOrder, createdAt, updatedAt` (`lib/db/src/schema/danceTypes.ts`) | Missing `description, iconUrl, coverImageUrl, color`. `classes.category` is free **text**, not an FK. |
| **API** | Full CRUD in `artifacts/api-server/src/routes/danceTypes.ts`: public `GET /api/dance-types`, admin `GET/POST/PATCH/DELETE /api/admin/settings/dance-types` (guarded by `requireAdminPermission("settings", …)`). Public list uses `select()` (all columns). | `CreateBody`/`UpdateBody` Zod schemas only allow `name, slug, isActive, sortOrder` — must add the new fields. No SVG **upload** endpoint (storage is URL-only today). |
| **Admin** | `artifacts/admin/src/pages/settings.tsx` already manages Dance Types (list, create, edit, activate, sortOrder) via React Hook Form + Zod + TanStack Query. | Form needs new fields + SVG upload + reorder UX. |
| **Mobile** | Generated client hook `useListDanceTypes()` already exists (`lib/api-client-react`). | Classes screen ignores it — uses hardcoded `DANCE_CATEGORIES` (`data/mockData.ts`) + `CAT_ICON` sprite map (`app/(tabs)/classes.tsx`). |
| **Uploads** | **No file-upload infrastructure** anywhere (no multer/busboy/S3/Cloudinary). Images (e.g. hero items) are stored as **URL strings**, pasted in the admin with a live preview. | A decision is required for "upload SVG file" (see §A). |

---

## 1. Database schema changes

**1a. Extend `dance_types`** (`lib/db/src/schema/danceTypes.ts`) — additive, nullable, safe:

```ts
description:    text("description"),            // nullable
iconUrl:        text("icon_url"),               // SVG or PNG URL (nullable → fallback)
coverImageUrl:  text("cover_image_url"),        // nullable
color:          text("color"),                  // brand color hex, e.g. "#00B6D7" (nullable)
// name, slug, isActive, sortOrder, timestamps already exist
```

Migration: new Drizzle migration `00XX_dance_types_cms_fields.sql` →
`ALTER TABLE dance_types ADD COLUMN description text, ADD COLUMN icon_url text, ADD COLUMN cover_image_url text, ADD COLUMN color text;` (all `NULL`-able, no backfill required).

**1b. Link Classes to Dance Style by ID** (`lib/db/src/schema/classes.ts`) — add an FK **without** removing the legacy string yet:

```ts
danceTypeId: integer("dance_type_id").references(() => danceTypesTable.id), // nullable during transition
// keep `category: text` for backward compatibility until cutover (see §5/§6)
```

Migration: `ALTER TABLE classes ADD COLUMN dance_type_id integer REFERENCES dance_types(id);` + an index on `dance_type_id`. Use `ON DELETE SET NULL` (or `RESTRICT` — decision in §7).

---

## 2. API endpoints

**Mostly already there.** Required changes:

1. **Extend Zod bodies** in `danceTypes.ts`:
   - `CreateBody` / `UpdateBody` add: `description?, iconUrl?, coverImageUrl?, color?` (all `.optional()`, `color` validated as hex, URLs validated as `z.string().url()` or relative path).
   - Insert/update `.values(...)` / `.set(...)` to persist them.
2. **Public `GET /api/dance-types`** already returns all columns (`select()`), so the new fields flow to mobile automatically once added — **no shape change needed**.
3. **Reorder endpoint** (nice-to-have): `PATCH /api/admin/settings/dance-types/reorder` accepting `[{id, sortOrder}]` for batch drag-reorder. (Single-row `sortOrder` edit already works via existing `PATCH`.)
4. **Regenerate the typed client** (`lib/api-client-react`) from the updated OpenAPI/Zod so `DanceType` carries the new fields on mobile + admin.

### §A — SVG upload (the one real decision; no infra exists)
Pick one:
- **Option A1 — URL only (lowest effort, consistent with hero items):** `iconUrl`/`coverImageUrl` are URL strings pasted in admin. "Upload" handled by whatever CDN/host the studio already uses. No backend infra. ✅ Ships fastest.
- **Option A2 — New upload endpoint (matches "upload SVG file" literally):** `POST /api/admin/settings/dance-types/icon` (multipart). Requires choosing storage: (i) object storage (S3/R2/Cloudinary — new dependency + creds), or (ii) store sanitized SVG markup in a DB `text` column and serve via `GET /api/dance-types/:id/icon.svg`. Must include **SVG sanitization** (see §7). Larger effort + a hosting decision.

> Recommendation: **A2 with DB-stored sanitized SVG** (no new cloud dependency, self-contained, matches the "upload SVG" requirement), with A1 URL paste also supported as a field. Final call is yours.

---

## 3. Admin portal screens & workflows

Extend the existing **Dance Types** section in `artifacts/admin/src/pages/settings.tsx` (or promote it to a dedicated `pages/dance-styles.tsx` for room to grow).

**Form fields:** Name, Slug (auto from name, editable), Description (textarea), Brand Color (color picker → hex), Icon (SVG upload **or** URL with live preview), Cover Image (URL + preview), Sort Order, Active toggle.

**Workflows / screens:**
- **List:** table/grid showing icon preview, color swatch, name, slug, #classes using it, active toggle, sort handle.
- **Create / Edit:** the form above; slug uniqueness validated (409 already handled by API).
- **Activate / Deactivate:** toggle → `PATCH { isActive }` (inactive hidden from mobile public list, which filters `isActive = true`).
- **Reorder:** drag-and-drop (or up/down) → batch `sortOrder` update (§2.3).
- **Delete:** confirm dialog; block/guard if classes still reference it (§7).
- **Icon upload:** accept `image/svg+xml`; show preview; sanitize server-side.

Permissions reuse the existing `settings:view` / `settings:edit` guards — no new permission model.

---

## 4. Mobile app changes

**Principle:** no hardcoded styles, no `DanceIcon.tsx`, no app update when styles change.

1. **Fetch from API:** replace hardcoded `DANCE_CATEGORIES` + `CAT_ICON` with `useListDanceTypes()` (already generated). Categories, names, colors, icons, order all come from the backend.
2. **New generic component `components/CategoryIcon.tsx`** (style-agnostic):
   - `iconUrl` ends in `.svg` / is SVG → render with `SvgUri` (from `react-native-svg`, already installed — supports remote SVG).
   - `iconUrl` is PNG/other → `expo-image` `<Image uri>`.
   - **No `iconUrl` → fallback = first letter of `name`** in the colored circle (your chosen fallback). One generic path, zero per-style branching.
3. **Color:** use the dance style's `color` for the icon-container tint (replacing the hardcoded `catRgb`/`rgbFill`).
4. **Keep filtering/nav/expansion logic unchanged:** the category section still groups classes; it just maps over the API-driven list. Class→category association continues via `class.category` string match to dance-type `slug`/`name` **until** the `danceTypeId` cutover (§5), at which point it matches by ID.
5. **Adapter:** `data/apiAdapters.ts` stops resolving against `mockData`; it reads dance-type metadata from the fetched list. `DANCE_CATEGORIES`/`CAT_ICON` deleted once nothing references them.
6. **Caching/perf:** TanStack Query caches the dance-types list; SVGs cached by URL. No app release needed to add a style.

---

## 5. Migration plan (from hardcoded categories)

1. **Add fields** (DB §1a) — deploy, no behavior change.
2. **Seed dance_types** to match the 5 current categories (Hip Hop, Ballet, Salsa, Afro, Breaking) with their existing brand colors + `iconUrl` populated by the studio via admin (or seed script). Slugs already align with the current category strings.
3. **Add `classes.dance_type_id`** (DB §1b), nullable.
4. **Backfill** `classes.dance_type_id` from the existing `category` string: `UPDATE classes SET dance_type_id = dt.id FROM dance_types dt WHERE lower(classes.category) = lower(dt.slug) OR lower(classes.category) = lower(dt.name);` Report any unmatched rows for manual mapping.
5. **Dual-read window:** mobile/admin prefer `dance_type_id`, fall back to `category` string match if null.
6. **Cutover:** once backfill is 100% and verified, switch class create/edit (admin) to set `danceTypeId`; mobile matches by ID; mark `category` string deprecated.
7. **Cleanup (later release):** drop `CAT_ICON`/`DANCE_CATEGORIES` in mobile; optionally drop/retire `classes.category`.

---

## 6. Backward compatibility

- **Additive DB changes only** (nullable columns, new FK) — existing reads/writes keep working.
- **`category` string retained** through the transition; nothing breaks if `danceTypeId` is null.
- **Public API shape is a superset** (new optional fields) — old mobile builds ignore unknown fields; new builds use them.
- **Fallback-first rendering** — any style without an `iconUrl` shows the first-letter glyph, so the app is never broken by missing assets.
- **Inactive styles** are filtered out of the public list (existing behavior), so deactivating is safe and reversible.

---

## 7. Risks & edge cases

| Risk / edge case | Mitigation |
|---|---|
| **Malicious uploaded SVG (XSS / external refs)** | Sanitize server-side (strip `<script>`, `on*`, external `href`/`xlink`, `<foreignObject>`); whitelist SVG tags. Mandatory if Option A2. |
| **Remote SVG render failures / slow nets** | `SvgUri` error/loading handling → fall back to first-letter glyph; cache by URL. |
| **Deleting a style still used by classes** | Guard delete (RESTRICT) or soft-delete via `isActive=false`; show "N classes use this" in admin. |
| **Class category string with no matching dance type** | Backfill report lists unmatched; render first-letter fallback; admin can map manually. |
| **Slug collisions** | Already handled (unique constraint + 409). |
| **Color contrast / accessibility** | Validate hex; use color only for tint/background, keep text/icon legible; provide a default brand color when null. |
| **`sortOrder` ties** | Secondary sort by `name` (already in the query). |
| **PNG vs SVG detection** | Detect by extension/content-type; default to `<Image>` for non-SVG; first-letter if neither loads. |
| **Client/admin type drift** | Regenerate `lib/api-client-react` from OpenAPI as part of the change; CI typecheck. |
| **api-server build in this sandbox** | The sandbox blocks the api-server build (EPERM on dist cleanup) — backend changes will be verified on your machine/CI, not here. |

---

## Decisions needed before implementation
1. **SVG upload:** Option **A1** (URL only) or **A2** (upload endpoint — and if A2, DB-stored sanitized SVG vs object storage)?
2. **Classes link:** add `danceTypeId` FK now (recommended) or keep string-only for this phase?
3. **Admin location:** extend `settings.tsx` Dance Types section, or promote to a dedicated `dance-styles` page?
4. **Delete semantics:** hard delete with guard, or soft delete (deactivate only)?

---

## APPROVED — Locked decisions
1. **SVG upload = A2**: upload from admin → **sanitize server-side** → store **sanitized SVG markup in the DB** → serve via API endpoint. `iconUrl` kept as optional fallback. **No external storage** (no S3/R2/Cloudinary).
2. **Classes**: add `danceTypeId` FK now; keep legacy `category` string only during migration; target = ID-based.
3. **Admin**: extend the existing Dance Types section in `settings.tsx` (no separate page).
4. **Delete**: **soft delete only** (Active/Inactive); never physically delete styles with historical usage; inactive hidden from mobile.
5. **Mobile**: fully dynamic — categories, icons, colors, order all come from the API. Zero hardcoded styles.
6. **Future-proof**: schema designed so metadata (age ranges, difficulty, cover videos, gallery, program descriptions, instructors, pricing overrides) can be added later without refactor (additive nullable columns / related tables; never breaking the ID contract).

---

## Detailed execution order (database → backend → admin → mobile → migration → cleanup)

**Phase 1 — Database** (`lib/db`)
1. Add nullable columns to `dance_types`: `description`, `icon_url`, `cover_image_url`, `color`, **`icon_svg` (text, sanitized markup)**, `icon_mime` (text).
2. Add `dance_type_id integer references dance_types(id) ON DELETE SET NULL` to `classes` (+ index). Keep `category` text.
3. New Drizzle migration SQL + update `$inferSelect`/`$inferInsert` types.
   *Verify:* `tsc` on `@workspace/db`.

**Phase 2 — Backend** (`artifacts/api-server`)
4. Add a **dependency-free SVG sanitizer** util (allowlist tags/attrs; strip `<script>`, `on*`, `<foreignObject>`, external `href`/`xlink`, entities).
5. Extend `danceTypes.ts`: `CreateBody`/`UpdateBody` add `description, iconUrl, color, coverImageUrl`; new `POST /api/admin/settings/dance-types/:id/icon` (accepts raw SVG body → sanitize → store `icon_svg`+`icon_mime`); new public `GET /api/dance-types/:id/icon.svg` (serves stored SVG, `Content-Type: image/svg+xml`, cache headers). Soft-delete: ensure `DELETE` is replaced/aliased by `PATCH { isActive:false }` (keep route but make it deactivate, or remove and rely on toggle).
6. Public `GET /api/dance-types` already returns all columns → new fields included; expose a computed `iconSvgUrl` (the serve endpoint) when `icon_svg` present.
   *Verify:* `tsc` on api-server (build verified on your CI — see Blockers).

**Phase 3 — API contract** (`lib/api-spec` + `lib/api-client-react`)
7. Update `openapi.yaml`: `DanceType` + bodies gain the new fields + icon endpoints. Regenerate orval client; build `@workspace/api-client-react`.
   *Verify:* `tsc` on the client package + central.

**Phase 4 — Admin** (`artifacts/admin/src/pages/settings.tsx`)
8. Extend the Dance Types form: Description, Brand Color (picker), Cover Image URL, **SVG file upload** (read file → `POST …/icon`) with live preview + `iconUrl` fallback field. Active toggle stays. Reorder (sortOrder) up/down or drag.
   *Verify:* `tsc` on admin (build on your CI).

**Phase 5 — Mobile** (`artifacts/central`)
9. New `components/CategoryIcon.tsx`: SVG (`SvgUri` for `iconSvgUrl`/`iconUrl`.svg) · PNG (`expo-image`) · **first-letter fallback**. No per-style branching.
10. Classes screen: replace `DANCE_CATEGORIES`/`CAT_ICON`/`catRgb` with `useListDanceTypes()` data (name, color, icon, order). Filtering/expansion logic unchanged; match by `danceTypeId` (fallback `category` slug/name during transition).
11. Remove `CAT_ICON`; delete `DANCE_CATEGORIES` once unreferenced.
    *Verify:* `tsc` on central (verifiable here).

**Phase 6 — Migration**
12. Seed `dance_types` rows for the 5 existing categories (name, slug, brand color); studio uploads SVGs via admin.
13. Backfill `classes.dance_type_id` from `category` string (slug/name match); report unmatched.
14. Dual-read window (ID preferred, string fallback) until backfill verified 100%.

**Phase 7 — Cleanup** (later release, after verification)
15. Admin class create/edit sets `danceTypeId`. Drop mobile fallback + `category` usage; optionally retire `classes.category`.

---

## Blockers confirmation
**No architectural blockers.** The entity, CRUD, admin section, and mobile hook already exist — this is additive. Three **sandbox constraints** (not blockers), handled as noted:
1. **api-server / admin builds can't run in this sandbox** (EPERM on dist cleanup). → Verified by `tsc` typecheck here; full build on your machine/CI.
2. **orval client regen** needs the codegen toolchain. → I'll run it; if it can't run here, I hand-edit `openapi.yaml` + generated types and you regenerate on your side. Not architectural.
3. **SVG sanitizer** — to honor "no external dependency/storage," I'll write a small **in-house allowlist sanitizer** (no npm dependency), so nothing needs installing.

Proceeding now, in the order above.
