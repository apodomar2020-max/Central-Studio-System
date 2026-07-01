import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import {
  AlertTriangle,
  CheckCircle2,
  Edit,
  Link as LinkIcon,
  Loader2,
  Megaphone,
  MessageSquare,
  PlugZap,
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
  category: "utility" | "marketing";
  language: string;
  body: string;
  status: "draft" | "approved" | "archived";
  variables?: string[] | null;
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
  status: "draft" | "approved" | "archived";
  body: string;
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
  language: "en",
  status: "draft",
  body: "",
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
  const [isPreparing, setIsPreparing] = useState(false);

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

  const saveTemplate = async () => {
    const body = { ...templateForm, variables: templateVariables(templateForm.body) };
    if (editingTemplate) {
      await customFetch(`/api/marketing/templates/${editingTemplate.id}`, { method: "PATCH", body: JSON.stringify(body) });
    } else {
      await customFetch("/api/marketing/templates", { method: "POST", body: JSON.stringify(body) });
    }
    setTemplateOpen(false);
    setEditingTemplate(null);
    setTemplateForm(emptyTemplateForm);
    await loadData();
  };

  const openTemplateEdit = (template: MarketingTemplate) => {
    setEditingTemplate(template);
    setTemplateForm({
      name: template.name,
      category: template.category,
      language: template.language,
      status: template.status,
      body: template.body,
    });
    setTemplateOpen(true);
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
                      <Badge variant={campaign.status === "prepared" ? "default" : "secondary"}>{campaign.status}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{campaign.message}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{audienceOptions.find((item) => item.value === (campaign.audienceType ?? campaign.targetAudience))?.label ?? campaign.targetAudience}</span>
                      <span>{campaign.recipientCount} eligible recipients</span>
                      <span>WhatsApp API delivery: coming soon</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canEdit && (
                    <Button variant="outline" size="sm" onClick={() => openCampaignEdit(campaign)}>
                      <Edit className="mr-2 h-3.5 w-3.5" />
                      Edit / Preview
                    </Button>
                  )}
                  <Button variant="outline" size="sm" disabled title="WhatsApp Cloud API integration is not enabled yet">
                    <Send className="mr-2 h-3.5 w-3.5" />
                    Send via WhatsApp · Coming Soon
                  </Button>
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.length === 0 ? (
            <div className="md:col-span-2 xl:col-span-3"><EmptyState title="No templates yet" text="Add approved WhatsApp templates before preparing campaigns." /></div>
          ) : templates.map((template) => (
            <div key={template.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{template.name}</p>
                  <p className="text-xs text-muted-foreground">{template.language} · {template.category}</p>
                </div>
                <Badge variant={template.status === "approved" ? "default" : "secondary"}>{template.status}</Badge>
              </div>
              <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">{template.body}</p>
              {canEdit && (
                <Button variant="outline" size="sm" className="mt-4" onClick={() => openTemplateEdit(template)}>
                  <Edit className="mr-2 h-3.5 w-3.5" />
                  Edit Template
                </Button>
              )}
            </div>
          ))}
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
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={String(template.id)}>{template.name} · {template.status}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Message Body">
                <Textarea rows={6} value={campaignForm.message} onChange={(e) => setCampaignForm((form) => ({ ...form, message: e.target.value }))} placeholder="Template body with {{name}} variables" />
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
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">WhatsApp delivery is disabled</p>
                    <p className="mt-1 text-xs text-muted-foreground">Phase 1 prepares campaigns and recipient snapshots only. Cloud API sending, queues, and webhooks come later.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCampaignOpen(false)}>Close</Button>
            <Button onClick={saveCampaign} disabled={isSavingCampaign || !campaignForm.title || !campaignForm.message}>
              {isSavingCampaign ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Draft
            </Button>
            <Button onClick={prepareCampaign} disabled={!canSend || isPreparing || !editingCampaign || !preview}>
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
          <DialogHeader><DialogTitle>{editingTemplate ? "Edit Template" : "New WhatsApp Template"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Template Name"><Input value={templateForm.name} onChange={(e) => setTemplateForm((form) => ({ ...form, name: e.target.value }))} /></Field>
            <Field label="Language"><Input value={templateForm.language} onChange={(e) => setTemplateForm((form) => ({ ...form, language: e.target.value }))} /></Field>
            <Field label="Category">
              <Select value={templateForm.category} onValueChange={(value) => setTemplateForm((form) => ({ ...form, category: value as "utility" | "marketing" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="utility">Utility</SelectItem><SelectItem value="marketing">Marketing</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select value={templateForm.status} onValueChange={(value) => setTemplateForm((form) => ({ ...form, status: value as "draft" | "approved" | "archived" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="archived">Archived</SelectItem></SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Body">
            <Textarea rows={7} value={templateForm.body} onChange={(e) => setTemplateForm((form) => ({ ...form, body: e.target.value }))} placeholder="Hi {{name}}, your class starts soon..." />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateOpen(false)}>Cancel</Button>
            <Button onClick={saveTemplate} disabled={!templateForm.name || !templateForm.body}>Save Template</Button>
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
