import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Calendar as CalendarIcon } from "lucide-react";
import {
  useListScheduleLocationBranches,
  useListScheduleLocationRooms,
  getListScheduleLocationRoomsQueryKey,
  useCreateRoomReservation,
  getGetAdminCalendarResourceViewQueryKey,
  getListAdminCalendarQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface CreateRoomReservationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultValues?: {
    branchId?: number | null;
    roomId?: number | null;
    date?: string | null;
    startTime?: string | null;
  };
  onSuccess?: () => void;
}

const RESERVATION_TYPES = [
  { value: "private_training", label: "Private Training" },
  { value: "room_rental", label: "Room Rental" },
  { value: "rehearsal", label: "Rehearsal" },
  { value: "workshop", label: "Workshop" },
  { value: "maintenance_block", label: "Maintenance Block" },
  { value: "other", label: "Other" },
];

export function CreateRoomReservationDialog({
  open,
  onOpenChange,
  defaultValues,
  onSuccess,
}: CreateRoomReservationDialogProps) {
  const queryClient = useQueryClient();
  const branchesQuery = useListScheduleLocationBranches();

  const [title, setTitle] = useState("");
  const [reservationType, setReservationType] = useState("private_training");
  const [branchId, setBranchId] = useState<number | null>(defaultValues?.branchId ?? null);
  const [roomId, setRoomId] = useState<number | null>(defaultValues?.roomId ?? null);
  const [date, setDate] = useState<string>(defaultValues?.date ?? new Date().toISOString().split("T")[0]);
  const [startTime, setStartTime] = useState<string>(defaultValues?.startTime ?? "14:00");
  const [endTime, setEndTime] = useState<string>("15:00");
  const [description, setDescription] = useState("");
  const [organizerName, setOrganizerName] = useState("");
  const [organizerContact, setOrganizerContact] = useState("");

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const roomsQuery = useListScheduleLocationRooms(branchId ?? 0, {
    query: {
      enabled: branchId != null,
      queryKey: getListScheduleLocationRoomsQueryKey(branchId ?? 0),
    },
  });

  useEffect(() => {
    if (open) {
      if (defaultValues?.branchId != null) setBranchId(defaultValues.branchId);
      if (defaultValues?.roomId != null) setRoomId(defaultValues.roomId);
      if (defaultValues?.date) setDate(defaultValues.date);
      if (defaultValues?.startTime) {
        setStartTime(defaultValues.startTime);
        const [h, m] = defaultValues.startTime.split(":").map(Number);
        const endH = (h + 1).toString().padStart(2, "0");
        setEndTime(`${endH}:${m.toString().padStart(2, "0")}`);
      }
      setErrorMsg(null);
    }
  }, [open, defaultValues]);

  // Set default branch if only 1 branch exists
  useEffect(() => {
    if (branchesQuery.data && branchesQuery.data.length > 0 && branchId == null) {
      setBranchId(branchesQuery.data[0].id);
    }
  }, [branchesQuery.data, branchId]);

  // Set default room if rooms loaded
  useEffect(() => {
    if (roomsQuery.data && roomsQuery.data.length > 0 && (roomId == null || !roomsQuery.data.some((r) => r.id === roomId))) {
      setRoomId(roomsQuery.data[0].id);
    }
  }, [roomsQuery.data, roomId]);

  const createMutation = useCreateRoomReservation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminCalendarQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminCalendarResourceViewQueryKey() });
        resetForm();
        onOpenChange(false);
        if (onSuccess) onSuccess();
      },
      onError: (err: any) => {
        const resData = err?.response?.data;
        if (err?.response?.status === 409 || resData?.error === "SCHEDULE_TIME_CONFLICT") {
          const conflict = resData?.conflict;
          const details = conflict
            ? `Conflicts with "${conflict.classTitle}" (${conflict.startTime}–${conflict.endTime}).`
            : "The selected room is already reserved or occupied during this time.";
          setErrorMsg(`Room Conflict: ${details}`);
        } else {
          setErrorMsg(resData?.message || resData?.error || "Failed to create room reservation.");
        }
      },
    },
  });

  const resetForm = () => {
    setTitle("");
    setReservationType("private_training");
    setDescription("");
    setOrganizerName("");
    setOrganizerContact("");
    setErrorMsg(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg("Please enter a title for the reservation.");
      return;
    }
    if (!branchId) {
      setErrorMsg("Please select a studio branch.");
      return;
    }
    if (!roomId) {
      setErrorMsg("Please select a room.");
      return;
    }
    if (!date) {
      setErrorMsg("Please select a date.");
      return;
    }

    setErrorMsg(null);
    createMutation.mutate({
      data: {
        title: title.trim(),
        reservationType,
        branchId,
        roomId,
        date,
        startTime,
        endTime,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(organizerName.trim() ? { organizerName: organizerName.trim() } : {}),
        ...(organizerContact.trim() ? { organizerContact: organizerContact.trim() } : {}),
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin2-studio-dialog sm:max-w-[540px]" data-testid="dialog-create-room-reservation">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <CalendarIcon className="h-5 w-5 text-amber-500" />
            Add Private Event / Room Reservation
          </DialogTitle>
          <DialogDescription>
            Reserve a studio room for private training, rentals, workshops, or maintenance blocks.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {errorMsg && (
            <Alert variant="destructive" data-testid="alert-create-reservation-error">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Cannot Reserve Room</AlertTitle>
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="res-title">Title *</Label>
            <Input
              id="res-title"
              placeholder="e.g., Private Rehearsal / Maintenance Block"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              data-testid="input-reservation-title"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="res-type">Reservation Type *</Label>
              <Select value={reservationType} onValueChange={setReservationType}>
                <SelectTrigger id="res-type" data-testid="select-reservation-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESERVATION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="res-date">Date *</Label>
              <Input
                id="res-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                data-testid="input-reservation-date"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="res-branch">Branch *</Label>
              <Select
                value={branchId != null ? String(branchId) : ""}
                onValueChange={(val) => {
                  setBranchId(Number(val));
                  setRoomId(null);
                }}
              >
                <SelectTrigger id="res-branch" data-testid="select-reservation-branch">
                  <SelectValue placeholder="Select Branch" />
                </SelectTrigger>
                <SelectContent>
                  {branchesQuery.data?.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="res-room">Room *</Label>
              <Select
                value={roomId != null ? String(roomId) : ""}
                onValueChange={(val) => setRoomId(Number(val))}
                disabled={!branchId}
              >
                <SelectTrigger id="res-room" data-testid="select-reservation-room">
                  <SelectValue placeholder="Select Room" />
                </SelectTrigger>
                <SelectContent>
                  {roomsQuery.data?.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="res-start-time">Start Time *</Label>
              <div className="relative">
                <Input
                  id="res-start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  data-testid="input-reservation-start-time"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="res-end-time">End Time *</Label>
              <div className="relative">
                <Input
                  id="res-end-time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  data-testid="input-reservation-end-time"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="res-description">Description (Optional)</Label>
            <Textarea
              id="res-description"
              placeholder="Notes or specifics for this reservation..."
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-reservation-description"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="res-organizer">Organizer Name (Optional)</Label>
              <Input
                id="res-organizer"
                placeholder="Name of instructor/renter"
                value={organizerName}
                onChange={(e) => setOrganizerName(e.target.value)}
                data-testid="input-reservation-organizer"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="res-contact">Organizer Contact (Optional)</Label>
              <Input
                id="res-contact"
                placeholder="Phone or email"
                value={organizerContact}
                onChange={(e) => setOrganizerContact(e.target.value)}
                data-testid="input-reservation-contact"
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              data-testid="button-submit-room-reservation"
            >
              {createMutation.isPending ? "Creating..." : "Save Reservation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
