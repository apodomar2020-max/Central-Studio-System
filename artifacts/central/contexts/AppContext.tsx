import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { customFetch, normalizeMediaUrl } from "@workspace/api-client-react";
import { mapStudentToUser, type AuthStudent } from "@/services/authProfile";
import { mapApiStatusToLocal, mapApiPaymentStatusToLocal } from "@/utils/bookingStatus";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import {
  beginPushLogout,
  finishPushLogout,
  unregisterPushDeviceForLogout,
} from "@/services/pushNotifications";
import { createLogoutCoordinator } from "@/services/logoutCoordinator";

/** Mirrors the backend's Profile Completion Engine (lib/profileCompletion.ts). */
export type ProfileCompletionStep = "email" | "profile" | "children" | "medical" | "styles";
export interface ProfileCompletion {
  percent: number;
  isComplete: boolean;
  nextStep: ProfileCompletionStep | "done";
  missing: string[];
  completed: string[];
}

export interface User {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  emailVerified: boolean;
  birthday?: string;
  role: "student" | "parent" | "instructor";
  accountType?: "student" | "parent";
  authProvider?: string | null;
  providerDisplayName?: string | null;
  /** @deprecated Old 3-field (name/phone/accountType) definition. Use profileCompletion.isComplete instead. */
  profileCompleted?: boolean;
  /** @deprecated Old 3-field definition. Use profileCompletion.missing instead. */
  profileMissingFields?: string[];
  gender?: string | null;
  dateOfBirth?: string | null;
  city?: string | null;
  nationality?: string | null;
  howDidYouHearAboutUs?: string | null;
  policiesAcceptedAt?: string | null;
  /** Backend-driven Profile Completion Engine — the single source of truth
   *  for what's done, what's missing, and where to route next. */
  profileCompletion?: ProfileCompletion;
  /** Opaque UUID used to generate the secure QR code. Never logged or displayed as text. */
  qrToken?: string;
  /** Effective avatar image URL (Google-synced or manual upload); undefined → show initials. */
  avatarUrl?: string;
}

export interface ChildProfile {
  id: string;
  fullName: string;
  /** Canonical server DOB used by General Studio eligibility. */
  dateOfBirth?: string | null;
  /** Legacy/profile-form compatibility value; never an eligibility authority. */
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
  /** The specific class occurrence this booking is for (YYYY-MM-DD), from the
   *  backend. Used to scope the Cancel CTA to the current occurrence only. */
  occurrenceDate?: string;
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
  /**
   * Stable child identity for this booking (children.id), when the backend
   * row has one. Null/undefined only for legacy rows created before this
   * field was captured — duplicate-booking detection (booking/flow.tsx)
   * must key on this, never on participantName, since names are editable
   * and not unique across siblings.
   */
  participantChildId?: number | null;
  paymentMethod: "online" | "cash" | "packageCredit";
  paymentStatus: "not_required" | "pending_payment" | "paid" | "refunded" | "failed";
  // F-08: "unknown" is the safe fallback for any status the client does
  // not recognize (e.g. the backend's "attendance_reversed") — see
  // utils/bookingStatus.ts's mapApiStatusToLocal, the single place that
  // produces this value.
  bookingStatus: "pending" | "confirmed" | "rejected" | "cancelled" | "attended" | "completed" | "noShow" | "unknown";
  bookingType: "single" | "package" | "ballet";
  userPackageId?: string;
  bookingNumber: string;
  attendanceStatus: "booked" | "attended" | "noShow" | "cancelled";
  createdAt: string;
  sourceUnavailable?: boolean;
  sourceUnavailableReason?: "CLASS_OR_SCHEDULE_REMOVED" | null;
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
  participantType?: "self" | "child" | null;
  participantChildId?: number | null;
  participantName?: string | null;
  participantAgeAtPurchase?: number | null;
  ownershipState?: "assigned" | "legacy_unassigned";
}

