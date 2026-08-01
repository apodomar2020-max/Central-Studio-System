import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAdminBranchesQueryKey,
  getListAdminBranchRoomsQueryKey,
  useCreateAdminBranch,
  useCreateAdminBranchRoom,
  useListAdminBranches,
  useListAdminBranchRooms,
  useUpdateAdminBranch,
  useUpdateAdminRoom,
  type Branch,
  type Room,
} from "@workspace/api-client-react";
import { Building2, Edit, DoorOpen } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";

const branchSchema = z.object({
  name: z.string().trim().min(1, "Branch name is required"),
  address: z.string().optional(),
  googleMapsLink: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  isActive: z.boolean(),
});
const roomSchema = z.object({ name: z.string().trim().min(1, "Room name is required"), isActive: z.boolean() });
type BranchForm = z.infer<typeof branchSchema>;
type RoomForm = z.infer<typeof roomSchema>;

const errorText = (error: unknown, fallback: string) => {
  const value = error as { data?: { error?: string }; message?: string };
  return value?.data?.error ?? value?.message ?? fallback;
};

export default function Branches() {
  const { can } = useAdminAuth();
  const canCreate = can("branches", "create");
  const canEdit = can("branches", "edit");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const branchesQuery = useListAdminBranches();
  const createBranch = useCreateAdminBranch();
  const updateBranch = useUpdateAdminBranch();
  const createRoom = useCreateAdminBranchRoom();
  const updateRoom = useUpdateAdminRoom();
  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [roomsBranch, setRoomsBranch] = useState<Branch | null>(null);
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const roomsBranchId = roomsBranch?.id ?? 0;
  const roomsQuery = useListAdminBranchRooms(roomsBranchId, {
    query: { enabled: roomsBranch != null, queryKey: getListAdminBranchRoomsQueryKey(roomsBranchId) },
  });

  const branchForm = useForm<BranchForm>({ resolver: zodResolver(branchSchema), defaultValues: { name: "", address: "", googleMapsLink: "", isActive: true } });
  const roomForm = useForm<RoomForm>({ resolver: zodResolver(roomSchema), defaultValues: { name: "", isActive: true } });

  const openCreateBranch = () => {
    setEditingBranch(null);
    branchForm.reset({ name: "", address: "", googleMapsLink: "", isActive: true });
    setBranchDialogOpen(true);
  };
  const openEditBranch = (branch: Branch) => {
    setEditingBranch(branch);
    branchForm.reset({ name: branch.name, address: branch.address ?? "", googleMapsLink: branch.googleMapsLink ?? "", isActive: branch.isActive });
    setBranchDialogOpen(true);
  };
  const openCreateRoom = () => {
    setEditingRoom(null);
    roomForm.reset({ name: "", isActive: true });
    setRoomDialogOpen(true);
  };
  const openEditRoom = (room: Room) => {
    setEditingRoom(room);
    roomForm.reset({ name: room.name, isActive: room.isActive });
    setRoomDialogOpen(true);
  };

  const submitBranch = (values: BranchForm) => {
    const data = { name: values.name.trim(), address: values.address?.trim() || null, googleMapsLink: values.googleMapsLink?.trim() || null, isActive: values.isActive };
    const success = async () => {
      await queryClient.invalidateQueries({ queryKey: getListAdminBranchesQueryKey() });
      setBranchDialogOpen(false);
      toast({ title: editingBranch ? "Branch updated" : "Branch created" });
    };
    const failure = (error: unknown) => toast({ title: "Could not save branch", description: errorText(error, "Please try again."), variant: "destructive" });
    if (editingBranch) updateBranch.mutate({ id: editingBranch.id, data }, { onSuccess: success, onError: failure });
    else createBranch.mutate({ data }, { onSuccess: success, onError: failure });
  };

  const submitRoom = (values: RoomForm) => {
    if (!roomsBranch) return;
    const data = { name: values.name.trim(), isActive: values.isActive };
    const success = async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAdminBranchRoomsQueryKey(roomsBranch.id) }),
        queryClient.invalidateQueries({ queryKey: getListAdminBranchesQueryKey() }),
      ]);
      setRoomDialogOpen(false);
      toast({ title: editingRoom ? "Room updated" : "Room created" });
    };
    const failure = (error: unknown) => toast({ title: "Could not save room", description: errorText(error, "Please try again."), variant: "destructive" });
    if (editingRoom) updateRoom.mutate({ id: editingRoom.id, data }, { onSuccess: success, onError: failure });
    else createRoom.mutate({ branchId: roomsBranch.id, data }, { onSuccess: success, onError: failure });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Branches" description="Manage studio locations and their rooms" mode="studio" addLabel="Add Branch" addTestId="button-add-branch" onAdd={canCreate ? openCreateBranch : undefined} />
      <div className="rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Branch Name</TableHead><TableHead>Branch Code</TableHead><TableHead>Address</TableHead><TableHead>Status</TableHead><TableHead>Room Count</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {branchesQuery.isLoading ? <TableRow><TableCell colSpan={6} className="py-10 text-center">Loading branches…</TableCell></TableRow>
              : branchesQuery.isError ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-destructive">{errorText(branchesQuery.error, "Could not load branches.")}</TableCell></TableRow>
              : branchesQuery.data?.length === 0 ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No branches yet. Add one to get started.</TableCell></TableRow>
              : branchesQuery.data?.map((branch) => <TableRow key={branch.id} data-testid={`row-branch-${branch.id}`}>
                <TableCell className="font-medium">{branch.name}</TableCell><TableCell className="font-mono">{branch.code}</TableCell><TableCell>{branch.address || "—"}</TableCell>
                <TableCell><Badge variant={branch.isActive ? "default" : "outline"}>{branch.isActive ? "Active" : "Inactive"}</Badge></TableCell><TableCell>{branch.roomCount}</TableCell>
                <TableCell className="text-right space-x-1">{canEdit && <Button variant="ghost" size="sm" onClick={() => openEditBranch(branch)}><Edit className="mr-2 h-4 w-4" />Edit</Button>}<Button variant="ghost" size="sm" onClick={() => setRoomsBranch(branch)}><DoorOpen className="mr-2 h-4 w-4" />Manage Rooms</Button></TableCell>
              </TableRow>)}
          </TableBody>
        </Table>
      </div>

      <Dialog open={branchDialogOpen} onOpenChange={setBranchDialogOpen}><DialogContent><DialogHeader><DialogTitle>{editingBranch ? "Edit Branch" : "Add Branch"}</DialogTitle></DialogHeader><Form {...branchForm}><form onSubmit={branchForm.handleSubmit(submitBranch)} className="space-y-4">
        {editingBranch && <FormItem><FormLabel>Branch Code</FormLabel><Input value={editingBranch.code} readOnly className="font-mono" /></FormItem>}
        <FormField control={branchForm.control} name="name" render={({ field }) => <FormItem><FormLabel>Branch Name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} />
        <FormField control={branchForm.control} name="address" render={({ field }) => <FormItem><FormLabel>Address</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} />
        <FormField control={branchForm.control} name="googleMapsLink" render={({ field }) => <FormItem><FormLabel>Google Maps Link</FormLabel><FormControl><Input placeholder="https://maps.google.com/…" {...field} /></FormControl><FormMessage /></FormItem>} />
        <FormField control={branchForm.control} name="isActive" render={({ field }) => <FormItem className="flex items-center gap-3"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="!mt-0">Active</FormLabel></FormItem>} />
        <DialogFooter><Button type="button" variant="outline" onClick={() => setBranchDialogOpen(false)}>Cancel</Button><Button type="submit" disabled={createBranch.isPending || updateBranch.isPending}>{editingBranch ? "Save Changes" : "Create Branch"}</Button></DialogFooter>
      </form></Form></DialogContent></Dialog>

      <Dialog open={roomsBranch != null} onOpenChange={(open) => !open && setRoomsBranch(null)}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" />Rooms at {roomsBranch?.name}</DialogTitle></DialogHeader>
        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm"><span>Branch: <strong>{roomsBranch?.name}</strong></span><span className="font-mono">{roomsBranch?.code}</span></div>
        {canCreate && <div className="flex justify-end"><Button onClick={openCreateRoom}>Add Room</Button></div>}
        <div className="rounded-md border"><Table><TableHeader><TableRow><TableHead>Room Name</TableHead><TableHead>Room Code</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
          {roomsQuery.isLoading ? <TableRow><TableCell colSpan={4} className="py-8 text-center">Loading rooms…</TableCell></TableRow>
            : roomsQuery.isError ? <TableRow><TableCell colSpan={4} className="py-8 text-center text-destructive">{errorText(roomsQuery.error, "Could not load rooms.")}</TableCell></TableRow>
            : roomsQuery.data?.length === 0 ? <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No rooms in this branch yet.</TableCell></TableRow>
            : roomsQuery.data?.map((room) => <TableRow key={room.id}><TableCell className="font-medium">{room.name}</TableCell><TableCell className="font-mono">{room.code}</TableCell><TableCell><Badge variant={room.isActive ? "default" : "outline"}>{room.isActive ? "Active" : "Inactive"}</Badge></TableCell><TableCell className="text-right">{canEdit && <Button variant="ghost" size="sm" onClick={() => openEditRoom(room)}><Edit className="mr-2 h-4 w-4" />Edit</Button>}</TableCell></TableRow>)}
        </TableBody></Table></div>
      </DialogContent></Dialog>

      <Dialog open={roomDialogOpen} onOpenChange={setRoomDialogOpen}><DialogContent><DialogHeader><DialogTitle>{editingRoom ? "Edit Room" : "Add Room"}</DialogTitle></DialogHeader><div className="rounded-md bg-muted px-3 py-2 text-sm">Branch: <strong>{roomsBranch?.name}</strong></div><Form {...roomForm}><form onSubmit={roomForm.handleSubmit(submitRoom)} className="space-y-4">
        {editingRoom && <FormItem><FormLabel>Room Code</FormLabel><Input value={editingRoom.code} readOnly className="font-mono" /></FormItem>}
        <FormField control={roomForm.control} name="name" render={({ field }) => <FormItem><FormLabel>Room Name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} />
        <FormField control={roomForm.control} name="isActive" render={({ field }) => <FormItem className="flex items-center gap-3"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="!mt-0">Active</FormLabel></FormItem>} />
        <DialogFooter><Button type="button" variant="outline" onClick={() => setRoomDialogOpen(false)}>Cancel</Button><Button type="submit" disabled={createRoom.isPending || updateRoom.isPending}>{editingRoom ? "Save Changes" : "Create Room"}</Button></DialogFooter>
      </form></Form></DialogContent></Dialog>
    </div>
  );
}
