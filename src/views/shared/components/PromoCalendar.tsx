/**
 * Pure React component (props only, no MCP): promotions as horizontal bars on a CSS-grid calendar, one block per
 * category, with CLASHES made visible. Built by hand, no calendar library.
 *
 * Accessibility: a clash is never signalled by colour alone. Clashing bars get an outline AND a warning icon AND the
 * overlapping days are shaded AND the aria-label says so.
 */
import { useMemo, useState } from "react";
import type { CalendarPromo, PromoCalendarOutput } from "../../../server/schemas.js";
import { CATEGORIES } from "../../../server/schemas.js";
import { assignLanes, buildColumns, clashesOf, monthGroups, periodLabel, spanOf } from "../calendarLayout.js";
import { formatWeek } from "../format.js";
import { Badge } from "./Badge.js";
import { Card } from "./Card.js";
import { EmptyState } from "./States.js";

const TYPE_LABEL: Record<string, string> = { percent_off: "% off", bogo: "BOGO", bundle: "Bundle" };
const where = (r: string) => (r === "all" ? "all regions" : r);

interface Props {
  data: PromoCalendarOutput;
  /** When given, shows previous/next month buttons. The WRAPPER decides what navigating means (server call or not). */
  onNavigate?: (dir: -1 | 1) => void;
  navigating?: boolean;
  navError?: string | null;
}

