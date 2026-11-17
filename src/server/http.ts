/**
 * Streamable HTTP entry point (stdio.ts is the other one; both reuse createServer()).
 * This file only reads the environment and starts listening; all the behaviour lives in httpApp.ts (and is tested there).
 *
 * Environment variables (all optional):
 *   PORT                    port to listen on                                       (default 3000)
 *   HOST                    address to bind                                         (default 127.0.0.1; 0.0.0.0 inside Docker)
 *   ALLOWED_HOSTS           comma-separated hostnames the Host header may carry     (e.g. localhost,mcp.example.com)
 *   CORS_ORIGINS            comma-separated browser origins allowed in addition to the local dev tools
 *   RATE_LIMIT_PER_MINUTE   per-client limit on /mcp, 0 = off                       (default 300)
 *   TRUST_PROXY             number of reverse-proxy hops to trust for the client IP (default 0; 1 behind Nginx/a platform)
 *   JSON_LIMIT              max request body                                        (default 64kb)
 */
import { createHttpApp } from "./httpApp.js";

const list = (value: string | undefined) => value?.split(",").map((s) => s.trim()).filter(Boolean);
const int = (value: string | undefined, fallback: number) => (value === undefined || value === "" ? fallback : Number(value));

const PORT = int(process.env["PORT"], 3000);
const allowedHosts = list(process.env["ALLOWED_HOSTS"]);
// Default: loopback only. Listing allowed hosts means we are meant to be reached from outside, so bind every interface.
const HOST = process.env["HOST"] ?? (allowedHosts ? "0.0.0.0" : "127.0.0.1");

const app = createHttpApp({
  host: HOST,
  ...(allowedHosts ? { allowedHosts } : {}),
  allowedOrigins: list(process.env["CORS_ORIGINS"]) ?? [],
  rateLimitPerMinute: int(process.env["RATE_LIMIT_PER_MINUTE"], 300),
  trustProxy: int(process.env["TRUST_PROXY"], 0),
  jsonLimit: process.env["JSON_LIMIT"] ?? "64kb",
});

const server = app.listen(PORT, HOST, () => {
  console.error(`PromoLite MCP listening on http://${HOST}:${PORT}/mcp`);
});

// Docker sends SIGTERM on `docker stop`: finish in-flight requests, then exit cleanly instead of being killed after 10 s.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.error(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
