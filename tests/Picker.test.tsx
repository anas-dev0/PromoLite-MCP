// @vitest-environment jsdom
/**
 * The picker is the view with the interesting TIMING behaviour: a debounce, and responses that can arrive out of order.
 * Fake timers make both deterministic. The component takes `search` and `onConfirm` as props, so no MCP mock is needed:
 * `search` stands in for app.callServerTool.
 */
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { Product, Store } from "../src/server/schemas.js";
import { DEBOUNCE_MS, ProductPicker, type Selection } from "../src/views/shared/components/ProductPicker.js";
import { useDebouncedValue } from "../src/views/shared/useDebouncedValue.js";

const milk: Product = { productId: "P001", name: "Whole Milk 1L", category: "Dairy", basePrice: 2.65 };
const oil1: Product = { productId: "P021", name: "Olive Oil 1L", category: "Pantry", basePrice: 17.5 };
const oil5: Product = { productId: "P022", name: "Olive Oil 5L", category: "Pantry", basePrice: 80 };
const stores: Store[] = [
  { storeId: "S01", city: "Tunis", region: "North" },
  { storeId: "S07", city: "Sfax", region: "South" },
];
const CATEGORIES = ["Dairy", "Pantry"];

/** A promise we resolve by hand, to control the ORDER in which responses arrive. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const page = (products: Product[]) => ({ products, total: products.length });
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const names = () => screen.queryAllByRole("listitem").map((li) => within(li).getByText(/Milk|Oil/).textContent);

/**
 * Synchronous stand-in for userEvent. (userEvent awaits real timers between keystrokes and hangs under fake timers;
 * fireEvent is instant, which is exactly what a deterministic timing test wants: "three keystrokes, no time passes".)
 */
