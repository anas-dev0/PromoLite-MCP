// @vitest-environment jsdom
/**
 * jsdom has no layout engine, so recharts cannot measure its container and draws no pixels here. We therefore do NOT test
 * the drawing. We test what we own: the toggle (view state), the empty state, and the data-shaping helpers.
 */
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { TrendPoint } from "../src/server/schemas.js";
import { TrendChart } from "../src/views/shared/components/TrendChart.js";

const points: TrendPoint[] = [
  { week: "2025-01-06", units: 50, price: 2, promoId: null, promoName: null },
  { week: "2025-01-13", units: 80, price: 1.5, promoId: "PR1", promoName: "Mid Jan" },
  { week: "2025-01-20", units: 55, price: 2, promoId: null, promoName: null },
];

describe("<TrendChart />", () => {
  it("starts on Units, and the legend says what the line shows", () => {
    render(<TrendChart points={points} />);
    expect(screen.getByRole("button", { name: "Units" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Revenue" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Units per week")).toBeInTheDocument();
  });

  it("the Units/Revenue toggle switches the series and the legend, with no server involved", async () => {
    const user = userEvent.setup();
    render(<TrendChart points={points} />);
    await user.click(screen.getByRole("button", { name: "Revenue" }));
    expect(screen.getByRole("button", { name: "Revenue" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Units" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Revenue per week (TND)")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName(/Revenue per week/);

    await user.click(screen.getByRole("button", { name: "Units" }));
    expect(screen.getByText("Units per week")).toBeInTheDocument();
  });

  it("explains the shaded band in the legend and describes the chart for screen readers", () => {
    render(<TrendChart points={points} />);
    expect(screen.getByText("Promotion week")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName("Units per week over 3 weeks, promotion weeks shaded");
  });

  it("gives the chart a fixed height (a responsive chart inside an iframe with no height would be 0px tall)", () => {
    const { container } = render(<TrendChart points={points} />);
    expect(container.querySelector(".chart-box")).toBeInTheDocument(); // .chart-box has height: 320px in styles.css
  });

  it("shows an empty state, and no toggle, when there is no data", () => {
    render(<TrendChart points={[]} />);
    expect(screen.getByText("No sales data for this selection.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revenue" })).not.toBeInTheDocument();
  });
});
