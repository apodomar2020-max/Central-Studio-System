import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Edit,
  Link as LinkIcon,
  Loader2,
  Megaphone,
  MessageSquare,
  PlugZap,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

type MarketingTemplate = {
  id: number;
  name: string;
  category: string;
  language: string;
  body: string;
  status: string;
  variables?: string[] | null;
  metaTemplateId?: string | null;
  headerType?: string | null;
  headerText?: string | null;
  footer?: string | null;
  buttons?: any[] | null;
  rejectedReason?: string | null;
  lastSyncedAt?: string | null;
  archivedAt?: string | null;
  rawMetaPayload?: any;
  source?: "meta_cache" | "legacy_local";
  createdAt: string;
};

type Campaign = {
  id: number;
  title: string;
  type: string;
  status: string;
  templateId?: number | null;
  subject?: string | null;
  message: string;
  targetAudience: string;
  audienceType?: AudienceType;
  audienceConfig?: AudienceConfig | null;
  recipientCount: number;
  sentCount: number;
  failedCount?: number;
  preparedCount?: number;
  preparedAt?: string | null;
  sentAt?: string | null;
  createdAt: string;
};

type AudienceType =
  | "all"
  | "students"
  | "parents"
  | "class"
  | "schedule"
  | "bookingStatus"
  | "activePackage"
  | "packageExpiringSoon"
  | "manual";

type AudienceConfig = {
  classId?: number;
  scheduleId?: number;
  occurrenceDate?: string;
  bookingStatus?: string;
  days?: number;
  studentIds?: number[];
};

type RecipientPreview = {
  audienceType: AudienceType;
  audienceConfig?: AudienceConfig | null;
  totalCandidates: number;
  eligibleCount: number;
  excluded: {
    missingPhone: number;
    invalidPhone: number;
    optedOut: number;
    duplicate: number;
  };
  sample: Array<{
    studentId: number;
    name: string;
    email: string;
    phone: string;
    normalizedPhone: string;
    accountType?: string | null;
    audienceReason: string;
  }>;
};

type SearchStudent = {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  accountType?: string | null;
};

type ClassRow = { id: number; title: string };
type ScheduleRow = { id: number; classId: number; dayOfWeek?: number | null; date?: string | null; startTime: string; endTime: string };
type ClassGroup = {
  id: number;
  classId: number;
  scheduleId?: number | null;
  title?: string | null;
  groupUrl: string;
  isActive: boolean;
  classTitle?: string | null;
  scheduleDate?: string | null;
  scheduleDayOfWeek?: number | null;
  scheduleStartTime?: string | null;
};

type WhatsAppStatus = {
  enabled: boolean;
  configured: boolean;
  graphApiVersion: string;
  phoneNumberIdMasked: string | null;
  businessAccountIdMasked: string | null;
  testRecipientRestricted: boolean;
};

type WhatsAppTestResult = {
  success: boolean;
  provider?: string;
  providerMessageId?: string | null;
  messageId?: string | null;
  rawStatus?: string | null;
  error?: string;
};

type TemplateForm = {
  name: string;
  category: "utility" | "marketing";
  language: string;
  body: string;
  headerText: string;
  footerText: string;
};

const STUDIO_CYAN = "#00B6D7";
const WHATSAPP_GREEN = "#25D366";
const audienceOptions: Array<{ value: AudienceType; label: string; hint: string }> = [
  { value: "all", label: "All users", hint: "Every account with a valid WhatsApp number" },
  { value: "students", label: "Students only", hint: "Student accounts only" },
  { value: "parents", label: "Parents only", hint: "Parent accounts only" },
  { value: "class", label: "Class audience", hint: "Users who booked a selected class" },
  { value: "schedule", label: "Schedule occurrence", hint: "Users booked on a selected schedule/date" },
  { value: "bookingStatus", label: "Booking status", hint: "Users with selected booking status" },
  { value: "activePackage", label: "Active package", hint: "Users with valid remaining credits" },
  { value: "packageExpiringSoon", label: "Package expiring soon", hint: "Active packages expiring in the selected window" },
  { value: "manual", label: "Manual selection", hint: "Search and choose specific users" },
];

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const emptyTemplateForm: TemplateForm = {
  name: "",
  category: "marketing",
  language: "en_US",
  body: "",
  headerText: "",
  footerText: "",
};

const emptyCampaignForm = {
  title: "",
  templateId: "",
  audienceType: "students" as AudienceType,
  classId: "",
  scheduleId: "",
  occurrenceDate: "",
  bookingStatus: "confirmed",
  days: "14",
  manualStudentIds: [] as number[],
  message: "",
};

const emptyGroupForm = {
  classId: "",
  scheduleId: "",
  title: "",
  groupUrl: "",
  isActive: true,
};

const emptyWhatsAppTestForm = {
  to: "",
  templateName: "hello_world",
  languageCode: "en_US",
  parameters: "",
};

function scheduleLabel(schedule: ScheduleRow | ClassGroup): string {
  if ("groupUrl" in schedule) {
    const day = typeof schedule.scheduleDayOfWeek === "number" ? dayNames[schedule.scheduleDayOfWeek] : schedule.scheduleDate;
    return [day, schedule.scheduleStartTime].filter(Boolean).join(" • ") || "Class group";
  }
  const day = typeof schedule.dayOfWeek === "number" ? dayNames[schedule.dayOfWeek] : schedule.date;
  return `${day ?? "Schedule"} • ${schedule.startTime}`;
}

function createAudienceConfig(form: typeof emptyCampaignForm): AudienceConfig {
  const config: AudienceConfig = {};
  if (form.classId) config.classId = Number(form.classId);
  if (form.scheduleId) config.scheduleId = Number(form.scheduleId);
  if (form.occurrenceDate) config.occurrenceDate = form.occurrenceDate;
  if (form.bookingStatus) config.bookingStatus = form.bookingStatus;
  if (form.days) config.days = Number(form.days);
  if (form.manualStudentIds.length > 0) config.studentIds = form.manualStudentIds;
  return config;
}

function templateVariables(body: string): string[] {
  return [...new Set(Array.from(body.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)).map((match) => match[1]))];
}

function parseTemplateParameters(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getStatusBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "approved") {
    return <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium">Approved</Badge>;
  }
  if (s === "pending") {
    return <Badge className="bg-amber-500 hover:bg-amber-600 text-white font-medium">Pending Review</Badge>;
  }
  if (s === "rejected") {
    return <Badge className="bg-destructive hover:bg-destructive text-white font-medium">Rejected</Badge>;
  }
  if (s === "paused") {
    return <Badge className="bg-orange-400 hover:bg-orange-500 text-white font-medium">Paused</Badge>;
  }
  if (s === "disabled") {
    return <Badge className="bg-rose-500 hover:bg-rose-600 text-white font-medium">Disabled</Badge>;
  }
  if (s === "archived") {
    return <Badge variant="secondary" className="font-medium">Archived</Badge>;
  }
  if (s === "legacy_local_template") {
    return <Badge variant="destructive" className="bg-amber-600 text-white font-medium">Legacy Unsynced</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}