export type PackageParticipantSelection =
  | { participantType: "self"; participantChildId?: never }
  | { participantType: "child"; participantChildId: number };

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
    | "pending"
    | "accepted"
    | "needsFollowUp"
    | "assignedToLevel"
    | "active"
    | "rejected"
    | "cancelled";
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
  setUser: (user: User | null) => Promise<void>;
  logout: () => Promise<void>;
  children: ChildProfile[];
  /** Returns the created profile (with its real backend id) on success, or
   *  null on failure — the caller can use the id immediately (e.g. to link
   *  a just-created child to something being submitted in the same flow)
   *  without waiting for a re-render. Shows its own error Alert on failure;
   *  callers don't need to show a duplicate one. */
  addChild: (child: ChildProfile) => Promise<ChildProfile | null>;
  updateChild: (child: ChildProfile) => void;
  removeChild: (childId: string) => void;
  refreshChildren: () => Promise<void>;
  bookings: Booking[];
  addBooking: (booking: Booking) => void;
  cancelBooking: (bookingId: string) => Promise<void>;
  /** Re-fetch bookings from the backend (source of truth) and reconcile with
   *  any local optimistic rows. Call on Schedule focus / pull-to-refresh. */
  refreshBookings: () => Promise<void>;
  userPackages: UserPackage[];
  packageUsageHistory: PackageUsage[];
  purchasePackage: (pkg: {
    id: number;
    name: string;
    sessions: number | null;
    validityMonths: number;
    promoCode?: string | null;
    participant: PackageParticipantSelection;
    paymentMode?: "pay_at_studio" | "online_payment";
  }) => Promise<void>;
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

/** Row shape returned by GET /api/my/bookings (enriched, display-ready). */
interface ApiMyBooking {
  id: number;
  classId: number | null;
  scheduleId: number | null;
  occurrenceDate: string | null;
  className: string;
  danceType: string;
  instructorName: string;
  instructorImage: string | null;
  date: string;
  time: string;
  scheduleLabel: string | null;
  duration: string;
  location: string;
  price: number;
  participantType: string;
  participantName: string;
  participantChildId?: number | null;
  paymentMethod: string;
  paymentStatus: string;
  bookingStatus: string;
  bookingType: string;
  bookingNumber: string;
  attendanceStatus: string;
  createdAt: string;
  sourceUnavailable?: boolean;
  sourceUnavailableReason?: "CLASS_OR_SCHEDULE_REMOVED" | null;
}

/** Map a server booking row onto the app's local Booking shape. The backend is
 *  authoritative for status; the mobile enums are coerced from the raw values. */
function mapMyBookingToLocal(r: ApiMyBooking): Booking {
  return {
    id: String(r.id),
    classId: r.classId != null ? String(r.classId) : "",
    scheduleId: r.scheduleId != null ? String(r.scheduleId) : undefined,
    occurrenceDate: r.occurrenceDate ?? undefined,
    className: r.sourceUnavailable ? "Class details unavailable" : (r.className || "Class"),
    danceType: r.danceType || "",
    instructorName: r.sourceUnavailable ? "" : (r.instructorName || "Instructor"),
    instructorImage: r.instructorImage ? normalizeMediaUrl(r.instructorImage, "image") : undefined,
    date: r.date || "",
    time: r.time || "",
    scheduleLabel: r.scheduleLabel ?? undefined,
    duration: r.duration || "",
    location: r.location || "Central Studio",
    price: r.price ?? 0,
    participantType: r.participantType === "child" ? "child" : "self",
    participantName: r.participantName || "",
    participantChildId: r.participantChildId ?? null,
    paymentMethod:
      r.paymentMethod === "packageCredit" ? "packageCredit" : r.paymentMethod === "online" ? "online" : "cash",
    paymentStatus: mapApiPaymentStatusToLocal(r.paymentStatus),
    bookingStatus: mapApiStatusToLocal(r.bookingStatus),
    bookingType: r.bookingType === "package" ? "package" : "single",
    bookingNumber: r.bookingNumber || "CS" + String(r.id).padStart(6, "0"),
    attendanceStatus:
      r.attendanceStatus === "attended"
        ? "attended"
        : r.attendanceStatus === "cancelled"
          ? "cancelled"
          : r.attendanceStatus === "noShow"
            ? "noShow"
            : "booked",
    createdAt: r.createdAt || new Date().toISOString(),
    sourceUnavailable: r.sourceUnavailable === true,
    sourceUnavailableReason: r.sourceUnavailableReason ?? null,
  };
}

const AppContext = createContext<AppContextType | null>(null);

const AUTH_SCOPED_STORAGE_KEYS = [
  "user",
  "studentToken",
  "bookings",
  "children",
  "packageUsageHistory",
  "baletApplications",
  "notifications",
  "referralCode",
  "referralCredits",
];

async function clearAuthScopedStorage() {
  await AsyncStorage.multiRemove(AUTH_SCOPED_STORAGE_KEYS);
}

