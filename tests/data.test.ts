/**
 * Data-layer tests (the base of the pyramid: many, fast, no protocol, no DOM).
 *
 * They run on tiny hand-made CSVs in tests/fixtures/mini, built so every expected number can be checked by hand:
 *   - 14 weeks (2025-01-06 .. 2025-04-07), product P1 only, 2 stores (S1 Tunis/North, S2 Sfax/South), 50 units/store/week
 *   - PR1 (Dairy, all)   week 02-10: 75 units/store           -> 150 vs baseline 100  = +50%
 *   - PR2 (Dairy, North) week 03-03: 90 units in S1           ->  90 vs baseline  50  = +80%
 *   - PR3 (Dairy, all)   week 03-17: 100 units/store          -> 200 vs baseline 100  = +100%  (baseline must SKIP the weeks of PR1 and PR2)
 *   - PR4: dated 2026, no sales rows at all  -> no uplift
 *   - PR5: week 01-06, the very first week   -> no history -> no uplift
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CalendarPromo } from "../src/server/schemas.js";
import { createDataStore, defaultStore, findClashes, UserError } from "../src/server/data.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/mini");
const store = createDataStore(FIXTURES);

const promo = (promoId: string, category: string, region: string, start: string, end: string): CalendarPromo => ({
  promoId, name: `Promo ${promoId}`, type: "percent_off", discountPct: 20, start, end, category, region,
});

describe("topPromotions (uplift)", () => {
  const all = store.topPromotions("2025-01-01", "2025-12-31", 10);

  it("ranks promotions by uplift, highest first", () => {
    expect(all.map((p) => p.promoId)).toEqual(["PR3", "PR2", "PR1"]);
  });

  it("computes exactly +50% for PR1 (150 units vs a baseline of 100)", () => {
    const pr1 = all.find((p) => p.promoId === "PR1")!;
    expect(pr1.uplift).toBeCloseTo(0.5, 10);
    expect(pr1.incrementalUnits).toBe(50);
  });

  it("scopes a regional promotion to its region (PR2 North only: 90 vs 50 = +80%)", () => {
    const pr2 = all.find((p) => p.promoId === "PR2")!;
    expect(pr2.uplift).toBeCloseTo(0.8, 10);
    expect(pr2.incrementalUnits).toBe(40);
  });

  it("builds the baseline from CLEAN weeks only (PR3 is exactly +100%, a naive 4-week baseline would give +81.8%)", () => {
    // The 4 weeks right before PR3 are 03-10, 03-03 (PR2 ran: 140 units), 02-24, 02-17. A naive average is 110.
    // The clean baseline skips 03-03 and 02-10 and uses 03-10, 02-24, 02-17, 02-03 = 100 each.
    const pr3 = all.find((p) => p.promoId === "PR3")!;
    expect(pr3.uplift).toBeCloseTo(1.0, 10);
    expect(pr3.incrementalUnits).toBe(100);
  });

  it("skips a promotion that has no sales data (PR4, dated 2026)", () => {
    expect(all.some((p) => p.promoId === "PR4")).toBe(false);
  });

  it("skips a promotion with no clean history before it (PR5 is the very first week)", () => {
    expect(all.some((p) => p.promoId === "PR5")).toBe(false);
  });

  it("returns [] for a period with no promotions", () => {
    expect(store.topPromotions("2024-01-01", "2024-12-31", 10)).toEqual([]);
  });

  it("only returns promotions that overlap the period", () => {
    expect(store.topPromotions("2025-03-01", "2025-03-10", 10).map((p) => p.promoId)).toEqual(["PR2"]);
  });

  it("treats the period end as inclusive (a one-day period on PR1's last day finds it)", () => {
    expect(store.topPromotions("2025-02-16", "2025-02-16", 10).map((p) => p.promoId)).toEqual(["PR1"]);
  });

  it("honours the limit", () => {
    expect(store.topPromotions("2025-01-01", "2025-12-31", 2).map((p) => p.promoId)).toEqual(["PR3", "PR2"]);
  });
});

describe("salesTrend", () => {
  it("returns one point per week, summed over all stores", () => {
    const t = store.salesTrend("P1");
    expect(t.store).toBe("All stores");
    expect(t.productName).toBe("Test Milk");
    expect(t.points).toHaveLength(14);
    expect(t.points[0]!.week).toBe("2025-01-06");
  });

  it("marks promotion weeks with the promo id and name", () => {
    const week = store.salesTrend("P1").points.find((p) => p.week === "2025-02-10")!;
    expect(week).toMatchObject({ units: 150, price: 1.6, promoId: "PR1", promoName: "Mid Feb" });
  });

  it("uses a units-weighted average price when only some stores are on promotion", () => {
    // 03-03: S1 sold 90 @ 1.60 (PR2), S2 sold 50 @ 2.00 -> (144 + 100) / 140 = 1.7428...
    const week = store.salesTrend("P1").points.find((p) => p.week === "2025-03-03")!;
    expect(week.units).toBe(140);
    expect(week.price).toBe(1.74);
    expect(week.promoId).toBe("PR2");
  });

  it("accepts a city name or a store id, case-insensitively, and filters to that store", () => {
    const byCity = store.salesTrend("P1", "sfax");
    const byId = store.salesTrend("P1", "S2");
    expect(byCity).toEqual(byId);
    expect(byCity.store).toBe("Sfax");
    expect(byCity.points.find((p) => p.week === "2025-03-03")).toMatchObject({ units: 50, promoId: null });
  });

  it("throws a helpful UserError for an unknown product", () => {
    expect(() => store.salesTrend("P999")).toThrow(UserError);
    expect(() => store.salesTrend("P999")).toThrow(/search_products/);
  });

  it("throws a UserError listing the valid stores for an unknown store", () => {
    expect(() => store.salesTrend("P1", "Paris")).toThrow(/Valid stores: S1 Tunis, S2 Sfax/);
  });

  it("returns an empty series (not an error) for a product that has no sales", () => {
    expect(store.salesTrend("P3").points).toEqual([]);
  });
});

describe("searchProducts", () => {
  it("requires every word to match the name or the category", () => {
    expect(store.searchProducts("test milk").map((p) => p.productId)).toEqual(["P1"]);
    expect(store.searchProducts("dairy").map((p) => p.productId)).toEqual(["P1", "P3"]);
    expect(store.searchProducts("milk olive")).toEqual([]);
  });

  it("is case-insensitive and ignores extra spaces", () => {
    expect(store.searchProducts("  OLIVE   oil ").map((p) => p.productId)).toEqual(["P2"]);
  });

  it("filters by category and honours the limit", () => {
    expect(store.searchProducts("test", "Pantry").map((p) => p.productId)).toEqual(["P2"]);
    expect(store.searchProducts("test", undefined, 1)).toHaveLength(1);
  });

  it("an empty query browses the catalogue, and the page reports the total", () => {
    const page = store.searchProductsPage("", undefined, 2);
    expect(page.products).toHaveLength(2);
    expect(page.total).toBe(3);
  });
});

describe("stores and the calendar", () => {
  it("listStores returns copies, so callers cannot corrupt the cache", () => {
    const first = store.listStores();
    first[0]!.city = "HACKED";
    expect(store.listStores()[0]!.city).toBe("Tunis");
  });

  it("promoCalendar returns the promotions that overlap the period, ordered by start date", () => {
    expect(store.promoCalendar("2025-02-01", "2025-03-31").map((p) => p.promoId)).toEqual(["PR1", "PR2", "PR3"]);
  });

  it("promoCalendar can be restricted to a category", () => {
    expect(store.promoCalendar("2025-01-01", "2025-12-31", "Pantry")).toEqual([]);
    // PR1, PR2, PR3, PR5 are in 2025; PR4 is dated 2026 so it is outside the period
    expect(store.promoCalendar("2025-01-01", "2025-12-31", "Dairy").map((p) => p.promoId)).toEqual(["PR5", "PR1", "PR2", "PR3"]);
  });
});

describe("findClashes", () => {
  it("two overlapping promotions on the same category are one clash, with the overlap dates", () => {
    const [c, ...rest] = findClashes([
      promo("A", "Dairy", "all", "2025-03-01", "2025-03-10"),
      promo("B", "Dairy", "all", "2025-03-08", "2025-03-20"),
    ]);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ a: "A", b: "B", category: "Dairy", overlapStart: "2025-03-08", overlapEnd: "2025-03-10", overlapDays: 3 });
  });

  it("same dates but different categories do not clash", () => {
    expect(findClashes([
      promo("A", "Dairy", "all", "2025-03-01", "2025-03-10"),
      promo("B", "Snacks", "all", "2025-03-01", "2025-03-10"),
    ])).toEqual([]);
  });

  it("ranges that touch on a single day are a clash of 1 day (dates are inclusive)", () => {
    const clashes = findClashes([
      promo("A", "Dairy", "all", "2025-03-01", "2025-03-10"),
      promo("B", "Dairy", "all", "2025-03-10", "2025-03-15"),
    ]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ overlapStart: "2025-03-10", overlapEnd: "2025-03-10", overlapDays: 1 });
  });

  it("back-to-back ranges (one ends the day before the other starts) do not clash", () => {
    expect(findClashes([
      promo("A", "Dairy", "all", "2025-03-01", "2025-03-09"),
      promo("B", "Dairy", "all", "2025-03-10", "2025-03-15"),
    ])).toEqual([]);
  });

  it('region "all" against a specific region is a clash, reported in the narrower region', () => {
    const [c] = findClashes([
      promo("A", "Dairy", "all", "2025-03-01", "2025-03-10"),
      promo("B", "Dairy", "Centre", "2025-03-05", "2025-03-12"),
    ]);
    expect(c!.region).toBe("Centre");
    // ...and the order of the two promotions does not matter
    expect(findClashes([
      promo("B", "Dairy", "Centre", "2025-03-05", "2025-03-12"),
      promo("A", "Dairy", "all", "2025-03-01", "2025-03-10"),
    ])[0]!.region).toBe("Centre");
  });

  it('two "all" promotions clash in "all"; two different regions do not clash', () => {
    expect(findClashes([
      promo("A", "Dairy", "all", "2025-03-01", "2025-03-10"),
      promo("B", "Dairy", "all", "2025-03-05", "2025-03-12"),
    ])[0]!.region).toBe("all");
    expect(findClashes([
      promo("A", "Dairy", "North", "2025-03-01", "2025-03-10"),
      promo("B", "Dairy", "South", "2025-03-01", "2025-03-10"),
    ])).toEqual([]);
  });

  it("a promotion fully inside another overlaps for its whole length", () => {
    const [c] = findClashes([
      promo("A", "Dairy", "all", "2025-03-01", "2025-03-31"),
      promo("B", "Dairy", "all", "2025-03-10", "2025-03-12"),
    ]);
    expect(c!.overlapDays).toBe(3);
  });

  it("returns clashes ordered by when they start", () => {
    const clashes = findClashes([
      promo("L1", "Snacks", "all", "2025-06-01", "2025-06-10"),
      promo("L2", "Snacks", "all", "2025-06-05", "2025-06-15"),
      promo("E1", "Dairy", "all", "2025-02-01", "2025-02-10"),
      promo("E2", "Dairy", "all", "2025-02-05", "2025-02-15"),
    ]);
    expect(clashes.map((c) => c.a)).toEqual(["E1", "L1"]);
  });

  it("the fixture promotions have no clashes with each other", () => {
    expect(findClashes(store.promoCalendar("2025-01-01", "2025-12-31"))).toEqual([]);
  });
});

describe("the real dataset (sanity checks on ./data)", () => {
  it("has the expected size", () => {
    expect(defaultStore.searchProductsPage("", undefined, 50).total).toBe(60);
    expect(defaultStore.listStores()).toHaveLength(8);
    expect(defaultStore.promoCalendar("2025-01-01", "2025-12-31")).toHaveLength(25);
  });

  it("contains exactly the 5 deliberate clashes", () => {
    const pairs = findClashes(defaultStore.promoCalendar("2025-01-01", "2025-12-31")).map((c) => `${c.a}x${c.b}`);
    expect(pairs.sort()).toEqual(["PR06xPR07", "PR09xPR10", "PR11xPR12", "PR16xPR17", "PR18xPR19"]);
  });

  it("March has no clashes (so a 'clashes in March' demo would find none)", () => {
    expect(findClashes(defaultStore.promoCalendar("2025-03-01", "2025-03-31"))).toEqual([]);
  });

  it("ranks Summer Fresh Dairy first in Q2 with a believable uplift", () => {
    const [best] = defaultStore.topPromotions("2025-04-01", "2025-06-30", 5);
    expect(best!.promoId).toBe("PR09");
    expect(best!.uplift).toBeGreaterThan(1.0);
    expect(best!.uplift).toBeLessThan(1.3);
  });
});
