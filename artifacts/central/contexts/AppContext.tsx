import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export interface User {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  emailVerified: boolean;
  birthday?: string;
  role: "student" | "parent" | "instructor";
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
  className: string;
  danceType: string;
  instructorName: string;
  date: string;
  time: string;
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
  purchasePackage: (pkg: Package) => UserPackage;
  cancelPackage: (userPackageId: string) => void;
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

  useEffect(() => {
    loadPersistedState();
  }, []);

  async function loadPersistedState() {
    try {
      const [lang, onboarded, usr, bks, chldrn, pkgs, usage, ballets, notifs, bannerDismissed, refCode, refCredits] =
        await Promise.all([
          AsyncStorage.getItem("language"),
          AsyncStorage.getItem("isOnboarded"),
          AsyncStorage.getItem("user"),
          AsyncStorage.getItem("bookings"),
          AsyncStorage.getItem("children"),
          AsyncStorage.getItem("userPackages"),
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
      if (parsedUser) setUserState(parsedUser);
      if (bks) setBookings(JSON.parse(bks));
      if (chldrn) setChildren(JSON.parse(chldrn));
      if (pkgs) setUserPackages(JSON.parse(pkgs));
      if (usage) setPackageUsageHistory(JSON.parse(usage));
      if (ballets) setBaletApplications(JSON.parse(ballets));
      if (notifs) setNotifications(JSON.parse(notifs));
      if (bannerDismissed === "true") setNewStudentBannerDismissed(true);
      if (refCredits) setReferralCredits(parseInt(refCredits, 10));
      if (refCode) {
        setReferralCode(refCode);
      } else if (parsedUser) {
        const generated = generateCode(parsedUser.fullName);
        setReferralCode(generated);
        await AsyncStorage.setItem("referralCode", generated);
      }
    } catch {}
    setIsLoading(false);
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
    if (usr) {
      await AsyncStorage.setItem("user", JSON.stringify(usr));
      const existing = await AsyncStorage.getItem("referralCode");
      if (!existing) {
        const generated = generateCode(usr.fullName);
        setReferralCode(generated);
        await AsyncStorage.setItem("referralCode", generated);
      }
    } else {
      await AsyncStorage.removeItem("user");
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

  const purchasePackage = useCallback(
    (pkg: Package): UserPackage => {
      const today = new Date().toISOString().slice(0, 10);
      const expiry = addMonths(today, pkg.validityMonths);
      const userPkg: UserPackage = {
        id: `upkg-${Date.now()}`,
        packageId: pkg.id,
        packageTitle: pkg.title,
        totalCredits: pkg.numberOfCredits,
        remainingCredits: pkg.numberOfCredits,
        purchaseDate: today,
        expiryDate: expiry,
        status: "pendingPayment",
      };
      setUserPackages((prev) => {
        const updated = [userPkg, ...prev];
        AsyncStorage.setItem("userPackages", JSON.stringify(updated));
        return updated;
      });
      const notif: AppNotification = {
        id: `notif-${Date.now()}`,
        title: "Package Request Submitted",
        body: `Your ${pkg.title} request is pending payment confirmation. We'll activate it shortly.`,
        type: "package",
        isRead: false,
        createdAt: new Date().toISOString(),
      };
      setNotifications((prev) => {
        const updated = [notif, ...prev];
        AsyncStorage.setItem("notifications", JSON.stringify(updated));
        return updated;
      });
      return userPkg;
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

  const cancelPackage = useCallback((userPackageId: string) => {
    setUserPackages((prev) => {
      const pkg = prev.find((p) => p.id === userPackageId);
      if (!pkg || pkg.status !== "pendingPayment") return prev;
      const updated = prev.filter((p) => p.id !== userPackageId);
      AsyncStorage.setItem("userPackages", JSON.stringify(updated));
      return updated;
    });
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
