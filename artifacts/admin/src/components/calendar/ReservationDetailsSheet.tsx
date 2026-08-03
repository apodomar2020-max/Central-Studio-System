import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  Building,
  Calendar,
  Clock,
  Edit2,
  FileText,
  MapPin,
  Tag,
  User,
  XCircle,
} from "lucide-react";
import {
  useGetRoomReservation,
  getGetRoomReservationQueryKey,
  useUpdateRoomReservation,
  getGetAdminCalendarResourceViewQueryKey,
  getListAdminCalendarQueryKey,
} from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { getCalendarCategoryTokens } from "./calendarTokens";

export interface ReservationDetailsSheetProps {
  reservationId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  private_training: "Private Training",
  room_rental: "Room Rental",
  rehearsal: "Rehearsal",
  workshop: "Workshop",
  maintenance_block: "Maintenance",
  other: "Other",
};

export function ReservationDetailsSheet({
  reservationId,
  open,
  onOpenChange,
  onUpdated,
}: ReservationDetailsSheetProps) {
  const { can } = useAdminAuth();
  const canEdit = can("room_reservations", "edit");
  const canCancel = can("room_reservations", "cancel");

  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  const reservationQuery = useGetRoomReservation(reservationId ?? 0, {
    query: {
      enabled: open && reservationId != null && reservationId > 0,
      queryKey: getGetRoomReservationQueryKey(reservationId ?? 0),
    },
  });

  const reservation = reservationQuery.data;

  // Edit form state
  const [editTitle, setEditTitle] = useState("");
  const [editType, setEditType] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const updateMutation = useUpdateRoomReservation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminCalendarQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminCalendarResourceViewQueryKey() });
        setIsEditing(false);
        setErrorMsg(null);
        if (onUpdated) onUpdated();
      },
      onError: (err: any) => {
        const resData = err?.response?.data;
        setErrorMsg(resData?.message || resData?.error || "Failed to update reservation.");
      },
    },
  });

  const startEdit = () => {
    if (!reservation) return;
    setEditTitle(reservation.title);
    setEditType(reservation.reservationType);
    setEditDescription(reservation.description ?? "");
    setErrorMsg(null);
    setIsEditing(true);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reservationId) return;
    if (!editTitle.trim()) {
      setErrorMsg("Title cannot be empty.");
      return;
    }
    updateMutation.mutate({
      id: reservationId,
      data: {
        title: editTitle.trim(),
        reservationType: editType,
        description: editDescription.trim() || undefined,
      },
    });
  };

  const handleConfirmCancelReservation = () => {
    if (!reservationId) return;
    setConfirmCancelOpen(false);
    updateMutation.mutate({
      id: reservationId,
      data: {
        status: "cancelled",
      },
    });
  };

  const resTokens = getCalendarCategoryTokens("reservation");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-[480px] overflow-y-auto" data-testid="sheet-reservation-details">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <SheetTitle className="text-xl font-bold">
              {reservation ? reservation.title : "Reservation Details"}
            </SheetTitle>
            {reservation && (
              <Badge
                variant={reservation.status === "active" ? "default" : "destructive"}
                className={reservation.status === "active" ? `${resTokens.badgeBg} ${resTokens.badgeText} ${resTokens.badgeBorder}` : ""}
                data-testid="badge-reservation-status"
              >
                {reservation.status.toUpperCase()}
              </Badge>
            )}
          </div>
          <SheetDescription>Studio Room Reservation</SheetDescription>
        </SheetHeader>

        {reservationQuery.isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading details...</div>
        ) : !reservation ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Reservation not found.</div>
        ) : isEditing ? (
          <form onSubmit={handleSaveEdit} className="space-y-4 py-4">
            {errorMsg && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="edit-res-title">Title *</Label>
              <Input
                id="edit-res-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                required
                data-testid="input-edit-reservation-title"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-res-type">Reservation Type *</Label>
              <Select value={editType} onValueChange={setEditType}>
                <SelectTrigger id="edit-res-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-res-desc">Description</Label>
              <Textarea
                id="edit-res-desc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
                data-testid="input-edit-reservation-description"
              />
            </div>

            <Alert className="bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle>Room & Time are Immutable</AlertTitle>
              <AlertDescription className="text-xs">
                Branch, room, date, and times cannot be changed directly. If you need a different room or time, please cancel this reservation and create a new one.
              </AlertDescription>
            </Alert>

            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={updateMutation.isPending} data-testid="button-save-edit-reservation">
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-6 py-4 text-sm">
            {errorMsg && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}

            {/* Type badge */}
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-amber-500" />
              <span className="font-medium text-muted-foreground">Type:</span>
              <Badge variant="outline" className={`${resTokens.badgeBg} ${resTokens.badgeBorder} ${resTokens.badgeText}`}>
                {TYPE_LABELS[reservation.reservationType] || reservation.reservationType}
              </Badge>
            </div>

            {/* Date & Time */}
            <div className="space-y-2 rounded-lg border bg-card p-3 shadow-sm">
              <div className="flex items-center gap-2 text-foreground">
                <Calendar className="h-4 w-4 text-primary" />
                <span className="font-semibold">{reservation.date}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4 text-primary" />
                <span>{reservation.startTime} – {reservation.endTime}</span>
              </div>
            </div>

            {/* Location */}
            <div className="space-y-2 rounded-lg border bg-card p-3 shadow-sm">
              <div className="flex items-center gap-2 text-foreground">
                <Building className="h-4 w-4 text-primary" />
                <span>{reservation.branchName ?? `Branch #${reservation.branchId}`}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4 text-primary" />
                <span>{reservation.roomName ?? `Room #${reservation.roomId}`}</span>
              </div>
            </div>

            {/* Description */}
            {reservation.description && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  Description
                </div>
                <div className="rounded-md border p-2.5 text-foreground bg-muted/30">
                  {reservation.description}
                </div>
              </div>
            )}

            {/* Organizer metadata */}
            {(reservation.organizerName || reservation.organizerContact) && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  <User className="h-4 w-4" />
                  Organizer Details
                </div>
                <div className="rounded-md border p-2.5 space-y-1 bg-muted/30">
                  {reservation.organizerName && (
                    <div><span className="font-medium">Name:</span> {reservation.organizerName}</div>
                  )}
                  {reservation.organizerContact && (
                    <div><span className="font-medium">Contact:</span> {reservation.organizerContact}</div>
                  )}
                </div>
              </div>
            )}

            {/* Action buttons */}
            {reservation.status === "active" && (canEdit || canCancel) && (
              <div className="flex flex-col gap-2 pt-4 border-t">
                {canEdit && (
                  <Button variant="outline" className="gap-2" onClick={startEdit} data-testid="button-edit-reservation">
                    <Edit2 className="h-4 w-4" />
                    Edit Details
                  </Button>
                )}
                {canCancel && (
                  <Button
                    variant="destructive"
                    className="gap-2"
                    onClick={() => setConfirmCancelOpen(true)}
                    disabled={updateMutation.isPending}
                    data-testid="button-cancel-reservation"
                  >
                    <XCircle className="h-4 w-4" />
                    Cancel Reservation
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        <AlertDialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
          <AlertDialogContent data-testid="dialog-cancel-reservation-confirm">
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel private event?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. The reservation will become unavailable for this room.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleConfirmCancelReservation}
                data-testid="button-confirm-cancel-reservation"
              >
                Confirm Cancellation
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
