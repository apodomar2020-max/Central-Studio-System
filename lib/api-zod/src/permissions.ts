export interface PermissionActionDefinition {
  key: string;
  label: string;
  description?: string;
}

export interface PermissionModuleDefinition {
  key: string;
  label: string;
  description: string;
  group: string;
  actions: readonly PermissionActionDefinition[];
  legacyAliases?: readonly string[];
  reserved?: boolean;
}

const actions = (...definitions: Array<[string, string]>): PermissionActionDefinition[] =>
  definitions.map(([key, label]) => ({ key, label }));

export const PERMISSION_GROUPS = [
  "Operations",
  "People",
  "Studio",
  "Packages & Credits",
  "Content & Engagement",
  "Ballet",
  "Finance",
  "Insights & System",
  "Future / Reserved",
] as const;

const permissionCatalog = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Operational dashboard, refresh, and appearance controls.",
    group: "Operations",
    actions: actions(["view", "View"], ["refresh", "Refresh"], ["themeToggle", "Theme Toggle"]),
  },
  {
    key: "bookings",
    label: "Bookings",
    description: "Booking lifecycle and administrative booking actions.",
    group: "Operations",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["cancel", "Cancel"], ["delete", "Delete"], ["export", "Export"]),
  },
  {
    key: "attendance",
    label: "Attendance",
    description: "Attendance records and manual attendance operations.",
    group: "Operations",
    actions: actions(["view", "View"], ["checkIn", "Check In"], ["edit", "Edit"], ["export", "Export"]),
  },
  {
    key: "feedback",
    label: "Feedback",
    description: "Internal post-class feedback and quality review.",
    group: "Operations",
    actions: actions(["view", "View"], ["viewComments", "View Comments"], ["review", "Review"]),
  },
  {
    key: "qr",
    label: "QR Check-In",
    description: "QR scanning, check-in confirmation, and package deduction.",
    group: "Operations",
    actions: actions(["scan", "Scan"], ["checkIn", "Check In"], ["packageDeduct", "Deduct Package"]),
  },
  {
    key: "users",
    label: "Users",
    description: "Combined user directory and user exports.",
    group: "People",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"], ["export", "Export"]),
  },
  {
    key: "students",
    label: "Students",
    description: "Student accounts and profiles.",
    group: "People",
    actions: actions(["view", "View"], ["edit", "Edit"], ["delete", "Delete"]),
  },
  {
    key: "parents",
    label: "Parents",
    description: "Parent accounts and parent details.",
    group: "People",
    actions: actions(["view", "View"], ["edit", "Edit"], ["delete", "Delete"]),
  },
  {
    key: "children",
    label: "Children",
    description: "Child profiles belonging to parent accounts.",
    group: "People",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"]),
  },
  {
    key: "branches",
    label: "Branches",
    description: "Studio branches and their rooms.",
    group: "Studio",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"]),
  },
  {
    key: "classes",
    label: "Classes",
    description: "Class setup, publishing, and class media.",
    group: "Studio",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"], ["mediaManage", "Manage Media"]),
  },
  {
    key: "schedules",
    label: "Schedules",
    description: "Weekly schedules and one-time workshops.",
    group: "Studio",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"]),
  },
  {
    key: "instructors",
    label: "Instructors",
    description: "Instructor profiles and instructor media.",
    group: "Studio",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"], ["mediaManage", "Manage Media"]),
  },
  {
    key: "packages",
    label: "Packages",
    description: "Package definitions and availability.",
    group: "Packages & Credits",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"]),
  },
  {
    key: "packageOrders",
    label: "Package Orders",
    description: "Package requests, activation, cancellation, and export.",
    group: "Packages & Credits",
    legacyAliases: ["package_orders"],
    actions: actions(["view", "View"], ["approve", "Approve"], ["cancel", "Cancel"], ["export", "Export"]),
  },
  {
    key: "credits",
    label: "Credits",
    description: "Credit balances, ledger history, and adjustments.",
    group: "Packages & Credits",
    actions: actions(["view", "View"], ["adjust", "Adjust"], ["history", "History"]),
  },
  {
    // Phase 6B: dedicated Promotions module. Promotions historically piggybacked
    // on the `offers` key, so `offers` is declared as a legacy alias — roles that
    // only hold stale offers.* grants (i.e. migration 0043 not yet applied) keep
    // Promotions access. The Offers feature and its catalog module were removed
    // in Phases 6C–6E-A; stale `offers` keys in role JSON are harmless and are
    // simply ignored by the catalog-driven role editor.
    key: "promotions",
    label: "Promotions",
    description: "Promotions, promo codes, campaign offers, and package purchase promotions.",
    group: "Content & Engagement",
    legacyAliases: ["offers"],
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"]),
  },
  {
    key: "heroSlides",
    label: "Hero Slides",
    description: "Mobile home hero slides.",
    group: "Content & Engagement",
    legacyAliases: ["hero_items"],
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"]),
  },
  {
    key: "notifications",
    label: "Notifications",
    description: "In-app notification content and delivery.",
    group: "Content & Engagement",
    actions: actions(["view", "View"], ["create", "Create"], ["send", "Send"], ["delete", "Delete"]),
  },
  {
    key: "marketing",
    label: "Marketing",
    description: "Existing marketing campaigns and sends.",
    group: "Content & Engagement",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["send", "Send"], ["delete", "Delete"]),
  },
  {
    key: "appContent",
    label: "App Content",
    description: "Help, policy, FAQ, and contact content.",
    group: "Content & Engagement",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"]),
  },
  {
    key: "ballet.applications",
    label: "Ballet Applications",
    description: "Application review, admission decisions, and cancellations.",
    group: "Ballet",
    actions: actions(["view", "View"], ["review", "Review"], ["approve", "Approve"], ["reject", "Reject"], ["cancel", "Cancel"]),
  },
  {
    key: "ballet.settings",
    label: "Ballet General Settings",
    description: "Ballet mobile presentation settings.",
    group: "Ballet",
    actions: actions(["view", "View"], ["edit", "Edit"]),
    legacyAliases: ["ballet.pricing"],
  },
  {
    key: "ballet.levels",
    label: "Ballet Levels",
    description: "Ballet level definitions and assignments.",
    group: "Ballet",
    actions: actions(["view", "View"], ["edit", "Edit"]),
  },
  {
    key: "ballet.payments",
    label: "Ballet Payments",
    description: "Ballet payment records, status changes, and refunds.",
    group: "Ballet",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"]),
  },
  {
    key: "ballet.instructors",
    label: "Ballet Instructors",
    description: "Ballet instructor profiles.",
    group: "Ballet",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"]),
  },
  {
    key: "ballet.classes",
    label: "Ballet Classes",
    description: "Ballet class setup and publishing.",
    group: "Ballet",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"]),
  },
  {
    key: "ballet.schedules",
    label: "Ballet Schedules",
    description: "Weekly ballet class schedules.",
    group: "Ballet",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"]),
  },
  {
    key: "ballet.groups",
    label: "Ballet Groups",
    description: "Ballet group cohorts tied to a level and schedule.",
    group: "Ballet",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"]),
  },
  {
    key: "ballet.packages",
    label: "Ballet Packages",
    description: "Ballet pricing packages.",
    group: "Ballet",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"]),
  },
  {
    key: "ballet.performances",
    label: "Ballet Performance Opportunities",
    description: "Recitals, galas, and competitions ballet students can perform at.",
    group: "Ballet",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"]),
  },
  {
    key: "reports",
    label: "Reports",
    description: "Analytics, report preview, and exports.",
    group: "Insights & System",
    actions: actions(["view", "View"], ["analytics", "Analytics"], ["exportExcel", "Export Excel"], ["exportPdf", "Export PDF"]),
  },
  {
    key: "settings",
    label: "Settings",
    description: "System-level studio configuration.",
    group: "Insights & System",
    actions: actions(["view", "View"], ["edit", "Edit"]),
  },
  {
    key: "adminUsers",
    label: "Admin Users",
    description: "Administrative accounts, status, and role assignment.",
    group: "Insights & System",
    legacyAliases: ["system_users"],
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["disable", "Disable"], ["delete", "Delete"], ["assignRole", "Assign Role"]),
  },
  {
    key: "roles",
    label: "Roles & Permissions",
    description: "Role definitions and permission assignment.",
    group: "Insights & System",
    legacyAliases: ["system_users"],
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"], ["assignPermissions", "Assign Permissions"]),
  },
  {
    // Activated (previously reserved) for the Finance Roles & Permissions
    // integration. No prior role has ever been granted any action under
    // this module (it was `reserved: true`), so activating it and defining
    // its real action set here is additive and requires no data migration.
    key: "finance",
    label: "Finance",
    description: "Finance Department access: viewing financial data, confirming payments, managing refunds, and exporting reports.",
    group: "Finance",
    actions: actions(
      ["view", "View Finance"],
      ["paymentsConfirm", "Confirm Payments"],
      ["refundsManage", "Manage Refunds"],
      ["exports", "Export Finance Data"],
    ),
  },
  {
    // Phase 7B: activated (previously reserved) — backs the System → Logs page.
    key: "auditLogs",
    label: "Audit Logs",
    description: "Admin activity history: who changed what, when, and from where.",
    group: "Insights & System",
    actions: actions(["view", "View"], ["export", "Export"]),
  },
] as const satisfies readonly PermissionModuleDefinition[];

