/**
 * Shared Finance presentation atoms.
 *
 * Centralized so the reliability badge, the amount cell, and the "Unknown"
 * treatment look and read identically on every Finance page. Labels come from
 * @workspace/api-zod — never re-spelled here.
 */
import {
  FINANCE_EVENT_NATURE_LABELS,
  FINANCE_EVENT_TYPE_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_RELIABILITY_LABELS,
  type FinanceEventNature,
  type FinanceEventType,
  type FinanceNormalizedPaymentMethod,
  type FinanceReliabilityBadge,
  type UnifiedFinanceTransaction,
} from "@workspace/api-zod";
import { AlertTriangle, HelpCircle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCreditUnits, formatEgp } from "./financeApi";

/**
 * Badge colour encodes TRUST, not sentiment: green only where an amount was
 * actually recorded, amber for anything estimated or admin-asserted, slate for
 * non-monetary credits, red-ish for unknown. Uses the same token-based classes
 * as the existing Logs/Ballet badges so both themes work unchanged.
 */
const RELIABILITY_BADGE_CLASS: Record<FinanceReliabilityBadge, string> = {
  recorded_collection: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  recorded_refund: "bg-blue-500/15 text-blue-600 border-blue-500/30 dark:text-blue-400",
  recorded_discount: "bg-violet-500/15 text-violet-600 border-violet-500/30 dark:text-violet-400",
  estimated_operational: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400",
  unverified_admin_tag: "bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400",
  legacy_display_only: "bg-slate-500/15 text-slate-600 border-slate-500/30 dark:text-slate-400",
  service_credit_unit: "bg-cyan-500/15 text-cyan-700 border-cyan-500/30 dark:text-cyan-400",
  unknown_amount: "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400",
};

/**
 * Reliability badge with the API's own explanation as its tooltip — the
 * explanation text is contractual, so it is never paraphrased in the UI.
 */
export function ReliabilityBadge({
  badge,
  explanation,
}: {
  badge: FinanceReliabilityBadge;
  explanation: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`cursor-help whitespace-nowrap ${RELIABILITY_BADGE_CLASS[badge]}`}
          data-testid={`badge-reliability-${badge}`}
        >
          {FINANCE_RELIABILITY_LABELS[badge]}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">{explanation}</TooltipContent>
    </Tooltip>
  );
}

export function EventTypeBadge({ eventType }: { eventType: FinanceEventType }) {
  return (
    <Badge variant="outline" className="whitespace-nowrap border-border/70 bg-muted/40 text-foreground">
      {FINANCE_EVENT_TYPE_LABELS[eventType]}
    </Badge>
  );
}

export function eventNatureLabel(nature: FinanceEventNature): string {
  return FINANCE_EVENT_NATURE_LABELS[nature];
}

export function paymentMethodLabel(method: FinanceNormalizedPaymentMethod | null): string {
  if (method == null) return "—";
  return method === "unknown" ? "Not recorded" : FINANCE_PAYMENT_METHOD_LABELS[method];
}

/**
 * The single amount cell used everywhere.
 *
 * Three mutually exclusive presentations, each of which is a factual claim:
 *   • a credit event shows UNITS (never "EGP 0"),
 *   • an unknown amount shows "Unknown" with an explanation (never 0),
 *   • otherwise the amount, annotated when it is only an estimate.
 */
export function FinanceAmountCell({ transaction }: { transaction: UnifiedFinanceTransaction }) {
  const { amounts, credit, amountAvailability, reliability } = transaction;

  if (amountAvailability === "not_applicable") {
    return (
      <div className="whitespace-nowrap">
        <span className="font-medium tabular-nums text-foreground">
          {formatCreditUnits(credit.unitDelta)}
        </span>
        {credit.balanceAfter != null && (
          <div className="text-xs text-muted-foreground">balance {credit.balanceAfter}</div>
        )}
      </div>
    );
  }

  if (amountAvailability === "unknown" || amounts.amountEgp == null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help items-center gap-1 whitespace-nowrap text-sm font-medium text-red-600 dark:text-red-400">
            <HelpCircle className="h-3.5 w-3.5" />
            Unknown
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">
          {reliability.explanation}
        </TooltipContent>
      </Tooltip>
    );
  }

  const estimated = amountAvailability === "estimated";
  return (
    <div className="whitespace-nowrap">
      <span className="font-medium tabular-nums text-foreground">{formatEgp(amounts.amountEgp)}</span>
      {estimated && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-1 inline-flex cursor-help items-center text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-relaxed">
            {reliability.explanation}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * Shared Finance guidance action. The legacy name remains intentionally stable
 * for existing consumers, while the presentation is now a neutral information
 * control backed by the Admin dialog pattern instead of an amber warning panel.
 */
export function FinanceLimitationsPanel({
  warnings,
  title = "Limitations",
}: {
  warnings: readonly string[];
  title?: string;
}) {
  if (warnings.length === 0) return null;

  const accessibleLabel = `Open ${title} information`;

  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="admin2-finance-info-trigger"
              aria-label={accessibleLabel}
              data-testid="button-finance-information"
            >
              <Info aria-hidden="true" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>View finance information</TooltipContent>
      </Tooltip>

      <DialogContent className="admin2-finance-info-dialog sm:max-w-xl" data-testid="dialog-finance-information">
        <DialogHeader className="admin2-finance-info-header">
          <div className="admin2-finance-info-heading">
            <span className="admin2-finance-info-icon" aria-hidden="true"><Info /></span>
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>Guidance for interpreting the financial information on this page.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ul className="admin2-finance-info-list">
          {warnings.map((warning) => (
            <li key={warning}>
              <span aria-hidden="true" />
              <p>{warning}</p>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Small caption marking a whole section as estimated or blended. */
export function EstimateWarningBadge({ label = "Estimated" }: { label?: string }) {
  return (
    <Badge
      variant="outline"
      className="whitespace-nowrap border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400"
    >
      <AlertTriangle className="mr-1 h-3 w-3" />
      {label}
    </Badge>
  );
}
