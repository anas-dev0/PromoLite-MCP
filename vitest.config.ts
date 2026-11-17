import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    // Node by default (data + protocol tests). View tests opt in to a browser-like DOM with a
    // `// @vitest-environment jsdom` comment on their first line.
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    css: false,
  },
});
