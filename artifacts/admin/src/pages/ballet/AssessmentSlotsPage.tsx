/**
 * Ballet → Assessment Slots
 *
 * Placeholder page — full implementation coming in the next sprint.
 * Admins will be able to create, edit, and deactivate assessment time slots here.
 */

import { CalendarDays } from "lucide-react";

export default function AssessmentSlotsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Assessment Slots</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage available ballet assessment appointment slots.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <div className="rounded-full bg-[#8A5CFF]/10 p-5">
          <CalendarDays className="h-10 w-10 text-[#8A5CFF]" />
        </div>
        <h2 className="text-lg font-semibold text-white">Coming Soon</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Assessment slot management is under development. You&apos;ll be able to add, edit, and
          deactivate time slots directly from this page.
        </p>
      </div>
    </div>
  );
}
