import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Loader2, Users, Baby, Sparkles, ClipboardList, CreditCard, Info, HeartPulse, MessageSquare } from "lucide-react";
import type { ApplicationDetailTabPanelsProps } from "./types";
import { DAY_NAMES, Field, formatPaymentMethod, GridRow, Section, StatusBadge } from "./shared";

export function ApplicationTab(props: ApplicationDetailTabPanelsProps) {
  const { app, assessmentSchedule, reviewStatuses, newStatus, setNewStatus, statusNote, setStatusNote, statusMutation } = props;
  return (
<TabsContent value="application" className="space-y-4">

  {/* Parent + Child — the two identity sections, side by side on desktop. */}
  <GridRow>
    <Section title="Parent / Guardian" icon={<Users />}>
      <Field label="Name"  value={app.parentName} />
      <Field label="Phone" value={app.parentPhone} />
      <Field label="Email" value={app.parentEmail} />
      {app.parentStudentId && (
        <Field label="Student ID" value={`#${app.parentStudentId}`} />
      )}
    </Section>

    <Section title="Child Information" icon={<Baby />}>
      <Field label="Name"     value={app.childName} />
      <Field label="Birthday" value={app.childBirthday} />
      <Field label="Age"      value={app.childAge !== null ? `${app.childAge} years` : null} />
      <Field label="Gender"   value={app.childGender} />
      {app.childId !== null && (
        <Field label="Linked Child Profile" value={`#${app.childId}`} />
      )}
    </Section>
  </GridRow>

  {/* Emergency Contact + Medical Notes — both conditional; the grid simply
      leaves the other cell empty when only one is present, rather than
      duplicating data to balance it. */}
  {(app.emergencyContactName || app.emergencyContactPhone || app.medicalNotes) && (
    <GridRow>
      {(app.emergencyContactName || app.emergencyContactPhone) && (
        <Section title="Emergency Contact" icon={<HeartPulse />}>
          <Field label="Name"  value={app.emergencyContactName} />
          <Field label="Phone" value={app.emergencyContactPhone} />
        </Section>
      )}
      {app.medicalNotes && (
        <Section title="Medical Notes" icon={<Info />}>
          <p className="text-sm text-foreground whitespace-pre-wrap">{app.medicalNotes}</p>
        </Section>
      )}
    </GridRow>
  )}

  {/* Free-text parent notes — full width for readability. */}
  {app.notes && (
    <Section title="Additional Notes (from parent)" icon={<MessageSquare />}>
      <p className="text-sm text-foreground whitespace-pre-wrap">{app.notes}</p>
    </Section>
  )}

  {/* Dance Experience + Assessment — side by side. */}
  <GridRow>
    <Section title="Dance Experience" icon={<Sparkles />}>
      <Field
        label="Previous experience"
        value={app.previousExperience ? "Yes" : "No"}
      />
      {app.experienceDetails && (
        <Field label="Details" value={app.experienceDetails} />
      )}
    </Section>

    <Section title="Assessment" icon={<ClipboardList />}>
      {assessmentSchedule ? (
        <>
          <Field label="Class" value={assessmentSchedule.classTitle} />
          <Field label="Level" value={assessmentSchedule.levelName} />
          <Field label="Schedule" value={`${DAY_NAMES[assessmentSchedule.dayOfWeek] ?? assessmentSchedule.dayOfWeek} ${assessmentSchedule.startTime} – ${assessmentSchedule.endTime}`} />
          <Field label="Selected date" value={app.assessmentDate} />
          {assessmentSchedule.instructorName && (
            <Field label="Instructor" value={assessmentSchedule.instructorName} />
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          No assessment schedule selected
        </p>
      )}
    </Section>
  </GridRow>

  {reviewStatuses.length > 0 && (
    <Section title="Application Status Update" icon={<ArrowRight />}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <StatusBadge status={app.status} />
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">new status</span>
        </div>
        <Select value={newStatus} onValueChange={setNewStatus}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Select review status…" />
          </SelectTrigger>
          <SelectContent>
            {reviewStatuses.filter((s: any) => s.value !== app.status).map((s: any) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          className="text-sm min-h-[64px] resize-none"
          placeholder="Note (optional)"
          value={statusNote}
          onChange={(e) => setStatusNote(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!newStatus || statusMutation.isPending}
          onClick={() => statusMutation.mutate(undefined)}
          style={{ background: "#00B6D6", color: "#000" }}
        >
          {statusMutation.isPending ? (
            <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving…</>
          ) : "Update Status"}
        </Button>
      </div>
    </Section>
  )}

  {/* Preferred Payment Intake + Metadata — side by side. */}
  <GridRow>
    <Section title="Preferred Payment Intake" icon={<CreditCard />}>
      <Field
        label="Preferred package"
        value={
          app.preferredPackageName
            ? `${app.preferredPackageName}${app.preferredPackageId ? ` (#${app.preferredPackageId})` : ""}`
            : "No preferred package selected (legacy application)"
        }
      />
      <Field label="Preferred payment method" value={formatPaymentMethod(app.preferredPaymentMethod)} />
    </Section>

    <Section title="Metadata" icon={<Info />}>
      <Field label="Application ID" value={`#${app.id}`} />
      <Field label="Submitted" value={new Date(app.createdAt).toLocaleString()} />
      <Field label="Last updated" value={new Date(app.updatedAt).toLocaleString()} />
    </Section>
  </GridRow>
</TabsContent>
  );
}
