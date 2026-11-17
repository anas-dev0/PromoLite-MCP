/**
 * Pure layout maths for the promotions calendar (no React, no MCP): easy to unit-test on Day 7.
 * Dates are ISO strings (YYYY-MM-DD); all arithmetic is done in UTC so timezones and daylight saving never shift a day.
 */
import type { CalendarPromo, Clash } from "../../server/schemas.js";

const DAY_MS = 86_400_000;
export const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => toIso(toMs(iso) + n * DAY_MS);
/** Whole days from a to b (b - a). */
export const diffDays = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY_MS);

export interface Columns {
  /** 1 = one column per day, 7 = one column per week (long periods) */
  unit: 1 | 7;
  count: number;
  /** ISO date at the start of each column */
  starts: string[];
}

/** Short periods get a column per day; long ones (over ~2 months) get a column per week, so bars stay readable. */
export function buildColumns(from: string, to: string): Columns {
  const totalDays = diffDays(from, to) + 1;
  const unit = totalDays <= 62 ? 1 : 7;
  const count = Math.ceil(totalDays / unit);
  return { unit, count, starts: Array.from({ length: count }, (_, i) => addDays(from, i * unit)) };
}

/** 0-based column index of a date, clamped to the visible period. */
export function columnOf(date: string, from: string, cols: Columns): number {
  const offset = Math.min(Math.max(diffDays(from, date), 0), cols.count * cols.unit - 1);
  return Math.floor(offset / cols.unit);
}

/** First and last column (inclusive) covered by [start, end], clipped to the period. */
export function spanOf(start: string, end: string, from: string, cols: Columns): [number, number] {
  return [columnOf(start, from, cols), columnOf(end, from, cols)];
}

/**
 * Greedy lane assignment: promotions that overlap in time (even by one column) must not be drawn on top of each
 * other, so each gets the first lane (sub-row) that is free at its start.
 */
export function assignLanes(promos: CalendarPromo[], from: string, cols: Columns): { lanes: Map<string, number>; count: number } {
  const lanes = new Map<string, number>();
  const laneEnd: number[] = []; // last occupied column of each lane
  const sorted = [...promos].sort((a, b) => a.start.localeCompare(b.start) || a.promoId.localeCompare(b.promoId));
  for (const p of sorted) {
    const [s, e] = spanOf(p.start, p.end, from, cols);
    let lane = laneEnd.findIndex((end) => end < s);
    if (lane === -1) lane = laneEnd.length;
    laneEnd[lane] = e;
    lanes.set(p.promoId, lane);
  }
  return { lanes, count: Math.max(laneEnd.length, 1) };
}

/** Month groups for the header row: [{ label: "June 2025", cols: 30 }, ...] */
export function monthGroups(cols: Columns): { label: string; span: number }[] {
  const groups: { label: string; span: number }[] = [];
  for (const iso of cols.starts) {
    const label = new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.span++;
    else groups.push({ label, span: 1 });
  }
  return groups;
}

/** The whole calendar month `dir` months away from the month containing `iso`. dir 0 = the month of `iso`. */
export function monthRange(iso: string, dir: -1 | 0 | 1): { from: string; to: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { from: toIso(first.getTime()), to: toIso(last.getTime()) };
}

/** "June 2025" when [from, to] is exactly one calendar month, otherwise "2025-01-01 → 2025-12-31". */
export function periodLabel(from: string, to: string): string {
  const m = monthRange(from, 0);
  if (m.from === from && m.to === to) {
    return new Date(`${from}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return `${from} → ${to}`;
}

/** Clashes that involve a given promotion. */
export const clashesOf = (promoId: string, clashes: Clash[]) => clashes.filter((c) => c.a === promoId || c.b === promoId);
