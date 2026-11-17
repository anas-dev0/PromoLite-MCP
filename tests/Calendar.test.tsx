// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CalendarPromo, PromoCalendarOutput } from "../src/server/schemas.js";
import { PromoCalendar } from "../src/views/shared/components/PromoCalendar.js";

const promo = (promoId: string, name: string, category: string, region: string, start: string, end: string, type = "percent_off"): CalendarPromo => ({
  promoId, name, type, discountPct: 25, start, end, category, region,
});

// June 2025: Alpha (Dairy, all) and Bravo (Dairy, Centre) overlap on Jun 9-15; Charlie (Beverages) is alone.
const DATA: PromoCalendarOutput = {
  from: "2025-06-01",
  to: "2025-06-30",
  category: null,
  promotions: [
    promo("PR1", "Alpha", "Dairy", "all", "2025-06-02", "2025-06-15", "bogo"),
    promo("PR2", "Bravo", "Dairy", "Centre", "2025-06-09", "2025-06-22"),
    promo("PR3", "Charlie", "Beverages", "all", "2025-06-23", "2025-06-30", "bundle"),
  ],
  clashes: [
    { a: "PR1", b: "PR2", aName: "Alpha", bName: "Bravo", category: "Dairy", region: "Centre", overlapStart: "2025-06-09", overlapEnd: "2025-06-15", overlapDays: 7 },
  ],
};

const bar = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name},`) });

describe("<PromoCalendar />", () => {
  it("summarises the period: how many promotions and how many clashes", () => {
    render(<PromoCalendar data={DATA} />);
    expect(screen.getByText(/3 promotions,/)).toBeInTheDocument();
    expect(screen.getByText("1 clash")).toBeInTheDocument();
  });

  it("marks the two clashing promotions, and not the third", () => {
    render(<PromoCalendar data={DATA} />);
    expect(bar("Alpha")).toHaveClass("is-clash");
    expect(bar("Bravo")).toHaveClass("is-clash");
    expect(bar("Charlie")).not.toHaveClass("is-clash");
  });

  it("never signals a clash by colour alone: icon + accessible label + shaded overlap", () => {
    const { container } = render(<PromoCalendar data={DATA} />);
    expect(within(bar("Alpha")).getByText("⚠")).toBeInTheDocument(); // the icon
    expect(bar("Alpha")).toHaveAccessibleName(/Clashes with Bravo/); // what a screen reader announces
    expect(bar("Charlie")).not.toHaveAccessibleName(/Clashes with/);
    expect(container.querySelectorAll(".clash-band")).toHaveLength(1); // the overlapping days are shaded
  });

  it("draws one block per category that has promotions, with overlapping bars on separate rows", () => {
    const { container } = render(<PromoCalendar data={DATA} />);
    expect([...container.querySelectorAll(".cal-label")].map((l) => l.textContent)).toEqual(["Dairy", "Beverages"]);
    expect((bar("Alpha") as HTMLElement).style.gridRow).not.toBe((bar("Bravo") as HTMLElement).style.gridRow);
  });

  it("'Clashes only' hides the promotion that does not clash, and shows it again when toggled off", async () => {
    const user = userEvent.setup();
    render(<PromoCalendar data={DATA} />);
    const toggle = screen.getByRole("button", { name: /clashes only/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /^Charlie,/ })).not.toBeInTheDocument();
    expect(bar("Alpha")).toBeInTheDocument();
    expect(bar("Bravo")).toBeInTheDocument();

    await user.click(toggle);
    expect(bar("Charlie")).toBeInTheDocument();
  });

  it("clicking a bar opens a detail card naming the clash partner and the overlap; clicking again closes it", async () => {
    const user = userEvent.setup();
    render(<PromoCalendar data={DATA} />);
    await user.click(bar("Bravo"));
    expect(bar("Bravo")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Clashes with/)).toBeInTheDocument();
    expect(screen.getByText("Alpha", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/for 7 days/)).toBeInTheDocument();
    await user.click(bar("Bravo"));
    expect(screen.queryByText(/Clashes with/)).not.toBeInTheDocument();
  });

  it("the detail card of a promotion without a clash says so", async () => {
    const user = userEvent.setup();
    render(<PromoCalendar data={DATA} />);
    await user.click(bar("Charlie"));
    expect(screen.getByText("No clash in this period.")).toBeInTheDocument();
  });

  it("shows Prev/Next only when the wrapper provides onNavigate, and reports the direction", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PromoCalendar data={DATA} />);
    expect(screen.queryByRole("button", { name: /next month/i })).not.toBeInTheDocument();

    const onNavigate = vi.fn();
    rerender(<PromoCalendar data={DATA} onNavigate={onNavigate} />);
    await user.click(screen.getByRole("button", { name: /next month/i }));
    await user.click(screen.getByRole("button", { name: /previous month/i }));
    expect(onNavigate.mock.calls).toEqual([[1], [-1]]);
    expect(screen.getByText("June 2025")).toBeInTheDocument();
  });

  it("disables navigation while a month is loading, and shows a navigation error", () => {
    render(<PromoCalendar data={DATA} onNavigate={() => {}} navigating navError="Could not load that month: boom" />);
    expect(screen.getByRole("button", { name: /next month/i })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load that month: boom");
  });

  it("shows an empty state when there are no promotions, and a different one when there are no clashes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PromoCalendar data={{ ...DATA, promotions: [], clashes: [] }} />);
    expect(screen.getByText("No promotions in this period.")).toBeInTheDocument();

    rerender(<PromoCalendar data={{ ...DATA, promotions: [DATA.promotions[2]!], clashes: [] }} />);
    expect(screen.getByText("0 clashes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /clashes only/i }));
    expect(screen.getByText("No clashes in this period.")).toBeInTheDocument();
  });

  it("switches to week columns for a long period (a whole year)", () => {
    const { container } = render(<PromoCalendar data={{ ...DATA, from: "2025-01-01", to: "2025-12-31" }} />);
    expect(container.querySelector(".cal")!.getAttribute("style")).toContain("--cols: 53");
  });
});
