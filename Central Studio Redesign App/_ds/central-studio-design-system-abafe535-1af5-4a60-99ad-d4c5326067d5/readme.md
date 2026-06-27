# Central Studio Design System

A premium, performance-driven design system for **Central Studio** — a vibrant dance learning platform serving kids, adults, and seniors across 12+ dance styles (Hip Hop, Afro, Salsa, Bachata, Breaking, Locking, Popping, Contemporary, Ballet, Jazz, Zumba, House Dance).

## Brand Overview

**Central Studio** is a world-class dance education platform with:
- **Brand Personality:** Energetic, creative, modern, premium, confident, human, performance-driven, youthful but professional
- **Core Products:** Mobile learning app, marketing website, instructor dashboards
- **Design Language:** Inspired by movement, stage lighting, rhythm, dance culture, performance, and modern digital products

---

## Brand Philosophy

Central Studio elevates dance education through **accessibility, confidence, and community**. Every design decision honors the *performance* at the heart of dance — the joy of mastery, the discipline of practice, the magic of live movement. The platform celebrates dancers of all ages and levels, making world-class instruction feel personal, achievable, and thrilling.

**Design Principles:**
1. **Performance-First** — Every interaction should feel as crisp and responsive as a dancer's movement
2. **Human Connection** — Center the dancer, not the interface; show real instructors, real progress
3. **Playful Confidence** — Modern, bold typography and color usage; never corporate or cold
4. **Movement & Rhythm** — Subtle motion and pacing mirror dance choreography; nothing feels static
5. **Inclusive Mastery** — Clear progression paths for all levels; celebrate small wins

---

## Content Fundamentals

**Tone:** Encouraging, energetic, conversational. Speak to dancers as peers, not students.

**Voice & Casing:**
- Use **title case** for buttons, headers, screen titles
- Use **sentence case** for body copy, descriptions, form labels
- Avoid ALL CAPS except for emphasis on single words (e.g., "Dance LIVE")
- Contractions welcome ("You're ready", "Let's go")

**Copy Examples:**
- ❌ "Select a dance class from our comprehensive catalog"
- ✅ "Pick a style. Find your vibe."
- ❌ "Your class begins in 30 minutes"
- ✅ "Class starts in 30 min — get ready!"

**Emoji & Special Characters:**
- Emoji used sparingly: 💃 🎵 ⏱️ (never gratuitous)
- Unicode arrows for navigation: → (right), ← (left)
- Mid-dot (·) for separators in compact UI
- No decorative Unicode or emojis in brand language

---

## Visual Foundations

### Colors

**Primary Palette:**
- **Gold** (`--color-gold-500`: `#FFB81C`) — Primary CTA, energy, prestige
- **Purple** (`--color-purple-500`: `#9D4EDD`) — Secondary, creative, movement
- **Black** (`--color-black`: `#1A1A1A`) — Text, contrast, authority
- **White** (`--color-white`: `#FFFFFF`) — Backgrounds, clarity

**Semantic Colors:**
- **Success:** `#10B981` (emerald, confidence)
- **Warning:** `#F59E0B` (amber, caution)
- **Danger:** `#EF4444` (red, stop)
- **Info:** `#3B82F6` (blue, clarity)

**Neutrals:**
- 6-step gray scale from `--color-gray-100` to `--color-gray-900`
- Used for borders, dividers, secondary text, disabled states

### Typography

**Fonts:**
- **Display:** PlusJakarta Sans (PJS) — bold, geometric, modern. Used for headlines, section titles, CTAs
- **Body:** Inter — clean, readable, contemporary. Used for all body copy, labels, descriptions
- **Mono:** IBM Plex Mono — for code, timestamps, technical info

**Type Scale (px):**
- **Poster:** 72px, `--fw-black`, `--lh-poster`, `--ls-poster` (hero headlines)
- **H1:** 56px, `--fw-bold`, `--lh-heading`
- **H2:** 42px, `--fw-bold`, `--lh-heading`
- **H3:** 32px, `--fw-semibold`, `--lh-heading`
- **H4:** 24px, `--fw-semibold`, `--lh-heading`
- **Body LG:** 18px, `--fw-regular`, `--lh-body`
- **Body:** 16px, `--fw-regular`, `--lh-body` (default)
- **Body SM:** 14px, `--fw-regular`, `--lh-body`
- **Label:** 12px, `--fw-medium`, `--ls-wide` (always uppercase)
- **Caption:** 11px, `--fw-regular`, `--lh-relaxed`

**Weight Usage:**
- Headlines: Bold (700) or Extrabold (800)
- Emphasis/medium: Semibold (600)
- Body: Regular (400) or Medium (500)
- Disabled/secondary: Regular (400)

