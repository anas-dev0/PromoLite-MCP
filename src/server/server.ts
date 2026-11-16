import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { topPromotions } from "./data.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use ISO format YYYY-MM-DD");

/** Builds the MCP server. Transport-agnostic: stdio.ts (and http.ts on Day 3) connect it. */
export function createServer() {
  const server = new McpServer({ name: "promolite", version: "0.1.0" });

  server.registerTool(
    "ping",
    {
      description: "Health check. Returns pong and the server time.",
      inputSchema: z.object({ name: z.string().optional() }),
    },
    async ({ name }) => ({
      content: [{ type: "text", text: `pong ${name ?? ""} at ${new Date().toISOString()}` }],
    }),
  );

  server.registerTool(
    "top_promotions",
    {
      description:
        "Ranks promotions by sales uplift (units sold during the promo vs the usual baseline) for promotions " +
        "running between two dates. Use when the user asks which promotions performed best. " +
        "Dates are ISO (YYYY-MM-DD); the dataset covers 2025.",
      inputSchema: z.object({
        from: isoDate.describe("Period start, e.g. 2025-04-01"),
        to: isoDate.describe("Period end, e.g. 2025-06-30"),
        limit: z.number().int().min(1).max(50).default(5).describe("How many promotions to return"),
      }),
    },
    async ({ from, to, limit }) => {
      if (from > to) {
        return { isError: true, content: [{ type: "text", text: `'from' (${from}) must not be after 'to' (${to}).` }] };
      }
      const rows = topPromotions(from, to, limit);
      if (rows.length === 0) {
        return { content: [{ type: "text", text: `No promotions overlap ${from} to ${to}. The data covers 2025.` }] };
      }
      const table = [
        "| # | Promotion | Type | Discount | Category | Region | Uplift | Extra units |",
        "|---|---|---|---|---|---|---|---|",
        ...rows.map((r, i) =>
          `| ${i + 1} | ${r.name} (${r.promoId}) | ${r.type} | ${r.discountPct}% | ${r.category} | ${r.region} | ` +
          `+${(r.uplift * 100).toFixed(0)}% | ${r.incrementalUnits} |`),
      ].join("\n");
      return { content: [{ type: "text", text: `Top ${rows.length} promotions by uplift, ${from} to ${to}:\n\n${table}` }] };
    },
  );

  return server;
}
