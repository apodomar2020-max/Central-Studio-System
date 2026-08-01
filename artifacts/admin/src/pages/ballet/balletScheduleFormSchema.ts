import { z } from "zod";

export const BALLET_SCHEDULE_FORM_STATUSES = ["active", "deactivated", "cancelled"] as const;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const timeField = (requiredMessage: string) => z.string().trim().min(1, requiredMessage).regex(TIME_PATTERN, requiredMessage);

export const balletScheduleFormSchema = z.object({
  classId: z.number({ required_error: "Class is required" }).int().positive("Class is required"),
  branchId: z.number().int().positive().nullable().optional(),
  roomId: z.number().int().positive().nullable().optional(),
  dayOfWeek: z.number({ required_error: "Day of week is required" }).int().min(0).max(6),
  startTime: timeField("Start time is required"),
  endTime: timeField("End time is required"),
  status: z.enum(BALLET_SCHEDULE_FORM_STATUSES).default("active"),
}).superRefine((values, context) => {
  if (TIME_PATTERN.test(values.startTime) && TIME_PATTERN.test(values.endTime) && values.endTime <= values.startTime) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endTime"],
      message: "End time must be later than start time.",
    });
  }
});

export type BalletScheduleFormValues = z.input<typeof balletScheduleFormSchema>;
