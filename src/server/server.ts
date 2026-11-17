import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { listStores, salesTrend, searchProducts, searchProductsPage, topPromotions, UserError } from "./data.js";
import {
  CATEGORIES, PickProductsInput, PickProductsOutput, SalesTrendInput, SalesTrendOutput, SearchProductsInput,
  SearchProductsOutput, SearchProductsUiInput, SearchProductsUiOutput, TopPromotionsInput, TopPromotionsOutput,
} from "./schemas.js";
import { PICKER_URI, registerViews, TABLE_URI, TREND_URI } from "./ui.js";

const text = (t: string) => [{ type: "text" as const, text: t }];
const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(0)}%`;

/** Runs a handler; a UserError (bad id, bad dates...) becomes a readable isError result instead of a crash. */
async function guarded<T extends object>(run: () => T | Promise<T>) {
  try {
    return await run();
  } catch (e) {
    if (e instanceof UserError) return { isError: true as const, content: text(e.message) };
    throw e; // a real bug: let the SDK report it as an internal error
  }
}

/** Builds the MCP server. Transport-agnostic: stdio.ts (and http.ts on Day 3) connect it. */
export function createServer() {
  const server = new McpServer({ name: "promolite", version: "0.5.0" });

  server.registerTool(
    "ping",
    {
      description: "Health check. Returns pong and the server time.",
      inputSchema: z.object({ name: z.string().optional() }),
    },
    async ({ name }) => ({ content: text(`pong ${name ?? ""} at ${new Date().toISOString()}`) }),
  );

  registerViews(server);

  // registerAppTool = registerTool + `_meta.ui.resourceUri`: "when this tool is called, show this view".
  // The handler still returns a complete text answer, so hosts without view support keep working.
  registerAppTool(
    server,
    "top_promotions",
    {
      title: "Top promotions by uplift",
      description:
        "Ranks promotions by sales uplift (units sold during the promotion vs the usual weekly baseline) for " +
        "promotions running between two dates. Use when the user asks which promotions performed best or worst. " +
        "Dates are ISO (YYYY-MM-DD); the dataset covers calendar year 2025.",
      inputSchema: TopPromotionsInput,
      outputSchema: TopPromotionsOutput,
      _meta: { ui: { resourceUri: TABLE_URI } },
    },
    ({ from, to, limit }) =>
      guarded(() => {
        if (from > to) throw new UserError(`'from' (${from}) must not be after 'to' (${to}).`);
        const rows = topPromotions(from, to, limit);
        if (rows.length === 0) {
          return { content: text(`No promotions overlap ${from} to ${to}. The data covers 2025.`), structuredContent: { from, to, rows } };
        }
        const table = [
          "| # | Promotion | Type | Discount | Category | Region | Uplift | Extra units |",
          "|---|---|---|---|---|---|---|---|",
          ...rows.map((r, i) =>
            `| ${i + 1} | ${r.name} (${r.promoId}) | ${r.type} | ${r.discountPct}% | ${r.category} | ${r.region} | ` +
            `${pct(r.uplift)} | ${r.incrementalUnits} |`),
        ].join("\n");
        return {
          content: text(`Top ${rows.length} promotions by uplift, ${from} to ${to}:\n\n${table}`),
          structuredContent: { from, to, rows },
        };
      }),
  );

  registerAppTool(
    server,
    "sales_trend",
    {
      title: "Weekly sales trend",
      description:
        "Weekly units sold and average price for ONE product over 2025, optionally for one store, marking the weeks " +
        "a promotion was active. Use for questions like 'show the sales trend for olive oil in Sfax'. " +
        "Needs a product ID: if you only have a name, call search_products first. " +
        "The store can be an ID (S07) or a city name (Sfax); omit it to sum all stores.",
      inputSchema: SalesTrendInput,
      outputSchema: SalesTrendOutput,
      _meta: { ui: { resourceUri: TREND_URI } },
    },
    ({ productId, store }) =>
      guarded(() => {
        const trend = salesTrend(productId, store);
        const { points } = trend;
        const total = points.reduce((s, p) => s + p.units, 0);
        const promo = points.filter((p) => p.promoId);
        const normal = points.filter((p) => !p.promoId);
        const avg = (ps: typeof points) => (ps.length ? ps.reduce((s, p) => s + p.units, 0) / ps.length : 0);
        const peak = points.reduce((a, b) => (b.units > a.units ? b : a));
        const lift =
          promo.length && normal.length && avg(normal) > 0
            ? ` Promoted weeks averaged ${Math.round(avg(promo))} units vs ${Math.round(avg(normal))} otherwise (${pct(avg(promo) / avg(normal) - 1)}).`
            : "";
        const lines = points.map((p) => `${p.week}: ${p.units} units @ ${p.price}${p.promoId ? `  [promo ${p.promoId}: ${p.promoName}]` : ""}`);
        return {
          content: text(
            `Sales trend for ${trend.productName} (${trend.productId}), ${trend.store}, 2025.\n` +
            `Total ${total} units over ${points.length} weeks; ${promo.length} promoted weeks; ` +
            `peak ${peak.units} units in the week of ${peak.week}.${lift}\n\n${lines.join("\n")}`),
          structuredContent: trend,
        };
      }),
  );

  server.registerTool(
    "search_products",
    {
      title: "Search products",
      description:
        "Finds products by name or category words (e.g. 'olive oil', 'dairy', 'milk') and returns their product IDs. " +
        "Call this first whenever you need a product ID for sales_trend.",
      inputSchema: SearchProductsInput,
      outputSchema: SearchProductsOutput,
    },
    ({ query, category, limit }) =>
      guarded(() => {
        const products = searchProducts(query, category, limit);
        if (products.length === 0) {
          return { content: text(`No products match "${query}". Try fewer or different words.`), structuredContent: { products } };
        }
        const lines = products.map((p) => `- ${p.productId}: ${p.name} (${p.category}, ${p.basePrice} TND)`);
        return {
          content: text(`${products.length} product(s) matching "${query}":\n${lines.join("\n")}`),
          structuredContent: { products },
        };
      }),
  );

  // ---------------------------------------------------------------- Day 5: picker
  // Model-visible: the model calls this when the user is vague ("compare some dairy products"), and the host
  // shows the picker view. The text answer below is the fallback for hosts that cannot show views.
  registerAppTool(
    server,
    "pick_products",
    {
      title: "Pick products and stores",
      description:
        "Opens an interactive picker so the USER can choose exact products and stores. Use when the request is vague " +
        "or ambiguous (for example 'compare some dairy products' or 'which olive oil?') instead of guessing product IDs. " +
        "The user's choice comes back to the conversation as a message with exact product IDs, which you can then pass " +
        "to sales_trend. Optionally pre-fill a search query and/or category.",
      inputSchema: PickProductsInput,
      outputSchema: PickProductsOutput,
      _meta: { ui: { resourceUri: PICKER_URI } },
    },
    ({ query, category }) =>
      guarded(() => {
        const stores = listStores();
        const structured = { query: query ?? "", category: category ?? null, categories: [...CATEGORIES], stores };
        return {
          content: text(
            "An interactive product picker was opened for the user. If your host cannot display it, use search_products " +
            "to find product IDs instead.\n" +
            `Categories: ${CATEGORIES.join(", ")}.\n` +
            `Stores: ${stores.map((s) => `${s.storeId} ${s.city}`).join(", ")}.`),
          structuredContent: structured,
        };
      }),
  );

  // App-only: `visibility: ["app"]` means only the picker view may call it (through the host, with NO model in the
  // loop). The server still LISTS it in tools/list; a host that supports MCP Apps hides it from the model.
  registerAppTool(
    server,
    "search_products_ui",
    {
      title: "Search products (picker backend)",
      description: "Backend for the product picker view: searches products as the user types. Not meant for the model.",
      inputSchema: SearchProductsUiInput,
      outputSchema: SearchProductsUiOutput,
      _meta: { ui: { visibility: ["app"] } },
    },
    ({ query, category, limit }) =>
      guarded(() => {
        const { products, total } = searchProductsPage(query, category, limit);
        return {
          content: text(`${products.length} of ${total} product(s) match "${query}".`),
          structuredContent: { products, total },
        };
      }),
  );

  return server;
}
