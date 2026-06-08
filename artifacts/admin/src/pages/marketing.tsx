import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListCampaigns,
  useCreateCampaign,
  useUpdateCampaign,
  useDeleteCampaign,
  useSendCampaign,
  getListCampaignsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Edit, Send, MessageSquare, Mail, Users, Megaphone, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";

const CAMPAIGN_TYPES = ["email", "whatsapp"] as const;
const TARGET_AUDIENCES = ["students", "parents", "all"] as const;

const formSchema = z.object({
  title: z.string().min(1),
  type: z.enum(CAMPAIGN_TYPES).default("email"),
  subject: z.string().nullish(),
  message: z.string().min(1),
  targetAudience: z.enum(TARGET_AUDIENCES).default("students"),
});

type FormValues = z.input<typeof formSchema>;
type Campaign = {
  id: number; title: string; type: string; status: string; subject?: string | null;
  message: string; targetAudience: string; recipientCount: number; sentCount: number;
  scheduledAt?: string | null; sentAt?: string | null; createdAt: string;
};

const typeBadge = (type: string) =>
  type === "whatsapp" ? { icon: MessageSquare, color: "#25D366", label: "WhatsApp" } : { icon: Mail, color: "#00B6D7", label: "Email" };

const audienceLabel: Record<string, string> = {
  students: "Students",
  parents: "Parents",
  all: "Everyone",
};

const STUDIO_CYAN = "#00B6D7";