export const PERMISSION_CATALOG: readonly PermissionModuleDefinition[] = permissionCatalog;
export type PermissionModuleKey = (typeof permissionCatalog)[number]["key"];
export type PermissionActionKey = (typeof permissionCatalog)[number]["actions"][number]["key"];
export type PermissionValues = Partial<Record<string, boolean>>;
export type PermissionMap = Partial<Record<string, PermissionValues>>;

export function normalizeRolePermissions(input: PermissionMap | null | undefined): PermissionMap {
  const normalized: PermissionMap = Object.fromEntries(
    Object.entries(input ?? {}).map(([module, values]) => [module, { ...(values ?? {}) }]),
  );

  for (const module of PERMISSION_CATALOG) {
    for (const action of module.actions) {
      if (normalized[module.key]?.[action.key] !== undefined) continue;
      const inherited = module.legacyAliases?.find(
        (alias) => normalized[alias]?.[action.key] !== undefined,
      );
      if (!inherited) continue;
      normalized[module.key] = {
        ...(normalized[module.key] ?? {}),
        [action.key]: normalized[inherited]?.[action.key] === true,
      };
    }
  }

  return normalized;
}

export function hasRolePermission(
  permissions: PermissionMap | null | undefined,
  moduleKey: string,
  actionKey: string,
): boolean {
  const canonicalValue = permissions?.[moduleKey]?.[actionKey];
  if (canonicalValue !== undefined) return canonicalValue === true;
  const module = PERMISSION_CATALOG.find((entry) => entry.key === moduleKey);
  return module?.legacyAliases?.some((alias) => permissions?.[alias]?.[actionKey] === true) ?? false;
}

export function countCatalogPermissions(permissions: PermissionMap | null | undefined): number {
  return PERMISSION_CATALOG.reduce(
    (total, module) => total + module.actions.filter(
      (action) => hasRolePermission(permissions, module.key, action.key),
    ).length,
    0,
  );
}
