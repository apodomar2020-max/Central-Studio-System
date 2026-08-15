import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListNotifications,
  useCreateNotification,
  useUpdateNotification,
  useDeleteNotification,
  getListNotificationsQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { Trash2, Edit } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { useAdminConfirm } from "@/components/admin/admin-confirm";
import { Badge } from "@/components/ui/badge";

const TARGETS = ["all", "studio", "stage"];

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  body: z.string().min(1, "Body is required"),
  target: z.string().default("all"),
  isDraft: z.boolean().default(true),
});

type FormValues = z.input<typeof formSchema>;
type Notification = {
  id: number;
  title: string;
  body: string;
  target: string;
  sentAt?: string | null;
  isDraft: boolean;
  createdAt: string;
  readCount?: number;
  pushStatus?: "in_app" | "sent" | "failed";
  pushSentCount?: number;
  pushFailedCount?: number;
};
type PushStatus = {
  enabled: boolean;
  provider: string;
  broadcastLimit: number;
  accessTokenConfigured: boolean;
};

export default function Notifications() {
  const confirmAction = useAdminConfirm();
  const { can } = useAdminAuth();
  const canCreate = can("notifications", "create");
  const canSend = can("notifications", "send");
  const canDelete = can("notifications", "delete");
  const { data: notifications, isLoading, isError } = useListNotifications();
  const { data: pushStatus } = useQuery({
    queryKey: ["notifications", "push-status"],
    queryFn: () => customFetch<PushStatus>("/api/notifications/push/status"),
  });
  const createNotification = useCreateNotification();
  const updateNotification = useUpdateNotification();
  const deleteNotification = useDeleteNotification();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Notification | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "", body: "", target: "all", isDraft: true },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ title: "", body: "", target: "all", isDraft: true });
    setOpen(true);
  };

  const openEdit = (n: Notification) => {
    setEditing(n);
    form.reset({ title: n.title, body: n.body, target: n.target, isDraft: n.isDraft });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const parsed = formSchema.parse(values);
    const payload = canSend ? parsed : { ...parsed, isDraft: true };
    const invalidate = () => { queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }); setOpen(false); };
    if (editing) {
      updateNotification.mutate({ id: editing.id, data: payload }, { onSuccess: invalidate });
    } else {
      createNotification.mutate({ data: payload }, { onSuccess: invalidate });
    }
  };

  const handleDelete = async (id: number) => {
    if (await confirmAction({ title: "Delete notification?", description: "The notification record will be removed. This action cannot be undone.", confirmLabel: "Delete notification" })) {
      deleteNotification.mutate({ id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }) });
    }
  };

  return (
    <div className="admin2-final-page admin2-marketing-registry space-y-6">
      <PageHeader title="Notifications" description="Broadcast messages to your community" mode="general" addLabel="Create Notification" addTestId="button-add-notification" onAdd={canCreate ? openCreate : undefined} />

      <div className="rounded-md border bg-card p-4 text-sm text-card-foreground">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={pushStatus?.enabled ? "default" : "secondary"}>
            Push {pushStatus?.enabled ? "Enabled" : "Disabled"}
          </Badge>
          <span className="text-muted-foreground">
            {/* Wave 1: NOTIFICATION_PUSH_BROADCAST_LIMIT now controls the device
                page/batch size sendBroadcastPushNotification pages through the
                full eligible audience with — it is no longer a total-recipient
                ceiling, so the label must not read as one. */}
            Provider: {pushStatus?.provider ?? "expo"} · Batch size: {pushStatus?.broadcastLimit ?? 25}
          </span>
          {!pushStatus?.enabled && (
            <span className="text-muted-foreground">In-app notifications continue normally.</span>
          )}
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reads</TableHead>
              <TableHead>Push</TableHead>
              <TableHead>Sent At</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-destructive">Notifications could not be loaded.</TableCell></TableRow>
            ) : notifications?.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No notifications yet.</TableCell></TableRow>
            ) : (
              (notifications as Notification[] | undefined)?.map((n) => (
                <TableRow key={n.id} data-testid={`row-notification-${n.id}`}>
                  <TableCell>
                    <div className="font-medium">{n.title}</div>
                    <div className="text-xs text-muted-foreground line-clamp-1">{n.body}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{n.target}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={n.isDraft ? "secondary" : "default"}>{n.isDraft ? "Draft" : "Sent"}</Badge>
                  </TableCell>
                  <TableCell>{n.readCount ?? 0}</TableCell>
                  <TableCell>
                    <Badge variant={n.pushStatus === "failed" ? "destructive" : "outline"}>
                      {n.pushStatus === "sent"
                        ? `Push sent${n.pushSentCount ? ` (${n.pushSentCount})` : ""}`
                        : n.pushStatus === "failed"
                          ? `Push failed${n.pushFailedCount ? ` (${n.pushFailedCount})` : ""}`
                          : "In-app"}
                    </Badge>
                  </TableCell>
                  <TableCell>{n.sentAt ? new Date(n.sentAt).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-right">
                    {canCreate && (n.isDraft || canSend) && (
                      <Button variant="ghost" size="icon" aria-label={`Edit notification ${n.title}`} data-testid={`button-edit-notification-${n.id}`} onClick={() => openEdit(n)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="ghost" size="icon" aria-label={`Delete notification ${n.title}`} data-testid={`button-delete-notification-${n.id}`} onClick={() => handleDelete(n.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={canCreate && open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Notification" : "Create Notification"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl><Input data-testid="input-notification-title" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="body" render={({ field }) => (
                <FormItem>
                  <FormLabel>Message</FormLabel>
                  <FormControl><Textarea data-testid="input-notification-body" rows={4} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="target" render={({ field }) => (
                <FormItem>
                  <FormLabel>Target Audience</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-notification-target"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {TARGETS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              {/* Publishing (un-drafting / sending) requires notifications.send */}
              {canSend && (
                <FormField control={form.control} name="isDraft" render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="!mt-0">Save as Draft</FormLabel>
                  </FormItem>
                )} />
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-notification" disabled={createNotification.isPending || updateNotification.isPending}>
                  {!canSend ? "Save Draft" : editing ? "Save Changes" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
import "./admin2-final.css";