export default function Marketing() {
  const { data: campaigns, isLoading } = useListCampaigns();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();
  const sendCampaign = useSendCampaign();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewCampaign, setPreviewCampaign] = useState<Campaign | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "", type: "email", subject: "", message: "", targetAudience: "students" },
  });

  const watchType = form.watch("type");

  const openCreate = () => {
    setEditing(null);
    form.reset({ title: "", type: "email", subject: "", message: "", targetAudience: "students" });
    setOpen(true);
  };

  const openEdit = (c: Campaign) => {
    setEditing(c);
    form.reset({
      title: c.title,
      type: (c.type as "email" | "whatsapp") ?? "email",
      subject: c.subject ?? "",
      message: c.message,
      targetAudience: (c.targetAudience as typeof TARGET_AUDIENCES[number]) ?? "students",
    });
    setOpen(true);
  };

  const onSubmit = (values: FormValues) => {
    const parsed = formSchema.parse(values);
    if (editing) {
      updateCampaign.mutate({ id: editing.id, data: parsed }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() }); setOpen(false); },
      });
    } else {
      createCampaign.mutate({ data: parsed }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() }); setOpen(false); },
      });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this campaign?")) {
      deleteCampaign.mutate({ id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() }) });
    }
  };

  const handleSend = (campaign: Campaign) => {
    if (campaign.status === "sent") return;
    setPreviewCampaign(campaign);
    setPreviewOpen(true);
  };

  const confirmSend = () => {
    if (!previewCampaign) return;
    sendCampaign.mutate({ id: previewCampaign.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        setPreviewOpen(false);
        setPreviewCampaign(null);
      },
    });
  };

  const draftCampaigns = campaigns?.filter((c) => c.status === "draft") ?? [];
  const sentCampaigns = campaigns?.filter((c) => c.status === "sent") ?? [];
  const totalReach = sentCampaigns.reduce((acc, c) => acc + c.sentCount, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Marketing" description="WhatsApp & email campaigns for students" mode="general" addLabel="New Campaign" addTestId="button-new-campaign" onAdd={openCreate} />

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Drafts", value: draftCampaigns.length, color: "#F59E0B", icon: Edit },
          { label: "Sent", value: sentCampaigns.length, color: "#22C55E", icon: CheckCircle2 },
          { label: "Total Reach", value: totalReach.toLocaleString(), color: STUDIO_CYAN, icon: Users },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border p-4 flex items-center gap-3" style={{ background: "hsl(196 28% 8%)", borderColor: "hsl(203 30% 14%)" }}>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0" style={{ background: `${s.color}18` }}>
              <s.icon className="h-4 w-4" style={{ color: s.color }} />
            </div>
            <div>
              <p className="text-xl font-bold text-white">{s.value}</p>
              <p className="text-xs" style={{ color: "#8A9AB0" }}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Campaign list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-xl border p-4 h-20 animate-pulse" style={{ background: "hsl(196 28% 8%)", borderColor: "hsl(203 30% 14%)" }} />
          ))}
        </div>
      ) : campaigns?.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ background: "hsl(196 28% 8%)", borderColor: "hsl(203 30% 14%)" }}>
          <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-20" style={{ color: STUDIO_CYAN }} />
          <p className="text-sm font-medium text-white">No campaigns yet</p>
          <p className="text-xs mt-1" style={{ color: "#8A9AB0" }}>Create your first WhatsApp or email campaign</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns?.map((campaign) => {
            const tb = typeBadge(campaign.type);
            return (
              <div
                key={campaign.id}
                data-testid={`card-campaign-${campaign.id}`}
                className="rounded-xl border p-4 flex items-start gap-4 group transition-all"
                style={{ background: "hsl(196 28% 8%)", borderColor: "hsl(203 30% 14%)" }}
              >
                {/* Type icon */}
                <div className="flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0" style={{ background: `${tb.color}18` }}>
                  <tb.icon className="h-5 w-5" style={{ color: tb.color }} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">{campaign.title}</p>
                      {campaign.subject && <p className="text-xs mt-0.5 truncate" style={{ color: "#8A9AB0" }}>{campaign.subject}</p>}
                      <p className="text-xs mt-1 line-clamp-2" style={{ color: "#4E6070" }}>{campaign.message}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <Badge variant={campaign.status === "sent" ? "default" : "secondary"} className="text-[10px]">
                        {campaign.status}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex items-center gap-1 text-xs" style={{ color: "#8A9AB0" }}>
                      <Users className="h-3 w-3" />
                      <span>{audienceLabel[campaign.targetAudience] ?? campaign.targetAudience}</span>
                    </div>
                    {campaign.status === "sent" ? (
                      <span className="text-xs" style={{ color: "#22C55E" }}>✓ Sent to {campaign.sentCount} recipients</span>
                    ) : (
                      <span className="text-xs" style={{ color: "#8A9AB0" }}>{campaign.recipientCount} recipients</span>
                    )}
                    <span className="text-xs" style={{ color: "#344A5A" }}>{tb.label}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {campaign.status === "draft" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      style={{ color: "#22C55E" }}
                      onClick={() => handleSend(campaign)}
                    >
                      <Send className="h-3.5 w-3.5" />
                      Send
                    </Button>
                  )}
                  {campaign.status === "draft" && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(campaign)}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(campaign.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Campaign" : "New Campaign"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Campaign Title *</FormLabel>
                  <FormControl><Input data-testid="input-campaign-title" placeholder="Ramadan Special — Summer Classes" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Channel</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="email">📧 Email</SelectItem>
                        <SelectItem value="whatsapp">💬 WhatsApp</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="targetAudience" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Audience</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="students">Students</SelectItem>
                        <SelectItem value="parents">Parents</SelectItem>
                        <SelectItem value="all">Everyone</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {watchType === "email" && (
                <FormField control={form.control} name="subject" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Subject</FormLabel>
                    <FormControl><Input placeholder="Don't miss our summer classes!" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <FormField control={form.control} name="message" render={({ field }) => (
                <FormItem>
                  <FormLabel>Message *</FormLabel>
                  <FormControl>
                    <Textarea
                      data-testid="input-campaign-message"
                      placeholder={watchType === "whatsapp"
                        ? "Hello! Central Studio has exciting new classes this summer..."
                        : "Dear student,\n\nWe're thrilled to announce..."}
                      rows={5}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-campaign" disabled={createCampaign.isPending || updateCampaign.isPending}>
                  {editing ? "Save Changes" : "Create Campaign"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Preview & Send confirmation dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Preview & Send</DialogTitle>
          </DialogHeader>
          {previewCampaign && (
            <div className="space-y-4">
              <div className="rounded-lg border p-4 space-y-2" style={{ background: "hsl(196 28% 8%)", borderColor: "hsl(203 30% 14%)" }}>
                {previewCampaign.type === "email" ? (
                  <div className="flex items-center gap-2 mb-3">
                    <Mail className="h-4 w-4" style={{ color: STUDIO_CYAN }} />
                    <span className="text-sm font-medium text-white">Email Preview</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="h-4 w-4" style={{ color: "#25D366" }} />
                    <span className="text-sm font-medium text-white">WhatsApp Preview</span>
                  </div>
                )}
                {previewCampaign.subject && (
                  <p className="text-xs font-semibold" style={{ color: "#8A9AB0" }}>Subject: {previewCampaign.subject}</p>
                )}
                <p className="text-sm text-white whitespace-pre-wrap">{previewCampaign.message}</p>
              </div>

              <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "#22C55E18", border: "1px solid #22C55E30" }}>
                <Users className="h-4 w-4 flex-shrink-0" style={{ color: "#22C55E" }} />
                <p className="text-sm" style={{ color: "#22C55E" }}>
                  Will be sent to <strong>{previewCampaign.recipientCount}</strong> {audienceLabel[previewCampaign.targetAudience]?.toLowerCase() ?? previewCampaign.targetAudience}
                </p>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setPreviewOpen(false)}>Cancel</Button>
                <Button
                  onClick={confirmSend}
                  disabled={sendCampaign.isPending}
                  className="gap-2"
                  style={{ background: "#22C55E" }}
                >
                  <Send className="h-4 w-4" />
                  {sendCampaign.isPending ? "Sending..." : `Send to ${previewCampaign.recipientCount} recipients`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
