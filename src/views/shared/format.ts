/** Formatting helpers shared by every view. */

/** 0.6 -> "+60%", -0.05 -> "-5%" */
export const formatPct = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(n * 100).toFixed(0)}%`;

export const formatNumber = (n: number) => n.toLocaleString("en-US");

/** "2025-03-10" -> "Mar 10". timeZone UTC so the date never shifts by the viewer's timezone. */
export const formatWeek = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
