/**
 * Central Studio — Design System Color Tokens
 *
 * Source of truth: Central Studio Redesign App / _ds/tokens/colors.css
 * Last aligned: 2026-06-22 (Fix Pack 1 — Visual Parity)
 *
 * INK SCALE (dark theme base)
 * --cs-ink-950  #060708   deepest background
 * --cs-ink-900  #0A0B0D   app background
 * --cs-ink-800  #15171B   card background
 * --cs-ink-700  #22262C   card-light / elevated surface
 * --cs-ink-600  #343A43   divider / subtle border
 * --cs-ink-500  #4C545E   secondary icon / muted border
 * --cs-ink-400  #6B747F   secondary text (body-sm, helper)
 * --cs-ink-300  #8E97A2   tertiary text
 * --cs-ink-200  #B6BDC6   on-dark secondary
 *
 * PRIMARY PALETTE
 * --cs-cyan-500    #00B6D7   primary interactive
 * --cs-magenta-500 #FF2E7E   accent / badge
 * --cs-violet-500  #7C3AED   adults level chip
 * --cs-lime-500    #B6E80A   kids level chip
 * --cs-amber-500   #FFB02E   warning / few-seats
 *
 * SEMANTIC
 * --cs-success-500 #1FB871
 * --cs-danger-500  #FF3B47
 */

const colors = {
  light: {
    text: "#FFFFFF",
    tint: "#00B6D7",
    background: "#0A0B0D",
    foreground: "#FFFFFF",
    card: "#15171B",
    cardForeground: "#FFFFFF",
    primary: "#00B6D7",
    primaryForeground: "#0A0B0D",
    secondary: "#22262C",
    secondaryForeground: "#FFFFFF",
    muted: "#22262C",
    mutedForeground: "#8E97A2",
    accent: "#00B6D7",
    accentForeground: "#0A0B0D",
    destructive: "#FF3B47",
    destructiveForeground: "#FFFFFF",
    border: "rgba(255,255,255,0.08)",
    input: "#22262C",
  },
  dark: {
    text: "#FFFFFF",
    tint: "#00B6D7",
    background: "#0A0B0D",
    foreground: "#FFFFFF",
    card: "#15171B",
    cardForeground: "#FFFFFF",
    primary: "#00B6D7",
    primaryForeground: "#0A0B0D",
    secondary: "#22262C",
    secondaryForeground: "#FFFFFF",
    muted: "#22262C",
    mutedForeground: "#8E97A2",
    accent: "#00B6D7",
    accentForeground: "#0A0B0D",
    destructive: "#FF3B47",
    destructiveForeground: "#FFFFFF",
    border: "rgba(255,255,255,0.08)",
    input: "#22262C",
  },
  radius: 12,

  // ── Studio semantic palette (used by screens that import colors directly) ──
  studio: {
    primary:    "#00B6D7",   // --cs-cyan-500
    secondary:  "#00B6D7",   // alias — same hue
    background: "#0A0B0D",   // --cs-ink-900
    card:       "#15171B",   // --cs-ink-800
    cardLight:  "#22262C",   // --cs-ink-700
    border:     "rgba(255,255,255,0.08)",
  },

  // ── Stage variant palette (AppButton "stage", BrandLogo, StepIndicator) ──
  // Now aligned to design tokens — was previously a divergent set.
  stage: {
    primary:    "#00B6D7",   // --cs-cyan-500 (same as studio; stage = live/performance context)
    accent:     "#00B6D7",   // --cs-cyan-500
    background: "#0A0B0D",   // --cs-ink-900
    card:       "#15171B",   // --cs-ink-800
    cardLight:  "#22262C",   // --cs-ink-700
    border:     "rgba(255,255,255,0.08)",
  },

  // ── Ink scale (exposed for components that need fine-grained steps) ──
  ink: {
    950: "#060708",
    900: "#0A0B0D",
    800: "#15171B",
    700: "#22262C",
    600: "#343A43",
    500: "#4C545E",
    400: "#6B747F",
    300: "#8E97A2",
    200: "#B6BDC6",
  },

  // ── Extended palette ─────────────────────────────────────────────────────
  cyan:    "#00B6D7",   // --cs-cyan-500
  magenta: "#FF2E7E",   // --cs-magenta-500
  violet:  "#7C3AED",   // --cs-violet-500
  lime:    "#B6E80A",   // --cs-lime-500
  amber:   "#FFB02E",   // --cs-amber-500

  // ── Semantic ─────────────────────────────────────────────────────────────
  success: "#1FB871",   // --cs-success-500
  warning: "#FFB02E",   // --cs-amber-500
  error:   "#FF3B47",   // --cs-danger-500
  info:    "#3B82F6",   // kept for legacy info banners
};

export default colors;
