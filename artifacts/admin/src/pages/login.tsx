/**
 * Fixed-viewport admin gateway. Authentication remains owned by
 * AdminAuthContext; this file only controls the responsive presentation.
 */
import { useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Moon,
  ShieldCheck,
  Sun,
  UserRound,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";

import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import "./login.css";

const featureItems = [
  { label: "Classes", icon: CalendarDays },
  { label: "Students", icon: UsersRound },
  { label: "Instructors", icon: UserRoundCheck },
  { label: "Reports", icon: BarChart3 },
] as const;

export default function LoginPage() {
  const { login } = useAdminAuth();
  const { theme, toggleTheme } = useAdminTheme();
  const isDark = theme === "dark";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password || loading) return;
    setError(null);
    setLoading(true);
    try {
      await login(username.trim().toLowerCase(), password);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = Boolean(username.trim() && password && !loading);

  return (
    <main className="admin-login-page" data-login-theme={isDark ? "dark" : "light"}>
      <section className="admin-login-intro" aria-label="Central Studio administration">
        <img
          className="admin-login-brand"
          src="/logo-central-white.png"
          alt="Central Studio — Dance, Learn, Create"
          draggable={false}
        />
        <div className="admin-login-accent" aria-hidden="true" />
        <h1 className="admin-login-statement">
          <span>Studio</span>
          <span>Management</span>
          <span className="admin-login-statement-accent">Made Simple.</span>
        </h1>
        <p className="admin-login-supporting-copy">
          Classes, schedules, students, instructors and more — all in one place.
        </p>

        <ul className="admin-login-features" aria-label="Administration areas">
          {featureItems.map(({ label, icon: Icon }) => (
            <li key={label}>
              <span aria-hidden="true"><Icon /></span>
              <small>{label}</small>
            </li>
          ))}
        </ul>
      </section>

      <figure className="admin-login-photo" aria-hidden="true">
        <img src="/central-studio-group.jpg" alt="" draggable={false} />
        <span />
      </figure>

      <section className="admin-login-card" aria-labelledby="admin-login-title">
        <button
          type="button"
          className="admin-login-theme-toggle"
          onClick={toggleTheme}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          <span>{isDark ? "Light" : "Dark"}</span>
        </button>
        <div className="admin-login-content">
          <img
            className="admin-login-card-logo"
            src={isDark ? "/logo-central-white.png" : "/logo-central-studio.png"}
            alt="Central Studio — Dance, Learn, Create"
            draggable={false}
          />
          <h2 id="admin-login-title">Welcome Back</h2>
          <p className="admin-login-description">Sign in to your Central Studio admin account</p>

          <form className="admin-login-form" onSubmit={handleSubmit} noValidate>
            <div className="admin-login-form-control">
              <label htmlFor="username">Username</label>
              <div className="admin-login-field">
              <UserRound className="admin-login-field-icon" aria-hidden="true" />
              <input
                id="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={loading}
                placeholder="Enter your username"
                autoComplete="username"
                autoFocus
                aria-label="Username"
              />
              </div>
            </div>

            <div className="admin-login-form-control">
              <label htmlFor="password">Password</label>
              <div className="admin-login-field">
              <LockKeyhole className="admin-login-field-icon" aria-hidden="true" />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={loading}
                placeholder="Enter your password"
                autoComplete="current-password"
                aria-label="Password"
                aria-describedby={error ? "admin-login-error" : undefined}
              />
              <button
                type="button"
                className="admin-login-password-toggle"
                onClick={() => setShowPassword((visible) => !visible)}
                disabled={loading}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
              </div>
            </div>

            <div className="admin-login-feedback" aria-live="polite">
              {error ? <p id="admin-login-error" role="alert">{error}</p> : null}
            </div>

            <button
              type="submit"
              className="admin-login-submit"
              disabled={!canSubmit}
              aria-busy={loading}
            >
              <span className="admin-login-submit-copy">
                {loading ? <><Loader2 aria-hidden="true" /> Signing In…</> : "Sign In"}
              </span>
              <ArrowRight className="admin-login-submit-arrow" aria-hidden="true" />
            </button>
            <p className="admin-login-security-note">
              <ShieldCheck aria-hidden="true" /> Authorized staff only. Keep your credentials private.
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}
