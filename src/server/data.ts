/**
 * Data layer: loads the CSVs and computes promotion metrics.
 * Pure TypeScript, knows nothing about MCP (Day 2 splits this out further and
 * adds more functions; it is already separate today so tools stay thin).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

// Absolute path built from this file's location, NOT from the working directory.
// Claude Desktop starts the server from a different cwd, so "data/sales.csv" would break.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA_DIR = path.join(ROOT, "data");

export interface Promotion {
  promoId: string;
  name: string;
  type: string;
  discountPct: number;
  start: string; // ISO date
  end: string;
  category: string;
  region: string; // "North" | "Centre" | "South" | "all"
}
export interface PromoResult {
  promoId: string;
  name: string;
  type: string;
  discountPct: number;
  start: string;
  end: string;
  category: string;
  region: string;
  uplift: number; // 0.6 = +60%
  incrementalUnits: number;
}

interface SaleRow { date: string; productId: string; storeId: string; units: number; promoId: string }
interface Dataset {
  promos: Promotion[];
  /** key `${category}|${region}` -> week -> { units, promoted } */
  weekly: Map<string, Map<string, { units: number; promoted: boolean }>>;
  weeks: string[]; // sorted Monday dates
}

const REGIONS = ["North", "Centre", "South"] as const;

function readCsv(file: string): Record<string, string>[] {
  return parse(readFileSync(path.join(DATA_DIR, file), "utf8"), { columns: true, skip_empty_lines: true });
}

let cache: Dataset | undefined;

function load(): Dataset {
  if (cache) return cache;

  const category = new Map(readCsv("products.csv").map((r) => [r["product_id"]!, r["category"]!]));
  const region = new Map(readCsv("stores.csv").map((r) => [r["store_id"]!, r["region"]!]));
  const promos: Promotion[] = readCsv("promotions.csv").map((r) => ({
    promoId: r["promo_id"]!, name: r["name"]!, type: r["type"]!, discountPct: Number(r["discount_pct"]),
    start: r["start"]!, end: r["end"]!, category: r["category"]!, region: r["region"]!,
  }));

  const weekly: Dataset["weekly"] = new Map();
  const weekSet = new Set<string>();
  for (const r of readCsv("sales.csv")) {
    const row: SaleRow = {
      date: r["date"]!, productId: r["product_id"]!, storeId: r["store_id"]!,
      units: Number(r["units"]), promoId: r["promo_id"]!,
    };
    const key = `${category.get(row.productId)}|${region.get(row.storeId)}`;
    let series = weekly.get(key);
    if (!series) weekly.set(key, (series = new Map()));
    const cell = series.get(row.date) ?? { units: 0, promoted: false };
    cell.units += row.units;
    if (row.promoId) cell.promoted = true;
    series.set(row.date, cell);
    weekSet.add(row.date);
  }
  return (cache = { promos, weekly, weeks: [...weekSet].sort() });
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Weekly units for a promo's scope (its category, in its region or all regions). */
function scopeSeries(ds: Dataset, p: Promotion): Map<string, { units: number; promoted: boolean }> {
  const regions = p.region === "all" ? REGIONS : [p.region];
  const out = new Map<string, { units: number; promoted: boolean }>();
  for (const reg of regions) {
    for (const [week, cell] of ds.weekly.get(`${p.category}|${reg}`) ?? []) {
      const o = out.get(week) ?? { units: 0, promoted: false };
      o.units += cell.units;
      o.promoted ||= cell.promoted;
      out.set(week, o);
    }
  }
  return out;
}

/**
 * Uplift = promo-week units / baseline weekly units - 1.
 * Baseline = average of the 4 weeks before the promo, BUT only weeks with no promotion
 * in the same category+region ("clean" weeks). A naive "last 4 weeks" would include other
 * promos (e.g. clashes) and understate the uplift. We look back up to 12 weeks to find them.
 */
export function computeUplift(p: Promotion): { uplift: number; incrementalUnits: number } | null {
  const ds = load();
  const series = scopeSeries(ds, p);
  const promoWeeks = ds.weeks.filter((w) => w <= p.end && addDays(w, 6) >= p.start);
  if (promoWeeks.length === 0) return null;

  const clean: number[] = [];
  for (let i = ds.weeks.indexOf(promoWeeks[0]!) - 1; i >= 0 && i >= ds.weeks.indexOf(promoWeeks[0]!) - 12; i--) {
    const cell = series.get(ds.weeks[i]!);
    if (cell && !cell.promoted) clean.push(cell.units);
    if (clean.length === 4) break;
  }
  if (clean.length === 0) return null;

  const baseline = clean.reduce((a, b) => a + b, 0) / clean.length;
  const promoUnits = promoWeeks.reduce((sum, w) => sum + (series.get(w)?.units ?? 0), 0);
  const expected = baseline * promoWeeks.length;
  return { uplift: promoUnits / expected - 1, incrementalUnits: Math.round(promoUnits - expected) };
}

/** Promotions overlapping [from, to], ranked by uplift (highest first). */
export function topPromotions(from: string, to: string, limit: number): PromoResult[] {
  const ds = load();
  return ds.promos
    .filter((p) => p.start <= to && p.end >= from)
    .flatMap((p) => {
      const m = computeUplift(p);
      return m ? [{ ...p, ...m }] : [];
    })
    .sort((a, b) => b.uplift - a.uplift)
    .slice(0, limit);
}
