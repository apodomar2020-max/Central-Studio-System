import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CALENDAR_TOKENS } from "./calendarTokens";

export type CalendarViewMode = "week" | "day" | "resource";

export interface CalendarHeaderProps {
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  rangeLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  canCreateSchedule: boolean;
  canCreateReservation: boolean;
  onAddClassClick: () => void;
  onAddPrivateEventClick: () => void;
  branchId: number | null;
  onBranchChange: (branchId: number | null) => void;
  branches?: Array<{ id: number; name: string }>;
  roomId: number | null;
  onRoomChange: (roomId: number | null) => void;
  rooms?: Array<{ id: number; name: string }>;
}

export function CalendarHeader({
  viewMode,
  onViewModeChange,
  rangeLabel,
  onPrev,
  onNext,
  onToday,
  canCreateSchedule,
  canCreateReservation,
  onAddClassClick,
  onAddPrivateEventClick,
  branchId,
  onBranchChange,
  branches = [],
  roomId,
  onRoomChange,
  rooms = [],
}: CalendarHeaderProps) {
  return (
    <div className="admin2-calendar-command">
      <div className="admin2-calendar-commandbar flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* View Switcher Segmented Control */}
          <div className="inline-flex rounded-md border bg-muted/50 p-0.5 shadow-inner">
            <Button
              variant={viewMode === "week" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs"
              data-testid="button-calendar-view-week"
              onClick={() => onViewModeChange("week")}
            >
              Week
            </Button>
            <Button
              variant={viewMode === "day" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs"
              data-testid="button-calendar-view-day"
              onClick={() => onViewModeChange("day")}
            >
              Day
            </Button>
            <Button
              variant={viewMode === "resource" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs"
              data-testid="button-calendar-view-resource"
              onClick={() => onViewModeChange("resource")}
            >
              Resource
            </Button>
          </div>

          <div className="h-4 w-px bg-border mx-1" />

          {/* Date Navigation Controls */}
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Previous calendar period" title="Previous" data-testid="button-calendar-prev" onClick={onPrev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-9 text-xs font-medium" data-testid="button-calendar-today" onClick={onToday}>
              Today
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Next calendar period" title="Next" data-testid="button-calendar-next" onClick={onNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <span className="ml-2 text-sm font-semibold text-foreground tracking-tight">{rangeLabel}</span>

          {/* Add Dropdown */}
          {(canCreateSchedule || canCreateReservation) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="gap-1.5 ml-2 h-8" data-testid="button-calendar-add-dropdown">
                  <Plus className="h-4 w-4" />
                  Add
                  <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[180px]">
                {canCreateSchedule && (
                  <DropdownMenuItem
                    data-testid="dropdown-item-add-class"
                    onClick={onAddClassClick}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 text-emerald-500" />
                    Add Class
                  </DropdownMenuItem>
                )}
                {canCreateReservation && (
                  <DropdownMenuItem
                    data-testid="dropdown-item-add-private-event"
                    onClick={onAddPrivateEventClick}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 text-amber-500" />
                    Add Private Event
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Location Filters */}
        <div className="flex items-center gap-2">
          <Select
            value={branchId != null ? String(branchId) : "all"}
            onValueChange={(value) => onBranchChange(value === "all" ? null : Number(value))}
          >
            <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-calendar-branch">
              <SelectValue placeholder="All branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={String(branch.id)}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={roomId != null ? String(roomId) : "all"}
            onValueChange={(value) => onRoomChange(value === "all" ? null : Number(value))}
            disabled={branchId == null}
          >
            <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-calendar-room">
              <SelectValue placeholder="All rooms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rooms</SelectItem>
              {rooms.map((room) => (
                <SelectItem key={room.id} value={String(room.id)}>
                  {room.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Category Legend Bar */}
      <div className="admin2-calendar-legend flex items-center gap-4 text-xs text-muted-foreground px-1">
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${CALENDAR_TOKENS.class.dotColor}`} />
          Studio class
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${CALENDAR_TOKENS.ballet.dotColor}`} />
          Ballet
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${CALENDAR_TOKENS.reservation.dotColor}`} />
          Private event
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${CALENDAR_TOKENS.conflict.dotColor}`} />
          Conflict
        </span>
      </div>
    </div>
  );
}
