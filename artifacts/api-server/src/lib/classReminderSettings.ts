import { eq } from "drizzle-orm";
import { classReminderSettingsTable, db } from "@workspace/db";

export type ClassReminderSettingsClient = {
  id: number;
  automaticRemindersEnabled: boolean;
  classReminder24hEnabled: boolean;
  classReminder1hEnabled: boolean;
  postClassRating3hEnabled: boolean;
  updatedAt: string;
};

export async function getOrCreateClassReminderSettings() {
  const [existing] = await db
    .select()
    .from(classReminderSettingsTable)
    .where(eq(classReminderSettingsTable.id, 1));

  if (existing) return existing;

  const [created] = await db
    .insert(classReminderSettingsTable)
    .values({ id: 1 })
    .onConflictDoNothing({ target: classReminderSettingsTable.id })
    .returning();

  if (created) return created;

  const [afterRace] = await db
    .select()
    .from(classReminderSettingsTable)
    .where(eq(classReminderSettingsTable.id, 1));

  if (!afterRace) throw new Error("Class reminder settings could not be initialized");
  return afterRace;
}

export function shapeClassReminderSettingsClient(
  settings: Awaited<ReturnType<typeof getOrCreateClassReminderSettings>>,
): ClassReminderSettingsClient {
  return {
    id: settings.id,
    automaticRemindersEnabled: settings.automaticRemindersEnabled,
    classReminder24hEnabled: settings.classReminder24hEnabled,
    classReminder1hEnabled: settings.classReminder1hEnabled,
    postClassRating3hEnabled: settings.postClassRating3hEnabled,
    updatedAt: settings.updatedAt,
  };
}

/** Is `categoryKey` allowed to run right now, honoring the global automation switch? */
export function isCategoryEnabled(
  settings: Awaited<ReturnType<typeof getOrCreateClassReminderSettings>>,
  categoryKey: "classReminder24hEnabled" | "classReminder1hEnabled" | "postClassRating3hEnabled",
): boolean {
  return settings.automaticRemindersEnabled && settings[categoryKey];
}
