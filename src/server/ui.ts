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

async function readView(name: string): Promise<string> {
  try {
    return await readFile(path.join(VIEWS_DIR, name, "index.html"), "utf8");
  } catch {
    throw new Error(`View "${name}" is not built. Run: npm run build:views`);
  }
}

/** One resource per view. Read on every request, so rebuilding a view needs no server restart. */
function registerView(server: McpServer, title: string, uri: string, folder: string, description: string) {
  registerAppResource(server, title, uri, { description }, async () => ({
    contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: await readView(folder) }],
  }));
}

export function registerViews(server: McpServer) {
  registerView(server, "Top promotions table", TABLE_URI, "table", "Sortable table of promotions ranked by uplift");
  registerView(server, "Sales trend chart", TREND_URI, "trend", "Weekly sales line with promotion weeks shaded");
  registerView(server, "Product picker", PICKER_URI, "picker", "Search and select exact products and stores");
}
