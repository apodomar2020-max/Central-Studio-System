/**
 * Admin Login Page — Premium redesign
 *
 * UI-only file. Authentication logic is untouched:
 *   - useAdminAuth().login() call is identical
 *   - form submit handler is identical
 *   - no auth state, JWT, or API changes
 */
import { useState } from "react";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { Loader2, User, Lock, ShieldCheck, Eye, EyeOff } from "lucide-react";

// ─── Input component (inline — avoids shadcn overrides on this screen) ────────
function GlassInput({
  id,
  type,
  value,
  onChange,
  disabled,
  placeholder,
  autoComplete,
  autoFocus,
  icon: Icon,
  rightSlot,
  "aria-label": ariaLabel,
}: {
  id: string;
  type: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled: boolean;
  placeholder: string;
  autoComplete?: string;
  autoFocus?: boolean;
  icon: React.ElementType;
  rightSlot?: React.ReactNode;
  "aria-label"?: string;
}) {
  const [focused, setFocused] = useState(false);

  const borderColor = focused
    ? "rgba(0,182,215,0.55)"
    : "rgba(255,255,255,0.09)";
  const bg = focused ? "rgba(0,182,215,0.07)" : "rgba(255,255,255,0.05)";
  const shadow = focused ? "0 0 0 3px rgba(0,182,215,0.12)" : "none";

  return (
    <div className="relative">
      <Icon
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
        style={{ color: focused ? "rgba(0,182,215,0.7)" : "rgba(255,255,255,0.28)" }}
        aria-hidden="true"
      />
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="w-full rounded-xl py-3 pl-10 pr-10 text-sm text-white outline-none transition-all duration-200 placeholder:text-white/20 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ background: bg, border: `1px solid ${borderColor}`, boxShadow: shadow }}
      />
      {rightSlot && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">{rightSlot}</div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const { login } = useAdminAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // ── Auth logic — unchanged ─────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username.trim().toLowerCase(), password);
      // Redirect happens automatically via App.tsx route guard re-render
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = Boolean(username && password && !loading);

  return (
    <div
      className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden px-4 py-10"
      style={{ background: "#060C10" }}
    >
      {/* ── Background: stage photo ──────────────────────────────────────── */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "url('/login-bg.png')",
          backgroundSize: "cover",
          backgroundPosition: "center 30%",
          backgroundRepeat: "no-repeat",
        }}
      />

      {/* ── Overlay stack (brand-matched darks + spotlight accents) ─────── */}

      {/* Base dark overlay — ensures readability */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: "rgba(6,12,16,0.72)" }}
      />

      {/* Radial vignette — darkens edges, focuses centre */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 80% at 50% 50%, transparent 30%, rgba(6,12,16,0.65) 100%)",
        }}
      />

      {/* Cyan brand glow — top-left, echoes stage light */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 55% 40% at 15% 20%, rgba(0,182,215,0.13) 0%, transparent 65%)",
        }}
      />

      {/* Stage purple accent — bottom-right */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 65% 45% at 85% 85%, rgba(138,92,255,0.11) 0%, transparent 60%)",
        }}
      />

      {/* Subtle grid — dance-floor lines */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,182,215,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,182,215,0.04) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          backgroundPosition: "center center",
        }}
      />

      {/* Bottom gradient fade — card floats above darkness */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-40"
        style={{ background: "linear-gradient(to bottom, transparent, rgba(6,12,16,0.9))" }}
      />

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="relative z-10 flex w-full max-w-sm flex-col items-center">

        {/* Logo */}
        <img
          src="/logo-central-white.png"
          alt="Central Studio"
          className="mb-5 h-14 w-auto select-none"
          style={{
            filter: "drop-shadow(0 0 22px rgba(0,182,215,0.45))",
            imageRendering: "crisp-edges",
          }}
          draggable={false}
        />

        {/* Badge */}
        <span
          className="mb-4 inline-block rounded-full px-3.5 py-1 text-[10px] font-semibold uppercase tracking-widest"
          style={{
            background: "rgba(0,182,215,0.1)",
            border: "1px solid rgba(0,182,215,0.22)",
            color: "#00B6D7",
            letterSpacing: "0.18em",
          }}
        >
          Admin Dashboard
        </span>

        {/* Hero headline */}
        <h1
          className="mb-1.5 text-center text-3xl font-bold tracking-tight text-white"
          style={{ textShadow: "0 2px 16px rgba(0,0,0,0.6)" }}
        >
          Welcome Back
        </h1>
        <p
          className="mb-8 text-center text-[13px] leading-relaxed"
          style={{ color: "rgba(255,255,255,0.4)" }}
        >
          Manage classes, bookings, ballet assessments, instructors,
          reports, and studio operations from one place.
        </p>

        {/* ── Glass card ─────────────────────────────────────────────────── */}
        <div
          className="w-full rounded-2xl p-7"
          style={{
            background: "rgba(10,18,22,0.68)",
            backdropFilter: "blur(28px) saturate(150%)",
            WebkitBackdropFilter: "blur(28px) saturate(150%)",
            border: "1px solid rgba(0,182,215,0.12)",
            boxShadow:
              "0 2px 4px rgba(0,0,0,0.2), 0 24px 64px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.2)",
          }}
          role="region"
          aria-label="Sign-in form"
        >
          <div className="mb-5">
            <h2 className="text-base font-semibold text-white">Sign In</h2>
            <p className="mt-0.5 text-[12px]" style={{ color: "rgba(255,255,255,0.38)" }}>
              Enter your credentials to continue.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {/* Username */}
            <div className="space-y-1.5">
              <label
                htmlFor="username"
                className="block text-[11px] font-semibold uppercase tracking-widest"
                style={{ color: "rgba(255,255,255,0.45)" }}
              >
                Username
              </label>
              <GlassInput
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                placeholder="superadmin"
                autoComplete="username"
                autoFocus
                icon={User}
                aria-label="Username"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="block text-[11px] font-semibold uppercase tracking-widest"
                style={{ color: "rgba(255,255,255,0.45)" }}
              >
                Password
              </label>
              <GlassInput
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                placeholder="••••••••"
                autoComplete="current-password"
                icon={Lock}
                aria-label="Password"
                rightSlot={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="flex h-5 w-5 items-center justify-center rounded transition-opacity hover:opacity-80"
                    style={{ color: "rgba(255,255,255,0.3)" }}
                  >
                    {showPassword ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                }
              />
            </div>

            {/* Error */}
            {error && (
              <div
                className="flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-[13px] leading-snug"
                style={{
                  background: "rgba(239,68,68,0.09)",
                  border: "1px solid rgba(239,68,68,0.22)",
                  color: "#FCA5A5",
                }}
                role="alert"
                aria-live="assertive"
              >
                <span className="mt-0.5 shrink-0">⚠</span>
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <SignInButton loading={loading} disabled={!canSubmit} />
          </form>
        </div>

        {/* Security footer */}
        <div
          className="mt-5 flex items-center gap-1.5 text-[11px]"
          style={{ color: "rgba(255,255,255,0.2)" }}
          aria-label="Security notice"
        >
          <ShieldCheck
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: "rgba(0,182,215,0.32)" }}
            aria-hidden="true"
          />
          <span>Secure Admin Access</span>
          <span aria-hidden="true">·</span>
          <span>Authorized Personnel Only</span>
        </div>
      </div>
    </div>
  );
}

// ─── Sign-in button with hover lift ──────────────────────────────────────────
function SignInButton({ loading, disabled }: { loading: boolean; disabled: boolean }) {
  const [hovered, setHovered] = useState(false);

  const baseStyle: React.CSSProperties = {
    background: disabled
      ? "rgba(0,182,215,0.25)"
      : hovered
        ? "linear-gradient(135deg,#00ccee 0%,#00a8cc 100%)"
        : "linear-gradient(135deg,#00B6D7 0%,#009ab8 100%)",
    color: "#030a0d",
    boxShadow: hovered && !disabled
      ? "0 6px 24px rgba(0,182,215,0.45)"
      : "0 2px 10px rgba(0,182,215,0.22)",
    transform: hovered && !disabled ? "translateY(-1px)" : "translateY(0)",
    transition: "all 0.18s ease",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled && !loading ? 0.55 : 1,
  };

  return (
    <button
      type="submit"
      disabled={disabled}
      className="mt-1.5 w-full rounded-xl py-3 text-sm font-semibold tracking-wide"
      style={baseStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-busy={loading}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Signing in…
        </span>
      ) : (
        "Sign In"
      )}
    </button>
  );
}
