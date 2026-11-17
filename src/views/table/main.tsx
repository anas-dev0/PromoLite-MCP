/**
 * LAYER 2 - thin MCP wrapper. Connects to the host, receives the tool result, passes it to <PromoTable>.
 *
 * Lifecycle: the iframe loads -> useApp() does the `ui/initialize` handshake with the host -> the host pushes
 * the tool input and then the tool result as NOTIFICATIONS. So we cannot assume data exists at startup:
 * we render a loading state until `ontoolresult` fires.
 */
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { TopPromotionsOutput } from "../../server/schemas.js";
import { PromoTable } from "./PromoTable.js";
import "./styles.css";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: TopPromotionsOutput };

function App() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const { error } = useApp({
    appInfo: { name: "PromoLite top promotions", version: "0.1.0" },
    capabilities: {},
    // Handlers must be set BEFORE the connection completes, or the first notification can be missed.
    onAppCreated: (app) => {
      app.ontoolresult = (result) => {
        if (result.isError) {
          const msg = result.content?.map((c) => ("text" in c ? c.text : "")).join(" ") || "The tool returned an error.";
          setState({ kind: "error", message: msg });
          return;
        }
        // Same Zod schema the server uses for its outputSchema: server and view cannot disagree on fields.
        const parsed = TopPromotionsOutput.safeParse(result.structuredContent);
        setState(
          parsed.success
            ? { kind: "ready", data: parsed.data }
            : { kind: "error", message: "Unexpected data shape from the server." },
        );
      };
    },
  });

  if (error) return <p className="state error">Could not connect to the host: {error.message}</p>;
  if (state.kind === "loading") return <p className="state">Loading promotions…</p>;
  if (state.kind === "error") return <p className="state error">{state.message}</p>;
  return (
    <section>
      <h1>
        Top promotions by uplift <small>{state.data.from} → {state.data.to}</small>
      </h1>
      <PromoTable rows={state.data.rows} />
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
