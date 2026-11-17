/** The calendar's layout maths (dates -> grid columns and lanes). Pure functions, so they are tested without a browser. */
import { describe, expect, it } from "vitest";
import type { CalendarPromo } from "../src/server/schemas.js";
import {
  addDays, assignLanes, buildColumns, clashesOf, columnOf, diffDays, monthGroups, monthRange, periodLabel, spanOf,
} from "../src/views/shared/calendarLayout.js";

const promo = (promoId: string, start: string, end: string): CalendarPromo => ({
  promoId, name: promoId, type: "percent_off", discountPct: 10, start, end, category: "Dairy", region: "all",
});

describe("date arithmetic (UTC, no timezone or daylight-saving drift)", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2025-01-31", 1)).toBe("2025-02-01");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // leap year
  });
  it("counts days between dates, across the March daylight-saving change", () => {
    expect(diffDays("2025-03-01", "2025-03-31")).toBe(30);
    expect(diffDays("2025-03-28", "2025-04-02")).toBe(5);
  });
});

describe("buildColumns", () => {
  it("one column per day for a month", () => {
    const c = buildColumns("2025-06-01", "2025-06-30");
    expect(c).toMatchObject({ unit: 1, count: 30 });
    expect(c.starts[0]).toBe("2025-06-01");
    expect(c.starts[29]).toBe("2025-06-30");
  });
  it("switches to one column per week above ~2 months", () => {
    expect(buildColumns("2025-01-01", "2025-12-31")).toMatchObject({ unit: 7, count: 53 });
    expect(buildColumns("2025-01-01", "2025-03-03").unit).toBe(1); // 62 days: still daily
    expect(buildColumns("2025-01-01", "2025-03-04").unit).toBe(7); // 63 days
  });
});

describe("columnOf / spanOf", () => {
  const cols = buildColumns("2025-06-01", "2025-06-30");
  it("maps a date to its column", () => {
    expect(columnOf("2025-06-01", "2025-06-01", cols)).toBe(0);
    expect(columnOf("2025-06-15", "2025-06-01", cols)).toBe(14);
  });
  it("clips dates outside the period (a promo that started in May still starts at column 0)", () => {
    expect(columnOf("2025-05-20", "2025-06-01", cols)).toBe(0);
    expect(columnOf("2025-07-13", "2025-06-01", cols)).toBe(29);
    expect(spanOf("2025-06-23", "2025-07-13", "2025-06-01", cols)).toEqual([22, 29]);
  });
  it("in week mode, a date maps to its week's column", () => {
    const weeks = buildColumns("2025-01-01", "2025-12-31");
    expect(columnOf("2025-01-07", "2025-01-01", weeks)).toBe(0);
    expect(columnOf("2025-01-08", "2025-01-01", weeks)).toBe(1);
  });
});

describe("assignLanes (overlapping promotions must not be drawn on top of each other)", () => {
  const cols = buildColumns("2025-06-01", "2025-06-30");
  it("puts overlapping promotions in different lanes and reuses a free lane afterwards", () => {
    const { lanes, count } = assignLanes(
      [promo("A", "2025-06-02", "2025-06-15"), promo("B", "2025-06-09", "2025-06-22"), promo("C", "2025-06-23", "2025-06-30")],
      "2025-06-01", cols,
    );
    expect(lanes.get("A")).toBe(0);
    expect(lanes.get("B")).toBe(1);
    expect(lanes.get("C")).toBe(0); // lane 0 is free again after A ended
    expect(count).toBe(2);
  });
  it("one lane is enough when nothing overlaps; an empty list still has one lane", () => {
    expect(assignLanes([promo("A", "2025-06-01", "2025-06-05"), promo("B", "2025-06-06", "2025-06-10")], "2025-06-01", cols).count).toBe(1);
    expect(assignLanes([], "2025-06-01", cols).count).toBe(1);
  });
  it("two promotions touching on one day still need two lanes", () => {
    expect(assignLanes([promo("A", "2025-06-01", "2025-06-10"), promo("B", "2025-06-10", "2025-06-20")], "2025-06-01", cols).count).toBe(2);
  });
});

describe("month helpers", () => {
  it("monthRange gives the whole month, and rolls over the year", () => {
    expect(monthRange("2025-06-17", 0)).toEqual({ from: "2025-06-01", to: "2025-06-30" });
    expect(monthRange("2025-06-17", 1)).toEqual({ from: "2025-07-01", to: "2025-07-31" });
    expect(monthRange("2025-12-05", 1)).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(monthRange("2025-01-05", -1)).toEqual({ from: "2024-12-01", to: "2024-12-31" });
  });
  it("monthRange knows February (leap and non-leap)", () => {
    expect(monthRange("2025-02-10", 0).to).toBe("2025-02-28");
    expect(monthRange("2024-02-10", 0).to).toBe("2024-02-29");
  });
  it("periodLabel prints a month name for a full month, otherwise the raw range", () => {
    expect(periodLabel("2025-06-01", "2025-06-30")).toBe("June 2025");
    expect(periodLabel("2025-06-02", "2025-06-30")).toBe("2025-06-02 → 2025-06-30");
    expect(periodLabel("2025-01-01", "2025-12-31")).toBe("2025-01-01 → 2025-12-31");
  });
  it("monthGroups groups the header columns by month", () => {
    const groups = monthGroups(buildColumns("2025-06-25", "2025-07-05"));
    expect(groups).toEqual([{ label: "Jun 2025", span: 6 }, { label: "Jul 2025", span: 5 }]);
  });
});

describe("clashesOf", () => {
  it("returns the clashes that involve a promotion, on either side", () => {
    const clashes = [
      { a: "A", b: "B" }, { a: "C", b: "A" }, { a: "D", b: "E" },
    ] as Parameters<typeof clashesOf>[1];
    expect(clashesOf("A", clashes)).toHaveLength(2);
    expect(clashesOf("E", clashes)).toHaveLength(1);
    expect(clashesOf("Z", clashes)).toHaveLength(0);
  });
});
