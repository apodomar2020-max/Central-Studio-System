/**
 * Ballet → Pricing & Settings
 *
 * Placeholder page — full implementation coming in the next sprint.
 * Admins will manage ballet pricing, session hours, and assessment instructions here.
 */

import { Settings2 } from "lucide-react";

export default function BalletSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Ballet Pricing &amp; Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure pricing, session hours, and assessment instructions.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <div className="rounded-full bg-[#8A5CFF]/10 p-5">
          <Settings2 className="h-10 w-10 text-[#8A5CFF]" />
        </div>
        <h2 className="text-lg font-semibold text-white">Coming Soon</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Ballet settings management is under development. You&apos;ll be able to update pricing,
          monthly hours, acceptance message templates, and assessment instructions here.
        </p>
      </div>
    </div>
  );
}
