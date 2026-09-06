/**
 * Fixed-viewport admin gateway. Authentication remains owned by
 * AdminAuthContext; this file only controls the responsive presentation.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { useAdminAuth } from "@/contexts/AdminAuthContext";
import "./login.css";

const LOGIN_BACKGROUND_VIDEO =
  "https://res.cloudinary.com/wwwgoc5d/video/upload/v1784993871/Logo_animation_theater_light_glow_202607251827_gwr_video_mvp_sbp8pd.mp4";

export default function LoginPage() {
  const { login } = useAdminAuth();
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
    <main className="admin-login-page">
      <video className="admin-login-video" aria-hidden="true" autoPlay muted loop playsInline preload="auto">
        <source src={LOGIN_BACKGROUND_VIDEO} type="video/mp4" />
      </video>
      <div className="admin-login-video-shade" aria-hidden="true" />

      <section className="admin-login-card" aria-labelledby="admin-login-title">
        <div className="admin-login-content">
          <img className="admin-login-logo" src="/logo.png" alt="Central Studio" draggable={false} />
          <h1 id="admin-login-title">Sign In</h1>
          <p className="admin-login-description">Enter Your Credentials To Continue.</p>

          <form className="admin-login-form" onSubmit={handleSubmit} noValidate>
            <label className="admin-login-field" htmlFor="username">
              <span className="sr-only">Username</span>
              <img className="admin-login-field-icon admin-login-user-icon" src="/login-icons/user.svg" alt="" aria-hidden="true" />
              <input
                id="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={loading}
                placeholder="Username"
                autoComplete="username"
                autoFocus
                aria-label="Username"
              />
            </label>

            <label className="admin-login-field" htmlFor="password">
              <span className="sr-only">Password</span>
              <img className="admin-login-field-icon admin-login-lock-icon" src="/login-icons/lock.svg" alt="" aria-hidden="true" />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={loading}
                placeholder="Password"
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
                <img src={showPassword ? "/login-icons/see.svg" : "/login-icons/unseen.svg"} alt="" aria-hidden="true" />
              </button>
            </label>

            <div className="admin-login-feedback" aria-live="polite">
              {error ? <p id="admin-login-error" role="alert">{error}</p> : null}
            </div>

            <button
              type="submit"
              className="admin-login-submit"
              disabled={!canSubmit}
              aria-busy={loading}
            >
              {loading ? <span><Loader2 aria-hidden="true" /> Signing In…</span> : "Sign In"}
            </button>
          </form>
        </div>

        <footer className="admin-login-footer" aria-label="Security notice">
          <img src="/login-icons/accessibility.svg" alt="" aria-hidden="true" />
          <span>Secure Admin Access - Authorized Personnel Only</span>
        </footer>
      </section>
    </main>
  );
}
