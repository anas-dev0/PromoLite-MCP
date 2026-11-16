/**
 * Generates the synthetic PromoLite dataset (4 CSV files in ./data).
 *
 * Run:  npm run generate-data
 *
 * The output is 100% deterministic: a seeded random number generator is used
 * instead of Math.random(), so everyone who clones the repo gets identical CSVs.
 * No real client data is involved.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");

// ---------------------------------------------------------------- seeded RNG
// mulberry32: tiny, fast, good-enough PRNG. Same seed => same sequence.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261115);
const between = (min: number, max: number) => min + rand() * (max - min);

// ------------------------------------------------------------------- helpers
const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const date = (s: string) => new Date(`${s}T00:00:00Z`);
const round2 = (n: number) => Math.round(n * 100) / 100;

function toCsv(header: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n") + "\n";
}

// ------------------------------------------------------------------ products
type Category = "Dairy" | "Beverages" | "Pantry" | "Bakery" | "Snacks" | "Household";

const CATALOG: Record<Category, { names: string[]; price: [number, number] }> = {
  Dairy: {
    names: ["Whole Milk 1L", "Skim Milk 1L", "Plain Yogurt 4-pack", "Fruit Yogurt 4-pack", "Fresh Cheese 200g",
      "Feta 250g", "Butter 250g", "Cream 20cl", "Labneh 300g", "Chocolate Milk 50cl"],
    price: [1.2, 6.5],
  },
  Beverages: {
    names: ["Sparkling Water 1.5L", "Still Water 1.5L", "Orange Juice 1L", "Apple Juice 1L", "Cola 1L",
      "Lemon Soda 1L", "Iced Tea 50cl", "Energy Drink 25cl", "Mint Syrup 75cl", "Pomegranate Juice 1L"],
    price: [0.9, 5],
  },
  Pantry: {
    names: ["Olive Oil 1L", "Olive Oil 5L", "Harissa 380g", "Couscous 1kg", "Spaghetti 500g",
      "Tomato Paste 400g", "Tuna in Oil 160g", "Chickpeas 400g", "Sugar 1kg", "Dates 500g"],
    price: [1.5, 38],
  },
  Bakery: {
    names: ["Baguette", "Whole Wheat Loaf", "Croissant 4-pack", "Brioche", "Tabouna Bread",
      "Pita 6-pack", "Biscuits 300g", "Madeleines 250g", "Sponge Cake", "Makroud 500g"],
    price: [0.4, 9],
  },
  Snacks: {
    names: ["Potato Chips 150g", "Salted Peanuts 200g", "Sunflower Seeds 200g", "Chocolate Bar 100g",
      "Wafer Rolls 150g", "Popcorn 100g", "Cashews 150g", "Gummy Bears 200g", "Granola Bar 6-pack", "Dried Figs 250g"],
    price: [0.8, 8],
  },
  Household: {
    names: ["Dish Soap 750ml", "Laundry Powder 3kg", "Bleach 2L", "Paper Towels 4-roll", "Toilet Paper 12-roll",
      "Sponges 5-pack", "Trash Bags 30", "Glass Cleaner 500ml", "Fabric Softener 2L", "Air Freshener"],
    price: [1.5, 22],
  },
};

// Realistic fixed prices (TND) for items where a uniform random range gives nonsense
// (e.g. sugar costing more than 5L of olive oil).
const FIXED_PRICE: Record<string, number> = {
  "Olive Oil 1L": 17.5, "Olive Oil 5L": 80, "Harissa 380g": 2.9, "Couscous 1kg": 2.4, "Spaghetti 500g": 1.2,
  "Tomato Paste 400g": 2.1, "Tuna in Oil 160g": 4.2, "Chickpeas 400g": 1.9, "Sugar 1kg": 2.0, "Dates 500g": 9.5,
};

interface Product { id: string; name: string; category: Category; basePrice: number; popularity: number }

const products: Product[] = [];
let pn = 1;
for (const [category, { names, price }] of Object.entries(CATALOG) as [Category, (typeof CATALOG)[Category]][]) {
  for (const name of names) {
    const random = round2(between(price[0], price[1])); // always drawn, keeps the RNG sequence stable
    products.push({
      id: `P${String(pn++).padStart(3, "0")}`,
      name,
      category,
      basePrice: FIXED_PRICE[name] ?? random,
      popularity: between(6, 40), // average units/week in a size-1.0 store
    });
  }
}

// -------------------------------------------------------------------- stores
type Region = "North" | "Centre" | "South";
interface Store { id: string; city: string; region: Region; size: number }
const stores: Store[] = [
  { id: "S01", city: "Tunis", region: "North", size: 1.6 },
  { id: "S02", city: "Bizerte", region: "North", size: 0.8 },
  { id: "S03", city: "Nabeul", region: "North", size: 0.9 },
  { id: "S04", city: "Sousse", region: "Centre", size: 1.3 },
  { id: "S05", city: "Monastir", region: "Centre", size: 0.8 },
  { id: "S06", city: "Kairouan", region: "Centre", size: 0.7 },
  { id: "S07", city: "Sfax", region: "South", size: 1.4 },
  { id: "S08", city: "Gabes", region: "South", size: 0.7 },
];

// ---------------------------------------------------------------- promotions
type PromoType = "percent_off" | "bogo" | "bundle";
interface Promo {
  id: string; name: string; type: PromoType; discountPct: number;
  start: string; end: string; category: Category; region: Region | "all";
}

// Hand-placed so we control exactly where the clashes are. Starts are Mondays,
// ends are Sundays. Everything starts after week 5 so a 4-week baseline exists.
const P = (
  n: number, name: string, type: PromoType, discountPct: number,
  start: string, end: string, category: Category, region: Region | "all",
): Promo => ({ id: `PR${String(n).padStart(2, "0")}`, name, type, discountPct, start, end, category, region });

const promos: Promo[] = [
  P(1, "Winter Dairy Days", "percent_off", 15, "2025-02-10", "2025-02-23", "Dairy", "all"),
  P(2, "Spring Cleaning", "percent_off", 20, "2025-03-03", "2025-03-16", "Household", "all"),
  P(3, "Ramadan Pantry Basket", "bundle", 20, "2025-03-03", "2025-03-23", "Pantry", "all"),
  P(4, "Ramadan Drinks Offer", "percent_off", 25, "2025-03-10", "2025-03-23", "Beverages", "all"),
  P(5, "Eid Bakery Treats", "bogo", 50, "2025-03-24", "2025-03-30", "Bakery", "all"),
  P(6, "Snack Attack", "percent_off", 30, "2025-04-07", "2025-04-20", "Snacks", "North"),
  P(7, "Easter Break Chocolate", "percent_off", 20, "2025-04-14", "2025-04-27", "Snacks", "North"), // CLASH 1 (Snacks/North vs PR06)
  P(8, "Olive Harvest Special", "percent_off", 18, "2025-05-05", "2025-05-18", "Pantry", "South"),
  P(9, "Summer Fresh Dairy", "bogo", 50, "2025-06-02", "2025-06-15", "Dairy", "Centre"),
  P(10, "Dairy Mega Deal", "percent_off", 25, "2025-06-09", "2025-06-22", "Dairy", "all"), // CLASH 2 (Dairy/Centre vs PR09)
  P(11, "Summer Cooler Sale", "percent_off", 30, "2025-06-23", "2025-07-13", "Beverages", "all"),
  P(12, "Beach Pack Beverages", "bundle", 15, "2025-07-07", "2025-07-20", "Beverages", "South"), // CLASH 3 (Beverages/South vs PR11)
  P(13, "Bakery Weekend Bundle", "bundle", 15, "2025-07-28", "2025-08-10", "Bakery", "Centre"),
  P(14, "August Household Refresh", "percent_off", 15, "2025-08-04", "2025-08-17", "Household", "North"),
  P(15, "Back to School Snacks", "percent_off", 25, "2025-09-01", "2025-09-14", "Snacks", "all"),
  P(16, "School Lunch Bakery", "bogo", 50, "2025-09-08", "2025-09-21", "Bakery", "all"), // CLASH 4 (Bakery: PR16 x PR17)
  P(17, "Bakery Rentree Deal", "percent_off", 20, "2025-09-15", "2025-09-28", "Bakery", "North"),
  P(18, "Autumn Pantry Stock-up", "percent_off", 15, "2025-10-06", "2025-10-19", "Pantry", "all"),
  P(19, "Olive Oil Festival", "percent_off", 22, "2025-10-13", "2025-10-26", "Pantry", "Centre"), // CLASH 5 (Pantry/Centre vs PR18)
  P(20, "Fresh Start Household", "bundle", 20, "2025-11-03", "2025-11-16", "Household", "all"),
  P(21, "Black Friday Beverages", "percent_off", 30, "2025-11-24", "2025-11-30", "Beverages", "all"),
  P(22, "Black Friday Snacks", "percent_off", 35, "2025-11-24", "2025-11-30", "Snacks", "all"),
  P(23, "Winter Warmers Dairy", "percent_off", 12, "2025-12-01", "2025-12-14", "Dairy", "North"),
  P(24, "Holiday Bakery Box", "bundle", 25, "2025-12-15", "2025-12-28", "Bakery", "all"),
  P(25, "New Year Pantry", "percent_off", 18, "2025-12-15", "2025-12-28", "Pantry", "South"),
];

// Unit boost grows with discount depth: boost = 1 + discount/100 * k, k random per promo.
// 12% off => ~x1.3, 35% off => ~x1.9, BOGO (listed as 50) => ~x2.1.
const promoBoost = new Map<string, number>();
for (const p of promos) {
  const k = p.type === "bogo" ? between(2.0, 2.4) : between(2.4, 3.0);
  promoBoost.set(p.id, round2(1 + (p.discountPct / 100) * k));
}

const overlaps = (a: Promo, b: Promo) => a.start <= b.end && b.start <= a.end;
const regionsOverlap = (a: Promo, b: Promo) => a.region === "all" || b.region === "all" || a.region === b.region;

function findClashes(): [Promo, Promo][] {
  const out: [Promo, Promo][] = [];
  for (let i = 0; i < promos.length; i++)
    for (let j = i + 1; j < promos.length; j++) {
      const a = promos[i]!, b = promos[j]!;
      if (a.category === b.category && overlaps(a, b) && regionsOverlap(a, b)) out.push([a, b]);
    }
  return out;
}

// ------------------------------------------------------------------ seasonality
// Weekly multiplier per category. Year 2025: Ramadan ~Mar 1-30, back to school
// mid-September, end-of-year shopping in December.
function seasonal(category: Category, weekStart: string): number {
  let m = 1;
  if (weekStart >= "2025-02-24" && weekStart <= "2025-03-24") {
    m *= { Dairy: 1.25, Beverages: 1.3, Pantry: 1.35, Bakery: 1.2, Snacks: 1.0, Household: 1.1 }[category];
  }
  if (weekStart >= "2025-08-25" && weekStart <= "2025-09-22") {
    m *= { Dairy: 1.05, Beverages: 1.0, Pantry: 1.0, Bakery: 1.15, Snacks: 1.3, Household: 1.1 }[category];
  }
  if (weekStart >= "2025-12-01") m *= 1.15;
  if (weekStart >= "2025-07-01" && weekStart <= "2025-08-24" && category === "Beverages") m *= 1.3; // summer
  return m;
}

// --------------------------------------------------------------------- sales
const WEEKS = 52;
const FIRST_WEEK = date("2025-01-06"); // a Monday

function activePromo(p: Product, s: Store, weekStart: string, weekEnd: string): Promo | undefined {
  const active = promos.filter(
    (pr) => pr.category === p.category && (pr.region === "all" || pr.region === s.region) &&
      pr.start <= weekEnd && pr.end >= weekStart,
  );
  // On a clash the deepest discount wins the price; the shopper only gets one.
  return active.sort((a, b) => b.discountPct - a.discountPct)[0];
}

function wasPromoLastWeek(p: Product, s: Store, weekStart: string): boolean {
  const prevEnd = iso(addDays(date(weekStart), -1));
  const prevStart = iso(addDays(date(weekStart), -7));
  return activePromo(p, s, prevStart, prevEnd) !== undefined;
}

const salesRows: (string | number)[][] = [];
for (let w = 0; w < WEEKS; w++) {
  const weekStart = iso(addDays(FIRST_WEEK, w * 7));
  const weekEnd = iso(addDays(FIRST_WEEK, w * 7 + 6));
  for (const product of products) {
    for (const store of stores) {
      const promo = activePromo(product, store, weekStart, weekEnd);
      let units = product.popularity * store.size * seasonal(product.category, weekStart) * between(0.9, 1.1);
      let price = product.basePrice;
      if (promo) {
        units *= promoBoost.get(promo.id)! * between(0.93, 1.07);
        price = product.basePrice * (promo.type === "bogo" ? 0.75 : 1 - promo.discountPct / 100);
      } else if (wasPromoLastWeek(product, store, weekStart)) {
        units *= between(0.8, 0.92); // post-promo dip: shoppers already stocked up
      }
      salesRows.push([weekStart, product.id, store.id, Math.max(0, Math.round(units)), round2(price), promo?.id ?? ""]);
    }
  }
}

// --------------------------------------------------------------------- write
mkdirSync(DATA_DIR, { recursive: true });
const write = (file: string, csv: string) => writeFileSync(path.join(DATA_DIR, file), csv, "utf8");

write("products.csv", toCsv(["product_id", "name", "category", "base_price"],
  products.map((p) => [p.id, p.name, p.category, p.basePrice])));
write("stores.csv", toCsv(["store_id", "city", "region"], stores.map((s) => [s.id, s.city, s.region])));
write("sales.csv", toCsv(["date", "product_id", "store_id", "units", "price", "promo_id"], salesRows));
write("promotions.csv", toCsv(
  ["promo_id", "name", "type", "discount_pct", "start", "end", "category", "region"],
  promos.map((p) => [p.id, p.name, p.type, p.discountPct, p.start, p.end, p.category, p.region])));

// -------------------------------------------------------------------- report
const clashes = findClashes();
console.error(`products.csv    ${products.length} rows`);
console.error(`stores.csv      ${stores.length} rows`);
console.error(`sales.csv       ${salesRows.length} rows`);
console.error(`promotions.csv  ${promos.length} rows`);
console.error(`\nClashes (same category + overlapping dates + overlapping region): ${clashes.length}`);
for (const [a, b] of clashes) console.error(`  ${a.id} "${a.name}"  x  ${b.id} "${b.name}"  [${a.category}]`);
