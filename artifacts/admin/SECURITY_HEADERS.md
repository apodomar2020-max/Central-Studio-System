# Admin dashboard — browser security headers

Security Wave — Admin Session / Browser Security Hardening. Headers are set
in `vercel.json` (JSON has no comment syntax, hence this file).

## HSTS

`max-age=15552000` (180 days). No `includeSubDomains` / `preload`: this
domain's subdomains are not confirmed to be fully HTTPS-safe under our
control, and preload-listing a domain is effectively irreversible — adding
either later is safe and cheap; removing them after the fact is not.

## CSP — enforced, not report-only

A real incompatibility was found and is scoped narrowly rather than avoided
by falling back to report-only:

- `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` — roughly
  30 admin components use the HTML `style={{...}}` attribute, which CSP's
  `style-src` governs identically to `<style>` blocks. Auditing and
  rewriting all of them to className-only styling is out of scope for a
  one-pass security change (real UI regression risk); `unsafe-inline` on
  `style-src` only (not `script-src`) is the standard, narrowly-scoped
  mitigation for this exact situation.
- `script-src 'self'` — no `unsafe-inline`/`unsafe-eval`. Verified against
  the actual production build (`vite build` output): no inline `<script>`
  blocks are emitted (no legacy-build polyfill plugin is configured), so
  the strict default is safe as-is.
- `font-src 'self' https://fonts.gstatic.com`, and Google Fonts'
  stylesheet host in `style-src` — the only third-party asset host the app
  uses (`index.html`'s `<link>` tags).
- `img-src 'self' https: data: blob:` — deliberately broad. Class/instructor
  photo URLs, Google Drive-derived image links, and social-provider avatar
  URLs are arbitrary externally-hosted `https:` URLs by design (see
  `lib/api-client-react/src/media-url.ts`'s `normalizeMediaUrl`) — existing,
  intentional product behavior this pass must not silently break.
- `connect-src 'self' https://supportive-magic-production-b800.up.railway.app`
  — the API origin. Update this value if the production API's domain ever
  changes.
- `frame-ancestors 'none'` — the dashboard must never be embeddable, backed
  up by `X-Frame-Options: DENY` for older browsers.
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` — no
  plugins/Flash-era content, no `<base>` tag hijacking, no cross-origin form
  submission targets.

## Other headers

- `Referrer-Policy: strict-origin-when-cross-origin` — full path kept
  same-origin, only the origin leaks cross-origin.
- `Permissions-Policy` — camera/microphone/geolocation/payment/usb/
  interest-cohort all denied; the dashboard uses none of them.
- `Cross-Origin-Opener-Policy: same-origin` — isolates the admin tab from
  cross-origin window references; does not affect `fetch`/XHR to the API.
- `Cross-Origin-Resource-Policy: same-site` — governs who may embed the
  admin app's *own* static assets, not what the admin app itself fetches;
  does not affect loading external images via `img-src` above.
- `Cross-Origin-Embedder-Policy` is deliberately **not** set — it would
  require every externally-hosted image (Google Drive links, arbitrary
  admin-entered URLs, social-provider avatars) to serve a matching CORP/CORS
  header, which is outside our control for third-party hosts. Setting it
  would silently break legitimate image loading.

## CORS (API side, `artifacts/api-server/src/app.ts`)

Already origin-allowlisted (`ALLOWED_ORIGINS` env var) with no wildcard
credentials — reconfirmed as part of this pass, not changed.
