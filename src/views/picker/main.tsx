/**
 * Thin MCP wrapper for the product picker. This is the first view that TALKS BACK:
 *
 *  - search: app.callServerTool("search_products_ui") goes view -> host -> server, with NO model in the loop.
 *    That is why it is fast and costs nothing. The tool is marked `visibility: ["app"]`, so the model never sees it.
 *  - confirm: the choice is handed back to the conversation so the model can continue with exact IDs.
 */
import { StrictMode, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { PickProductsOutput, SearchProductsUiOutput } from "../../server/schemas.js";
import { Card, ErrorState, LoadingState } from "../shared/components/index.js";
import { ProductPicker } from "../shared/components/ProductPicker.js";
import { handBack } from "../shared/handBack.js";
import "../shared/styles.css";
import { useToolView } from "../shared/useToolView.js";

function App() {
  const { state, app } = useToolView("PromoLite product picker", PickProductsOutput);

  // Stable identity (useCallback): the picker re-runs its search effect whenever this function changes.
  const search = useCallback(
    async (query: string, category: string | null) => {
      if (!app) throw new Error("Not connected to the host yet.");
      const res = await app.callServerTool({
        name: "search_products_ui",
        arguments: { query, ...(category ? { category } : {}) },
      });
      if (res.isError) {
        throw new Error(res.content?.map((c) => ("text" in c ? c.text : "")).join(" ") || "Search failed.");
      }
      const parsed = SearchProductsUiOutput.safeParse(res.structuredContent);
      if (!parsed.success) throw new Error("Unexpected data shape from the server.");
      return parsed.data;
    },
    [app],
  );

  if (state.kind === "loading" || !app) return <LoadingState label="Opening the picker…" />;
  if (state.kind === "error") return <ErrorState message={state.message} />;

  return (
    <Card title="Pick products and stores" subtitle="Search, select, then send your choice to the chat">
      <ProductPicker
        stores={state.data.stores}
        categories={state.data.categories}
        initialQuery={state.data.query}
        initialCategory={state.data.category}
        search={search}
        onConfirm={(selection) => handBack(app, selection)}
      />
    </Card>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
