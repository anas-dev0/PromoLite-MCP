/**
 * MCP Apps wiring: each view is a `ui://` RESOURCE (one HTML file) that a tool points at via
 * _meta.ui.resourceUri. The host reads the resource and shows it in a sandboxed iframe.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { ROOT } from "./data.js";

// Built by `npm run build:views`. Resolved from ROOT (not the cwd) like the CSVs.
const VIEWS_DIR = path.join(ROOT, "dist/views");

export const TABLE_URI = "ui://promolite/top-promotions";
export const TREND_URI = "ui://promolite/sales-trend";
export const PICKER_URI = "ui://promolite/picker";
export const CALENDAR_URI = "ui://promolite/calendar";

async function readView(name: string): Promise<string> {
  try {
    return await readFile(path.join(VIEWS_DIR, name, "index.html"), "utf8");
  } catch {
    throw new Error(`View "${name}" is not built. Run: npm run build:views`);
  }
}

/**
 * STRICT CSP: the views declare that they need NOTHING from the network. Each list maps to a CSP directive:
 *   connectDomains  -> connect-src  (fetch / XHR / WebSocket)      resourceDomains -> img/script/style/font/media-src
 *   frameDomains    -> frame-src    (nested iframes)               baseUriDomains  -> base-uri
 * An empty list means "none". The spec already treats omitted fields as empty (the secure default), but saying it
 * explicitly documents the policy in code and lets a test lock it in. This is possible because every view is ONE
 * self-contained HTML file (JS and CSS inlined, no CDN fonts); the view's data arrives through the host's postMessage
 * bridge, not through the network.
 */
export const STRICT_CSP: Record<"connectDomains" | "resourceDomains" | "frameDomains" | "baseUriDomains", string[]> = {
  connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [],
};
/** A fresh copy per use, so nobody can mutate the shared policy by accident. */
const strictUiMeta = () => ({ ui: { csp: { connectDomains: [...STRICT_CSP.connectDomains], resourceDomains: [...STRICT_CSP.resourceDomains], frameDomains: [...STRICT_CSP.frameDomains], baseUriDomains: [...STRICT_CSP.baseUriDomains] } } });

/** One resource per view. Read on every request, so rebuilding a view needs no server restart. */
function registerView(server: McpServer, title: string, uri: string, folder: string, description: string) {
  registerAppResource(server, title, uri, { description, _meta: strictUiMeta() }, async () => ({
    // The content item's _meta takes precedence over the listing's, so it carries the policy too.
    contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: await readView(folder), _meta: strictUiMeta() }],
  }));
}

export function registerViews(server: McpServer) {
  registerView(server, "Top promotions table", TABLE_URI, "table", "Sortable table of promotions ranked by uplift");
  registerView(server, "Sales trend chart", TREND_URI, "trend", "Weekly sales line with promotion weeks shaded");
  registerView(server, "Product picker", PICKER_URI, "picker", "Search and select exact products and stores");
  registerView(server, "Promotions calendar", CALENDAR_URI, "calendar", "Promotions on a calendar with clashes highlighted");
}