export default function Marketing() {
  const { can } = useAdminAuth();
  const canCreate = can("marketing", "create");
  const canEdit = can("marketing", "edit");
  const canSend = can("marketing", "send");
  const canDelete = can("marketing", "delete");

  const [activeTab, setActiveTab] = useState<"campaigns" | "templates" | "groups" | "whatsapp">("campaigns");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<MarketingTemplate[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [groups, setGroups] = useState<ClassGroup[]>([]);
  const [whatsAppStatus, setWhatsAppStatus] = useState<WhatsAppStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm);
  const [editingTemplate, setEditingTemplate] = useState<MarketingTemplate | null>(null);

  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignForm, setCampaignForm] = useState(emptyCampaignForm);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [preview, setPreview] = useState<RecipientPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSavingCampaign, setIsSavingCampaign] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isRefreshingTemplateId, setIsRefreshingTemplateId] = useState<number | null>(null);
  const [isSyncingMeta, setIsSyncingMeta] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSendingCampaignId, setIsSendingCampaignId] = useState<number | null>(null);
  const [isRecipientsDialogOpen, setIsRecipientsDialogOpen] = useState(false);
  const [selectedCampaignForRecipients, setSelectedCampaignForRecipients] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<any[]>([]);
  const [isLoadingRecipients, setIsLoadingRecipients] = useState(false);
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [confirmSendCampaign, setConfirmSendCampaign] = useState<Campaign | null>(null);
  const [confirmData, setConfirmData] = useState<{ total: number; prepared: number; sent: number; failed: number } | null>(null);
  const [isLoadingConfirmData, setIsLoadingConfirmData] = useState(false);
  const [batchResult, setBatchResult] = useState<{ campaignTitle: string; sentInBatch: number; total: number; prepared: number; sent: number; failed: number; newStatus: string; campaign: Campaign } | null>(null);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientStatusFilter, setRecipientStatusFilter] = useState<"all" | "prepared" | "sent" | "failed">("all");
  const [isRetryingFailed, setIsRetryingFailed] = useState(false);
  const [activeRecipientTab, setActiveRecipientTab] = useState<"list" | "logs">("list");
  const [deliveryLogs, setDeliveryLogs] = useState<any[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  const [groupOpen, setGroupOpen] = useState(false);
  const [groupForm, setGroupForm] = useState(emptyGroupForm);
  const [editingGroup, setEditingGroup] = useState<ClassGroup | null>(null);

  const [studentSearch, setStudentSearch] = useState("");
  const [studentResults, setStudentResults] = useState<SearchStudent[]>([]);
  const [whatsAppTestForm, setWhatsAppTestForm] = useState(emptyWhatsAppTestForm);
  const [isSendingWhatsAppTest, setIsSendingWhatsAppTest] = useState(false);
  const [whatsAppTestResult, setWhatsAppTestResult] = useState<WhatsAppTestResult | null>(null);

  const approvedTemplates = useMemo(() => templates.filter((template) => template.status === "approved"), [templates]);
  const selectedTemplate = useMemo(
    () => templates.find((template) => String(template.id) === campaignForm.templateId),
    [campaignForm.templateId, templates],
  );

  const parsedVars = useMemo(() => {
    const regex = /\{\{(\d+)\}\}/g;
    const matches = new Set<string>();
    let match;
    while ((match = regex.exec(templateForm.body)) !== null) {
      matches.add(`{{${match[1]}}}`);
    }
    return Array.from(matches).sort((a, b) => Number(a.replace(/[{}]/g, "")) - Number(b.replace(/[{}]/g, "")));
  }, [templateForm.body]);

  const filteredRecipients = useMemo(() => {
    return recipients.filter((recipient) => {
      const searchLower = recipientSearch.toLowerCase();
      const matchesSearch =
        recipient.name.toLowerCase().includes(searchLower) ||
        (recipient.email && recipient.email.toLowerCase().includes(searchLower)) ||
        (recipient.normalizedPhone && recipient.normalizedPhone.includes(searchLower));
      const matchesStatus =
        recipientStatusFilter === "all" || recipient.status === recipientStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [recipients, recipientSearch, recipientStatusFilter]);

  async function loadData() {
    setIsLoading(true);
    setError(null);
    try {
      const [campaignRows, templateRows, classRows, scheduleRows, groupRows, statusRow] = await Promise.all([
        customFetch<Campaign[]>("/api/marketing/campaigns"),
        customFetch<MarketingTemplate[]>("/api/marketing/templates"),
        customFetch<ClassRow[]>("/api/classes"),
        customFetch<ScheduleRow[]>("/api/schedules"),
        customFetch<ClassGroup[]>("/api/marketing/class-groups"),
        customFetch<WhatsAppStatus>("/api/marketing/whatsapp/status"),
      ]);
      setCampaigns(campaignRows);
      setTemplates(templateRows);
      setClasses(classRows);
      setSchedules(scheduleRows);
      setGroups(groupRows);
      setWhatsAppStatus(statusRow);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Marketing Center.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (studentSearch.trim().length < 2) {
      setStudentResults([]);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      customFetch<SearchStudent[]>(`/api/marketing/audience/search?q=${encodeURIComponent(studentSearch.trim())}`, { signal: controller.signal })
        .then(setStudentResults)
        .catch(() => setStudentResults([]));
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [studentSearch]);

  const resetCampaignDialog = () => {
    setEditingCampaign(null);
    setCampaignForm(emptyCampaignForm);
    setPreview(null);
  };

  const openCampaignCreate = () => {
    resetCampaignDialog();
    setCampaignOpen(true);
  };

  const openCampaignEdit = (campaign: Campaign) => {
    setEditingCampaign(campaign);
    const config = campaign.audienceConfig ?? {};
    setCampaignForm({
      title: campaign.title,
      templateId: campaign.templateId ? String(campaign.templateId) : "",
      audienceType: campaign.audienceType ?? (campaign.targetAudience as AudienceType) ?? "students",
      classId: config.classId ? String(config.classId) : "",
      scheduleId: config.scheduleId ? String(config.scheduleId) : "",
      occurrenceDate: config.occurrenceDate ?? "",
      bookingStatus: config.bookingStatus ?? "confirmed",
      days: config.days ? String(config.days) : "14",
      manualStudentIds: config.studentIds ?? [],
      message: campaign.message,
    });
    setPreview(null);
    setCampaignOpen(true);
  };

  const saveCampaign = async (): Promise<Campaign | null> => {
    const template = selectedTemplate;
    const audienceConfig = createAudienceConfig(campaignForm);
    const body = {
      title: campaignForm.title,
      type: "whatsapp",
      templateId: campaignForm.templateId ? Number(campaignForm.templateId) : null,
      message: campaignForm.message || template?.body || "",
      targetAudience: campaignForm.audienceType,
      audienceType: campaignForm.audienceType,
      audienceConfig,
    };

    setIsSavingCampaign(true);
    try {
      if (editingCampaign) {
        await customFetch(`/api/marketing/campaigns/${editingCampaign.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        const campaign = await customFetch<Campaign>("/api/marketing/campaigns", {
          method: "POST",
          body: JSON.stringify(body),
        });
        setEditingCampaign(campaign);
        await loadData();
        setPreview(null);
        return campaign;
      }
      await loadData();
      setPreview(null);
      return editingCampaign;
    } finally {
      setIsSavingCampaign(false);
    }
  };

  const previewRecipients = async () => {
    const activeCampaign = editingCampaign ?? await saveCampaign();
    if (!activeCampaign) return;
    setIsPreviewing(true);
    try {
      const row = await customFetch<RecipientPreview>(`/api/marketing/campaigns/${activeCampaign.id}/preview-recipients`, {
        method: "POST",
        body: JSON.stringify({
          audienceType: campaignForm.audienceType,
          audienceConfig: createAudienceConfig(campaignForm),
        }),
      });
      setPreview(row);
    } finally {
      setIsPreviewing(false);
    }
  };

  const prepareCampaign = async () => {
    if (!editingCampaign) return;
    setIsPreparing(true);
    try {
      await customFetch(`/api/marketing/campaigns/${editingCampaign.id}/prepare`, { method: "POST" });
      await loadData();
      setCampaignOpen(false);
      resetCampaignDialog();
    } finally {
      setIsPreparing(false);
    }
  };

  const handleOpenSendConfirmation = async (campaign: Campaign) => {
    setConfirmSendCampaign(campaign);
    setIsLoadingConfirmData(true);
    setConfirmData(null);
    try {
      const data = await customFetch<any[]>(`/api/marketing/campaigns/${campaign.id}/recipients`);
      const total = data.length;
      const prepared = data.filter((r) => r.status === "prepared").length;
      const sent = data.filter((r) => r.status === "sent").length;
      const failed = data.filter((r) => r.status === "failed").length;
      setConfirmData({ total, prepared, sent, failed });
    } catch (err) {
      const error = err as Error & { data?: { error?: string } };
      setError(error.data?.error ?? error.message ?? "Failed to load campaign confirmation data.");
      setConfirmSendCampaign(null);
    } finally {
      setIsLoadingConfirmData(false);
    }
  };

  const sendCampaign = async (campaign: Campaign) => {
    setIsSendingCampaignId(campaign.id);
    setConfirmSendCampaign(null);
    setError(null);
    try {
      const response = await customFetch<{ success: boolean; sentCount: number; sentAt: string | null }>(
        `/api/marketing/campaigns/${campaign.id}/send`,
        { method: "POST" }
      );
      if (response.success) {
        const freshRecipients = await customFetch<any[]>(`/api/marketing/campaigns/${campaign.id}/recipients`);
        const total = freshRecipients.length;
        const prepared = freshRecipients.filter((r) => r.status === "prepared").length;
        const sent = freshRecipients.filter((r) => r.status === "sent").length;
        const failed = freshRecipients.filter((r) => r.status === "failed").length;
        const newStatus = prepared === 0 ? "sent" : "sending";

        setBatchResult({
          campaignTitle: campaign.title,
          sentInBatch: response.sentCount,
          total,
          prepared,
          sent,
          failed,
          newStatus,
          campaign,
        });
        await loadData();
      }
    } catch (err) {
      const error = err as Error & { data?: { error?: string } };
      setError(error.data?.error ?? error.message ?? "Failed to send campaign batch.");
    } finally {
      setIsSendingCampaignId(null);
    }
  };

  const retryFailedRecipients = async (campaign: Campaign) => {
    if (!confirm("Are you sure you want to retry failed recipients? This resets their status to prepared.")) return;
    setIsRetryingFailed(true);
    setError(null);
    try {
      const response = await customFetch<{ success: boolean }>(
        `/api/marketing/campaigns/${campaign.id}/retry-failed`,
        { method: "POST" }
      );
      if (response.success) {
        alert("Failed recipients reset successfully. They are now prepared for sending.");
        if (isRecipientsDialogOpen && selectedCampaignForRecipients?.id === campaign.id) {
          const [recipientsData, logsData] = await Promise.all([
            customFetch<any[]>(`/api/marketing/campaigns/${campaign.id}/recipients`),
            customFetch<any[]>(`/api/marketing/campaigns/${campaign.id}/logs`).catch(() => [])
          ]);
          setRecipients(recipientsData);
          setDeliveryLogs(logsData);
        }
        await loadData();
      }
    } catch (err) {
      const error = err as Error & { data?: { error?: string } };
      setError(error.data?.error ?? error.message ?? "Failed to retry failed recipients.");
    } finally {
      setIsRetryingFailed(false);
    }
  };

  const openRecipientStatusDialog = async (campaign: Campaign) => {
    setSelectedCampaignForRecipients(campaign);
    setRecipientSearch("");
    setRecipientStatusFilter("all");
    setActiveRecipientTab("list");
    setDeliveryLogs([]);
    setIsRecipientsDialogOpen(true);
    setIsLoadingRecipients(true);
    setRecipientsError(null);
    try {
      const [recipientsData, logsData] = await Promise.all([
        customFetch<any[]>(`/api/marketing/campaigns/${campaign.id}/recipients`),
        customFetch<any[]>(`/api/marketing/campaigns/${campaign.id}/logs`).catch(() => [])
      ]);
      setRecipients(recipientsData);
      setDeliveryLogs(logsData);
    } catch (err) {
      const error = err as Error & { data?: { error?: string } };
      setRecipientsError(error.data?.error ?? error.message ?? "Failed to load recipients list.");
    } finally {
      setIsLoadingRecipients(false);
    }
  };

  const saveTemplate = async () => {
    setIsSavingTemplate(true);
    try {
      const body = {
        name: templateForm.name,
        category: templateForm.category,
        language: templateForm.language,
        body: templateForm.body,
        headerText: templateForm.headerText || null,
        footerText: templateForm.footerText || null,
      };
      await customFetch("/api/marketing/templates", { method: "POST", body: JSON.stringify(body) });
      setTemplateOpen(false);
      setEditingTemplate(null);
      setTemplateForm(emptyTemplateForm);
      await loadData();
    } catch (err) {
      const error = err as Error & { data?: { error?: string } };
      alert(error.data?.error ?? error.message ?? "Failed to save template.");
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const deleteTemplate = async (id: number) => {
    if (!canDelete || !confirm("Are you sure you want to delete this template? This will delete it from Meta (or archive it if in use).")) return;
    try {
      const response = await customFetch<{ success?: boolean; message?: string }>(`/api/marketing/templates/${id}`, { method: "DELETE" }).catch(async (e) => {
        if (e.message?.includes("Unexpected end of JSON") || e.status === 204) {
          return { success: true } as { success?: boolean; message?: string };
        }
        throw e;
      });
      if (response && response.message) {
        alert(response.message);
      }
      await loadData();
    } catch (err) {
      const error = err as Error & { data?: { error?: string } };
      alert(error.data?.error ?? error.message ?? "Failed to delete template.");
    }
  };

  const cloneTemplate = (template: MarketingTemplate) => {
    setEditingTemplate(null);
    setTemplateForm({
      name: `${template.name}_copy`,
      category: template.category === "utility" || template.category === "marketing" ? template.category : "marketing",
      language: template.language,
      body: template.body,
      headerText: template.headerText ?? "",
      footerText: template.footer ?? "",
    });
    setTemplateOpen(true);
  };

  const refreshTemplate = async (id: number) => {
    setIsRefreshingTemplateId(id);
    try {
      await customFetch(`/api/marketing/templates/${id}/status`, { method: "GET" });
      await loadData();
    } catch (err) {
      const error = err as Error & { data?: { error?: string } };
      alert(error.data?.error ?? error.message ?? "Failed to refresh template status.");
    } finally {
      setIsRefreshingTemplateId(null);
    }
  };

  const syncMetaTemplates = async () => {
    setIsSyncingMeta(true);
    try {
      const result = await customFetch<{ added: number; updated: number; archived: number }>("/api/marketing/templates/sync", { method: "POST" });
      alert(`Sync completed! Added: ${result.added}, Updated: ${result.updated}, Legacy/Deactivated: ${result.archived}`);
      await loadData();
    } catch (err) {
      const error = err as Error & { data?: { error?: string } };
      alert(error.data?.error ?? error.message ?? "Failed to sync templates from Meta.");
    } finally {
      setIsSyncingMeta(false);
    }
  };

  const saveGroup = async () => {
    const body = {
      classId: Number(groupForm.classId),
      scheduleId: groupForm.scheduleId ? Number(groupForm.scheduleId) : null,
      title: groupForm.title || null,
      groupUrl: groupForm.groupUrl,
      isActive: groupForm.isActive,
    };
    if (editingGroup) {
      await customFetch(`/api/marketing/class-groups/${editingGroup.id}`, { method: "PATCH", body: JSON.stringify(body) });
    } else {
      await customFetch("/api/marketing/class-groups", { method: "POST", body: JSON.stringify(body) });
    }
    setGroupOpen(false);
    setEditingGroup(null);
    setGroupForm(emptyGroupForm);
    await loadData();
  };

  const openGroupEdit = (group: ClassGroup) => {
    setEditingGroup(group);
    setGroupForm({
      classId: String(group.classId),
      scheduleId: group.scheduleId ? String(group.scheduleId) : "",
      title: group.title ?? "",
      groupUrl: group.groupUrl,
      isActive: group.isActive,
    });
    setGroupOpen(true);
  };

  const deleteCampaign = async (campaign: Campaign) => {
    if (!canDelete || !confirm("Delete this campaign?")) return;
    await customFetch(`/api/marketing/campaigns/${campaign.id}`, { method: "DELETE" });
    await loadData();
  };

  const sendWhatsAppTest = async () => {
    setIsSendingWhatsAppTest(true);
    setWhatsAppTestResult(null);
    try {
      const response = await customFetch<WhatsAppTestResult>("/api/marketing/whatsapp/test-send", {
        method: "POST",
        body: JSON.stringify({
          to: whatsAppTestForm.to,
          templateName: whatsAppTestForm.templateName,
          languageCode: whatsAppTestForm.languageCode,
          parameters: parseTemplateParameters(whatsAppTestForm.parameters),
        }),
      });
      setWhatsAppTestResult({
        success: true,
        provider: response.provider ?? "whatsapp_cloud",
        providerMessageId: response.providerMessageId ?? response.messageId ?? null,
        rawStatus: response.rawStatus ?? null,
      });
      await loadData();
    } catch (err) {
      const error = err as Error & { data?: { error?: string }; response?: Response };
      setWhatsAppTestResult({
        success: false,
        error: error.data?.error ?? error.message ?? "WhatsApp test send failed.",
      });
    } finally {
      setIsSendingWhatsAppTest(false);
    }
  };

  const manualSelected = campaignForm.manualStudentIds
    .map((id) => studentResults.find((student) => student.id === id))
    .filter(Boolean) as SearchStudent[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketing Center"
        description="Build WhatsApp-ready campaigns, preview recipients, and prepare sends."
        mode="general"
        addLabel={activeTab === "templates" ? "New Template" : activeTab === "groups" ? "Add Group Link" : activeTab === "campaigns" ? "New Campaign" : undefined}
        onAdd={canCreate ? activeTab === "templates" ? () => setTemplateOpen(true) : activeTab === "groups" ? () => setGroupOpen(true) : activeTab === "campaigns" ? openCampaignCreate : undefined : undefined}
      />

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Campaigns", value: campaigns.length, icon: Megaphone, color: STUDIO_CYAN },
          { label: "Approved Templates", value: approvedTemplates.length, icon: CheckCircle2, color: WHATSAPP_GREEN },
          { label: "Prepared Recipients", value: campaigns.reduce((sum, campaign) => sum + (campaign.status === "prepared" ? campaign.recipientCount : 0), 0), icon: Users, color: "#8A5CFF" },
          { label: "Real Sending", value: "Soon", icon: Send, color: "#F59E0B" },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${item.color}18` }}>
              <item.icon className="h-4 w-4" style={{ color: item.color }} />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground">{item.value}</p>
              <p className="text-xs text-muted-foreground">{item.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {[
          ["campaigns", "Campaigns"],
          ["templates", "Templates"],
          ["groups", "Class WhatsApp Groups"],
          ["whatsapp", "WhatsApp Test"],
        ].map(([value, label]) => (
          <Button key={value} variant={activeTab === value ? "default" : "outline"} size="sm" onClick={() => setActiveTab(value as typeof activeTab)}>
            {label}
          </Button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
      )}

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />
          Loading Marketing Center...
        </div>
      ) : activeTab === "campaigns" ? (
        <div className="space-y-3">
          {campaigns.length === 0 ? (
            <EmptyState title="No campaigns yet" text="Create a WhatsApp-ready campaign and preview recipients before sending." />
          ) : campaigns.map((campaign) => (
            <div key={campaign.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: `${WHATSAPP_GREEN}18` }}>
                    <MessageSquare className="h-5 w-5" style={{ color: WHATSAPP_GREEN }} />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-foreground">{campaign.title}</p>
                      <Badge variant={campaign.status === "prepared" ? "default" : campaign.status === "sending" ? "outline" : campaign.status === "sent" ? "secondary" : "secondary"}>
                        {campaign.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{campaign.message}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{audienceOptions.find((item) => item.value === (campaign.audienceType ?? campaign.targetAudience))?.label ?? campaign.targetAudience}</span>
                      <span>{campaign.recipientCount} eligible recipients</span>
                    </div>
                    {campaign.status !== "draft" && (
                      <div className="mt-3 space-y-1.5">
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground items-center">
                          <span className="font-semibold text-foreground">{campaign.sentCount} / {campaign.recipientCount} sent</span>
                          <span>·</span>
                          <span className="font-semibold text-destructive">{campaign.failedCount || 0} failed</span>
                          <span>·</span>
                          <span className="font-semibold text-amber-600">{campaign.preparedCount || 0} remaining</span>
                          <span className="ml-auto font-medium text-foreground">{Math.round((campaign.sentCount / campaign.recipientCount) * 100 || 0)}%</span>
                        </div>
                        <div className="w-full max-w-md rounded-full bg-muted h-1.5 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${(campaign.sentCount / campaign.recipientCount) * 100 || 0}%`, backgroundColor: WHATSAPP_GREEN }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  {canEdit && (campaign.status === "draft" || campaign.status === "prepared") && (
                    <Button variant="outline" size="sm" onClick={() => openCampaignEdit(campaign)}>
                      <Edit className="mr-2 h-3.5 w-3.5" />
                      Edit / Preview
                    </Button>
                  )}
                  {(campaign.status === "prepared" || campaign.status === "sending" || campaign.status === "sent") && (
                    <Button variant="outline" size="sm" onClick={() => openRecipientStatusDialog(campaign)}>
                      <Users className="mr-2 h-3.5 w-3.5" />
                      Recipients ({campaign.sentCount}/{campaign.recipientCount})
                    </Button>
                  )}
                  {canSend && (campaign.status === "prepared" || campaign.status === "sending") && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleOpenSendConfirmation(campaign)}
                      disabled={isSendingCampaignId === campaign.id || !whatsAppStatus?.enabled || !whatsAppStatus?.configured}
                      style={whatsAppStatus?.enabled && whatsAppStatus?.configured ? { backgroundColor: WHATSAPP_GREEN, borderColor: WHATSAPP_GREEN, color: "#fff" } : undefined}
                    >
                      {isSendingCampaignId === campaign.id ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="mr-2 h-3.5 w-3.5" />
                      )}
                      {campaign.status === "sending" ? "Send Next Batch" : "Send Campaign"}
                    </Button>
                  )}
                  {canDelete && (
                    <Button variant="ghost" size="icon" onClick={() => deleteCampaign(campaign)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : activeTab === "templates" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b pb-3 border-border">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Template Library</h2>
              <p className="text-xs text-muted-foreground">Manage templates synchronized with your Meta WhatsApp Business account.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={syncMetaTemplates}
              disabled={isSyncingMeta}
              className="flex items-center gap-2"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncingMeta ? "animate-spin" : ""}`} />
              {isSyncingMeta ? "Syncing..." : "Sync From Meta"}
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {templates.length === 0 ? (
              <div className="md:col-span-2 xl:col-span-3">
                <EmptyState title="No templates found" text="Click 'Sync From Meta' to pull templates, or create a new template to register it on Meta." />
              </div>
            ) : templates.map((template) => {
              const statusLower = (template.status || "").toLowerCase();
              const isApproved = statusLower === "approved";
              const isRejected = statusLower === "rejected";
              const isLegacy = statusLower === "legacy_local_template";

              return (
                <div key={template.id} className="rounded-xl border border-border bg-card p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate" title={template.name}>{template.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{template.language} · {template.category}</p>
                      </div>
                      {getStatusBadge(template.status)}
                    </div>

                    {template.headerText && (
                      <div className="mt-3 bg-muted/40 rounded p-2 border border-border/40 text-xs">
                        <span className="font-semibold text-foreground block text-[10px] uppercase tracking-wider mb-0.5">Header (Text)</span>
                        <p className="text-muted-foreground line-clamp-1">{template.headerText}</p>
                      </div>
                    )}

                    <div className="mt-3 bg-muted/60 rounded-lg p-3 border border-border">
                      <span className="font-semibold text-foreground block text-[10px] uppercase tracking-wider mb-1">Body Text</span>
                      <p className="text-sm text-foreground whitespace-pre-wrap line-clamp-4">{template.body}</p>
                    </div>

                    {template.footer && (
                      <div className="mt-2 text-xs text-muted-foreground italic px-1">
                        {template.footer}
                      </div>
                    )}

                    {isRejected && template.rejectedReason && (
                      <div className="mt-3 rounded bg-destructive/10 p-2.5 border border-destructive/20 text-xs text-destructive flex gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-semibold block">Meta Rejection Reason</span>
                          <p>{template.rejectedReason}</p>
                        </div>
                      </div>
                    )}

                    {isLegacy && (
                      <div className="mt-3 rounded bg-amber-500/10 p-2.5 border border-amber-500/20 text-xs text-amber-600 flex gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-semibold block">Legacy Local Template</span>
                          <p>Cannot be sent. Please create/clone this template to sync it to Meta.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 mt-4 items-center justify-between border-t pt-3 border-border/50">
                    <div className="flex gap-2">
                      {(isApproved || isRejected || isLegacy) && (
                        <Button variant="outline" size="sm" onClick={() => cloneTemplate(template)}>
                          <Copy className="mr-2 h-3.5 w-3.5" />
                          Clone Template
                        </Button>
                      )}
                      {!isApproved && !isRejected && !isLegacy && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isRefreshingTemplateId === template.id}
                          onClick={() => refreshTemplate(template.id)}
                        >
                          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isRefreshingTemplateId === template.id ? "animate-spin" : ""}`} />
                          Refresh Status
                        </Button>
                      )}
                    </div>
                    {canDelete && (
                      <Button variant="ghost" size="icon" onClick={() => deleteTemplate(template.id)} className="text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : activeTab === "groups" ? (
        <div className="space-y-3">
          {groups.length === 0 ? (
            <EmptyState title="No class group links yet" text="Save optional WhatsApp group URLs for future class community features." />
          ) : groups.map((group) => (
            <div key={group.id} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-foreground">{group.title || group.classTitle || `Class #${group.classId}`}</p>
                <p className="text-xs text-muted-foreground">{group.classTitle ?? "Class"} · {scheduleLabel(group)}</p>
                <a className="mt-1 inline-flex items-center gap-1 text-xs text-primary" href={group.groupUrl} target="_blank" rel="noreferrer">
                  <LinkIcon className="h-3 w-3" />
                  {group.groupUrl}
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={group.isActive ? "default" : "secondary"}>{group.isActive ? "Active" : "Inactive"}</Badge>
                {canEdit && <Button variant="outline" size="sm" onClick={() => openGroupEdit(group)}>Edit</Button>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: `${WHATSAPP_GREEN}18` }}>
                <PlugZap className="h-5 w-5" style={{ color: WHATSAPP_GREEN }} />
              </div>
              <div>
                <p className="font-semibold text-foreground">Connection Status</p>
                <p className="text-xs text-muted-foreground">Server-side WhatsApp Cloud API configuration</p>
              </div>
            </div>
            {whatsAppStatus ? (
              <div className="space-y-3 text-sm">
                <StatusRow label="WhatsApp enabled" value={whatsAppStatus.enabled ? "true" : "false"} ok={whatsAppStatus.enabled} />
                <StatusRow label="Configured" value={whatsAppStatus.configured ? "true" : "false"} ok={whatsAppStatus.configured} />
                <StatusRow label="Phone Number ID" value={whatsAppStatus.phoneNumberIdMasked ?? "Not configured"} />
                <StatusRow label="Business Account ID" value={whatsAppStatus.businessAccountIdMasked ?? "Not configured"} />
                <StatusRow label="Graph API version" value={whatsAppStatus.graphApiVersion} />
                <StatusRow label="Test recipient restriction" value={whatsAppStatus.testRecipientRestricted ? "Enabled" : "Not configured"} ok={whatsAppStatus.testRecipientRestricted} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Status unavailable.</p>
            )}
            {!whatsAppStatus?.enabled && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600">
                WhatsApp sending is disabled in environment variables.
              </div>
            )}
            <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              Access tokens are never shown in the Admin UI. This panel only displays masked identifiers and safe status flags.
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-foreground">Send Test Message</p>
                <p className="text-xs text-muted-foreground">Send one approved template to one test recipient only.</p>
              </div>
              <Badge variant="secondary">No bulk sending</Badge>
            </div>

            {!canSend && (
              <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                You do not have permission to send WhatsApp test messages.
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Recipient phone number">
                <Input
                  value={whatsAppTestForm.to}
                  onChange={(e) => setWhatsAppTestForm((form) => ({ ...form, to: e.target.value }))}
                  placeholder="+20110614656"
                  disabled={!canSend}
                />
              </Field>
              <Field label="Template name">
                <Input
                  value={whatsAppTestForm.templateName}
                  onChange={(e) => setWhatsAppTestForm((form) => ({ ...form, templateName: e.target.value }))}
                  placeholder="hello_world"
                  disabled={!canSend}
                />
              </Field>
              <Field label="Language code">
                <Input
                  value={whatsAppTestForm.languageCode}
                  onChange={(e) => setWhatsAppTestForm((form) => ({ ...form, languageCode: e.target.value }))}
                  placeholder="en_US"
                  disabled={!canSend}
                />
              </Field>
              <Field label="Template parameters">
                <Textarea
                  value={whatsAppTestForm.parameters}
                  onChange={(e) => setWhatsAppTestForm((form) => ({ ...form, parameters: e.target.value }))}
                  placeholder="Optional: one value per line"
                  rows={3}
                  disabled={!canSend}
                />
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                onClick={sendWhatsAppTest}
                disabled={!canSend || !whatsAppStatus?.enabled || !whatsAppStatus?.configured || isSendingWhatsAppTest || !whatsAppTestForm.to || !whatsAppTestForm.templateName}
              >
                {isSendingWhatsAppTest ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Send Test WhatsApp
              </Button>
              {whatsAppStatus?.testRecipientRestricted && (
                <span className="text-xs text-muted-foreground">Restricted to the server-configured test recipient.</span>
              )}
            </div>

            {whatsAppTestResult && (
              <div className={`mt-4 rounded-lg border p-3 text-sm ${
                whatsAppTestResult.success
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}
              >
                {whatsAppTestResult.success ? (
                  <div>
                    <p className="font-semibold">Test message accepted by WhatsApp Cloud.</p>
                    <p className="mt-1">Provider message ID: {whatsAppTestResult.providerMessageId ?? "Not returned"}</p>
                  </div>
                ) : (
                  <p>{whatsAppTestResult.error ?? "WhatsApp test send failed."}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={campaignOpen} onOpenChange={(next) => { setCampaignOpen(next); if (!next) resetCampaignDialog(); }}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCampaign ? "Prepare Campaign" : "New WhatsApp Campaign"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
            <div className="space-y-4">
              <Field label="Campaign Title">
                <Input value={campaignForm.title} onChange={(e) => setCampaignForm((form) => ({ ...form, title: e.target.value }))} placeholder="Summer class reminder" />
              </Field>
              <Field label="Approved Template">
                <Select value={campaignForm.templateId || "none"} onValueChange={(value) => {
                  const template = templates.find((item) => String(item.id) === value);
                  setCampaignForm((form) => ({ ...form, templateId: value === "none" ? "" : value, message: template?.body ?? form.message }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Choose template" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No template selected</SelectItem>
                    {templates.map((template) => {
                      const isSelectable = template.status === "approved" && !!template.metaTemplateId;
                      return (
                        <SelectItem key={template.id} value={String(template.id)} disabled={!isSelectable}>
                          {template.name} ({template.language}) {!isSelectable ? `· [${template.status}]` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {selectedTemplate && (selectedTemplate.status !== "approved" || !selectedTemplate.metaTemplateId) && (
                  <div className="mt-2 rounded-lg bg-destructive/15 border border-destructive/20 p-2.5 text-xs text-destructive flex gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Unapproved Template Selected</p>
                      <p>This template is not approved on Meta or is a legacy template. You cannot send campaigns using this template.</p>
                    </div>
                  </div>
                )}
                {selectedTemplate && selectedTemplate.status === "approved" && (
                  <div className="mt-1.5 flex flex-col gap-1 text-[11px] text-muted-foreground bg-muted/40 p-2 rounded border border-border/40">
                    <p><span className="font-semibold">Meta Template ID:</span> {selectedTemplate.metaTemplateId}</p>
                    <p><span className="font-semibold">Language:</span> {selectedTemplate.language} · <span className="font-semibold">Category:</span> {selectedTemplate.category}</p>
                    {selectedTemplate.variables && selectedTemplate.variables.length > 0 && (
                      <p>
                        <span className="font-semibold">Variables required:</span>{" "}
                        {selectedTemplate.variables.map((v) => `{{${v}}}`).join(", ")}
                      </p>
                    )}
                  </div>
                )}
              </Field>
              <Field label="Message Body">
                <Textarea
                  rows={6}
                  value={campaignForm.message}
                  onChange={(e) => setCampaignForm((form) => ({ ...form, message: e.target.value }))}
                  disabled={!!campaignForm.templateId}
                  placeholder="Template body text will be prefilled automatically"
                />
                {campaignForm.templateId && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Message body is loaded from the approved Meta template and cannot be edited.
                  </p>
                )}
              </Field>
              <Field label="Audience">
                <Select value={campaignForm.audienceType} onValueChange={(value) => setCampaignForm((form) => ({ ...form, audienceType: value as AudienceType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {audienceOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">{audienceOptions.find((option) => option.value === campaignForm.audienceType)?.hint}</p>
              </Field>

              {(campaignForm.audienceType === "class" || campaignForm.audienceType === "schedule") && (
                <Field label="Class">
                  <Select value={campaignForm.classId || "none"} onValueChange={(value) => setCampaignForm((form) => ({ ...form, classId: value === "none" ? "" : value }))}>
                    <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Choose class</SelectItem>
                      {classes.map((cls) => <SelectItem key={cls.id} value={String(cls.id)}>{cls.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {campaignForm.audienceType === "schedule" && (
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Schedule">
                    <Select value={campaignForm.scheduleId || "none"} onValueChange={(value) => setCampaignForm((form) => ({ ...form, scheduleId: value === "none" ? "" : value }))}>
                      <SelectTrigger><SelectValue placeholder="Select schedule" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Choose schedule</SelectItem>
                        {schedules
                          .filter((schedule) => !campaignForm.classId || schedule.classId === Number(campaignForm.classId))
                          .map((schedule) => <SelectItem key={schedule.id} value={String(schedule.id)}>{scheduleLabel(schedule)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Occurrence Date">
                    <Input type="date" value={campaignForm.occurrenceDate} onChange={(e) => setCampaignForm((form) => ({ ...form, occurrenceDate: e.target.value }))} />
                  </Field>
                </div>
              )}

              {campaignForm.audienceType === "bookingStatus" && (
                <Field label="Booking Status">
                  <Select value={campaignForm.bookingStatus} onValueChange={(value) => setCampaignForm((form) => ({ ...form, bookingStatus: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["pending", "confirmed", "cancelled", "rejected", "attended", "no_show"].map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {campaignForm.audienceType === "packageExpiringSoon" && (
                <Field label="Expiring Within Days">
                  <Input type="number" min={1} value={campaignForm.days} onChange={(e) => setCampaignForm((form) => ({ ...form, days: e.target.value }))} />
                </Field>
              )}

              {campaignForm.audienceType === "manual" && (
                <div className="rounded-xl border border-border bg-muted/20 p-3">
                  <Label>Manual User Search</Label>
                  <div className="relative mt-2">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-9" value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} placeholder="Search name, email, phone..." />
                  </div>
                  <div className="mt-3 max-h-40 overflow-y-auto space-y-2">
                    {studentResults.map((student) => {
                      const checked = campaignForm.manualStudentIds.includes(student.id);
                      return (
                        <button
                          key={student.id}
                          type="button"
                          className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-left text-sm"
                          onClick={() => setCampaignForm((form) => ({
                            ...form,
                            manualStudentIds: checked
                              ? form.manualStudentIds.filter((id) => id !== student.id)
                              : [...form.manualStudentIds, student.id],
                          }))}
                        >
                          <span>{student.name}<span className="ml-2 text-xs text-muted-foreground">{student.email}</span></span>
                          <Badge variant={checked ? "default" : "secondary"}>{checked ? "Selected" : student.accountType ?? "User"}</Badge>
                        </button>
                      );
                    })}
                  </div>
                  {manualSelected.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{manualSelected.length} selected</p>}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-foreground">Recipient Preview</p>
                    <p className="text-xs text-muted-foreground">No messages are sent in Phase 1.</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={previewRecipients} disabled={isPreviewing || !campaignForm.title || !campaignForm.message}>
                    {isPreviewing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Users className="mr-2 h-3.5 w-3.5" />}
                    Preview Recipients
                  </Button>
                </div>
                {preview ? (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <Metric label="Eligible" value={preview.eligibleCount} tone="success" />
                      <Metric label="Candidates" value={preview.totalCandidates} />
                    </div>
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-600">
                      Excluded: {preview.excluded.missingPhone} missing phone, {preview.excluded.invalidPhone} invalid, {preview.excluded.optedOut} opted out, {preview.excluded.duplicate} duplicate.
                    </div>
                    <div className="space-y-2">
                      {preview.sample.slice(0, 6).map((recipient) => (
                        <div key={recipient.normalizedPhone} className="rounded-lg border border-border px-3 py-2">
                          <p className="text-sm font-medium text-foreground">{recipient.name}</p>
                          <p className="text-xs text-muted-foreground">{recipient.normalizedPhone} · {recipient.email}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    Preview recipients to verify phone coverage and opt-out exclusions.
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-2">
                  {whatsAppStatus?.enabled && whatsAppStatus?.configured ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-500" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
                  )}
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {whatsAppStatus?.enabled && whatsAppStatus?.configured
                        ? "WhatsApp delivery is active"
                        : "WhatsApp delivery is disabled"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {whatsAppStatus?.enabled && whatsAppStatus?.configured
                        ? "Campaigns will be sent via the configured WhatsApp Cloud API."
                        : "WhatsApp is not configured. Set WHATSAPP_ENABLED=true and configure API settings to enable sending."}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCampaignOpen(false)}>Close</Button>
            <Button
              onClick={saveCampaign}
              disabled={
                isSavingCampaign ||
                !campaignForm.title ||
                !campaignForm.message ||
                (selectedTemplate && (selectedTemplate.status !== "approved" || !selectedTemplate.metaTemplateId))
              }
            >
              {isSavingCampaign ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Draft
            </Button>
            <Button
              onClick={prepareCampaign}
              disabled={
                !canSend ||
                isPreparing ||
                !editingCampaign ||
                !preview ||
                (selectedTemplate && (selectedTemplate.status !== "approved" || !selectedTemplate.metaTemplateId))
              }
            >
              {isPreparing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Prepare Campaign
            </Button>
            <Button disabled title="WhatsApp Cloud API is not integrated yet">
              <Send className="mr-2 h-4 w-4" />
              Send via WhatsApp · Coming Soon
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Submit Template to Meta</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Template Name">
              <Input
                value={templateForm.name}
                placeholder="e.g. summer_session_invite"
                onChange={(e) => setTemplateForm((form) => ({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") }))}
              />
              <span className="text-[10px] text-muted-foreground block mt-0.5">
                Lowercase alphanumeric and underscores only.
              </span>
            </Field>
            <Field label="Language">
              <Select value={templateForm.language} onValueChange={(value) => setTemplateForm((form) => ({ ...form, language: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en_US">English (US) · en_US</SelectItem>
                  <SelectItem value="ar">Arabic · ar</SelectItem>
                  <SelectItem value="es">Spanish · es</SelectItem>
                  <SelectItem value="fr">French · fr</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-[10px] text-muted-foreground block mt-0.5">
                Choose the template translation language.
              </span>
            </Field>
            <Field label="Category">
              <Select value={templateForm.category} onValueChange={(value) => setTemplateForm((form) => ({ ...form, category: value as "utility" | "marketing" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="marketing">Marketing</SelectItem>
                  <SelectItem value="utility">Utility</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Header Text (Optional)">
              <Input
                value={templateForm.headerText}
                placeholder="e.g. Central Studio"
                onChange={(e) => setTemplateForm((form) => ({ ...form, headerText: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Body Text (Required)">
            <Textarea
              rows={5}
              value={templateForm.body}
              onChange={(e) => setTemplateForm((form) => ({ ...form, body: e.target.value }))}
              placeholder="e.g. Hi {{1}}, your booking for {{2}} is confirmed!"
            />
            {parsedVars.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Detected Variables:</span>
                {parsedVars.map((v) => (
                  <Badge key={v} variant="outline" className="text-[10px] py-0 px-1.5 font-mono bg-muted">{v}</Badge>
                ))}
              </div>
            )}
            <span className="text-[10px] text-muted-foreground block mt-1">
              Use numbered variables like <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>. Text templates must match Meta formatting rules.
            </span>
          </Field>
          <Field label="Footer Text (Optional)">
            <Input
              value={templateForm.footerText}
              placeholder="e.g. Reply STOP to opt out"
              onChange={(e) => setTemplateForm((form) => ({ ...form, footerText: e.target.value }))}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateOpen(false)}>Cancel</Button>
            <Button onClick={saveTemplate} disabled={isSavingTemplate || !templateForm.name || !templateForm.body}>
              {isSavingTemplate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit to Meta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{editingGroup ? "Edit Class Group Link" : "Add Class Group Link"}</DialogTitle></DialogHeader>
          <Field label="Class">
            <Select value={groupForm.classId || "none"} onValueChange={(value) => setGroupForm((form) => ({ ...form, classId: value === "none" ? "" : value }))}>
              <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
              <SelectContent><SelectItem value="none">Choose class</SelectItem>{classes.map((cls) => <SelectItem key={cls.id} value={String(cls.id)}>{cls.title}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Schedule (optional)">
            <Select value={groupForm.scheduleId || "none"} onValueChange={(value) => setGroupForm((form) => ({ ...form, scheduleId: value === "none" ? "" : value }))}>
              <SelectTrigger><SelectValue placeholder="Select schedule" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No specific schedule</SelectItem>
                {schedules.filter((schedule) => !groupForm.classId || schedule.classId === Number(groupForm.classId)).map((schedule) => <SelectItem key={schedule.id} value={String(schedule.id)}>{scheduleLabel(schedule)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Display Title"><Input value={groupForm.title} onChange={(e) => setGroupForm((form) => ({ ...form, title: e.target.value }))} /></Field>
          <Field label="WhatsApp Group URL"><Input value={groupForm.groupUrl} onChange={(e) => setGroupForm((form) => ({ ...form, groupUrl: e.target.value }))} placeholder="https://chat.whatsapp.com/..." /></Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupOpen(false)}>Cancel</Button>
            <Button onClick={saveGroup} disabled={!groupForm.classId || !groupForm.groupUrl}>Save Group Link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isRecipientsDialogOpen} onOpenChange={setIsRecipientsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6">
          <DialogHeader>
            <DialogTitle>Campaign Recipients & Status</DialogTitle>
          </DialogHeader>

          {/* Sub-tabs header */}
          <div className="flex border-b mb-4 text-sm font-medium">
            <button
              onClick={() => setActiveRecipientTab("list")}
              className={`py-2 px-4 border-b-2 transition-all ${
                activeRecipientTab === "list"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Recipients ({recipients.length})
            </button>
            <button
              onClick={() => setActiveRecipientTab("logs")}
              className={`py-2 px-4 border-b-2 transition-all ${
                activeRecipientTab === "logs"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Delivery Logs ({deliveryLogs.length})
            </button>
          </div>

          {isLoadingRecipients ? (
            <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mb-2" />
              Loading recipients list...
            </div>
          ) : recipientsError ? (
            <div className="text-destructive text-sm p-4">{recipientsError}</div>
          ) : activeRecipientTab === "list" ? (
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {/* Timeline Snapshot */}
              {selectedCampaignForRecipients && (
                <div className="rounded-xl border bg-muted/20 p-4 text-xs space-y-2">
                  <p className="font-semibold text-foreground">Campaign Activity Timeline</p>
                  <ul className="space-y-1 pl-4 list-disc text-muted-foreground">
                    <li>
                      Prepared on <span className="font-medium text-foreground">{selectedCampaignForRecipients.preparedAt ? new Date(selectedCampaignForRecipients.preparedAt).toLocaleString() : "Unknown"}</span> with <span className="font-medium text-foreground">{selectedCampaignForRecipients.recipientCount}</span> candidates.
                    </li>
                    {recipients.filter(r => r.status === "sent").length > 0 && (
                      <li>
                        Dispatched <span className="font-semibold text-emerald-600">{recipients.filter(r => r.status === "sent").length}</span> messages successfully.
                      </li>
                    )}
                    {recipients.filter(r => r.status === "failed").length > 0 && (
                      <li>
                        Failed to send <span className="font-semibold text-destructive">{recipients.filter(r => r.status === "failed").length}</span> messages.
                      </li>
                    )}
                    {selectedCampaignForRecipients.status === "sent" && (
                      <li className="text-emerald-600 font-medium">
                        Campaign finished sending on {selectedCampaignForRecipients.sentAt ? new Date(selectedCampaignForRecipients.sentAt).toLocaleString() : "Unknown"}.
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between text-sm border-b pb-4">
                <div>
                  <p className="font-semibold text-foreground">
                    {selectedCampaignForRecipients?.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Status: <span className="font-semibold capitalize text-foreground">{selectedCampaignForRecipients?.status}</span>
                  </p>
                </div>
                <div className="flex gap-4">
                  <div className="text-right">
                    <span className="font-bold text-foreground">
                      {recipients.filter(r => r.status === "sent").length}
                    </span>
                    <p className="text-xs text-muted-foreground">Sent</p>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-amber-600">
                      {recipients.filter(r => r.status === "prepared").length}
                    </span>
                    <p className="text-xs text-muted-foreground">Prepared</p>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-destructive">
                      {recipients.filter(r => r.status === "failed").length}
                    </span>
                    <p className="text-xs text-muted-foreground">Failed</p>
                  </div>
                  <div className="text-right border-l pl-4">
                    <span className="font-bold text-foreground">
                      {recipients.length}
                    </span>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                </div>
              </div>

              {/* Search & Filter Section */}
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9 h-9"
                    placeholder="Search name, phone, email..."
                    value={recipientSearch}
                    onChange={(e) => setRecipientSearch(e.target.value)}
                  />
                </div>
                <div className="flex gap-1 border rounded-lg p-1 bg-muted/20">
                  {(["all", "prepared", "sent", "failed"] as const).map((filter) => (
                    <Button
                      key={filter}
                      variant={recipientStatusFilter === filter ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 capitalize text-xs px-2.5"
                      onClick={() => setRecipientStatusFilter(filter)}
                    >
                      {filter}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                {filteredRecipients.map((recipient) => {
                  const isMetaTranslationError = recipient.errorMessage && (
                    recipient.errorMessage.includes("132001") ||
                    recipient.errorMessage.toLowerCase().includes("template name does not exist")
                  );
                  return (
                    <div key={recipient.id} className="flex items-center justify-between border rounded-lg p-3 text-sm bg-card hover:bg-muted/5">
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">{recipient.name}</p>
                        <p className="text-xs text-muted-foreground">{recipient.normalizedPhone || "No Phone"} · {recipient.email || "No Email"}</p>
                        {recipient.errorMessage && (
                          <div className="space-y-1.5 mt-1">
                            <p className="text-xs text-destructive font-mono bg-destructive/5 px-2 py-1 rounded border border-destructive/10 max-w-lg whitespace-pre-wrap">
                              Reason: {recipient.errorMessage}
                            </p>
                            {isMetaTranslationError && (
                              <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 rounded px-2.5 py-1.5 text-[11px] leading-relaxed max-w-lg">
                                <strong className="font-bold">Meta Translation Tip:</strong> This error (#132001) occurs because the template name or language code does not exactly match an approved WhatsApp template in your Meta Business Suite. Please verify that the template is fully approved for this language code.
                              </div>
                            )}
                          </div>
                        )}
                        {recipient.updatedAt && (
                          <p className="text-[10px] text-muted-foreground">Last updated: {new Date(recipient.updatedAt).toLocaleString()}</p>
                        )}
                      </div>
                      <Badge variant={recipient.status === "sent" ? "default" : recipient.status === "failed" ? "destructive" : "secondary"}>
                        {recipient.status}
                      </Badge>
                    </div>
                  );
                })}
                {filteredRecipients.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground p-8 bg-muted/10 rounded-lg border border-dashed">
                    No recipients match the active search or status filter.
                  </p>
                )}
              </div>
            </div>
          ) : (
            /* Delivery Logs view */
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {isLoadingLogs ? (
                <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mb-2" />
                  Loading delivery logs...
                </div>
              ) : logsError ? (
                <div className="text-destructive text-sm p-4">{logsError}</div>
              ) : (
                <div className="space-y-3">
                  {deliveryLogs.map((log) => {
                    const isMetaTranslationError = log.errorMessage && (
                      log.errorMessage.includes("132001") ||
                      log.errorMessage.toLowerCase().includes("template name does not exist")
                    );
                    return (
                      <div key={log.id} className="border rounded-lg p-3 text-xs bg-card hover:bg-muted/5 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-foreground">
                            {log.recipientName ? `${log.recipientName} (${log.recipientPhone || "No Phone"})` : "System / Campaign Event"}
                          </p>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(log.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={log.status === "sent" ? "default" : log.status === "failed" ? "destructive" : "secondary"} className="text-[10px] py-0 px-1.5 font-normal capitalize">
                            {log.eventType} · {log.status}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">Provider: {log.provider}</span>
                          {log.providerMessageId && (
                            <span className="text-[10px] text-muted-foreground font-mono">Msg ID: {log.providerMessageId}</span>
                          )}
                        </div>
                        {log.errorMessage && (
                          <div className="space-y-1">
                            <p className="text-destructive font-mono bg-destructive/5 px-2 py-1 rounded border border-destructive/10">
                              Error: {log.errorMessage} {log.errorCode ? `(Code: ${log.errorCode})` : ""}
                            </p>
                            {isMetaTranslationError && (
                              <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 rounded px-2.5 py-1.5 text-[11px] leading-relaxed">
                                <strong className="font-bold">Meta Translation Tip:</strong> This error (#132001) occurs because the template name or language code does not exactly match an approved WhatsApp template in your Meta Business Suite. Please verify that the template is fully approved for this language code.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {deliveryLogs.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground p-8 bg-muted/10 rounded-lg border border-dashed">
                      No delivery log events recorded for this campaign.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="mt-4 border-t pt-3 flex gap-2">
            {selectedCampaignForRecipients && recipients.some(r => r.status === "failed") && (
              <Button
                variant="outline"
                onClick={() => retryFailedRecipients(selectedCampaignForRecipients)}
                disabled={isRetryingFailed}
                className="mr-auto text-destructive border-destructive hover:bg-destructive/10 h-9 text-xs"
              >
                {isRetryingFailed ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
                Retry Failed ({recipients.filter(r => r.status === "failed").length})
              </Button>
            )}
            <Button variant="outline" className="h-9 text-xs" onClick={() => setIsRecipientsDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog Before Sending */}
      <Dialog open={confirmSendCampaign !== null} onOpenChange={(open) => !open && setConfirmSendCampaign(null)}>
        <DialogContent className="max-w-md p-6">
          <DialogHeader>
            <DialogTitle>Send WhatsApp Campaign?</DialogTitle>
          </DialogHeader>
          {confirmSendCampaign && (
            <div className="space-y-4 text-sm mt-3">
              <div className="space-y-2 border-b pb-3">
                <p className="font-semibold text-base text-foreground">{confirmSendCampaign.title}</p>
                <p className="text-xs text-muted-foreground">
                  Template: <span className="font-medium text-foreground">{confirmSendCampaign.templateId ? templates.find(t => t.id === confirmSendCampaign.templateId)?.name : "None"}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Status: <span className="font-medium text-foreground capitalize">{confirmSendCampaign.status}</span>
                </p>
              </div>
              {isLoadingConfirmData ? (
                <div className="flex flex-col items-center justify-center p-6 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mb-2" />
                  Calculating campaign statistics...
                </div>
              ) : confirmData ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs bg-muted/20 p-3 rounded-lg">
                    <div>Total Candidates: <span className="font-bold text-foreground">{confirmData.total}</span></div>
                    <div>Already Sent: <span className="font-bold text-foreground">{confirmData.sent}</span></div>
                    <div>Failed: <span className="font-bold text-destructive">{confirmData.failed}</span></div>
                    <div>Prepared Remaining: <span className="font-bold text-amber-600">{confirmData.prepared}</span></div>
                  </div>
                  <div className="border-t pt-3 space-y-2">
                    <div className="flex justify-between font-medium">
                      <span>Batch limit:</span>
                      <span>5 recipients</span>
                    </div>
                    <div className="flex justify-between font-semibold text-emerald-600">
                      <span>Will send now:</span>
                      <span>{Math.min(confirmData.prepared, 5)} messages</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Remaining after this batch:</span>
                      <span>{Math.max(0, confirmData.prepared - 5)} recipients</span>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-destructive">Failed to calculate campaign data.</p>
              )}
              <DialogFooter className="pt-3 border-t">
                <Button variant="outline" onClick={() => setConfirmSendCampaign(null)}>Cancel</Button>
                <Button
                  onClick={() => confirmSendCampaign && sendCampaign(confirmSendCampaign)}
                  disabled={isLoadingConfirmData || !confirmData || confirmData.prepared === 0}
                  style={whatsAppStatus?.enabled && whatsAppStatus?.configured ? { backgroundColor: WHATSAPP_GREEN, borderColor: WHATSAPP_GREEN, color: "#fff" } : undefined}
                >
                  Send Now
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Batch Result Summary */}
      <Dialog open={batchResult !== null} onOpenChange={(open) => !open && setBatchResult(null)}>
        <DialogContent className="max-w-md p-6">
          <DialogHeader>
            <DialogTitle className="text-emerald-600 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              Batch Sending Completed
            </DialogTitle>
          </DialogHeader>
          {batchResult && (
            <div className="space-y-4 text-sm mt-3">
              <p className="font-medium text-foreground">Summary for "{batchResult.campaignTitle}":</p>
              <div className="space-y-2 bg-muted/20 p-3 rounded-lg border">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sent in this batch:</span>
                  <span className="font-bold text-emerald-600">{batchResult.sentInBatch} successfully</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Failed (total):</span>
                  <span className="font-bold text-destructive">{batchResult.failed} failed</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Remaining:</span>
                  <span className="font-bold text-amber-600">{batchResult.prepared} prepared</span>
                </div>
                <div className="flex justify-between border-t pt-2 mt-2">
                  <span className="text-muted-foreground">Campaign status:</span>
                  <span className="font-bold text-foreground capitalize">{batchResult.newStatus}</span>
                </div>
              </div>
              <DialogFooter className="pt-3 border-t flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    const c = batchResult.campaign;
                    setBatchResult(null);
                    void openRecipientStatusDialog(c);
                  }}
                >
                  <Users className="mr-2 h-4 w-4" />
                  View Recipients
                </Button>
                <Button variant="secondary" className="flex-1" onClick={() => setBatchResult(null)}>Close</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "success" }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <p className="text-lg font-bold" style={{ color: tone === "success" ? WHATSAPP_GREEN : undefined }}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/20 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={ok === undefined ? "font-medium text-foreground" : ok ? "font-medium text-emerald-600" : "font-medium text-amber-600"}>
        {value}
      </span>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-12 text-center">
      <Megaphone className="mx-auto mb-3 h-10 w-10 opacity-30" style={{ color: STUDIO_CYAN }} />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
