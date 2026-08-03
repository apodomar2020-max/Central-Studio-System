import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export interface SlotQuickActionContext {
  date: string;
  startTime: string;
  branchId?: number | null;
  roomId?: number | null;
}

export interface SlotQuickActionPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorPosition: { x: number; y: number } | null;
  slotContext: SlotQuickActionContext | null;
  canCreateSchedule: boolean;
  canCreateReservation: boolean;
  onAddClass: (context: SlotQuickActionContext) => void;
  onAddPrivateEvent: (context: SlotQuickActionContext) => void;
}

export function SlotQuickActionPopover({
  open,
  onOpenChange,
  anchorPosition,
  slotContext,
  canCreateSchedule,
  canCreateReservation,
  onAddClass,
  onAddPrivateEvent,
}: SlotQuickActionPopoverProps) {
  if (!slotContext || (!canCreateSchedule && !canCreateReservation)) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {anchorPosition && (
        <PopoverAnchor
          style={{
            position: "fixed",
            left: anchorPosition.x,
            top: anchorPosition.y,
            width: 1,
            height: 1,
            pointerEvents: "none",
          }}
        />
      )}
      <PopoverContent
        align="start"
        className="w-56 p-2 shadow-xl border-border/80"
        data-testid="popover-slot-quick-action"
      >
        <div className="mb-1.5 px-2 py-1 text-xs font-semibold text-muted-foreground border-b pb-1.5 flex items-center justify-between">
          <span>Create at {slotContext.startTime}</span>
          <span className="font-normal text-[11px] text-muted-foreground/80">{slotContext.date}</span>
        </div>
        <div className="space-y-1 pt-0.5">
          {canCreateSchedule && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs font-medium h-8 px-2 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300"
              data-testid="button-quick-action-add-class"
              onClick={() => {
                onOpenChange(false);
                onAddClass(slotContext);
              }}
            >
              <CalendarIcon className="mr-2 h-4 w-4 text-emerald-500" />
              Add Class
            </Button>
          )}
          {canCreateReservation && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs font-medium h-8 px-2 hover:bg-amber-500/10 hover:text-amber-700 dark:hover:text-amber-300"
              data-testid="button-quick-action-add-private-event"
              onClick={() => {
                onOpenChange(false);
                onAddPrivateEvent(slotContext);
              }}
            >
              <CalendarIcon className="mr-2 h-4 w-4 text-amber-500" />
              Add Private Event
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
