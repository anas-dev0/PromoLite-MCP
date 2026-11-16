import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { salesTrend, searchProducts, topPromotions, UserError } from "./data.js";
import {
  SalesTrendInput, SalesTrendOutput, SearchProductsInput, SearchProductsOutput,
  TopPromotionsInput, TopPromotionsOutput,
} from "./schemas.js";

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
  const server = new McpServer({ name: "promolite", version: "0.2.0" });

  server.registerTool(
    "ping",
    {
      description: "Health check. Returns pong and the server time.",
      inputSchema: z.object({ name: z.string().optional() }),
    },
    async ({ name }) => ({ content: text(`pong ${name ?? ""} at ${new Date().toISOString()}`) }),
  );

  server.registerTool(
    "top_promotions",
    {
      title: "Top promotions by uplift",
      description:
        "Ranks promotions by sales uplift (units sold during the promotion vs the usual weekly baseline) for " +
        "promotions running between two dates. Use when the user asks which promotions performed best or worst. " +
        "Dates are ISO (YYYY-MM-DD); the dataset covers calendar year 2025.",
      inputSchema: TopPromotionsInput,
      outputSchema: TopPromotionsOutput,
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

  server.registerTool(
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
    },
    ({ productId, store }) =>
      guarded(() => {
        const trend = salesTrend(productId, store);
        const total = trend.points.reduce((s, p) => s + p.units, 0);
        const promoWeeks = trend.points.filter((p) => p.promoId);
        const peak = trend.points.reduce((a, b) => (b.units > a.units ? b : a));
        const lines = trend.points.map((p) => `${p.week}: ${p.units} units @ ${p.price}${p.promoId ? `  [promo ${p.promoId}]` : ""}`);
        return {
          content: text(
            `Sales trend for ${trend.productName} (${trend.productId}), ${trend.store}, 2025.\n` +
            `Total ${total} units over ${trend.points.length} weeks; ${promoWeeks.length} promoted weeks; ` +
            `peak ${peak.units} units in week of ${peak.week}.\n\n${lines.join("\n")}`),
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

  return server;
}
