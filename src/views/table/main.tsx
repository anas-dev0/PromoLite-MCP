/**
 * Thin MCP wrapper: connects to the host (via the shared hook) and renders the shared <PromoTable>.
 * All the plumbing (handshake, theming, result validation) lives in ../shared/useToolView.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TopPromotionsOutput } from "../../server/schemas.js";
import { Card, ErrorState, LoadingState, PromoTable } from "../shared/components/index.js";
import "../shared/styles.css";
import { useToolView } from "../shared/useToolView.js";

function App() {
  const state = useToolView("PromoLite top promotions", TopPromotionsOutput);
  if (state.kind === "loading") return <LoadingState label="Loading promotions…" />;
  if (state.kind === "error") return <ErrorState message={state.message} />;
  return (
    <Card title="Top promotions by uplift" subtitle={`${state.data.from} → ${state.data.to}`}>
      <PromoTable rows={state.data.rows} />
    </Card>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
