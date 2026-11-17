/**
 * Starts the stdio server as a child process and calls its tools, like a host would.
 *   npm run smoke            -> runs src/ through tsx
 *   npm run smoke -- --built -> runs the compiled dist/ (after `npm run build`)
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const built = process.argv.includes("--built");
const args = built ? ["dist/server/stdio.js"] : ["--import", "tsx", "src/server/stdio.ts"];
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args }));

const text = (r: any) => r.content.map((c: any) => c.text).join("\n");
const call = async (title: string, name: string, a: Record<string, unknown>, full = false) => {
  const r: any = await client.callTool({ name, arguments: a });
  const out = text(r);
  console.log(`\n--- ${title}  (isError=${r.isError ?? false}, structured=${r.structuredContent ? "yes" : "no"})`);
  console.log(full ? out : out.split("\n").slice(0, 8).join("\n"));
};

console.log(`MODE: ${built ? "built dist/" : "tsx src/"}`);
const tools = (await client.listTools()).tools;
console.log("TOOLS:", tools.map((t) => t.name).join(", "));
console.log("top_promotions _meta:", JSON.stringify(tools.find((t) => t.name === "top_promotions")?._meta));
const resources = (await client.listResources()).resources;
console.log("RESOURCES:", resources.map((r) => `${r.uri} (${r.mimeType})`).join(", "));
for (const r of resources) {
  const res: any = await client.readResource({ uri: r.uri });
  const c = res.contents[0];
  console.log(`read ${r.uri}: mime=${c.mimeType}, ${c.text.length} chars, starts with: ${JSON.stringify(c.text.slice(0, 15))}`);
}
await call("ping", "ping", { name: "anas" }, true);
await call("top_promotions Q2", "top_promotions", { from: "2025-04-01", to: "2025-06-30" }, true);
await call("search 'olive oil'", "search_products", { query: "olive oil" }, true);
await call("search 'dairy'", "search_products", { query: "dairy" }, true);
await call("search nothing", "search_products", { query: "zzzz" }, true);
await call("trend olive oil 1L in Sfax", "sales_trend", { productId: "P021", store: "Sfax" });
await call("trend all stores", "sales_trend", { productId: "P021" });
await call("ERR unknown product", "sales_trend", { productId: "P999" }, true);
await call("ERR unknown store", "sales_trend", { productId: "P021", store: "Paris" }, true);
await call("ERR dates reversed", "top_promotions", { from: "2025-06-30", to: "2025-04-01" }, true);
await call("ERR bad date format", "top_promotions", { from: "yesterday", to: "2025-04-01" }, true);
await call("ERR limit 500", "top_promotions", { from: "2025-01-01", to: "2025-12-31", limit: 500 }, true);
await client.close();