export function PromoCalendar({ data, onNavigate, navigating = false, navError = null }: Props) {
  const [clashesOnly, setClashesOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const clashIds = useMemo(() => new Set(data.clashes.flatMap((c) => [c.a, c.b])), [data.clashes]);
  const visible = useMemo(
    () => (clashesOnly ? data.promotions.filter((p) => clashIds.has(p.promoId)) : data.promotions),
    [clashesOnly, data.promotions, clashIds],
  );
  const cols = useMemo(() => buildColumns(data.from, data.to), [data.from, data.to]);
  const selected = data.promotions.find((p) => p.promoId === selectedId) ?? null;

  const blocks = CATEGORIES.map((category) => {
    const promos = visible.filter((p) => p.category === category);
    return { category, promos, ...assignLanes(promos, data.from, cols) };
  }).filter((b) => b.promos.length > 0);

  return (
    <div className="calendar">
      <div className="card-header">
        <div className="cal-nav">
          {onNavigate ? (
            <button type="button" className="chip" onClick={() => onNavigate(-1)} disabled={navigating} aria-label="Previous month">
              ← Prev
            </button>
          ) : null}
          <strong aria-live="polite">{periodLabel(data.from, data.to)}</strong>
          {onNavigate ? (
            <button type="button" className="chip" onClick={() => onNavigate(1)} disabled={navigating} aria-label="Next month">
              Next →
            </button>
          ) : null}
          {navigating ? <span className="id">Loading…</span> : null}
        </div>
        <button type="button" className={`chip-toggle${clashesOnly ? " on" : ""}`} aria-pressed={clashesOnly} onClick={() => setClashesOnly((v) => !v)}>
          <span aria-hidden="true">⚠</span> Clashes only
        </button>
      </div>

      <p className="stats">
        {data.promotions.length} promotion{data.promotions.length === 1 ? "" : "s"}
        {data.category ? ` in ${data.category}` : ""},{" "}
        <strong className={data.clashes.length ? "neg" : undefined}>
          {data.clashes.length} clash{data.clashes.length === 1 ? "" : "es"}
        </strong>
      </p>
      {navError ? <p className="state error" role="alert">{navError}</p> : null}

      {blocks.length === 0 ? (
        <EmptyState label={clashesOnly ? "No clashes in this period." : "No promotions in this period."} />
      ) : (
        <div className="cal-scroll">
          <div className="cal" style={{ ["--cols" as string]: cols.count }}>
            <div className="cal-row cal-head">
              <span />
              {monthGroups(cols).map((g, i) => (
                <span key={i} className="cal-month" style={{ gridColumn: `span ${g.span}` }}>{g.label}</span>
              ))}
            </div>
            <div className="cal-row cal-head">
              <span />
              {cols.starts.map((iso) => (
                <span key={iso} className="cal-day">
                  {cols.unit === 1 ? Number(iso.slice(8)) : formatWeek(iso).replace(/^[A-Za-z]+ /, "")}
                </span>
              ))}
            </div>

            {blocks.map((b) => (
              <div key={b.category} className="cal-block" style={{ gridTemplateRows: `repeat(${b.count}, 30px)` }}>
                <span className="cal-label" style={{ gridRow: `1 / span ${b.count}` }}>{b.category}</span>

                {data.clashes
                  .filter((c) => c.category === b.category && b.promos.some((p) => p.promoId === c.a) && b.promos.some((p) => p.promoId === c.b))
                  .map((c) => {
                    const [s, e] = spanOf(c.overlapStart, c.overlapEnd, data.from, cols);
                    return (
                      <span
                        key={`${c.a}-${c.b}`}
                        className="clash-band"
                        style={{ gridColumn: `${2 + s} / ${3 + e}`, gridRow: `1 / span ${b.count}` }}
                        title={`Clash: ${c.aName} / ${c.bName}, ${c.overlapDays} day(s)`}
                      />
                    );
                  })}

                {b.promos.map((p) => (
                  <Bar
                    key={p.promoId}
                    promo={p}
                    lane={b.lanes.get(p.promoId) ?? 0}
                    span={spanOf(p.start, p.end, data.from, cols)}
                    clashWith={clashesOf(p.promoId, data.clashes).map((c) => (c.a === p.promoId ? c.bName : c.aName))}
                    selected={p.promoId === selectedId}
                    onSelect={() => setSelectedId((cur) => (cur === p.promoId ? null : p.promoId))}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="chart-legend" aria-label="Legend">
        <span><span className="swatch" style={{ background: "var(--c-percent_off)" }} />% off</span>
        <span><span className="swatch" style={{ background: "var(--c-bogo)" }} />BOGO</span>
        <span><span className="swatch" style={{ background: "var(--c-bundle)" }} />Bundle</span>
        <span><span aria-hidden="true">⚠</span> clash (outlined, overlap shaded)</span>
      </div>

      {selected ? <Detail promo={selected} data={data} onClose={() => setSelectedId(null)} /> : null}
    </div>
  );
}

function Bar({ promo, lane, span, clashWith, selected, onSelect }: {
  promo: CalendarPromo;
  lane: number;
  span: [number, number];
  clashWith: string[];
  selected: boolean;
  onSelect: () => void;
}) {
  const isClash = clashWith.length > 0;
  const label =
    `${promo.name}, ${TYPE_LABEL[promo.type] ?? promo.type} ${promo.discountPct}%, ${promo.category}, ${where(promo.region)}, ` +
    `${promo.start} to ${promo.end}.` + (isClash ? ` Clashes with ${clashWith.join(", ")}.` : "");
  return (
    <button
      type="button"
      className={`bar bar-${promo.type}${isClash ? " is-clash" : ""}${selected ? " is-selected" : ""}`}
      style={{ gridColumn: `${2 + span[0]} / ${3 + span[1]}`, gridRow: lane + 1 }}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
    >
      {isClash ? <span aria-hidden="true">⚠ </span> : null}
      <span className="bar-name">{promo.name}</span>
      <span className="bar-meta"> · {TYPE_LABEL[promo.type] ?? promo.type} {promo.discountPct}%</span>
    </button>
  );
}

function Detail({ promo, data, onClose }: { promo: CalendarPromo; data: PromoCalendarOutput; onClose: () => void }) {
  const clashes = clashesOf(promo.promoId, data.clashes);
  return (
    <div className="detail">
      <Card
        title={promo.name}
        subtitle={promo.promoId}
        actions={<button type="button" className="chip" onClick={onClose} aria-label="Close details">Close ×</button>}
      >
        <p className="stats">
          <Badge tone={promo.type === "bogo" ? "pos" : promo.type === "percent_off" ? "accent" : "neutral"}>
            {TYPE_LABEL[promo.type] ?? promo.type}
          </Badge>{" "}
          {promo.discountPct}% · {promo.category} · {where(promo.region)} · {promo.start} → {promo.end}
        </p>
        {clashes.length === 0 ? (
          <p className="state ok">No clash in this period.</p>
        ) : (
          <ul className="clash-list">
            {clashes.map((c) => (
              <li key={`${c.a}-${c.b}`}>
                <span aria-hidden="true">⚠</span> Clashes with <strong>{c.a === promo.promoId ? c.bName : c.aName}</strong> in{" "}
                {where(c.region)} for {c.overlapDays} day{c.overlapDays === 1 ? "" : "s"} ({c.overlapStart} → {c.overlapEnd})
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
