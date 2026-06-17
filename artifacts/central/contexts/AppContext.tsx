import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";

export interface User {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  emailVerified: boolean;
  birthday?: string;
  role: "student" | "parent" | "instructor";
  /** Opaque UUID used to generate the secure QR code. Never logged or displayed as text. */
  qrToken?: string;
}

export interface ChildProfile {
  id: string;
  fullName: string;
  birthday: string;
  age: number;
  gender: "male" | "female";
  medicalNotes?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

export interface Booking {
  id: string;
  classId: string;
  scheduleId?: string;
  className: string;
  danceType: string;
  instructorName: string;
  instructorImage?: string;
  date: string;
  time: string;
  scheduleLabel?: string;
  duration: string;
  location: string;
  price: number;
  participantType: "self" | "child";
  participantName: string;
  paymentMethod: "online" | "cash" | "packageCredit";
  paymentStatus: "paid" | "unpaid" | "refunded";
  bookingStatus: "confirmed" | "pendingPayment" | "cancelled" | "attended" | "noShow" | "refunded";
  bookingType: "single" | "package" | "ballet";
  userPackageId?: string;
  bookingNumber: string;
  attendanceStatus: "booked" | "attended" | "noShow" | "cancelled";
  createdAt: string;
}

export interface Package {
  id: string;
  title: string;
  numberOfCredits: number;
  price: number;
  validityMonths: number;
  description: string;
  isActive: boolean;
  popular?: boolean;
}

export interface UserPackage {
  id: string;
  packageId: string;
  packageTitle: string;
  totalCredits: number;
  remainingCredits: number;
  purchaseDate: string;
  expiryDate: string;
  status: "active" | "expired" | "fullyUsed" | "cancelled" | "pendingPayment";
}

export interface PackageUsage {
  id: string;
  userPackageId: string;
  bookingId: string;
  className: string;
  creditDeducted: number;
  deductedAt: string;
  reason: "attended" | "noShowPolicy";
}

export interface BalletApplication {
  id: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  childName: string;
  childBirthday: string;
  childAge: number;
  childGender: "male" | "female";
  previousExperience: boolean;
  experienceDetails?: string;
  medicalNotes?: string;
  preferredSlotId: string;
  preferredSlotLabel: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  notes?: string;
  status:
    | "submitted"
    | "pendingAssessment"
    | "accepted"
    | "rejected"
    | "needsFollowUp"
    | "assignedToLevel"
    | "activeBallet";
  assignedLevel?: string;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  type: "booking" | "class_reminder" | "package" | "ballet" | "offer" | "system";
  isRead: boolean;
  createdAt: string;
}

interface AppContextType {
  language: "en" | "ar";
  setLanguage: (lang: "en" | "ar") => void;
  isOnboarded: boolean;
  setIsOnboarded: (v: boolean) => void;
  user: User | null;
  setUser: (user: User | null) => void;
  children: ChildProfile[];
  addChild: (child: ChildProfile) => void;
  updateChild: (child: ChildProfile) => void;
  removeChild: (childId: string) => void;
  bookings: Booking[];
  addBooking: (booking: Booking) => void;
  userPackages: UserPackage[];
  packageUsageHistory: PackageUsage[];
  purchasePackage: (pkg: { id: number; name: string; sessions: number | null; validityMonths: number }) => Promise<void>;
  cancelPackage: (userPackageId: string) => Promise<void>;
  refreshUserPackages: () => Promise<void>;
  usePackageCredit: (userPackageId: string, bookingId: string, className: string) => boolean;
  baletApplications: BalletApplication[];
  submitBalletApplication: (app: Omit<BalletApplication, "id" | "createdAt" | "status">) => boolean;
  notifications: AppNotification[];
  markNotificationRead: (id: string) => void;
  unreadNotifications: number;
  isLoading: boolean;
  newStudentBannerDismissed: boolean;
  dismissNewStudentBanner: () => void;
  referralCode: string;
  referralCredits: number;
}

function generateCode(fullName: string): string {
  const letters = fullName.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 4).padEnd(4, "X");
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const suffix = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${letters}-${suffix}`;
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

const AppContext = createContext<AppContextType | null>(null);

export function AppContextProvider({ children: childrenNodes }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<"en" | "ar">("en");
  const [isOnboarded, setIsOnboardedState] = useState(false);
  const [user, setUserState] = useState<User | null>(null);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [userPackages, setUserPackages] = useState<UserPackage[]>([]);
  const [packageUsageHistory, setPackageUsageHistory] = useState<PackageUsage[]>([]);
  const [baletApplications, setBaletApplications] = useState<BalletApplication[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newStudentBannerDismissed, setNewStudentBannerDismissed] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  const [referralCredits, setReferralCredits] = useState(0);

  const isMountedRef = useRef(true);
  // Track user in a ref so callbacks can access it without re-creating
  const userRef = useRef<User | null>(null);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    loadPersistedState();
  }, []);

  async function loadPersistedState() {
    try {
      const [lang, onboarded, usr, bks, chldrn, usage, ballets, notifs, bannerDismissed, refCode, refCredits] =
        await Promise.all([
          AsyncStorage.getItem("language"),
          AsyncStorage.getItem("isOnboarded"),
          AsyncStorage.getItem("user"),
          AsyncStorage.getItem("bookings"),
          AsyncStorage.getItem("children"),
          AsyncStorage.getItem("packageUsageHistory"),
          AsyncStorage.getItem("baletApplications"),
          AsyncStorage.getItem("notifications"),
          AsyncStorage.getItem("newStudentBannerDismissed"),
          AsyncStorage.getItem("referralCode"),
          AsyncStorage.getItem("referralCredits"),
        ]);

      if (lang) setLanguageState(lang as "en" | "ar");
      if (onboarded === "true") setIsOnboardedState(true);
      const parsedUser = usr ? (JSON.parse(usr) as User) : null;

      if (parsedUser) {
        // Security check: if a user session is persisted but there is no
        // student JWT, the session pre-dates the JWT auth upgrade. Clear it
        // so the user is prompted to log in and receive a proper signed token.
        const studentToken = await AsyncStorage.getItem("studentToken");
        if (!studentToken) {
          await AsyncStorage.removeItem("user");
          // parsedUser is intentionally not set in state — session is invalidated.
        } else {
          setUserState(parsedUser);
          userRef.current = parsedUser;
        }
      }

      if (bks) setBookings(JSON.parse(bks));
      if (chldrn) setChildren(JSON.parse(chldrn));
      if (usage) setPackageUsageHistory(JSON.parse(usage));
      if (ballets) setBaletApplications(JSON.parse(ballets));
      if (notifs) setNotifications(JSON.parse(notifs));
      if (bannerDismissed === "true") setNewStudentBannerDismissed(true);
      if (refCredits) setReferralCredits(parseInt(refCredits, 10));

      // Reload the referral code for the now-confirmed user (may be null if invalidated)
      const confirmedUser = userRef.current;
      if (refCode) {
        setReferralCode(refCode);
      } else if (confirmedUser) {
        const generated = generateCode(confirmedUser.fullName);
        setReferralCode(generated);
        await AsyncStorage.setItem("referralCode", generated);
      }
      // Load packages from API for the confirmed user
      if (confirmedUser) {
        fetchAndSetPackages().catch(() => {});
      }
    } catch {}
    setIsLoading(false);
  }

  /**
   * Fetch this student's package orders from the secure /api/my/packages
   * endpoint (student JWT scoped) and update local state.
   *
   * Previously this called /api/package-orders (returns ALL students) and
   * filtered client-side — that was a privacy leak fixed in Phase B (B1).
   */
  async function fetchAndSetPackages() {
    try {
      const orders = await customFetch<Array<{
        id: number; packageId?: number | null; packageName: string;
        totalCredits: number; remainingCredits: number;
        status: string; activatedAt?: string | null;
        expiresAt?: string | null; createdAt: string;
        studentEmail: string;
      }>>(`/api/my/packages`);

      const mapped: UserPackage[] = orders.map((o) => ({
        id: String(o.id),
        packageId: String(o.packageId ?? 0),
        packageTitle: o.packageName,
        totalCredits: o.totalCredits,
        remainingCredits: o.remainingCredits,
        purchaseDate: o.createdAt.slice(0, 10),
        expiryDate: o.expiresAt?.slice(0, 10) ?? "",
        status: o.status as UserPackage["status"],
      }));

      if (isMountedRef.current) setUserPackages(mapped);
    } catch {
      // Network unavailable — keep whatever was in state
    }
  }

  const setLanguage = useCallback(async (lang: "en" | "ar") => {
    setLanguageState(lang);
    await AsyncStorage.setItem("language", lang);
  }, []);

  const setIsOnboarded = useCallback(async (v: boolean) => {
    setIsOnboardedState(v);
    await AsyncStorage.setItem("isOnboarded", String(v));
  }, []);

  const setUser = useCallback(async (usr: User | null) => {
    setUserState(usr);
    userRef.current = usr;
    if (usr) {
      await AsyncStorage.setItem("user", JSON.stringify(usr));
      const existing = await AsyncStorage.getItem("referralCode");
      if (!existing) {
        const generated = generateCode(usr.fullName);
        setReferralCode(generated);
        await AsyncStorage.setItem("referralCode", generated);
      }
      // Load this user's packages from the API
      fetchAndSetPackages().catch(() => {});
    } else {
      // Logout — clear both the user record and the student JWT.
      // After this, setAuthTokenGetter falls back to the shared API key
      // so guest browsing (classes, packages) still works.
      await AsyncStorage.removeItem("user");
      await AsyncStorage.removeItem("studentToken");
      setUserPackages([]);
    }
  }, []);

  const addChild = useCallback(async (child: ChildProfile) => {
    setChildren((prev) => {
      const updated = [...prev, child];
      AsyncStorage.setItem("children", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateChild = useCallback(async (child: ChildProfile) => {
    setChildren((prev) => {
      const updated = prev.map((c) => (c.id === child.id ? child : c));
      AsyncStorage.setItem("children", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeChild = useCallback(async (childId: string) => {
    setChildren((prev) => {
      const updated = prev.filter((c) => c.id !== childId);
      AsyncStorage.setItem("children", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const addBooking = useCallback(async (booking: Booking) => {
    setBookings((prev) => {
      const updated = [booking, ...prev];
      AsyncStorage.setItem("bookings", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const refreshUserPackages = useCallback(async () => {
    await fetchAndSetPackages();
  }, []);

  const purchasePackage = useCallback(
    async (pkg: { id: number; name: string; sessions: number | null; validityMonths: number }): Promise<void> => {
      const usr = userRef.current;
      if (!usr) return;
      await customFetch("/api/package-orders", {
        method: "POST",
        body: JSON.stringify({
          studentName: usr.fullName,
          studentEmail: usr.email,
          studentPhone: usr.phone ?? null,
          packageId: pkg.id,
          packageName: pkg.name,
          totalCredits: pkg.sessions ?? 1,
          remainingCredits: pkg.sessions ?? 1,
        }),
      });
      // Refresh the list so the new pending order shows up immediately
      await fetchAndSetPackages();
    },
    []
  );

  const usePackageCredit = useCallback(
    (userPackageId: string, bookingId: string, className: string): boolean => {
      let success = false;
      setUserPackages((prev) => {
        const idx = prev.findIndex((p) => p.id === userPackageId && p.remainingCredits > 0 && p.status === "active");
        if (idx === -1) return prev;
        const updated = prev.map((p, i) => {
          if (i !== idx) return p;
          const remaining = p.remainingCredits - 1;
          return {
            ...p,
            remainingCredits: remaining,
            status: remaining === 0 ? ("fullyUsed" as const) : ("active" as const),
          };
        });
        AsyncStorage.setItem("userPackages", JSON.stringify(updated));
        success = true;
        return updated;
      });
      if (success) {
        const usage: PackageUsage = {
          id: `usage-${Date.now()}`,
          userPackageId,
          bookingId,
          className,
          creditDeducted: 1,
          deductedAt: new Date().toISOString(),
          reason: "attended",
        };
        setPackageUsageHistory((prev) => {
          const updated = [usage, ...prev];
          AsyncStorage.setItem("packageUsageHistory", JSON.stringify(updated));
          return updated;
        });
      }
      return success;
    },
    []
  );

  const cancelPackage = useCallback(async (userPackageId: string): Promise<void> => {
    const usr = userRef.current;
    try {
      await customFetch(`/api/package-orders/${userPackageId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled" }),
      });
    } catch {
      // Best-effort — still refresh list even if the PATCH failed
    }
    await fetchAndSetPackages();
  }, []);

  const submitBalletApplication = useCallback(
    (app: Omit<BalletApplication, "id" | "createdAt" | "status">): boolean => {
      const newApp: BalletApplication = {
        ...app,
        id: `ballet-${Date.now()}`,
        status: "submitted",
        createdAt: new Date().toISOString(),
      };
      setBaletApplications((prev) => {
        const updated = [newApp, ...prev];
        AsyncStorage.setItem("baletApplications", JSON.stringify(updated));
        return updated;
      });
      const notif: AppNotification = {
        id: `notif-${Date.now()}`,
        title: "Ballet Application Submitted",
        body: `Your application for ${app.childName} has been received. We'll contact you to confirm your assessment appointment.`,
        type: "ballet",
        isRead: false,
        createdAt: new Date().toISOString(),
      };
      setNotifications((prev) => {
        const updated = [notif, ...prev];
        AsyncStorage.setItem("notifications", JSON.stringify(updated));
        return updated;
      });
      return true;
    },
    []
  );

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const updated = prev.map((n) => (n.id === id ? { ...n, isRead: true } : n));
      AsyncStorage.setItem("notifications", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const dismissNewStudentBanner = useCallback(async () => {
    setNewStudentBannerDismissed(true);
    await AsyncStorage.setItem("newStudentBannerDismissed", "true");
  }, []);

  const unreadNotifications = notifications.filter((n) => !n.isRead).length;

  return (
    <AppContext.Provider
      value={{
        language,
        setLanguage,
        isOnboarded,
        setIsOnboarded,
        user,
        setUser,
        children,
        addChild,
        updateChild,
        removeChild,
        bookings,
        addBooking,
        userPackages,
        packageUsageHistory,
        purchasePackage,
        cancelPackage,
        refreshUserPackages,
        usePackageCredit,
        baletApplications,
        submitBalletApplication,
        notifications,
        markNotificationRead,
        unreadNotifications,
        isLoading,
        newStudentBannerDismissed,
        dismissNewStudentBanner,
        referralCode,
        referralCredits,
      }}
    >
      {childrenNodes}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppContextProvider");
  return ctx;
}
