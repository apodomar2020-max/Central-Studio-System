type ChartTooltipEntry = {
  dataKey?: string | number;
  name?: string | number;
  value?: string | number | readonly (string | number)[];
  color?: string;
  fill?: string;
  payload?: { fill?: string };
};

type AdminChartTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: readonly ChartTooltipEntry[];
};

function formatTooltipValue(value: ChartTooltipEntry["value"]): string {
  if (Array.isArray(value)) return value.join(" – ");
  if (typeof value === "number") return value.toLocaleString();
  return value == null ? "—" : String(value);
}

/** Theme-safe content renderer shared by every production Recharts tooltip. */
export function AdminChartTooltip({ active, label, payload }: AdminChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return <div className="admin2-chart-tooltip" role="status">
    {label != null && label !== "" ? <div className="admin2-chart-tooltip-label">{label}</div> : null}
    <div className="admin2-chart-tooltip-items">
      {payload.map((entry, index) => {
        const name = entry.name ?? entry.dataKey ?? "Value";
        const marker = entry.color ?? entry.fill ?? entry.payload?.fill ?? "var(--admin2-cyan)";
        return <div className="admin2-chart-tooltip-item" key={`${String(entry.dataKey ?? name)}-${index}`}>
          <span className="admin2-chart-tooltip-marker" style={{ backgroundColor: marker }} aria-hidden="true" />
          <span>{name}</span>
          <strong>{formatTooltipValue(entry.value)}</strong>
        </div>;
      })}
    </div>
  </div>;
}
