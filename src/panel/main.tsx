/**
 * Stand-in for "Cora's own chat panel": a normal web page (NOT an MCP App, NOT inside an iframe, no model, no chat)
 * that renders the SAME shared components the AI apps render. One component library, two surfaces.
 */
import { StrictMode, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PromoCalendarOutput, SalesTrendOutput, TopPromotionsOutput,
} from "../server/schemas.js";
import { monthRange } from "../views/shared/calendarLayout.js";
import { Card, EmptyState, ErrorState, LoadingState, PromoTable, TrendChart } from "../views/shared/components/index.js";
import { PromoCalendar } from "../views/shared/components/PromoCalendar.js";
import { formatNumber } from "../views/shared/format.js";
import "../views/shared/styles.css";
import "./panel.css";
import { callTool, serverUrl } from "./mcpClient.js";

type Result =
  | { kind: "promotions"; data: TopPromotionsOutput }
  | { kind: "trend"; data: SalesTrendOutput }
  | { kind: "calendar"; data: PromoCalendarOutput };

interface Action {
  label: string;
  run: () => Promise<Result>;
}

// "Questions" a planner might click. No chat, no model: each button is one tool call.
const ACTIONS: Action[] = [
  {
    label: "Best promotions Q2",
    run: async () => ({
      kind: "promotions",
      data: await callTool("top_promotions", { from: "2025-04-01", to: "2025-06-30", limit: 8 }, TopPromotionsOutput),
    }),
  },
  {
    label: "Olive oil trend in Sfax",
    run: async () => ({
      kind: "trend",
      data: await callTool("sales_trend", { productId: "P021", store: "Sfax" }, SalesTrendOutput),
    }),
  },
  {
    label: "Calendar for June",
    run: async () => ({
      kind: "calendar",
      data: await callTool("promo_calendar", { from: "2025-06-01", to: "2025-06-30" }, PromoCalendarOutput),
    }),
  },
  {
    label: "All clashes in 2025",
    run: async () => ({
      kind: "calendar",
      data: await callTool("promo_calendar", { from: "2025-01-01", to: "2025-12-31" }, PromoCalendarOutput),
    }),
  },
];

function App() {
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [navigating, setNavigating] = useState(false);
  const latest = useRef(0); // only the latest request may update the screen

  const run = async (action: Action) => {
    const id = ++latest.current;
    setStatus("loading");
    try {
      const r = await action.run();
      if (id !== latest.current) return;
      setResult(r);
      setStatus("idle");
    } catch (e) {
      if (id !== latest.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  const navigate = useCallback(
    async (dir: -1 | 1) => {
      if (result?.kind !== "calendar") return;
      const { from, to } = monthRange(result.data.from, dir);
      const id = ++latest.current;
      setNavigating(true);
      try {
        const data = await callTool(
          "promo_calendar",
          { from, to, ...(result.data.category ? { category: result.data.category } : {}) },
          PromoCalendarOutput,
        );
        if (id === latest.current) setResult({ kind: "calendar", data });
      } catch (e) {
        if (id === latest.current) { setError(e instanceof Error ? e.message : String(e)); setStatus("error"); }
      } finally {
        if (id === latest.current) setNavigating(false);
      }
    },
    [result],
  );

  return (
    <main className="panel">
      <header className="panel-header">
        <h1>PromoLite panel <small>standalone page · same components as the AI app views</small></h1>
        <p className="stats">Server: {serverUrl()}</p>
        <div className="chip-row" role="group" aria-label="Questions">
          {ACTIONS.map((a) => (
            <button key={a.label} type="button" className="chip" onClick={() => void run(a)} disabled={status === "loading"}>
              {a.label}
            </button>
          ))}
        </div>
      </header>

      <section aria-live="polite">
        {status === "loading" ? <LoadingState label="Asking the server…" /> : null}
        {status === "error" ? <ErrorState message={error} /> : null}
        {status !== "loading" && status !== "error" && !result ? <EmptyState label="Pick a question above." /> : null}
        {status !== "loading" && status !== "error" && result?.kind === "promotions" ? (
          <Card title="Top promotions by uplift" subtitle={`${result.data.from} → ${result.data.to}`}>
            <PromoTable rows={result.data.rows} />
          </Card>
        ) : null}
        {status !== "loading" && status !== "error" && result?.kind === "trend" ? (
          <Card title={result.data.productName} subtitle={`${result.data.productId} · ${result.data.store} · 2025`}>
            <p className="stats">
              {formatNumber(result.data.points.reduce((s, p) => s + p.units, 0))} units over {result.data.points.length} weeks
            </p>
            <TrendChart points={result.data.points} />
          </Card>
        ) : null}
        {status !== "loading" && status !== "error" && result?.kind === "calendar" ? (
          <Card title="Promotions calendar" subtitle="Click a bar for details">
            <PromoCalendar data={result.data} onNavigate={(d) => void navigate(d)} navigating={navigating} />
          </Card>
        ) : null}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
