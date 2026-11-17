/**
 * LAYER 1 - pure React component. Takes `rows` as props, knows nothing about MCP.
 * (That is what lets Day 6 reuse it in the standalone "Cora panel" page and Day 7 test it with Testing Library.)
 */
import { useMemo, useState } from "react";
import type { PromoResult } from "../../server/schemas.js";

type Key = "name" | "type" | "discountPct" | "category" | "region" | "uplift" | "incrementalUnits";

interface Column {
  key: Key;
  label: string;
  numeric: boolean;
}

const COLUMNS: Column[] = [
  { key: "name", label: "Promotion", numeric: false },
  { key: "type", label: "Type", numeric: false },
  { key: "discountPct", label: "Discount", numeric: true },
  { key: "category", label: "Category", numeric: false },
  { key: "region", label: "Region", numeric: false },
  { key: "uplift", label: "Uplift", numeric: true },
  { key: "incrementalUnits", label: "Extra units", numeric: true },
];

export const formatPct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(0)}%`;
const TYPE_LABEL: Record<string, string> = { percent_off: "% off", bogo: "BOGO", bundle: "Bundle" };

export function PromoTable({ rows }: { rows: PromoResult[] }) {
  // Default: best uplift first. Clicking a header sorts by it; clicking again flips the direction.
  const [sort, setSort] = useState<{ key: Key; dir: "asc" | "desc" }>({ key: "uplift", dir: "desc" });

  const sorted = useMemo(() => {
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sign;
    });
  }, [rows, sort]);

  const onHeaderClick = (col: Column) =>
    setSort((s) =>
      s.key === col.key
        ? { key: col.key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: col.numeric ? "desc" : "asc" },
    );

  if (rows.length === 0) return <p className="state">No promotions in this period.</p>;

  return (
    <table className="promo-table">
      <thead>
        <tr>
          {COLUMNS.map((col) => (
            <th
              key={col.key}
              className={col.numeric ? "num" : undefined}
              aria-sort={sort.key === col.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
            >
              <button type="button" onClick={() => onHeaderClick(col)}>
                {col.label}
                <span aria-hidden="true" className="arrow">
                  {sort.key === col.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </span>
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.promoId}>
            <td>
              {r.name} <span className="id">{r.promoId}</span>
            </td>
            <td>
              <span className={`badge badge-${r.type}`}>{TYPE_LABEL[r.type] ?? r.type}</span>
            </td>
            <td className="num">{r.discountPct}%</td>
            <td>{r.category}</td>
            <td>{r.region}</td>
            <td className={`num ${r.uplift >= 0 ? "pos" : "neg"}`}>{formatPct(r.uplift)}</td>
            <td className="num">{r.incrementalUnits.toLocaleString("en-US")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
