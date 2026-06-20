import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type AdminTheme = "dark" | "night";

interface AdminThemeContextValue {
  theme: AdminTheme;
  toggleTheme: () => void;
}

const STORAGE_KEY = "central-admin-theme";
const AdminThemeContext = createContext<AdminThemeContextValue | null>(null);

export function AdminThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<AdminTheme>(() =>
    localStorage.getItem(STORAGE_KEY) === "night" ? "night" : "dark",
  );

  useEffect(() => {
    document.documentElement.classList.toggle("night", theme === "night");
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const value = useMemo<AdminThemeContextValue>(() => ({
    theme,
    toggleTheme: () => setTheme((current) => current === "dark" ? "night" : "dark"),
  }), [theme]);

  return <AdminThemeContext.Provider value={value}>{children}</AdminThemeContext.Provider>;
}

export function useAdminTheme(): AdminThemeContextValue {
  const context = useContext(AdminThemeContext);
  if (!context) throw new Error("useAdminTheme must be used inside AdminThemeProvider");
  return context;
}
