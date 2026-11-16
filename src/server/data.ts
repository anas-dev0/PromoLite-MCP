/**
 * Data layer: loads the CSVs and answers questions about them.
 * Plain TypeScript functions that know NOTHING about MCP. server.ts only validates input,
 * calls these, and formats the answer. Easy to unit-test (Day 7); a database would only change this file.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import type { Product, PromoResult, TrendPoint } from "./schemas.js";

// Absolute path built from this file's location, NOT the working directory (Claude Desktop starts the
// server from another cwd). Works from src/server/ (tsx) and dist/server/ (built): both are 2 levels below the root.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA_DIR = path.join(ROOT, "data");

/** A mistake the caller can fix. server.ts turns it into an `isError` tool result with this message. */
export class UserError extends Error {}

interface Promotion {
  promoId: string; name: string; type: string; discountPct: number;
  start: string; end: string; category: string; region: string;
}
interface Store { storeId: string; city: string; region: string }
interface SaleRow { date: string; storeId: string; units: number; price: number; promoId: string }
interface Cell { units: number; promoted: boolean }

interface Dataset {
  products: Product[];
  productsById: Map<string, Product>;
  stores: Store[];
  promos: Promotion[];
  salesByProduct: Map<string, SaleRow[]>;
  /** key `${category}|${region}` -> week -> weekly totals (used for uplift) */
  weekly: Map<string, Map<string, Cell>>;
  weeks: string[]; // sorted Monday dates
}

const REGIONS = ["North", "Centre", "South"] as const;

function readCsv(file: string): Record<string, string>[] {
  return parse(readFileSync(path.join(DATA_DIR, file), "utf8"), { columns: true, skip_empty_lines: true });
}

let cache: Dataset | undefined;

function load(): Dataset {
  if (cache) return cache;

  const products: Product[] = readCsv("products.csv").map((r) => ({
    productId: r["product_id"]!, name: r["name"]!, category: r["category"]!, basePrice: Number(r["base_price"]),
  }));
  const productsById = new Map(products.map((p) => [p.productId, p]));
  const stores: Store[] = readCsv("stores.csv").map((r) => ({
    storeId: r["store_id"]!, city: r["city"]!, region: r["region"]!,
  }));
  const storeRegion = new Map(stores.map((s) => [s.storeId, s.region]));
  const promos: Promotion[] = readCsv("promotions.csv").map((r) => ({
    promoId: r["promo_id"]!, name: r["name"]!, type: r["type"]!, discountPct: Number(r["discount_pct"]),
    start: r["start"]!, end: r["end"]!, category: r["category"]!, region: r["region"]!,
  }));

  const salesByProduct = new Map<string, SaleRow[]>();
  const weekly: Dataset["weekly"] = new Map();
  const weekSet = new Set<string>();
  for (const r of readCsv("sales.csv")) {
    const productId = r["product_id"]!;
    const row: SaleRow = {
      date: r["date"]!, storeId: r["store_id"]!, units: Number(r["units"]),
      price: Number(r["price"]), promoId: r["promo_id"]!,
    };
    (salesByProduct.get(productId) ?? salesByProduct.set(productId, []).get(productId)!).push(row);

    const key = `${productsById.get(productId)?.category}|${storeRegion.get(row.storeId)}`;
    const series = weekly.get(key) ?? weekly.set(key, new Map()).get(key)!;
    const cell = series.get(row.date) ?? { units: 0, promoted: false };
    cell.units += row.units;
    if (row.promoId) cell.promoted = true;
    series.set(row.date, cell);
    weekSet.add(row.date);
  }
  return (cache = { products, productsById, stores, promos, salesByProduct, weekly, weeks: [...weekSet].sort() });
}

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------------------ uplift

/** Weekly units for a promo's scope (its category, in its region or all regions). */
function scopeSeries(ds: Dataset, p: Promotion): Map<string, Cell> {
  const regions = p.region === "all" ? REGIONS : [p.region];
  const out = new Map<string, Cell>();
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
 * Baseline = average of the last 4 CLEAN weeks (no promotion in the same category+region),
 * looking back up to 12 weeks. A naive "last 4 weeks" would include other promos (the clashes)
 * and understate the uplift.
 */
function computeUplift(ds: Dataset, p: Promotion): { uplift: number; incrementalUnits: number } | null {
  const series = scopeSeries(ds, p);
  const promoWeeks = ds.weeks.filter((w) => w <= p.end && addDays(w, 6) >= p.start);
  if (promoWeeks.length === 0) return null;

  const first = ds.weeks.indexOf(promoWeeks[0]!);
  const clean: number[] = [];
  for (let i = first - 1; i >= 0 && i >= first - 12; i--) {
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
      const m = computeUplift(ds, p);
      return m ? [{ ...p, ...m }] : [];
    })
    .sort((a, b) => b.uplift - a.uplift)
    .slice(0, limit);
}

// ------------------------------------------------------------- sales trend

/** Accepts a store ID ("S07") or a city name ("Sfax", case-insensitive). */
function resolveStore(ds: Dataset, input: string): Store {
  const q = input.trim().toLowerCase();
  const found = ds.stores.find((s) => s.storeId.toLowerCase() === q || s.city.toLowerCase() === q);
  if (!found) {
    const list = ds.stores.map((s) => `${s.storeId} ${s.city}`).join(", ");
    throw new UserError(`Unknown store "${input}". Valid stores: ${list}.`);
  }
  return found;
}

/** Weekly series for one product, for one store or (store omitted) summed over all stores. */
export function salesTrend(productId: string, store?: string) {
  const ds = load();
  const product = ds.productsById.get(productId);
  if (!product) throw new UserError(`Unknown product ${productId}. Call search_products first to find a valid product ID.`);
  const st = store === undefined ? undefined : resolveStore(ds, store);

  const byWeek = new Map<string, { units: number; revenue: number; promos: Map<string, number> }>();
  for (const row of ds.salesByProduct.get(productId) ?? []) {
    if (st && row.storeId !== st.storeId) continue;
    const w = byWeek.get(row.date) ?? { units: 0, revenue: 0, promos: new Map() };
    w.units += row.units;
    w.revenue += row.units * row.price;
    if (row.promoId) w.promos.set(row.promoId, (w.promos.get(row.promoId) ?? 0) + 1);
    byWeek.set(row.date, w);
  }

  const points: TrendPoint[] = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, w]) => ({
      week,
      units: w.units,
      price: Math.round((w.revenue / w.units) * 100) / 100, // units-weighted average price
      // if several stores run different promos, report the most widespread one
      promoId: [...w.promos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }));

  return { productId, productName: product.name, store: st ? st.city : "All stores", points };
}

// ---------------------------------------------------------- product search

/** Every word of the query must appear in the product's name or category (case-insensitive). */
export function searchProducts(query: string, category?: string, limit = 10): Product[] {
  const ds = load();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return ds.products
    .filter((p) => !category || p.category === category)
    .filter((p) => {
      const haystack = `${p.name} ${p.category}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    })
    .slice(0, limit);
}
