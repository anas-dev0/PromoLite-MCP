/**
 * HTTP layer tests: the security behaviour of createHttpApp (Host validation, Origin/CORS allowlist, rate limit, body
 * limit, clean errors). Each test starts the real Express app on a random free port, so nothing is mocked.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createDataStore } from "../src/server/data.js";
import { createHttpApp, type HttpAppOptions } from "../src/server/httpApp.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/mini");

const running: http.Server[] = [];
async function start(options: HttpAppOptions = {}) {
  const app: Express = createHttpApp({ data: createDataStore(FIXTURES), ...options });
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  running.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  while (running.length) {
    const s = running.pop()!;
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

const MCP_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
const rpc = (method: string, params: object = {}, id = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const post = (url: string, body: string, headers: Record<string, string> = {}) =>
  fetch(`${url}/mcp`, { method: "POST", headers: { ...MCP_HEADERS, ...headers }, body });
/** Responses are Server-Sent Events: "event: message\ndata: {json}". */
const sseJson = async (res: Response) => JSON.parse((await res.text()).split("\n").find((l) => l.startsWith("data:"))!.slice(5));

/** fetch() will not let us set the Host header, so the Host-validation tests use node:http directly. */
function rawRequest(url: string, hostHeader: string, body = rpc("tools/list")) {
  const u = new URL(url);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      { host: u.hostname, port: u.port, path: "/mcp", method: "POST", headers: { ...MCP_HEADERS, Host: hostHeader, "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("basics", () => {
  it("answers /health with a tiny 'ok' and does not advertise the framework", async () => {
    const url = await start();
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("serves MCP over POST /mcp (stateless: no session needed)", async () => {
    const url = await start();
    const list = await sseJson(await post(url, rpc("tools/list")));
    expect(list.result.tools).toHaveLength(7);

    const call = await sseJson(await post(url, rpc("tools/call", { name: "top_promotions", arguments: { from: "2025-01-01", to: "2025-12-31" } }, 2)));
    expect(call.result.content[0].text).toContain("Late March (PR3)"); // the fixture dataset, not the real one
  });

  it("refuses GET and DELETE on /mcp (a stateless server has no push stream and no session to delete)", async () => {
    const url = await start();
    for (const method of ["GET", "DELETE"]) {
      const res = await fetch(`${url}/mcp`, { method });
      expect(res.status, method).toBe(405);
    }
  });

  it("has no other public surface: unknown paths are 404", async () => {
    const url = await start();
    expect((await fetch(`${url}/admin`)).status).toBe(404);
    expect((await fetch(`${url}/`)).status).toBe(404);
  });
});

describe("Origin and CORS allowlist (browser callers)", () => {
  it("a request with NO Origin (Claude's servers, curl, the Inspector proxy) is not affected", async () => {
    const url = await start();
    expect((await post(url, rpc("tools/list"))).status).toBe(200);
  });

  it("allows the local dev tools by default and tells the browser so", async () => {
    const url = await start();
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8080"]) {
      const res = await post(url, rpc("tools/list"), { Origin: origin });
      expect(res.status, origin).toBe(200);
      expect(res.headers.get("access-control-allow-origin"), origin).toBe(origin);
    }
  });

  it("answers a CORS preflight for an allowed origin", async () => {
    const url = await start();
    const res = await fetch(`${url}/mcp`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("REJECTS an unlisted origin with 403, even though the request itself would have been valid", async () => {
    const url = await start();
    const res = await post(url, rpc("tools/list"), { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("the same exact-match allowlist applies when bound to all interfaces (the Docker setup)", async () => {
    const url = await start({ host: "0.0.0.0", allowedHosts: ["127.0.0.1"], allowedOrigins: ["https://panel.example.com"] });
    const bad = await post(url, rpc("tools/list"), { Origin: "https://evil.example" });
    expect(bad.status).toBe(403);
    expect((await bad.json()).error.message).toMatch(/Origin/); // the SDK layer (hostname) or ours (exact origin)
    // same hostname, different scheme or port: still rejected, because we match the whole origin
    expect((await post(url, rpc("tools/list"), { Origin: "http://panel.example.com" })).status).toBe(403);
    expect((await post(url, rpc("tools/list"), { Origin: "https://panel.example.com:8443" })).status).toBe(403);
    expect((await post(url, rpc("tools/list"), { Origin: "https://panel.example.com" })).status).toBe(200);
  });

  it("rejects an unlisted origin on the preflight too, so the browser never even sends the real request", async () => {
    const url = await start();
    const res = await fetch(`${url}/mcp`, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    expect(res.status).toBe(403);
  });

  it("CORS_ORIGINS extends the allowlist (exact match: a look-alike origin is still rejected)", async () => {
    const url = await start({ allowedOrigins: ["https://panel.example.com"] });
    expect((await post(url, rpc("tools/list"), { Origin: "https://panel.example.com" })).status).toBe(200);
    expect((await post(url, rpc("tools/list"), { Origin: "https://panel.example.com.evil.io" })).status).toBe(403);
    expect((await post(url, rpc("tools/list"), { Origin: "http://panel.example.com" })).status).toBe(403); // wrong scheme
  });
});

describe("Host header validation (DNS rebinding)", () => {
  it("accepts a listed hostname and rejects any other", async () => {
    const url = await start({ host: "0.0.0.0", allowedHosts: ["good.example", "127.0.0.1"] });
    expect((await rawRequest(url, "good.example")).status).toBe(200);
    expect((await rawRequest(url, "good.example:8080")).status).toBe(200); // the port is ignored
    const bad = await rawRequest(url, "evil.example");
    expect(bad.status).toBe(403);
  });

  it("by default (bound to loopback) only localhost-class hosts are accepted", async () => {
    const url = await start();
    expect((await rawRequest(url, "localhost")).status).toBe(200);
    expect((await rawRequest(url, "attacker.example")).status).toBe(403);
  });
});

describe("limits", () => {
  it("rejects a body over the limit with 413 and a small JSON error (no stack trace)", async () => {
    const url = await start({ jsonLimit: "1kb" });
    const res = await post(url, rpc("tools/call", { name: "ping", arguments: { name: "x".repeat(5000) } }));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.message).toBe("Request body too large");
    expect(JSON.stringify(body)).not.toMatch(/at .*\.(js|ts)/); // no stack trace
  });

  it("answers malformed JSON with 400, not a crash", async () => {
    const url = await start();
    const res = await post(url, "{ this is not json");
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("Malformed request");
  });

  it("rate-limits /mcp per client: the request over the limit gets 429 with Retry-After", async () => {
    const url = await start({ rateLimitPerMinute: 3 });
    for (let i = 0; i < 3; i++) expect((await post(url, rpc("tools/list"))).status, `request ${i + 1}`).toBe(200);
    const blocked = await post(url, rpc("tools/list"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await blocked.json()).error.message).toMatch(/Too many requests/);
    // the health probe is never rate-limited, or Docker would restart a healthy container
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });

  it("behind a trusted proxy the limit is per REAL client (X-Forwarded-For), not per proxy", async () => {
    const url = await start({ rateLimitPerMinute: 2, trustProxy: 1 });
    const as = (ip: string) => post(url, rpc("tools/list"), { "X-Forwarded-For": ip });
    expect((await as("10.0.0.1")).status).toBe(200);
    expect((await as("10.0.0.1")).status).toBe(200);
    expect((await as("10.0.0.1")).status).toBe(429); // client A is over its limit...
    expect((await as("10.0.0.2")).status).toBe(200); // ...client B is not
  });

  it("without a trusted proxy, X-Forwarded-For is ignored (a client cannot dodge the limit by faking it)", async () => {
    const url = await start({ rateLimitPerMinute: 2 });
    const as = (ip: string) => post(url, rpc("tools/list"), { "X-Forwarded-For": ip });
    await as("1.1.1.1");
    await as("2.2.2.2");
    expect((await as("3.3.3.3")).status).toBe(429);
  });

  it("the limiter is off when set to 0", async () => {
    const url = await start({ rateLimitPerMinute: 0 });
    for (let i = 0; i < 10; i++) expect((await post(url, rpc("tools/list"))).status).toBe(200);
  });
});
