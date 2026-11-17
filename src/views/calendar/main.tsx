/**
 * Thin MCP wrapper for the promotions calendar.
 *
 * Month navigation is a SECOND kind of view-to-server call (Day 5's was search): the view asks the server for another
 * month directly with app.callServerTool("promo_calendar"), with no model turn. The "Clashes only" toggle, by contrast,
 * is pure view state and never touches the server.
 */
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PromoCalendarOutput } from "../../server/schemas.js";
import { monthRange } from "../shared/calendarLayout.js";
import { Card, ErrorState, LoadingState } from "../shared/components/index.js";
import { PromoCalendar } from "../shared/components/PromoCalendar.js";
import "../shared/styles.css";
import { useToolView } from "../shared/useToolView.js";

function App() {
  const { state, app } = useToolView("PromoLite calendar", PromoCalendarOutput);
  const [navData, setNavData] = useState<PromoCalendarOutput | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [navError, setNavError] = useState<string | null>(null);
  const latest = useRef(0);

  const initial = state.kind === "ready" ? state.data : null;
  // If the host sends a NEW tool result (the model called the tool again), it replaces whatever we navigated to.
  useEffect(() => {
    setNavData(null);
    setNavError(null);
  }, [initial]);

  const shown = navData ?? initial;

  const navigate = useCallback(
    async (dir: -1 | 1) => {
      if (!app || !shown) return;
      const { from, to } = monthRange(shown.from, dir);
      const id = ++latest.current; // only the latest click may update the screen
      setNavigating(true);
      setNavError(null);
      try {
        const res = await app.callServerTool({
          name: "promo_calendar",
          arguments: { from, to, ...(shown.category ? { category: shown.category } : {}) },
        });
        if (id !== latest.current) return;
        if (res.isError) throw new Error(res.content?.map((c) => ("text" in c ? c.text : "")).join(" ") || "Request failed.");
        const parsed = PromoCalendarOutput.safeParse(res.structuredContent);
        if (!parsed.success) throw new Error("Unexpected data shape from the server.");
        setNavData(parsed.data);
      } catch (err) {
        if (id === latest.current) setNavError(`Could not load that month: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (id === latest.current) setNavigating(false);
      }
    },
    [app, shown],
  );

  if (state.kind === "loading") return <LoadingState label="Loading calendar…" />;
  if (state.kind === "error") return <ErrorState message={state.message} />;
  if (!shown) return <LoadingState label="Loading calendar…" />;

  return (
    <Card title="Promotions calendar" subtitle="Click a bar for details">
      <PromoCalendar data={shown} onNavigate={navigate} navigating={navigating} navError={navError} />
    </Card>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
