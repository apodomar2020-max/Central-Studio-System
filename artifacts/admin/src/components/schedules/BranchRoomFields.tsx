import {
  getListScheduleLocationRoomsQueryKey,
  useListScheduleLocationBranches,
  useListScheduleLocationRooms,
  type ScheduleBranch,
  type ScheduleRoom,
} from "@workspace/api-client-react";
import { FormItem, FormLabel, FormMessage } from "@/components/ui/form";
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
      <FormLabel>Branch *</FormLabel>
      <Select value={branchId ? String(branchId) : ""} onValueChange={(value) => onBranchChange(Number(value))} disabled={branchesQuery.isLoading || branchesQuery.isError}>
        <SelectTrigger data-testid="select-schedule-branch"><SelectValue placeholder={branchesQuery.isLoading ? "Loading Branches…" : branchesQuery.isError ? "Could not load Branches" : "Select Branch"} /></SelectTrigger>
        <SelectContent>{branches.map((branch) => <SelectItem key={branch.id} value={String(branch.id)}>{branch.name}{branch.isActive ? "" : " (Inactive)"}</SelectItem>)}</SelectContent>
      </Select>
      {branchError && <FormMessage>{branchError}</FormMessage>}
    </FormItem>
    <FormItem>
      <FormLabel>Room *</FormLabel>
      <Select value={roomId ? String(roomId) : ""} onValueChange={(value) => onRoomChange(Number(value))} disabled={!selectedBranchId || (!historicalInactiveBranch && (roomsQuery.isLoading || roomsQuery.isError))}>
        <SelectTrigger data-testid="select-schedule-room"><SelectValue placeholder={!selectedBranchId ? "Select a Branch first" : roomsQuery.isLoading ? "Loading Rooms…" : roomsQuery.isError ? "Could not load Rooms" : rooms.length === 0 ? "No active Rooms" : "Select Room"} /></SelectTrigger>
        <SelectContent>{rooms.map((room) => <SelectItem key={room.id} value={String(room.id)}>{room.name}{room.isActive ? "" : " (Inactive)"}</SelectItem>)}</SelectContent>
      </Select>
      {roomError && <FormMessage>{roomError}</FormMessage>}
    </FormItem>
  </div>;
}