export function AppContextProvider({ children: childrenNodes }: { children: React.ReactNode }) {
  const alert = useCentralAlert();
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
  const logoutRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    loadPersistedState();
  }, []);

  // Finance Batch 1 (Part B2): credit/package data is server-authoritative
  // but can go stale on-device — e.g. an admin activates a package or
  // deducts a credit at check-in while this app is backgrounded, and there
  // is no push-driven cache invalidation for it. Refetch packages/bookings
  // whenever the app returns to the foreground, one fetch per transition
  // (not polling), so a student never has to force-quit/reopen the app to
  // see an updated balance.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const cameToForeground = appStateRef.current.match(/inactive|background/) && nextState === "active";
      appStateRef.current = nextState;
      if (!cameToForeground || !userRef.current) return;
      fetchAndSetPackages().catch(() => {});
      fetchAndSetBookings().catch(() => {});
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          await clearAuthScopedStorage();
          // parsedUser is intentionally not set in state — session is invalidated.
        } else {
          let effectiveUser = parsedUser;
          try {
            const refreshed = await customFetch<{ student: AuthStudent }>("/api/auth/me");
            effectiveUser = mapStudentToUser(refreshed.student);
            await AsyncStorage.setItem("user", JSON.stringify(effectiveUser));
          } catch {
            // Offline or backend unavailable — keep the persisted user for now.
          }
          setUserState(effectiveUser);
          userRef.current = effectiveUser;
        }
      }

      const confirmedUser = userRef.current;
      if (confirmedUser) {
        if (bks) setBookings(JSON.parse(bks));
        if (chldrn) setChildren(JSON.parse(chldrn));
        if (usage) setPackageUsageHistory(JSON.parse(usage));
        if (ballets) setBaletApplications(JSON.parse(ballets));
        if (notifs) setNotifications(JSON.parse(notifs));
      }
      if (bannerDismissed === "true") setNewStudentBannerDismissed(true);
      if (confirmedUser && refCredits) setReferralCredits(parseInt(refCredits, 10));

      // Reload the referral code for the now-confirmed user (may be null if invalidated)
      if (refCode) {
        setReferralCode(refCode);
      } else if (confirmedUser) {
        const generated = generateCode(confirmedUser.fullName);
        setReferralCode(generated);
        await AsyncStorage.setItem("referralCode", generated);
      }
      // Load packages + bookings from API for the confirmed user
      if (confirmedUser) {
        fetchAndSetPackages().catch(() => {});
        fetchAndSetBookings().catch(() => {});
        if (confirmedUser.accountType === "parent") {
          fetchAndSetChildren().catch(() => {});
        } else {
          setChildren([]);
          AsyncStorage.removeItem("children").catch(() => {});
        }
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
        participantType?: "self" | "child" | null;
        participantChildId?: number | null;
        participantName?: string | null;
        participantAgeAtPurchase?: number | null;
        ownershipState?: "assigned" | "legacy_unassigned";
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
        participantType: o.participantType,
        participantChildId: o.participantChildId,
        participantName: o.participantName,
        participantAgeAtPurchase: o.participantAgeAtPurchase,
        ownershipState: o.ownershipState,
      }));

      if (isMountedRef.current) setUserPackages(mapped);
    } catch {
      // Network unavailable — keep whatever was in state
    }
  }

  /**
   * Phase C — fetch this student's bookings from the secure, JWT-scoped
   * /api/my/bookings endpoint (the single source of truth) and reconcile with
   * local state.
   *
   * Server rows ALWAYS win: admin status changes (pending → confirmed →
   * attended / rejected / cancelled) are reflected after the next fetch. Local
   * optimistic rows are only kept while the server hasn't returned them yet
   * (the brief window right after creating a booking, or while offline).
   */
  async function fetchAndSetBookings() {
    try {
      const res = await customFetch<{ data: ApiMyBooking[] }>(`/api/my/bookings`);
      const serverBookings: Booking[] = res.data.map(mapMyBookingToLocal);

      if (!isMountedRef.current) return;
      setBookings((prev) => {
        const serverIds = new Set(serverBookings.map((b) => b.id));
        // Keep only local optimistic rows the server doesn't know about yet.
        const localOnly = prev.filter((b) => !serverIds.has(b.id));
        const merged = [...serverBookings, ...localOnly];
        AsyncStorage.setItem("bookings", JSON.stringify(merged));
        return merged;
      });
    } catch {
      // Offline or backend unavailable — keep the cached local bookings.
    }
  }

  async function fetchAndSetChildren() {
    try {
      const data = await customFetch<{ children: any[] }>("/api/children");
      const mapped = data.children.map((c) => ({
        id: String(c.id),
        fullName: c.fullName,
        dateOfBirth: c.dateOfBirth ?? null,
        birthday: c.dateOfBirth || c.birthday || "",
        age: c.age || 0,
        gender: c.gender as "male" | "female",
        medicalNotes: c.medicalNotes || undefined,
        emergencyContactName: c.emergencyName || undefined,
        emergencyContactPhone: c.emergencyPhone || undefined,
      }));

      if (isMountedRef.current) {
        setChildren(mapped);
        await AsyncStorage.setItem("children", JSON.stringify(mapped));
      }
    } catch {
      // Best-effort cache restore if offline
      try {
        const cached = await AsyncStorage.getItem("children");
        if (cached && isMountedRef.current) {
          setChildren(JSON.parse(cached));
        }
      } catch {}
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
      // Strip qrToken before writing to AsyncStorage — it is a sensitive
      // check-in secret and AsyncStorage is unencrypted on-device storage.
      // The token stays in React state (userState) so my-qr.tsx still works
      // in-session; it just won't be exposed to any process that reads the
      // raw AsyncStorage file on a rooted/jailbroken device.
      const { qrToken: _qrToken, ...persistedUser } = usr;
      await AsyncStorage.setItem("user", JSON.stringify(persistedUser));
      const existing = await AsyncStorage.getItem("referralCode");
      if (!existing) {
        const generated = generateCode(usr.fullName);
        setReferralCode(generated);
        await AsyncStorage.setItem("referralCode", generated);
      }
      // Load this user's packages + bookings from the API
      fetchAndSetPackages().catch(() => {});
      fetchAndSetBookings().catch(() => {});
      if (usr.accountType === "parent") {
        fetchAndSetChildren().catch(() => {});
      } else {
        setChildren([]);
        await AsyncStorage.removeItem("children");
      }
    } else {
      // Logout — clear both the user record and the student JWT.
      // After this, setAuthTokenGetter falls back to the shared API key
      // so guest browsing (classes, packages) still works.
      await clearAuthScopedStorage();
      setBookings([]);
      setUserPackages([]);
      setChildren([]);
      setPackageUsageHistory([]);
      setBaletApplications([]);
      setNotifications([]);
      setReferralCode("");
      setReferralCredits(0);
    }
  }, []);

  if (!logoutRef.current) {
    logoutRef.current = createLogoutCoordinator({
      begin: () => { beginPushLogout(); },
      unregister: unregisterPushDeviceForLogout,
      // setUser(null) removes the student JWT, so this is deliberately second.
      clearSession: () => setUser(null),
      finish: finishPushLogout,
    });
  }
  const logout = logoutRef.current;

  const addChild = useCallback(async (child: ChildProfile) => {
    try {
      const payload = {
        fullName: child.fullName,
        dateOfBirth: child.birthday || null,
        birthday: child.birthday || null,
        age: child.age,
        gender: child.gender,
        // Profile Completion Engine (Phase 4): use ?? not || — the Medical
        // Information onboarding step needs to be able to explicitly submit
        // an empty string ("reviewed, nothing to report"), which the backend
        // distinguishes from null ("never asked"). Behavior for the existing
        // Profile-tab child form is unchanged (it only ever passes undefined
        // or a trimmed non-empty string, never "").
        medicalNotes: child.medicalNotes ?? null,
        emergencyName: child.emergencyContactName || null,
        emergencyPhone: child.emergencyContactPhone || null,
      };
      const response = await customFetch<{ child: any }>("/api/children", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const c = response.child;
      const mappedChild: ChildProfile = {
        id: String(c.id),
        fullName: c.fullName,
        dateOfBirth: c.dateOfBirth ?? null,
        birthday: c.dateOfBirth || c.birthday || "",
        age: c.age || 0,
        gender: c.gender as "male" | "female",
        medicalNotes: c.medicalNotes || undefined,
        emergencyContactName: c.emergencyName || undefined,
        emergencyContactPhone: c.emergencyPhone || undefined,
      };
      setChildren((prev) => {
        const next = [...prev, mappedChild];
        AsyncStorage.setItem("children", JSON.stringify(next));
        return next;
      });
      return mappedChild;
    } catch (err) {
      console.error("addChild error:", err);
      alert.show({
        tone: "error",
        title: "Error",
        message: err instanceof Error ? err.message : "Failed to add child profile. Please check your connection.",
        actions: [{ label: "OK", tone: "primary" }],
      });
      return null;
    }
  }, [alert]);

  const updateChild = useCallback(async (child: ChildProfile) => {
    try {
      const childId = parseInt(child.id, 10);
      if (isNaN(childId)) {
        throw new Error("Invalid child ID format");
      }
      const payload = {
        fullName: child.fullName,
        dateOfBirth: child.birthday || null,
        birthday: child.birthday || null,
        age: child.age,
        gender: child.gender,
        // Profile Completion Engine (Phase 4): use ?? not || — the Medical
        // Information onboarding step needs to be able to explicitly submit
        // an empty string ("reviewed, nothing to report"), which the backend
        // distinguishes from null ("never asked"). Behavior for the existing
        // Profile-tab child form is unchanged (it only ever passes undefined
        // or a trimmed non-empty string, never "").
        medicalNotes: child.medicalNotes ?? null,
        emergencyName: child.emergencyContactName || null,
        emergencyPhone: child.emergencyContactPhone || null,
      };
      const response = await customFetch<{ child: any }>(`/api/children/${childId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const c = response.child;
      const mappedChild: ChildProfile = {
        id: String(c.id),
        fullName: c.fullName,
        dateOfBirth: c.dateOfBirth ?? null,
        birthday: c.dateOfBirth || c.birthday || "",
        age: c.age || 0,
        gender: c.gender as "male" | "female",
        medicalNotes: c.medicalNotes || undefined,
        emergencyContactName: c.emergencyName || undefined,
        emergencyContactPhone: c.emergencyPhone || undefined,
      };
      setChildren((prev) => {
        const next = prev.map((item) => (item.id === mappedChild.id ? mappedChild : item));
        AsyncStorage.setItem("children", JSON.stringify(next));
        return next;
      });
    } catch (err) {
      console.error("updateChild error:", err);
      alert.show({
        tone: "error",
        title: "Error",
        message: err instanceof Error ? err.message : "Failed to update child profile. Please check your connection.",
        actions: [{ label: "OK", tone: "primary" }],
      });
    }
  }, [alert]);

  const removeChild = useCallback(async (childId: string) => {
    try {
      const numericId = parseInt(childId, 10);
      if (isNaN(numericId)) {
        throw new Error("Invalid child ID format");
      }
      await customFetch(`/api/children/${numericId}`, {
        method: "DELETE",
      });
      setChildren((prev) => {
        const next = prev.filter((c) => c.id !== childId);
        AsyncStorage.setItem("children", JSON.stringify(next));
        return next;
      });
    } catch (err) {
      console.error("removeChild error:", err);
      alert.show({
        tone: "error",
        title: "Error",
        message: err instanceof Error ? err.message : "Failed to delete child profile. Please check your connection.",
        actions: [{ label: "OK", tone: "primary" }],
      });
    }
  }, [alert]);

  const addBooking = useCallback(async (booking: Booking) => {
    setBookings((prev) => {
      const updated = [booking, ...prev];
      AsyncStorage.setItem("bookings", JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Cancel one of the user's own bookings. The backend flips bookingStatus to
  // 'cancelled' (keeps the record + releases the seat); we mirror that locally so
  // the CTA/progress update immediately. Throws on failure so callers can alert.
  const cancelBooking = useCallback(async (bookingId: string): Promise<void> => {
    await customFetch(`/api/bookings/${bookingId}/cancel`, { method: "PATCH" });
    setBookings((prev) => {
      const updated = prev.map((b) =>
        b.id === bookingId
          ? { ...b, bookingStatus: "cancelled" as const, attendanceStatus: "cancelled" as const }
          : b,
      );
      AsyncStorage.setItem("bookings", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const refreshUserPackages = useCallback(async () => {
    await fetchAndSetPackages();
  }, []);

  const refreshChildren = useCallback(async () => {
    await fetchAndSetChildren();
  }, []);

  const refreshBookings = useCallback(async () => {
    await fetchAndSetBookings();
  }, []);

  const purchasePackage = useCallback(
    async (pkg: {
      id: number;
      name: string;
      sessions: number | null;
      validityMonths: number;
      promoCode?: string | null;
      participant: PackageParticipantSelection;
      paymentMode?: "pay_at_studio" | "online_payment";
    }): Promise<void> => {
      const usr = userRef.current;
      if (!usr) return;
      await customFetch("/api/package-orders", {
        method: "POST",
        body: JSON.stringify({
          packageId: pkg.id,
          promoCode: pkg.promoCode ?? null,
          participantType: pkg.participant.participantType,
          ...(pkg.participant.participantType === "child"
            ? { participantChildId: pkg.participant.participantChildId }
            : {}),
          ...(pkg.paymentMode ? { paymentMode: pkg.paymentMode } : {}),
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
        status: "pending",
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
        logout,
        children,
        addChild,
        updateChild,
        removeChild,
        bookings,
        addBooking,
        cancelBooking,
        refreshBookings,
        userPackages,
        packageUsageHistory,
        purchasePackage,
        cancelPackage,
        refreshUserPackages,
        refreshChildren,
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
