import { useEffect, useState } from "react";
import { format } from "date-fns";
import { BOARD_PX_PER_MIN } from "./scheduleBoardUtils";

export interface ScheduleBoardNowIndicatorProps {
  gridStartMin: number;
  gridEndMin: number;
}

/**
 * Current-time indicator for the Schedule Board's horizontal timeline —
 * Google Calendar style red indicator: vertical line at current time X position with red badge,
 * rendered only for the current day.
 *
 * Example: ──────── 🔴 6:35 PM
 */
export function ScheduleBoardNowIndicator({ gridStartMin, gridEndMin }: ScheduleBoardNowIndicatorProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (currentMinutes < gridStartMin || currentMinutes > gridEndMin) {
    return null;
  }

  const totalMin = gridEndMin - gridStartMin;
  const leftPercent = ((currentMinutes - gridStartMin) / totalMin) * 100;
  const timeFormatted = format(now, "h:mm a");

  return (
    <div
      className="absolute top-0 bottom-0 z-20 pointer-events-none flex flex-col items-center -translate-x-1/2"
      style={{ left: `${leftPercent}%` }}
      data-testid="schedule-board-now-indicator"
    >
      <div className="flex items-center gap-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
        <span>{timeFormatted}</span>
      </div>
      <div className="w-[2px] flex-1 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
    </div>
  );
}

