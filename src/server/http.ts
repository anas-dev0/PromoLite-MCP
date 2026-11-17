/**
 * Streamable HTTP entry point (stdio.ts is the other one; both reuse createServer()).
 *
 * STATELESS mode: every POST /mcp builds a fresh McpServer + transport and throws them away
 * afterwards. No sessions to keep, so it behaves well behind Nginx and on several instances.
 * (The CSV data is cached at module level in data.ts, so a fresh server per request is cheap.)
 */
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import cors from "cors";
import { createServer } from "./server.js";

const PORT = Number(process.env["PORT"] ?? 3000);
// Default: bind 127.0.0.1 only, with DNS-rebinding protection (Host/Origin must be localhost).
// To expose through a tunnel or a proxy, list the public hostnames:  ALLOWED_HOSTS=abc.trycloudflare.com
const allowedHosts = process.env["ALLOWED_HOSTS"]?.split(",").map((h) => h.trim()).filter(Boolean);
const HOST = process.env["HOST"] ?? (allowedHosts ? "0.0.0.0" : "127.0.0.1");

const app = createMcpExpressApp({ host: HOST, ...(allowedHosts ? { allowedHosts } : {}) });
// Browsers (basic-host, the Inspector) call us cross-origin, and must be able to read the session header.
app.use(cors({ exposedHeaders: ["Mcp-Session-Id"] }));

app.post("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

// Stateless server: no server-to-client stream and nothing to delete.
const notAllowed = (_req: unknown, res: { status(n: number): { json(b: unknown): void } }) =>
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: use POST)" }, id: null });
app.get("/mcp", notAllowed);
app.delete("/mcp", notAllowed);

app.listen(PORT, HOST, () => {
  console.error(`PromoLite MCP listening on http://${HOST}:${PORT}/mcp`);
});
