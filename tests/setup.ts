/** Runs before every test file. DOM helpers are only wired up when the file runs in jsdom. */
import { afterEach } from "vitest";

if (typeof document !== "undefined") {
  // `toBeInTheDocument()`, `toHaveAttribute()`... on expect()
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  // Unmount what a test rendered, so tests cannot leak into each other.
  afterEach(() => cleanup());

  // jsdom has no layout engine and no ResizeObserver; recharts' ResponsiveContainer needs one to exist.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
