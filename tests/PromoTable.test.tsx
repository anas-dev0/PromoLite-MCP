// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PromoResult } from "../src/server/schemas.js";
import { PromoTable } from "../src/views/shared/components/PromoTable.js";

const row = (promoId: string, name: string, type: string, uplift: number, incrementalUnits: number): PromoResult => ({
  promoId, name, type, discountPct: 20, start: "2025-04-01", end: "2025-04-14", category: "Dairy", region: "all", uplift, incrementalUnits,
});
const ROWS = [
  row("PR1", "Alpha Deal", "percent_off", 0.5, 100),
  row("PR2", "Zulu Sale", "bogo", 1.2, 40),
  row("PR3", "Mango Offer", "bundle", 0.2, 900),
];

/** Names in the order the body rows are displayed. */
const order = () =>
  screen.getAllByRole("row").slice(1) // skip the header row
    .map((r) => within(r).getAllByRole("cell")[0]!.textContent!.replace(/PR\d$/, "").trim());

describe("<PromoTable />", () => {
  it("shows the best uplift first by default", () => {
    render(<PromoTable rows={ROWS} />);
    expect(order()).toEqual(["Zulu Sale", "Alpha Deal", "Mango Offer"]);
    expect(screen.getByRole("columnheader", { name: /uplift/i })).toHaveAttribute("aria-sort", "descending");
  });

  it("clicking the Uplift header flips the order, and clicking again flips it back", async () => {
    const user = userEvent.setup();
    render(<PromoTable rows={ROWS} />);
    await user.click(screen.getByRole("button", { name: /uplift/i }));
    expect(order()).toEqual(["Mango Offer", "Alpha Deal", "Zulu Sale"]);
    expect(screen.getByRole("columnheader", { name: /uplift/i })).toHaveAttribute("aria-sort", "ascending");
    await user.click(screen.getByRole("button", { name: /uplift/i }));
    expect(order()).toEqual(["Zulu Sale", "Alpha Deal", "Mango Offer"]);
  });

  it("a text column sorts A to Z first; a numeric column sorts highest first", async () => {
    const user = userEvent.setup();
    render(<PromoTable rows={ROWS} />);
    await user.click(screen.getByRole("button", { name: /^promotion/i }));
    expect(order()).toEqual(["Alpha Deal", "Mango Offer", "Zulu Sale"]);
    await user.click(screen.getByRole("button", { name: /extra units/i }));
    expect(order()).toEqual(["Mango Offer", "Alpha Deal", "Zulu Sale"]); // 900, 100, 40
  });

  it("only the active column is marked as sorted", async () => {
    const user = userEvent.setup();
    render(<PromoTable rows={ROWS} />);
    await user.click(screen.getByRole("button", { name: /^promotion/i }));
    const sorted = screen.getAllByRole("columnheader").filter((h) => h.getAttribute("aria-sort") !== "none");
    expect(sorted).toHaveLength(1);
    expect(sorted[0]).toHaveTextContent("Promotion");
  });

  it("formats uplift as a signed percentage, units with separators, and shows a type badge", () => {
    render(<PromoTable rows={ROWS} />);
    expect(screen.getByText("+120%")).toBeInTheDocument();
    expect(screen.getByText("900")).toBeInTheDocument();
    expect(screen.getByText("BOGO")).toBeInTheDocument();
    expect(screen.getByText("Bundle")).toBeInTheDocument();
    expect(screen.getByText("% off")).toBeInTheDocument();
  });

  it("shows negative uplift in the negative style", () => {
    render(<PromoTable rows={[row("PR9", "Flop", "percent_off", -0.1, -5)]} />);
    const cell = screen.getByText("-10%");
    expect(cell).toHaveClass("neg");
  });

  it("does not mutate the rows it was given when sorting", async () => {
    const user = userEvent.setup();
    const input = [...ROWS];
    render(<PromoTable rows={input} />);
    await user.click(screen.getByRole("button", { name: /^promotion/i }));
    expect(input.map((r) => r.promoId)).toEqual(["PR1", "PR2", "PR3"]);
  });

  it("shows an empty state instead of an empty table", () => {
    render(<PromoTable rows={[]} />);
    expect(screen.getByText("No promotions in this period.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
