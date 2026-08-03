import { useEffect, useState } from "react";
import { formatHourLabel, PX_PER_MIN } from "./CalendarOccurrenceCard";

export interface CalendarNowIndicatorProps {
  gridStartMin: number;
  gridEndMin: number;
}

export function CalendarNowIndicator({
  gridStartMin,
  gridEndMin,
}: CalendarNowIndicatorProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (currentMinutes < gridStartMin || currentMinutes > gridEndMin) {
    return null;
  }

  const top = (currentMinutes - gridStartMin) * PX_PER_MIN;

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
      style={{ top }}
      data-testid="calendar-now-indicator"
    >
      <div className="flex items-center -ml-2">
        <div className="h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-rose-500/30" />
        <span className="ml-1 rounded bg-rose-500 px-1 py-0.5 text-[9px] font-bold text-white shadow-sm">
          {formatHourLabel(currentMinutes)}
        </span>
      </div>
      <div className="h-[2px] flex-1 bg-rose-500/80 shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
    </div>
  );
}