### Spacing System

**Base unit:** 4px

**Token scale:** 4, 8, 12, 16, 24, 32, 48, 64, 80, 96, 120, 160 (px)

**Usage:**
- **Padding inside components:** 8–16px
- **Gap between sibling elements:** 12–24px
- **Section/screen margins:** 24–48px
- **Card/container borders:** 8–16px padding

### Effects & Shadows

**Shadow System (3 levels):**
- **Subtle:** `0 1px 2px rgba(0,0,0,0.05)` — separates surfaces
- **Medium:** `0 4px 12px rgba(0,0,0,0.10)` — depth, hover state
- **Heavy:** `0 16px 32px rgba(0,0,0,0.15)` — modal, floating panels

**Glows (emphasis):**
- **Gold glow:** `0 0 16px rgba(255, 184, 28, 0.25)` — primary CTA focus
- **Purple glow:** `0 0 12px rgba(157, 78, 221, 0.20)` — secondary focus
- **Stage light:** `0 0 24px rgba(255, 184, 28, 0.15)` — special moments (livestream, featured)

**Blur & Transparency:**
- **Backdrop blur:** `backdrop-filter: blur(12px)` — modals, overlays
- **Overlay:** `rgba(0,0,0,0.40)` — dark mode, strong emphasis
- **Hover overlay:** `rgba(255,255,255,0.08)` — subtle lightness on dark

### Corner Radii

- **None (0px)** — text, small inline elements
- **Small (4px)** — inputs, small buttons, tags
- **Medium (8px)** — cards, larger buttons, modals
- **Large (12px)** — rounded containers, large cards
- **Full (999px)** — pills, circular avatars, fully rounded buttons

### Backgrounds & Patterns

**Primary Background:**
- White (`#FFFFFF`) on light theme
- Deep black (`#1A1A1A`) on dark theme (if supported)

**Card Background:**
- White with subtle shadow (Subtle level)
- Hover: Light gray (`--color-gray-50`) with Medium shadow

**Full-Bleed Imagery:**
- **Hero sections:** Full-width, 60vh min-height, dark overlay (20–30% opacity) for text contrast
- **Instructors/dancers:** Real photography, warm-toned, authentic movement captures
- **Class cards:** Full-bleed background image + gradient overlay (`rgba(26,26,26,0.30)` to `rgba(26,26,26,0.50)`)

**Gradients (sparingly):**
- **Gold-to-purple accent:** `linear-gradient(135deg, #FFB81C 0%, #9D4EDD 100%)` — special CTAs, hero elements
- **Staging light:** `radial-gradient(circle at center, rgba(255,184,28,0.15), transparent)` — spotlight moments
- **None else** — avoid generic gradients; use solid colors + shadows

### Motion & Animation

**Easing Functions:**
- **Default UI:** `--ease-out` — snappy, responsive (hover, focus)
- **Choreographed:** `--ease-stage` — celebratory bounce (transitions, CTA presses)
- **Smooth:** `--ease-in-out` — page transitions, large movements

**Durations:**
- **Instant:** 80ms (hover color change)
- **Fast:** 140ms (focus ring, small animations)
- **Base:** 220ms (default transitions, modal open)
- **Slow:** 340ms (page slide, choreographed entrance)
- **Slower:** 520ms (hero animation, multi-step sequence)

**Motion Patterns:**
- **Hover:** Color + scale (1.02x) with `--ease-out`
- **Press:** Scale down (0.98x) + darker color, `--dur-fast`
- **Entrance:** Fade + slide-up (40px) with `--ease-stage`, staggered children (+80ms each)
- **No autoplay loops** — motion is responsive, not decorative

### Interaction States

**Buttons & Interactive Elements:**

| State | Treatment |
|-------|-----------|
| **Default** | Solid color, shadow-subtle |
| **Hover** | Color lighter (or darker for dark bg), scale 1.02, shadow-medium |
| **Focus** | 2–3px gold glow, focus ring visible |
| **Active/Pressed** | Color darker, scale 0.98, shadow-subtle |
| **Disabled** | Opacity 0.50, no cursor, no shadows |

**Form Inputs:**

| State | Treatment |
|-------|-----------|
| **Empty/Default** | Gray border (--color-gray-300), light background |
| **Focused** | Gold border (2px), subtle gold glow, blue inner shadow |
| **Filled** | Same border, slightly darker bg |
| **Error** | Red border, red label, error icon, error message below |
| **Disabled** | Gray border, gray bg, opacity 0.5 |

