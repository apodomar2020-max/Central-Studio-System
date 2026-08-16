/**
 * System → Logs — /logs.
 *
 * Two distinct, permission-gated workspaces under one nav destination, each
 * its own tab and its own table — never merged, because they are different
 * domains:
 *   - Admin Activity  (admin_activity_logs, Phase 7B)  — who changed what in
 *     Admin, when, and from where. Gated by auditLogs.view. Unchanged from
 *     before Wave 5 — see components/admin/admin-activity-logs-panel.tsx,
 *     an exact extraction of this page's original (pre-Wave-5) content.
 *   - Notification Delivery (notification_delivery_logs, Wave 5) —
 *     operational Push delivery outcomes for system/automation notifications
 *     (and, for completeness, clearly-labeled manual Admin campaign
 *     deliveries). Gated by auditLogs.view AND notifications.view — see
 *     components/admin/notification-delivery-logs-panel.tsx and
 *     routes/notificationDeliveryLogs.ts for the full design/RBAC reasoning.
 * Same internal-Tabs-under-one-nav-link pattern already established by
 * system-users.tsx (Users / Roles) — no new top-level System module, no new
 * route.
 */
import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { AdminActivityLogsPanel } from "@/components/admin/admin-activity-logs-panel";
import { NotificationDeliveryLogsPanel } from "@/components/admin/notification-delivery-logs-panel";

export default function LogsPage() {
  const { can } = useAdminAuth();
  const canViewAdminActivity = can("auditLogs", "view");
  // Both permissions required — see routes/notificationDeliveryLogs.ts's doc
  // comment for why notifications.view alone (a Marketing-only role's
  // permission) is not treated as sufficient on its own.
  const canViewNotificationDelivery = can("auditLogs", "view") && can("notifications", "view");
  const defaultTab = canViewAdminActivity ? "admin-activity" : "notification-delivery";

  return (
    <div className="admin2-final-page admin2-audit-ledger space-y-6">
      <PageHeader
        title="Logs"
        description="System audit trail and operational Push delivery visibility."
        mode="general"
      />

      {!canViewAdminActivity && !canViewNotificationDelivery ? (
        <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">
          You don't have permission to view any log workspace.
        </div>
      ) : (
        <Tabs defaultValue={defaultTab} className="mt-2">
          <TabsList className="mb-6">
            {canViewAdminActivity && <TabsTrigger value="admin-activity">Admin Activity</TabsTrigger>}
            {canViewNotificationDelivery && <TabsTrigger value="notification-delivery">Notification Delivery</TabsTrigger>}
          </TabsList>

          {canViewAdminActivity && (
            <TabsContent value="admin-activity">
              <AdminActivityLogsPanel />
            </TabsContent>
          )}

          {canViewNotificationDelivery && (
            <TabsContent value="notification-delivery">
              <NotificationDeliveryLogsPanel />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
import "./admin2-final.css";
