import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

type PageHeaderProps = {
  title?: string;
  description?: string;
  mode?: "studio" | "stage" | "general";
  addLabel?: string;
  addTestId?: string;
  onAdd?: () => void;
  children?: React.ReactNode;
};

/**
 * PageHeader — action container helper for legacy page integrations.
 *
 * Page identity (title, category badge, description, section icon) is now
 * authoritatively owned by the single global TopBar header. This component
 * renders only page-level action triggers or children when provided, eliminating
 * duplicate page identity headings.
 */
export function PageHeader({
  mode = "studio",
  addLabel,
  addTestId,
  onAdd,
  children,
}: PageHeaderProps) {
  if (!onAdd && !children) return null;

  return (
    <div className="mb-4 flex items-center justify-end">
      {onAdd && addLabel ? (
        <Button
          data-testid={addTestId}
          onClick={onAdd}
          className={cn("gap-2 shrink-0")}
          style={
            mode === "stage"
              ? {
                  background: "#8A5CFF",
                  color: "#fff",
                  borderColor: "#8A5CFF44",
                }
              : undefined
          }
        >
          <Plus className="h-4 w-4" />
          {addLabel}
        </Button>
      ) : (
        children
      )}
    </div>
  );
}
