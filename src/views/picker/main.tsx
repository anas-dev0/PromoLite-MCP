/**
 * Thin MCP wrapper for the product picker. This is the first view that TALKS BACK:
 *
 *  - search: app.callServerTool("search_products_ui") goes view -> host -> server, with NO model in the loop.
 *    That is why it is fast and costs nothing. The tool is marked `visibility: ["app"]`, so the model never sees it.
 *  - confirm: the choice is handed back to the conversation so the model can continue with exact IDs.
 */
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { StrictMode, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { PickProductsOutput, SearchProductsUiOutput } from "../../server/schemas.js";
import { Card, ErrorState, LoadingState } from "../shared/components/index.js";
import { ProductPicker, type Selection } from "../shared/components/ProductPicker.js";
import { buildSelectionMessage } from "../shared/selection.js";
import "../shared/styles.css";
import { useToolView } from "../shared/useToolView.js";

/**
 * Two ways to tell the conversation about the choice (ext-apps view-to-host requests):
 *   sendMessage        posts a visible user message and the model REPLIES to it (it continues by itself)
 *   updateModelContext silently adds context for the model's NEXT turn (nothing is shown, nothing starts)
 * We prefer sendMessage, because the user expects the next step to happen when they press the button. Hosts declare
 * what they support in their capabilities; if `message` is missing we fall back to updateModelContext and tell the user
 * to continue the conversation. If a host supports neither, we show the message so the user can paste it into the chat themselves.
 */
async function handBack(app: McpApp, selection: Selection): Promise<{ note: string; copyText?: string }> {
  const text = buildSelectionMessage(selection.products, selection.stores);
  const caps = app.getHostCapabilities();

  if (caps?.message) {
    const res = await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
    if (res.isError) throw new Error("The host refused the message.");
    return { note: "Sent to the conversation." };
  }
  if (caps?.updateModelContext) {
    const res = await app.updateModelContext({
      content: [{ type: "text", text: `The user selected in the PromoLite picker: ${text}` }],
      structuredContent: {
        products: selection.products.map((p) => p.productId),
        stores: selection.stores.map((s) => s.storeId),
      },
    });
    if ((res as { isError?: boolean }).isError) throw new Error("The host refused the context update.");
    return { note: "Selection shared with Claude. Send any message (for example “continue”) and it will use it." };
  }
  // Neither request is supported (e.g. the MCP Inspector): give the user the message to paste by hand.
  return { note: "This host cannot receive a selection from the view. Paste this message into the chat:", copyText: text };
}

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