**Cards:**
- **Rest:** White bg, subtle shadow
- **Hover:** Light gray bg, medium shadow, slight scale (1.01x)
- **Pressed:** Darker bg, no scale change

### Layout & Composition

**Grid & Spacing:**
- Mobile: 16px margins, full-bleed sections
- Tablet: 24px margins, 2-column grids
- Desktop: 48px margins, multi-column layouts (3–4 col)
- Card grids use 12–16px gaps

**Protection & Overlays:**
- Text on imagery always has a dark overlay or text shadow
- Use gradient overlays (`rgba(26,26,26,0.30)` → `rgba(26,26,26,0.60)`) for readability
- No exposed white text on light imagery

**Fixed Elements:**
- Top navigation: Always visible, shadow below
- Player controls: Sticky/fixed on mobile, always accessible
- CTA buttons: Sticky footer on mobile if critical

---

## Iconography

**Icon System:** **Lucide Icons** (lucide.dev)
- **Stroke weight:** 2px (medium clarity)
- **Size convention:** 20px base, scale as needed (16px small, 24px medium, 32px large)
- **Color:** Inherits text color; gold for primary actions
- **Style:** Line-based (not filled) for UI, except special brand illustrations

**Icon Usage:**
- Navigation: home, search, calendar, user, settings, play, pause, etc.
- Actions: plus, edit, trash, share, download, etc.
- Status: check, alert, info, help icons
- Dance styles: custom SVG illustrations for each style (breakdancing icon, ballet pointe, salsa rhythm, etc.)

**Brand Illustrations:**
- **Instructors:** Real photography, warm color grading
- **Dance styles:** Minimalist line-art silhouettes + style name (e.g., hip-hop dancer outline)
- **Empty states:** Playful, approachable illustrations (e.g., dancer warming up for "no classes yet")
- **Background decorations:** Subtle rhythm/grid patterns inspired by stage lighting (use sparingly)

**No emoji in UI** except in very specific brand moments (e.g., celebration, achievement badges).

---

## Component Library

The design system includes reusable React/JSX components:

- **Button** — Primary, secondary, ghost variants; sizes: sm, md, lg
- **Badge** — Status indicators (completed, in-progress, live)
- **Tag** — Categorical labels (dance styles, difficulty, duration)
- **Input** — Text, email, password, search with focus/error states
- **Card** — Container with image support, shadow, and hover states
- **Avatar** — Circular user/instructor photos, initials fallback
- **Switch** — Toggle for settings
- **Tabs** — Horizontal tab navigation
- **Modal** — Dialog with overlay, backdrop blur
- **Toast** — Notification messages (success, error, info)
- **Tooltip** — Contextual help text

Each component is documented in its own directory with props, variants, and usage examples visible in the Design System tab.

---

## File Structure

```
central-studio-design-system/
├── styles.css                  # Global entry point (@import all tokens)
├── tokens/
│   ├── colors.css
│   ├── typography.css
│   ├── spacing.css
│   ├── effects.css
│   ├── motion.css
├── components/
│   ├── buttons/
│   │   ├── Button.jsx
│   │   ├── Button.d.ts
│   │   ├── Button.prompt.md
│   │   └── buttons.card.html
│   ├── forms/
│   │   ├── Input.jsx, Input.d.ts, Input.prompt.md
│   │   ├── Switch.jsx, Switch.d.ts, Switch.prompt.md
│   │   └── forms.card.html
│   ├── containers/
│   │   ├── Card.jsx, Card.d.ts, Card.prompt.md
│   │   ├── Modal.jsx, Modal.d.ts, Modal.prompt.md
│   │   └── containers.card.html
│   └── [other groups...]
├── ui_kits/
│   ├── mobile_app/
│   │   ├── index.html
│   │   ├── screens/
│   │   │   ├── Discover.jsx
│   │   │   ├── ClassDetail.jsx
│   │   │   ├── Schedule.jsx
│   │   │   └── Booking.jsx
│   ├── marketing_site/
│   │   ├── index.html
│   │   └── screens/
│   │       └── Home.jsx
├── assets/
│   ├── logo.svg
│   ├── logo-mark.svg
│   ├── dance-styles/ (SVG icons)
│   └── [illustrations, patterns]
├── guidelines/
│   ├── [specimen cards in Design System tab]
└── readme.md (this file)
```

---

## Design System Companion

Use this design system in two ways:

1. **Consuming projects** — Copy `_ds/` folder + read `_ds/readme.md` for setup
2. **Agent skills** — Load via `SKILL.md` for Claude Code integration

For questions or contributions, refer to the `SKILL.md` file.

---

**Last Updated:** June 2026  
**Namespace:** `CentralStudioDesignSystem_abafe5`