const user = {
  type(el: HTMLElement, text: string) {
    let value = (el as HTMLInputElement).value;
    for (const ch of text) {
      value += ch;
      fireEvent.change(el, { target: { value } });
    }
  },
  clear: (el: HTMLElement) => void fireEvent.change(el, { target: { value: "" } }),
  click: (el: HTMLElement) => void fireEvent.click(el),
  selectOptions: (el: HTMLElement, value: string) => void fireEvent.change(el, { target: { value } }),
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type SearchFn = (query: string, category: string | null) => Promise<{ products: Product[]; total: number }>;
type ConfirmFn = (selection: Selection) => Promise<{ note: string; copyText?: string }>;

function setup(
  search: Mock<SearchFn> = vi.fn<SearchFn>(async () => page([milk, oil1, oil5])),
  onConfirm: Mock<ConfirmFn> = vi.fn<ConfirmFn>(async () => ({ note: "Sent to the conversation." })),
) {
  render(<ProductPicker stores={stores} categories={CATEGORIES} search={search} onConfirm={onConfirm} />);
  return { search, onConfirm };
}

describe("<ProductPicker /> search", () => {
  it("browses the catalogue as soon as it opens (one search with an empty query)", async () => {
    const { search } = setup();
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("", null);
    expect(names()).toEqual(["Whole Milk 1L", "Olive Oil 1L", "Olive Oil 5L"]);
    expect(screen.getByText("Showing 3 of 3")).toBeInTheDocument();
  });

  it("DEBOUNCE: typing three characters quickly sends ONE request, after the pause", async () => {
    const { search } = setup();
    await flush();
    search.mockClear();

    await user.type(screen.getByRole("searchbox"), "oli"); // three keystrokes
    expect(search).not.toHaveBeenCalled();
    await advance(DEBOUNCE_MS - 1);
    expect(search).not.toHaveBeenCalled(); // still waiting for the user to stop typing
    await advance(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("oli", null);
  });

  it("each new keystroke restarts the wait", async () => {
    const { search } = setup();
    await flush();
    search.mockClear();
    const box = screen.getByRole("searchbox");

    await user.type(box, "ol");
    await advance(200);
    await user.type(box, "i"); // 200 ms after the last key: the timer restarts
    await advance(200);
    expect(search).not.toHaveBeenCalled();
    await advance(50);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("oli", null);
  });

  it("changing the category searches immediately (no debounce: it is a click, not typing)", async () => {
    const { search } = setup();
    await flush();
    search.mockClear();
    await user.selectOptions(screen.getByRole("combobox", { name: /category/i }), "Dairy");
    await flush();
    expect(search).toHaveBeenCalledWith("", "Dairy");
  });

  it("STALE RESPONSES: a slow answer for an old query never overwrites the answer for the new one", async () => {
    const slow = deferred<ReturnType<typeof page>>();
    const search = vi.fn<SearchFn>(async (q) => {
      if (q === "ol") return slow.promise; // this answer will arrive LATE
      if (q === "olive oil") return page([oil1, oil5]);
      return page([milk]);
    });
    setup(search);
    await flush();

    const box = screen.getByRole("searchbox");
    await user.type(box, "ol");
    await advance(DEBOUNCE_MS); // request for "ol" is sent and held back
    await user.type(box, "ive oil");
    await advance(DEBOUNCE_MS); // request for "olive oil" is sent and answered
    expect(names()).toEqual(["Olive Oil 1L", "Olive Oil 5L"]);

    slow.resolve(page([milk])); // the old, stale answer finally lands...
    await flush();
    expect(names()).toEqual(["Olive Oil 1L", "Olive Oil 5L"]); // ...and is ignored
    expect(screen.getByText("Showing 2 of 2")).toBeInTheDocument();
  });

  it("shows a 'no results' message, and an error message when the search fails", async () => {
    const search = vi.fn<SearchFn>(async (q) => {
      if (q === "zzz") return page([]);
      if (q === "boom") throw new Error("server down");
      return page([milk]);
    });
    setup(search);
    await flush();
    const box = screen.getByRole("searchbox");

    await user.type(box, "zzz");
    await advance(DEBOUNCE_MS);
    expect(screen.getByText(/No products match/)).toBeInTheDocument();

    await user.clear(box);
    await user.type(box, "boom");
    await advance(DEBOUNCE_MS);
    expect(screen.getByRole("alert")).toHaveTextContent("Search failed: server down");
  });

  it("shows 'Searching…' while a request is in flight", async () => {
    const slow = deferred<ReturnType<typeof page>>();
    setup(vi.fn<SearchFn>(() => slow.promise));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
    slow.resolve(page([milk]));
    await flush();
    expect(screen.queryByText("Searching…")).not.toBeInTheDocument();
  });
});

describe("<ProductPicker /> selection and hand-back", () => {
  it("selected products appear as removable chips", async () => {
    setup();
    await flush();
    await user.click(screen.getByRole("checkbox", { name: /Whole Milk 1L/ }));
    await user.click(screen.getByRole("checkbox", { name: /Olive Oil 5L/ }));
    expect(screen.getByRole("button", { name: "Remove Whole Milk 1L" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Olive Oil 5L" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Whole Milk 1L" }));
    expect(screen.queryByRole("button", { name: "Remove Whole Milk 1L" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Whole Milk 1L/ })).not.toBeChecked();
  });

  it("the selection survives a new search", async () => {
    const search = vi.fn<SearchFn>(async (q) => page(q === "oil" ? [oil1] : [milk, oil1]));
    setup(search);
    await flush();
    await user.click(screen.getByRole("checkbox", { name: /Whole Milk 1L/ }));
    await user.type(screen.getByRole("searchbox"), "oil");
    await advance(DEBOUNCE_MS);
    expect(screen.getByRole("button", { name: "Remove Whole Milk 1L" })).toBeInTheDocument(); // still selected
  });

  it("'Use these products' is disabled until something is selected", async () => {
    setup();
    await flush();
    const button = screen.getByRole("button", { name: /use these products/i });
    expect(button).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /Whole Milk 1L/ }));
    expect(button).toBeEnabled();
  });

  it("confirming sends the chosen products and stores, and shows the host's note", async () => {
    const { onConfirm } = setup();
    await flush();
    await user.click(screen.getByRole("checkbox", { name: /Olive Oil 1L/ }));
    await user.click(screen.getByRole("checkbox", { name: "Sfax" }));
    await user.click(screen.getByRole("button", { name: /use these products/i }));
    await flush();
    expect(onConfirm).toHaveBeenCalledWith({ products: [oil1], stores: [stores[1]] });
    expect(screen.getByRole("status")).toHaveTextContent("Sent to the conversation.");
  });

  it("with no store selected it sends an empty store list (meaning: all stores)", async () => {
    const { onConfirm } = setup();
    await flush();
    await user.click(screen.getByRole("checkbox", { name: /Whole Milk 1L/ }));
    await user.click(screen.getByRole("button", { name: /use these products/i }));
    await flush();
    expect(onConfirm).toHaveBeenCalledWith({ products: [milk], stores: [] });
  });

  it("shows a ready-to-paste message when the host cannot receive the selection", async () => {
    const onConfirm = vi.fn<ConfirmFn>(async () => ({ note: "This host cannot receive a selection. Paste this message:", copyText: "Show the sales trend for P001." }));
    setup(undefined, onConfirm);
    await flush();
    await user.click(screen.getByRole("checkbox", { name: /Whole Milk 1L/ }));
    await user.click(screen.getByRole("button", { name: /use these products/i }));
    await flush();
    expect(screen.getByRole("textbox", { name: /message to paste/i })).toHaveValue("Show the sales trend for P001.");
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("shows an error when sending fails, and lets the user try again", async () => {
    const onConfirm = vi.fn<ConfirmFn>(async () => { throw new Error("The host refused the message."); });
    setup(undefined, onConfirm);
    await flush();
    await user.click(screen.getByRole("checkbox", { name: /Whole Milk 1L/ }));
    await user.click(screen.getByRole("button", { name: /use these products/i }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not send: The host refused the message.");
    expect(screen.getByRole("button", { name: /use these products/i })).toBeEnabled();
  });
});

describe("useDebouncedValue", () => {
  it("updates only after the value stops changing for the delay", async () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 100), { initialProps: { v: "a" } });
    expect(result.current).toBe("a");
    rerender({ v: "ab" });
    rerender({ v: "abc" });
    expect(result.current).toBe("a");
    await advance(99);
    expect(result.current).toBe("a");
    await advance(1);
    expect(result.current).toBe("abc");
  });
});
