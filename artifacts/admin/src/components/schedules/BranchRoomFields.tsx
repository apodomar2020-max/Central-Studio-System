import {
  getListScheduleLocationRoomsQueryKey,
  useListScheduleLocationBranches,
  useListScheduleLocationRooms,
  type ScheduleBranch,
  type ScheduleRoom,
} from "@workspace/api-client-react";
import { FormItem } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function BranchRoomFields({
  branchId, roomId, currentBranch, currentRoom, onBranchChange, onRoomChange, branchError, roomError,
}: {
  branchId: number | null | undefined;
  roomId: number | null | undefined;
  currentBranch?: ScheduleBranch | null;
  currentRoom?: ScheduleRoom | null;
  onBranchChange: (id: number) => void;
  onRoomChange: (id: number) => void;
  branchError?: string;
  roomError?: string;
}) {
  const branchesQuery = useListScheduleLocationBranches();
  const selectedBranchId = branchId ?? 0;
  const historicalInactiveBranch = currentBranch?.id === selectedBranchId && !currentBranch.isActive;
  const roomsQuery = useListScheduleLocationRooms(selectedBranchId, {
    query: { enabled: selectedBranchId > 0 && !historicalInactiveBranch, queryKey: getListScheduleLocationRoomsQueryKey(selectedBranchId) },
  });
  const branches = [...(branchesQuery.data ?? [])];
  if (currentBranch && !branches.some((item) => item.id === currentBranch.id)) branches.push(currentBranch);
  const rooms = [...(roomsQuery.data ?? [])];
  if (currentRoom && currentRoom.branchId === selectedBranchId && !rooms.some((item) => item.id === currentRoom.id)) rooms.push(currentRoom);

  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <FormItem>
      <Label htmlFor="select-schedule-branch">Branch *</Label>
      <Select value={branchId ? String(branchId) : ""} onValueChange={(value) => onBranchChange(Number(value))} disabled={branchesQuery.isLoading || branchesQuery.isError}>
        <SelectTrigger id="select-schedule-branch" data-testid="select-schedule-branch" aria-invalid={Boolean(branchError)} aria-describedby={branchError ? "schedule-branch-error" : undefined}><SelectValue placeholder={branchesQuery.isLoading ? "Loading Branches…" : branchesQuery.isError ? "Could not load Branches" : "Select Branch"} /></SelectTrigger>
        <SelectContent>{branches.map((branch) => <SelectItem key={branch.id} value={String(branch.id)}>{branch.name}{branch.isActive ? "" : " (Inactive)"}</SelectItem>)}</SelectContent>
      </Select>
      {branchError && <p id="schedule-branch-error" role="alert" className="text-sm font-medium text-destructive">{branchError}</p>}
    </FormItem>
    <FormItem>
      <Label htmlFor="select-schedule-room">Room *</Label>
      <Select value={roomId ? String(roomId) : ""} onValueChange={(value) => onRoomChange(Number(value))} disabled={!selectedBranchId || (!historicalInactiveBranch && (roomsQuery.isLoading || roomsQuery.isError))}>
        <SelectTrigger id="select-schedule-room" data-testid="select-schedule-room" aria-invalid={Boolean(roomError)} aria-describedby={roomError ? "schedule-room-error" : undefined}><SelectValue placeholder={!selectedBranchId ? "Select a Branch first" : roomsQuery.isLoading ? "Loading Rooms…" : roomsQuery.isError ? "Could not load Rooms" : rooms.length === 0 ? "No active Rooms" : "Select Room"} /></SelectTrigger>
        <SelectContent>{rooms.map((room) => <SelectItem key={room.id} value={String(room.id)}>{room.name}{room.isActive ? "" : " (Inactive)"}</SelectItem>)}</SelectContent>
      </Select>
      {roomError && <p id="schedule-room-error" role="alert" className="text-sm font-medium text-destructive">{roomError}</p>}
    </FormItem>
  </div>;
}
