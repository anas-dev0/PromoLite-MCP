import type { ReactNode } from "react";

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "pos"; children: ReactNode }) {
  return <span className={`badge${tone === "neutral" ? "" : ` badge-${tone}`}`}>{children}</span>;
}
