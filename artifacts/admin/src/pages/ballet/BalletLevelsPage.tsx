/**
 * Ballet → Levels
 *
 * Placeholder page — full implementation coming in the next sprint.
 * Admins will manage ballet level definitions and their sort order here.
 */

import { Trophy } from "lucide-react";

export default function BalletLevelsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Ballet Levels</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage ballet level definitions and progression order.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <div className="rounded-full bg-[#8A5CFF]/10 p-5">
          <Trophy className="h-10 w-10 text-[#8A5CFF]" />
        </div>
        <h2 className="text-lg font-semibold text-white">Coming Soon</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Ballet level management is under development. You&apos;ll be able to add, rename, reorder,
          and deactivate ballet levels from this page.
        </p>
      </div>
    </div>
  );
}
