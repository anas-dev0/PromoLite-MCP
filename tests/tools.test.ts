/**
 * Protocol tests (the middle of the pyramid): the REAL server and a REAL MCP client talk through the SDK's in-memory
 * transport pair, so these tests see exactly what a host sees: tools/list, tools/call, resources/list, resources/read.
 *
 * The resource tests read the built views, so they need `npm run build:views` first (`npm test` does that for you
 * through its `pretest` script).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDataStore, ROOT } from "../src/server/data.js";
import { createServer } from "../src/server/server.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/mini");

async function connect(data?: ReturnType<typeof createDataStore>) {
  const server = createServer(data);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientSide);
  return { client, close: () => client.close() };
}

// Loose helpers: tool results are checked field by field below.
const textOf = (r: any): string => (r.content ?? []).map((c: any) => c.text ?? "").join("\n");
const isAppOnly = (t: any) => JSON.stringify(t._meta?.ui?.visibility) === JSON.stringify(["app"]);

let real: Awaited<ReturnType<typeof connect>>;
let mini: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => {
  real = await connect(); // the real dataset
  mini = await connect(createDataStore(FIXTURES)); // tiny fixtures with known answers
});
afterAll(async () => {
  await real.close();
  await mini.close();
});

describe("tools/list", () => {
  it("lists exactly the seven tools", async () => {
    const names = (await real.client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["pick_products", "ping", "promo_calendar", "sales_trend", "search_products", "search_products_ui", "top_promotions"],
    );
  });

  it("marks search_products_ui as app-only (the host hides it from the model)", async () => {
    const tool = (await real.client.listTools()).tools.find((t) => t.name === "search_products_ui")!;
    expect(tool._meta).toMatchObject({ ui: { visibility: ["app"] } });
  });

  it("is the ONLY app-only tool: every other tool is visible to the model", async () => {
    const appOnly = (await real.client.listTools()).tools.filter(isAppOnly).map((t) => t.name);
    expect(appOnly).toEqual(["search_products_ui"]);
  });

  it("gives every model-visible tool a description that says when to use it", async () => {
    for (const t of (await real.client.listTools()).tools.filter((t) => !isAppOnly(t))) {
      expect(t.description?.length ?? 0, t.name).toBeGreaterThan(25);
    }
  });

  it("describes inputs with a JSON Schema and outputs with an outputSchema (except ping)", async () => {
    for (const t of (await real.client.listTools()).tools) {
      expect(t.inputSchema.type, t.name).toBe("object");
      if (t.name !== "ping") expect(t.outputSchema, t.name).toBeDefined();
    }
  });
});

describe("every model-visible tool answers with text AND structured content", () => {
  const calls: [string, Record<string, unknown>][] = [
    ["top_promotions", { from: "2025-04-01", to: "2025-06-30" }],
    ["sales_trend", { productId: "P021", store: "Sfax" }],
    ["search_products", { query: "olive oil" }],
    ["pick_products", {}],
    ["promo_calendar", { from: "2025-06-01", to: "2025-06-30" }],
  ];
  it.each(calls)("%s", async (name, args) => {
    const r: any = await real.client.callTool({ name, arguments: args });
    expect(r.isError ?? false).toBe(false);
    expect(textOf(r).length).toBeGreaterThan(20); // a complete answer for hosts that cannot show views
    expect(r.structuredContent).toBeTypeOf("object");
  });

  it("ping answers with text only", async () => {
    const r: any = await real.client.callTool({ name: "ping", arguments: { name: "test" } });
    expect(textOf(r)).toMatch(/^pong test at /);
  });
});

describe("tool results are correct (on fixtures with known answers)", () => {
  it("top_promotions text shows the exact uplift of the best promotion", async () => {
    const r: any = await mini.client.callTool({ name: "top_promotions", arguments: { from: "2025-01-01", to: "2025-12-31" } });
    expect(textOf(r)).toContain("| 1 | Late March (PR3)");
    expect(textOf(r)).toContain("+100%");
    expect(r.structuredContent.rows.map((p: any) => p.promoId)).toEqual(["PR3", "PR2", "PR1"]);
  });

  it("sales_trend text and data agree, and report the promo-vs-normal comparison", async () => {
    const r: any = await mini.client.callTool({ name: "sales_trend", arguments: { productId: "P1", store: "Sfax" } });
    expect(r.structuredContent.store).toBe("Sfax");
    expect(r.structuredContent.points).toHaveLength(14);
    expect(textOf(r)).toContain("Promoted weeks averaged");
  });

  it("sales_trend for a product with no sales is a friendly answer, not an error or a crash", async () => {
    const r: any = await mini.client.callTool({ name: "sales_trend", arguments: { productId: "P3" } });
    expect(r.isError ?? false).toBe(false);
    expect(textOf(r)).toContain("No sales recorded");
    expect(r.structuredContent.points).toEqual([]);
  });

  it("promo_calendar reports clashes in the text, and 'No clashes' when there are none", async () => {
    const june: any = await real.client.callTool({ name: "promo_calendar", arguments: { from: "2025-06-01", to: "2025-06-30" } });
    expect(textOf(june)).toContain("Summer Fresh Dairy (PR09) overlaps Dairy Mega Deal (PR10) for 7 days");
    expect(june.structuredContent.clashes).toHaveLength(1);

    const march: any = await real.client.callTool({ name: "promo_calendar", arguments: { from: "2025-03-01", to: "2025-03-31" } });
    expect(textOf(march)).toContain("No clashes in this period.");
    expect(march.structuredContent.clashes).toEqual([]);
  });

  it("pick_products pre-fills the picker and lists categories and stores", async () => {
    const r: any = await real.client.callTool({ name: "pick_products", arguments: { query: "olive", category: "Pantry" } });
    expect(r.structuredContent).toMatchObject({ query: "olive", category: "Pantry" });
    expect(r.structuredContent.stores).toHaveLength(8);
    expect(r.structuredContent.categories).toContain("Dairy");
  });

  it("the app-only tool still works when called directly (hiding it is the HOST's job, not the server's)", async () => {
    const r: any = await real.client.callTool({ name: "search_products_ui", arguments: { query: "olive" } });
    expect(r.structuredContent).toMatchObject({ total: 2 });
    expect(r.structuredContent.products.map((p: any) => p.productId)).toEqual(["P021", "P022"]);
    const browse: any = await real.client.callTool({ name: "search_products_ui", arguments: { query: "" } });
    expect(browse.structuredContent.products).toHaveLength(12); // default page size
    expect(browse.structuredContent.total).toBe(60);
  });
});

describe("bad inputs return isError with a message the model can act on", () => {
  const bad: [string, string, Record<string, unknown>, RegExp][] = [
    ["reversed dates", "top_promotions", { from: "2025-06-30", to: "2025-04-01" }, /must not be after/],
    ["date in the wrong format", "top_promotions", { from: "yesterday", to: "2025-04-01" }, /ISO format YYYY-MM-DD/],
    ["limit above the maximum", "top_promotions", { from: "2025-01-01", to: "2025-12-31", limit: 500 }, /limit/],
    ["limit of zero", "top_promotions", { from: "2025-01-01", to: "2025-12-31", limit: 0 }, /limit/],
    ["unknown product", "sales_trend", { productId: "P999" }, /Unknown product P999.*search_products/],
    ["unknown store", "sales_trend", { productId: "P021", store: "Paris" }, /Unknown store "Paris".*Sfax/],
    ["missing required argument", "sales_trend", {}, /productId/],
    ["empty search query", "search_products", { query: "" }, /query/],
    ["unknown category", "search_products", { query: "milk", category: "Toys" }, /category/],
    ["calendar with reversed dates", "promo_calendar", { from: "2025-06-30", to: "2025-06-01" }, /must not be after/],
  ];
  it.each(bad)("%s", async (_label, name, args, message) => {
    const r: any = await real.client.callTool({ name, arguments: args });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(message);
  });
});

describe("UI resources (MCP Apps)", () => {
  const viewsBuilt = existsSync(path.join(ROOT, "dist/views/table/index.html"));

  it("the views are built (run `npm run build:views`)", () => {
    expect(viewsBuilt, "dist/views/table/index.html is missing: run `npm run build:views`").toBe(true);
  });

  it("every UI-linked tool points at a listed ui:// resource", async () => {
    const tools = (await real.client.listTools()).tools;
    const resources = (await real.client.listResources()).resources.map((r) => r.uri);
    const linked = tools.filter((t) => (t._meta as any)?.ui?.resourceUri);
    expect(linked.map((t) => t.name).sort()).toEqual(["pick_products", "promo_calendar", "sales_trend", "top_promotions"]);
    for (const t of linked) {
      const uri = (t._meta as any).ui.resourceUri as string;
      expect(uri, t.name).toMatch(/^ui:\/\/promolite\//);
      expect(resources, t.name).toContain(uri);
      // the legacy key is also set, for older hosts
      expect((t._meta as any)["ui/resourceUri"], t.name).toBe(uri);
    }
  });

  it("every resource can be read, has the MCP App MIME type and is one self-contained HTML page", async () => {
    const resources = (await real.client.listResources()).resources;
    expect(resources.length).toBe(4);
    for (const r of resources) {
      const res: any = await real.client.readResource({ uri: r.uri });
      const content = res.contents[0];
      expect(content.mimeType, r.uri).toBe(RESOURCE_MIME_TYPE);
      expect(content.text.toLowerCase().startsWith("<!doctype html>"), r.uri).toBe(true);
      // single-file build: no external script or stylesheet to fetch (the host's CSP would block it anyway)
      expect(content.text, r.uri).not.toMatch(/<script[^>]+src=["']https?:/i);
      expect(content.text, r.uri).not.toMatch(/<link[^>]+href=["']https?:/i);
    }
  });

  it("every view declares a STRICT CSP: nothing may be loaded from the network, on the listing and on the content", async () => {
    const strict = { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] };
    const resources = (await real.client.listResources()).resources;
    for (const r of resources) {
      expect((r._meta as any)?.ui?.csp, `${r.uri} (listing)`).toEqual(strict);
      const res: any = await real.client.readResource({ uri: r.uri });
      expect(res.contents[0]._meta?.ui?.csp, `${r.uri} (content)`).toEqual(strict);
    }
  });

  it("no view contains a reference to an outside origin that it could load (fonts, scripts, styles, images, fetches)", async () => {
    // Plain strings inside library code (schema URLs, error-message links) are fine; what must NOT exist is a tag or CSS
    // that makes the browser fetch something.
    for (const r of (await real.client.listResources()).resources) {
      const html: string = ((await real.client.readResource({ uri: r.uri })) as any).contents[0].text;
      expect(html, r.uri).not.toMatch(/<(script|link|img|iframe|source|video|audio)\b[^>]*\b(src|href)=["']https?:\/\//i);
      expect(html, r.uri).not.toMatch(/@import\s+(url\()?["']?https?:/i);
      expect(html, r.uri).not.toMatch(/url\(\s*["']?https?:\/\//i);
    }
  });

  it("reading an unknown resource fails cleanly", async () => {
    await expect(real.client.readResource({ uri: "ui://promolite/nope" })).rejects.toThrow();
  });
});
