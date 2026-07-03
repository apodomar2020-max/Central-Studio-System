import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

type PageHeaderProps = {
  title: string;
  description: string;
  mode?: "studio" | "stage" | "general";
  addLabel?: string;
  addTestId?: string;
  onAdd?: () => void;
  children?: React.ReactNode;
};

const modeColors = {
  studio: { dot: "#00B6D7", label: "STUDIO", labelColor: "#00B6D755" },
  stage: { dot: "#00B6D7", label: "STUDIO", labelColor: "#00B6D755" },
  general: { dot: "#9CA3AF", label: undefined, labelColor: "#9CA3AF55" },
};

export function PageHeader({
  title,
  description,
  mode = "studio",
  addLabel,
  addTestId,
  onAdd,
  children,
}: PageHeaderProps) {
  const { dot, label, labelColor } = modeColors[mode];

  return (
    // Phase 5B: stacks vertically on mobile so long titles/descriptions don't
    // collide with the action button; identical side-by-side layout at sm+.
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {label && (
          <div className="flex items-center gap-1.5 mb-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: dot }}
            />
            <span
              className="text-[10px] font-semibold tracking-widest uppercase"
              style={{ color: labelColor }}
            >
              {label}
            </span>
          </div>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {description}
        </p>
      </div>

      {onAdd && addLabel ? (
        <Button
          data-testid={addTestId}
          onClick={onAdd}
          className={cn("gap-2 self-start shrink-0")}
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
