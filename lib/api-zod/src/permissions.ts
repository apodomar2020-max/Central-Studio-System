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
    key: "offers",
    label: "Offers",
    description: "Mobile offers and promotional content.",
    group: "Content & Engagement",
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
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"]),
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
    description: "Application review and admission decisions.",
    group: "Ballet",
    actions: actions(["view", "View"], ["review", "Review"], ["approve", "Approve"], ["reject", "Reject"]),
  },
  {
    key: "ballet.assessmentDates",
    label: "Ballet Assessment Dates",
    description: "Assessment date and capacity management.",
    group: "Ballet",
    actions: actions(["view", "View"], ["create", "Create"], ["edit", "Edit"], ["delete", "Delete"]),
  },
  {
    key: "ballet.pricing",
    label: "Ballet Pricing",
    description: "Ballet pricing and registration settings.",
    group: "Ballet",
    actions: actions(["view", "View"], ["edit", "Edit"]),
  },
  {
    key: "ballet.levels",
    label: "Ballet Levels",
    description: "Ballet level definitions and assignments.",
    group: "Ballet",
    actions: actions(["view", "View"], ["edit", "Edit"]),
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
    key: "finance",
    label: "Finance",
    description: "Reserved for the future Finance module.",
    group: "Future / Reserved",
    reserved: true,
    actions: actions(["view", "View"], ["revenueView", "Revenue"], ["cashFlowView", "Cash Flow"], ["branchRevenueView", "Branch Revenue"], ["instructorRevenueView", "Instructor Revenue"], ["refundsView", "Refunds"], ["exports", "Exports"]),
  },
  {
    key: "auditLogs",
    label: "Audit Logs",
    description: "Reserved for future audit history and export.",
    group: "Future / Reserved",
    reserved: true,
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
