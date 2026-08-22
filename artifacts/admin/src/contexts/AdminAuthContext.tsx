/**
 * AdminAuthContext — stores the current admin user + JWT token.
 *
 * Token is persisted in localStorage so a page refresh doesn't log you out.
 * On mount, we call /api/admin/auth/me with the stored token to verify
 * the session is still valid (token not expired, account still active).
 *
 * Usage:
 *   const { user, token, login, logout, isLoading } = useAdminAuth();
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { hasRolePermission, type PermissionMap } from "@workspace/api-zod";

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
export const ADMIN_TOKEN_STORAGE_KEY = "admin_jwt";

export interface AdminRole {
  id: number;
  name: string;
  permissions: PermissionMap;
}

export interface AdminUser {
  id: number;
  username: string;
  fullName: string;
  email: string;
  isSuperAdmin: boolean;
  roleId: number | null;
  role: AdminRole | null;
}

interface AdminAuthContextValue {
  user: AdminUser | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** Returns true if the current user can perform `action` on `module`. */
  can: (module: string, action: string) => boolean;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

function makeHeaders(token?: string | null): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { "x-admin-token": token } : {}),
  };
  return headers;
}

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY));
  const [isLoading, setIsLoading] = useState(true);

  // On mount (or when token changes from localStorage), verify the session.
  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    fetch(`${API_BASE}/api/admin/auth/me`, { headers: makeHeaders(token) })
      .then(async (res) => {
        if (!res.ok) throw new Error("Session invalid");
        return res.json() as Promise<AdminUser>;
      })
      .then((adminUser) => setUser(adminUser))
      .catch(() => {
        // Token expired or account deactivated — clear it.
        localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, [token]);

  const login = useCallback(async (username: string, password: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/api/admin/auth/login`, {
      method: "POST",
      headers: makeHeaders(),
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? "Login failed");
    }

    const data = await res.json() as { token: string; user: AdminUser };
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const can = useCallback(
    (module: string, action: string): boolean => {
      if (!user) return false;
      if (user.isSuperAdmin) return true;
      return hasRolePermission(user.role?.permissions, module, action);
    },
    [user],
  );

  return (
    <AdminAuthContext.Provider value={{ user, token, isLoading, login, logout, can }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  return ctx;
}
