/**
 * The standalone panel is a NORMAL Vite app (multi-file, served over HTTP), unlike the views, which are
 * single-file HTML resources.   npm run dev:panel   (http://localhost:5173)    npm run build:panel   (dist/panel)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(ROOT, "src/panel"),
  base: "./",
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: path.join(ROOT, "dist/panel"), emptyOutDir: true, target: "es2022" },
});
