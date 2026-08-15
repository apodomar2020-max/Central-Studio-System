/**
 * Shared error type for the Manual Push Campaign domain (Wave 2+).
 *
 * Deliberately its own tiny file: both notificationCampaigns.ts (lifecycle/
 * send/recovery) and notificationCampaignAudience.ts (Wave 3's audience
 * resolver) throw it, and notificationCampaigns.ts calls INTO the audience
 * resolver — putting the class in either of those two files would create a
 * circular import between them.
 */
export class NotificationCampaignError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "NotificationCampaignError";
  }
}
