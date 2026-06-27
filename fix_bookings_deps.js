const fs = require('fs');
const path = require('path');

const bookingsPath = path.join(__dirname, 'artifacts/central/app/(tabs)/bookings.tsx');
let bookings = fs.readFileSync(bookingsPath, 'utf8');

// Replace bad imports
bookings = bookings.replace(
  /import \{\n\s*BalletApplication,\n\s*getBalletStatusInfo,\n\s*BALLET_COLOR,\n\} from "@\/contexts\/BalletContext";\nimport \{ isOfflineError \} from "@\/services\/connectivity";\nimport \{\n\s*fetchMyApplications,\n\s*syncOfflineApplications,\n\} from "@\/services\/ballet\/api";/,
  \`import {
  fetchMyApplications,
  ACTIVE_APPLICATION_STATUSES,
  type BalletApplication,
} from "@/services/balletAssessmentService";
import { isOfflineError } from "@/services/connectivity";

const BALLET_COLOR = "#A78BFA";
type BalletStatusInfo = { label: string; color: string; icon: any };
function getBalletStatusInfo(status: string): BalletStatusInfo {
  switch (status) {
    case "submitted":       return { label: "Under Review",         color: "#F59E0B", icon: "time-outline" };
    case "pendingAssessment": return { label: "Assessment Scheduled", color: "#60A5FA", icon: "calendar-outline" };
    case "needsFollowUp":   return { label: "Follow-up Required",   color: "#F59E0B", icon: "chatbubble-ellipses-outline" };
    case "accepted":        return { label: "Accepted",             color: "#22C55E", icon: "checkmark-circle" };
    case "assignedToLevel": return { label: "Level Assigned",       color: BALLET_COLOR, icon: "ribbon-outline" };
    case "activeBallet":    return { label: "Active Student",       color: BALLET_COLOR, icon: "star-outline" };
    case "rejected":        return { label: "Not Accepted",         color: "#EF4444", icon: "close-circle-outline" };
    case "cancelled":       return { label: "Cancelled",            color: "#6B7280", icon: "ban-outline" };
    default:                return { label: status,                 color: "#9CA3AF", icon: "information-circle-outline" };
  }
}\`
);

// Remove syncOfflineApplications usage
bookings = bookings.replace(
  /  useEffect\(\(\) => \{\n    if \(user && isOffline\) \{\n      syncOfflineApplications\(\)\.then\(\(\) => \{\n        loadBalletApps\(\);\n      \}\);\n    \}\n  \}, \[user, isOffline, loadBalletApps\]\);\n/,
  ""
);

// Fix TS implicitly any 'part'
bookings = bookings.replace(/map\(\(part\) => part\[0\]\)/g, 'map((part: string) => part[0])');

fs.writeFileSync(bookingsPath, bookings, 'utf8');

const cardPath = path.join(__dirname, 'artifacts/central/components/BookingCard.tsx');
let card = fs.readFileSync(cardPath, 'utf8');
card = card.replace(/map\(\(part\) => part\[0\]\)/g, 'map((part: string) => part[0])');
fs.writeFileSync(cardPath, card, 'utf8');

console.log("Fixed dependencies and types.");
