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

async function readView(name: string): Promise<string> {
  try {
    return await readFile(path.join(VIEWS_DIR, name, "index.html"), "utf8");
  } catch {
    throw new Error(`View "${name}" is not built. Run: npm run build:views`);
  }
}

export function registerViews(server: McpServer) {
  registerAppResource(
    server,
    "Top promotions table",
    TABLE_URI,
    { description: "Sortable table of promotions ranked by uplift" },
    async () => ({
      // Read on every request: rebuilding the view during development needs no server restart.
      contents: [{ uri: TABLE_URI, mimeType: RESOURCE_MIME_TYPE, text: await readView("table") }],
    }),
  );
}
