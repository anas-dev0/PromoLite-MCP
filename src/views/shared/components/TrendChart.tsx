/**
 * Pure React component (props only, no MCP). Weekly sales line with promotion weeks shaded behind it.
 *
 * Chart choice: a quantity over time is a LINE. Promo periods are context for that line, not a second
 * quantity, so they are drawn as a background band (a bar series on its own hidden 0-1 axis), never as a second line.
 *
 * The units/revenue toggle is VIEW state: it re-renders locally and never calls the server (revenue = units x price,
 * both already in the data).
 */
import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import type { TrendPoint } from "../../../server/schemas.js";
import { formatNumber, formatWeek } from "../format.js";
import { EmptyState } from "./States.js";

type Metric = "units" | "revenue";

interface Row extends TrendPoint {
  revenue: number;
  value: number; // what the line plots (units or revenue)
  band: 0 | 1; // 1 on promotion weeks -> shaded background
}

function TrendTooltip({ active, payload }: TooltipContentProps) {
  const row = payload?.[0]?.payload as Row | undefined;
  if (!active || !row) return null;
  return (
    <div className="tooltip">
      <strong>Week of {formatWeek(row.week)}</strong>
      <div><span>Units</span><span>{formatNumber(row.units)}</span></div>
      <div><span>Avg price</span><span>{row.price} TND</span></div>
      <div><span>Revenue</span><span>{formatNumber(Math.round(row.revenue))} TND</span></div>
      {row.promoId ? <span className="promo">Promo: {row.promoName ?? row.promoId}</span> : null}
    </div>
  );
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const [metric, setMetric] = useState<Metric>("units");

  const rows: Row[] = useMemo(
    () =>
      points.map((p) => {
        const revenue = p.units * p.price;
        return { ...p, revenue, value: metric === "units" ? p.units : revenue, band: p.promoId ? 1 : 0 };
      }),
    [points, metric],
  );

  if (points.length === 0) return <EmptyState label="No sales data for this selection." />;

  const unitLabel = metric === "units" ? "Units per week" : "Revenue per week (TND)";

  return (
    <>
      <div className="card-header">
        <div className="segmented" role="group" aria-label="Metric">
          {(["units", "revenue"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {m === "units" ? "Units" : "Revenue"}
            </button>
          ))}
        </div>
        <div className="chart-legend">
          <span><span className="swatch" style={{ background: "var(--accent)" }} />{unitLabel}</span>
          <span><span className="swatch" style={{ background: "var(--promo-band)", border: "1px solid var(--border)" }} />Promotion week</span>
        </div>
      </div>

      {/* Fixed height: ResponsiveContainer takes its size from the parent, and an iframe parent has none. */}
      <div className="chart-box" role="img" aria-label={`${unitLabel} over ${points.length} weeks, promotion weeks shaded`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={0}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="week"
              tickFormatter={formatWeek}
              minTickGap={24}
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={{ stroke: "var(--border)" }}
            />
            <YAxis
              yAxisId="main"
              tickFormatter={formatNumber}
              width={56}
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={{ stroke: "var(--border)" }}
            />
            {/* Hidden 0-1 axis so the promo band always fills the full chart height. width={0} matters: a hidden
                axis still reserves 60px by default, which pushed the real axis outside the SVG. */}
            <YAxis yAxisId="band" hide width={0} orientation="right" domain={[0, 1]} />
            <Tooltip content={TrendTooltip} cursor={{ stroke: "var(--muted)" }} />
            <Bar yAxisId="band" dataKey="band" fill="var(--promo-band)" isAnimationActive={false} legendType="none" />
            <Line
              yAxisId="main"
              dataKey="value"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
