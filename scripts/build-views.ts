/**
 * Builds every view into ONE self-contained HTML file with vite-plugin-singlefile:
 *   src/views/<name>/index.html  ->  dist/views/<name>/index.html   (JS + CSS inlined)
 * Why one file: a host loads a view from an MCP resource, not from a web server, so there is no URL to fetch
 * main.js from, and the host's CSP blocks outside domains anyway.
 *
 * Run: npm run build:views            (all views)      npm run build:views -- table   (one view)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALL_VIEWS = ["table"]; // add "trend", "picker", "calendar" on Days 4-6

const requested = process.argv.slice(2);
for (const view of requested.length ? requested : ALL_VIEWS) {
  console.error(`building view: ${view}`);
  await build({
    configFile: false, // everything is configured here, no vite.config.ts needed
    root: path.join(ROOT, "src/views", view),
    plugins: [react(), viteSingleFile()],
    logLevel: "warn",
    build: { outDir: path.join(ROOT, "dist/views", view), emptyOutDir: true, target: "es2022" },
  });
}
