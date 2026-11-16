/** Starts the stdio server as a child process and calls its tools, like a host would. Run: npm run smoke */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/server/stdio.ts"] }));

const text = (r: any) => r.content.map((c: any) => c.text).join("\n");
console.log("TOOLS:", (await client.listTools()).tools.map((t) => t.name).join(", "));
console.log("\n--- ping\n" + text(await client.callTool({ name: "ping", arguments: { name: "anas" } })));
console.log("\n--- top_promotions Q2\n" + text(await client.callTool({ name: "top_promotions", arguments: { from: "2025-04-01", to: "2025-06-30" } })));
console.log("\n--- top_promotions whole year, limit 25\n" + text(await client.callTool({ name: "top_promotions", arguments: { from: "2025-01-01", to: "2025-12-31", limit: 25 } })));
const bad = await client.callTool({ name: "top_promotions", arguments: { from: "2025-06-30", to: "2025-04-01" } });
console.log("\n--- bad dates (isError=" + bad.isError + ")\n" + text(bad));
const bad2 = await client.callTool({ name: "top_promotions", arguments: { from: "yesterday", to: "2025-04-01" } });
console.log("\n--- bad format (isError=" + bad2.isError + ")\n" + text(bad2));
await client.close();
