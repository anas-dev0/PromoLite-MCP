/** Pure logic used by the views: no React, no DOM, no MCP. These are the cheapest view tests. */
import { describe, expect, it, vi } from "vitest";
import { PickProductsInput, SalesTrendInput, SearchProductsUiInput, TopPromotionsInput } from "../src/server/schemas.js";
import { formatNumber, formatPct, formatWeek } from "../src/views/shared/format.js";
import { handBack, type HandBackApp } from "../src/views/shared/handBack.js";
import { buildSelectionMessage } from "../src/views/shared/selection.js";

const milk = { productId: "P001", name: "Whole Milk 1L", category: "Dairy", basePrice: 2.65 };
const oil = { productId: "P021", name: "Olive Oil 1L", category: "Pantry", basePrice: 17.5 };
const sfax = { storeId: "S07", city: "Sfax", region: "South" };
const tunis = { storeId: "S01", city: "Tunis", region: "North" };

describe("format helpers", () => {
  it("formatPct always shows the sign, and never prints '+-'", () => {
    expect(formatPct(0.6)).toBe("+60%");
    expect(formatPct(0)).toBe("+0%");
    expect(formatPct(-0.05)).toBe("-5%");
    expect(formatPct(1.116)).toBe("+112%");
  });

  it("formatNumber groups thousands", () => {
    expect(formatNumber(4678)).toBe("4,678");
    expect(formatNumber(12)).toBe("12");
  });

  it("formatWeek prints a short date and never shifts by the viewer's timezone", () => {
    expect(formatWeek("2025-03-10")).toBe("Mar 10");
    expect(formatWeek("2025-01-01")).toBe("Jan 1");
  });
});

describe("buildSelectionMessage (what the picker says to the conversation)", () => {
  it("always includes the exact product IDs and store IDs", () => {
    const text = buildSelectionMessage([oil], [sfax]);
    expect(text).toContain("P021");
    expect(text).toContain("Sfax (S07)");
  });

  it("uses plural wording for several products and stores", () => {
    const text = buildSelectionMessage([milk, oil], [sfax, tunis]);
    expect(text).toContain("each of these products");
    expect(text).toContain("Whole Milk 1L (P001), Olive Oil 1L (P021)");
    expect(text).toContain("Stores: Sfax (S07), Tunis (S01)");
  });

  it("says 'all stores' when no store is selected", () => {
    expect(buildSelectionMessage([milk], [])).toContain("Store: all stores");
  });
});

describe("handBack (sendMessage vs updateModelContext vs nothing)", () => {
  /** A fake App with only the three methods handBack uses, as spies we can inspect. */
  const makeApp = (caps: object | undefined, isError = false) => {
    const sendMessage = vi.fn(async (_params: { role: "user"; content: { type: string; text?: string }[] }) => ({ isError }));
    const updateModelContext = vi.fn(async (_params: { content?: { type: string; text?: string }[]; structuredContent?: Record<string, unknown> }) => ({ isError }));
    const app = { getHostCapabilities: () => caps, sendMessage, updateModelContext } as unknown as HandBackApp;
    return Object.assign(app, { sendMessage, updateModelContext }) as HandBackApp & { sendMessage: typeof sendMessage; updateModelContext: typeof updateModelContext };
  };
  const selection = { products: [milk, oil], stores: [sfax] };

  it("prefers sendMessage when the host supports `message`", async () => {
    const app = makeApp({ message: { text: {} }, updateModelContext: { text: {} } });
    const out = await handBack(app, selection);
    expect(app.sendMessage).toHaveBeenCalledOnce();
    expect(app.updateModelContext).not.toHaveBeenCalled();
    const sent = app.sendMessage.mock.calls[0]![0];
    expect(sent.role).toBe("user");
    expect(sent.content[0]!.text).toContain("P001");
    expect(out.note).toBe("Sent to the conversation.");
  });

  it("falls back to updateModelContext (with machine-readable IDs) when `message` is missing", async () => {
    const app = makeApp({ updateModelContext: { text: {} } });
    const out = await handBack(app, selection);
    expect(app.sendMessage).not.toHaveBeenCalled();
    const ctx = app.updateModelContext.mock.calls[0]![0];
    expect(ctx.structuredContent).toEqual({ products: ["P001", "P021"], stores: ["S07"] });
    expect(out.note).toMatch(/Send any message/); // the model will not start by itself
  });

  it("gives the user a ready-to-paste message when the host supports neither", async () => {
    const app = makeApp({});
    const out = await handBack(app, selection);
    expect(app.sendMessage).not.toHaveBeenCalled();
    expect(app.updateModelContext).not.toHaveBeenCalled();
    expect(out.copyText).toContain("P021");
    expect(out.note).toMatch(/Paste this message/);
  });

  it("copes with a host that reports no capabilities at all", async () => {
    const out = await handBack(makeApp(undefined), selection);
    expect(out.copyText).toBeDefined();
  });

  it("throws (so the picker can show it) when the host refuses the message", async () => {
    await expect(handBack(makeApp({ message: {} }, true), selection)).rejects.toThrow(/refused the message/);
    await expect(handBack(makeApp({ updateModelContext: {} }, true), selection)).rejects.toThrow(/refused the context/);
  });
});

describe("input schemas (the contract the model sees)", () => {
  it("top_promotions defaults limit to 5 and accepts only ISO dates", () => {
    expect(TopPromotionsInput.parse({ from: "2025-01-01", to: "2025-02-01" }).limit).toBe(5);
    expect(TopPromotionsInput.safeParse({ from: "01/01/2025", to: "2025-02-01" }).success).toBe(false);
    expect(TopPromotionsInput.safeParse({ from: "2025-01-01", to: "2025-02-01", limit: 51 }).success).toBe(false);
    expect(TopPromotionsInput.safeParse({ from: "2025-01-01", to: "2025-02-01", limit: 2.5 }).success).toBe(false);
  });

  it("sales_trend requires a product id, the store is optional", () => {
    expect(SalesTrendInput.safeParse({}).success).toBe(false);
    expect(SalesTrendInput.safeParse({ productId: "P021" }).success).toBe(true);
  });

  it("search_products_ui allows an empty query (browse) and defaults the page size to 12", () => {
    expect(SearchProductsUiInput.parse({})).toEqual({ query: "", limit: 12 });
  });

  it("pick_products accepts no arguments at all", () => {
    expect(PickProductsInput.safeParse({}).success).toBe(true);
    expect(PickProductsInput.safeParse({ category: "Toys" }).success).toBe(false);
  });
});
