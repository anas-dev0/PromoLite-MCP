/**
 * The HTTP application, built by a function so tests (and http.ts) can create it with any options.
 *
 * Defense in depth, outermost layer first (Nginx adds its own limits in front of all this):
 *   1. Host-header validation      -> blocks DNS-rebinding (a hostile web page resolving its domain to 127.0.0.1)
 *   2. Origin allowlist            -> a browser page may call us only from an origin we list (403 otherwise)
 *   3. CORS allowlist              -> the browser is only told "yes" for those same origins (no open `cors()`)
 *   4. Rate limit per client IP    -> a runaway client cannot hammer the server
 *   5. Body size limit             -> 413 instead of parsing a huge payload
 *   6. Zod validation (server.ts)  -> every tool input is checked before any code runs
 * Non-browser clients (Claude's servers, curl, the Inspector proxy) send no Origin header and are not affected by 2-3.
 *
 * STATELESS mode: every POST /mcp builds a fresh McpServer + transport and throws them away afterwards. No sessions
 * to keep, so it behaves well behind Nginx and on several instances.
 */
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import cors from "cors";
import type { ErrorRequestHandler, Express, RequestHandler } from "express";
import type { DataStore } from "./data.js";
import { createServer } from "./server.js";

/** Origins allowed by default: the local dev tools (standalone panel on Vite, basic-host). Extend with CORS_ORIGINS. */
export const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173", "http://127.0.0.1:5173", // npm run dev:panel
  "http://localhost:8080", "http://127.0.0.1:8080", // basic-host (the reference MCP Apps host)
];

export interface HttpAppOptions {
  /** Address the server binds to. Localhost-class values switch on the SDK's default DNS-rebinding protection. */
  host?: string;
  /** Hostnames (no port) the Host header may carry, e.g. ["localhost", "mcp.example.com"]. */
  allowedHosts?: string[];
  /** Extra browser origins (scheme + host + port) allowed to call /mcp, on top of DEFAULT_ALLOWED_ORIGINS. */
  allowedOrigins?: string[];
  /** Max requests per client IP per minute on /mcp. 0 turns the limiter off (Nginx may already do it). */
  rateLimitPerMinute?: number;
  /** Behind Nginx or a platform proxy: how many proxy hops to trust for the real client IP (X-Forwarded-For). */
  trustProxy?: number;
  /** Max JSON body size, e.g. "64kb". */
  jsonLimit?: string;
  /** Dataset to serve. Defaults to the real one; tests inject fixtures. */
  data?: DataStore;
}

/** Fixed-window counter per key. Tiny and dependency-free: enough to stop a runaway client, not a DDoS shield. */
function rateLimiter(limitPerMinute: number): RequestHandler {
  const WINDOW_MS = 60_000;
  const hits = new Map<string, { count: number; resetAt: number }>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, h] of hits) if (h.resetAt <= now) hits.delete(key);
  }, WINDOW_MS);
  sweep.unref(); // never keep the process alive just for the cleanup timer

  return (req, res, next) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return next();
    }
    if (++h.count > limitPerMinute) {
      res.setHeader("Retry-After", Math.ceil((h.resetAt - now) / 1000));
      return void res.status(429).json({ jsonrpc: "2.0", error: { code: -32000, message: "Too many requests. Slow down." }, id: null });
    }
    next();
  };
}

export function createHttpApp(opts: HttpAppOptions = {}): Express {
  const {
    host = "127.0.0.1", allowedHosts, allowedOrigins = [], rateLimitPerMinute = 0, trustProxy = 0, jsonLimit = "64kb", data,
  } = opts;
  const origins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...allowedOrigins]);

  // The SDK validates Origin by HOSTNAME only (no scheme, no port) and, on a loopback bind, only accepts localhost-class
  // hostnames unless told otherwise. So tell it ours; the exact-match check below stays the strict one.
  const originHostnames = [...new Set([...origins].map((o) => new URL(o).hostname))];
  const app = createMcpExpressApp({ host, jsonLimit, allowedOrigins: originHostnames, ...(allowedHosts ? { allowedHosts } : {}) });
  app.disable("x-powered-by"); // do not advertise the framework
  if (trustProxy) app.set("trust proxy", trustProxy);

  // Liveness probe for Docker / the platform. Reveals nothing but "up".
  app.get("/health", (_req, res) => void res.json({ status: "ok" }));

  // Layer 2: a request that carries an Origin header comes from a browser page. Only listed origins may proceed.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) {
      return void res.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: "Origin not allowed" }, id: null });
    }
    next();
  });
  // Layer 3: explicit allowlist instead of the open `cors()` default.
  app.use(cors({ origin: [...origins], exposedHeaders: ["Mcp-Session-Id"], maxAge: 600 }));

  if (rateLimitPerMinute > 0) app.use("/mcp", rateLimiter(rateLimitPerMinute));

  app.post("/mcp", async (req, res) => {
    const server = createServer(data);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request failed:", err); // the details stay in the server log, never in the response
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  // Stateless server: no server-to-client stream and nothing to delete.
  const notAllowed: RequestHandler = (_req, res) =>
    void res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: use POST)" }, id: null });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);

  // Anything that goes wrong in middleware (oversized or malformed body, ...) becomes a small JSON error, never a stack trace.
  const onError: ErrorRequestHandler = (err: { status?: number; statusCode?: number; type?: string }, _req, res, _next) => {
    const status = err.status ?? err.statusCode ?? 500;
    const message = status === 413 ? "Request body too large" : status === 400 ? "Malformed request" : "Internal server error";
    if (!res.headersSent) res.status(status).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
  };
  app.use(onError);

  return app;
}
