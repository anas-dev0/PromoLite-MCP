/**
 * The MCP plumbing every view needs, written once:
 *   1. connect to the host (ui/initialize handshake)
 *   2. apply the host's theme, colors and fonts
 *   3. receive the tool result and validate it with the SAME Zod schema the server uses
 *
 * A view then only writes: `const state = useToolView("name", Schema)` and renders the state.
 */
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import type { z } from "zod";

export type ViewState<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };

export function useToolView<S extends z.ZodType>(appName: string, schema: S): ViewState<z.infer<S>> {
  const [state, setState] = useState<ViewState<z.infer<S>>>({ kind: "loading" });

  const { app, error } = useApp({
    appInfo: { name: appName, version: "0.1.0" },
    capabilities: {},
    // Handlers must be set BEFORE the connection completes, or the first notification can be missed.
    onAppCreated: (created) => {
      created.ontoolresult = (result) => {
        if (result.isError) {
          const msg = result.content?.map((c) => ("text" in c ? c.text : "")).join(" ").trim();
          setState({ kind: "error", message: msg || "The tool returned an error." });
          return;
        }
        const parsed = schema.safeParse(result.structuredContent);
        setState(
          parsed.success
            ? { kind: "ready", data: parsed.data }
            : { kind: "error", message: "Unexpected data shape from the server." },
        );
      };
    },
  });

  // Applies the host's CSS variables, color-scheme (light/dark) and fonts to <html>, and keeps them updated.
  useHostStyles(app, app?.getHostContext());

  if (error) return { kind: "error", message: `Could not connect to the host: ${error.message}` };
  return state;
}
