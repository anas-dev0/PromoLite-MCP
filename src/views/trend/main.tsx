/** Thin MCP wrapper for the sales trend chart. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SalesTrendOutput } from "../../server/schemas.js";
import { Card, ErrorState, LoadingState, TrendChart } from "../shared/components/index.js";
import { formatNumber } from "../shared/format.js";
import "../shared/styles.css";
import { useToolView } from "../shared/useToolView.js";

function App() {
  const state = useToolView("PromoLite sales trend", SalesTrendOutput);
  if (state.kind === "loading") return <LoadingState label="Loading sales trend…" />;
  if (state.kind === "error") return <ErrorState message={state.message} />;

  const { productName, productId, store, points } = state.data;
  const total = points.reduce((sum, p) => sum + p.units, 0);
  const promoWeeks = points.filter((p) => p.promoId).length;
  return (
    <Card title={productName} subtitle={`${productId} · ${store} · 2025`}>
      <p className="stats">
        {formatNumber(total)} units over {points.length} weeks, {promoWeeks} on promotion
      </p>
      <TrendChart points={points} />
    </Card>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
