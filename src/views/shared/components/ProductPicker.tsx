/**
 * Pure React component: no MCP inside. It gets two callbacks as props:
 *   search(query, category)  -> products   (the wrapper implements it with app.callServerTool, NO model involved)
 *   onConfirm(selection)     -> note       (the wrapper hands the choice back to the conversation)
 *
 * Two behaviours that matter for a search-as-you-type box:
 *   1. DEBOUNCE: wait until the user stops typing (250 ms) before searching, so "olive" sends 1 request, not 5.
 *   2. STALE RESPONSES: responses can arrive out of order. Every request gets a number; only the response of the
 *      LATEST request is allowed to update the screen. Without this, a slow answer for "ol" could overwrite the
 *      answer for "olive oil".
 */
import { useEffect, useRef, useState } from "react";
import type { Product, Store } from "../../../server/schemas.js";
import { useDebouncedValue } from "../useDebouncedValue.js";
import { LoadingState } from "./States.js";

export interface Selection {
  products: Product[];
  stores: Store[];
}

interface Props {
  stores: Store[];
  categories: string[];
  initialQuery?: string;
  initialCategory?: string | null;
  /** Must be referentially stable (useCallback), otherwise the effect below would re-run on every render. */
  search: (query: string, category: string | null) => Promise<{ products: Product[]; total: number }>;
  /** `note` is shown to the user. `copyText` (optional) is a ready-to-paste message for hosts that cannot receive it. */
  onConfirm: (selection: Selection) => Promise<{ note: string; copyText?: string }>;
}

type SearchState =
  | { status: "loading"; products: Product[]; total: number }
  | { status: "ready"; products: Product[]; total: number }
  | { status: "error"; products: Product[]; total: number; message: string };

type SendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent"; note: string; copyText?: string }
  | { status: "error"; message: string };

export const DEBOUNCE_MS = 250;

export function ProductPicker({ stores, categories, initialQuery = "", initialCategory = null, search, onConfirm }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<string | null>(initialCategory);
  const [result, setResult] = useState<SearchState>({ status: "loading", products: [], total: 0 });
  const [selected, setSelected] = useState<Product[]>([]);
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [send, setSend] = useState<SendState>({ status: "idle" });

  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const latestRequest = useRef(0);

  useEffect(() => {
    const id = ++latestRequest.current;
    setResult((r) => ({ ...r, status: "loading" }));
    search(debouncedQuery, category).then(
      (res) => {
        if (id === latestRequest.current) setResult({ status: "ready", ...res });
      },
      (err: unknown) => {
        if (id === latestRequest.current) {
          setResult((r) => ({ ...r, status: "error", message: err instanceof Error ? err.message : String(err) }));
        }
      },
    );
    return () => {
      // unmount (or a new request starting) -> make sure an old answer can never apply
      if (latestRequest.current === id) latestRequest.current++;
    };
  }, [debouncedQuery, category, search]);

  const isSelected = (p: Product) => selected.some((s) => s.productId === p.productId);
  const toggleProduct = (p: Product) => {
    setSend({ status: "idle" });
    setSelected((cur) => (isSelected(p) ? cur.filter((s) => s.productId !== p.productId) : [...cur, p]));
  };
  const toggleStore = (id: string) => {
    setSend({ status: "idle" });
    setStoreIds((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));
  };

  const confirm = async () => {
    setSend({ status: "sending" });
    try {
      const { note, copyText } = await onConfirm({
        products: selected,
        stores: stores.filter((s) => storeIds.includes(s.storeId)),
      });
      setSend({ status: "sent", note, ...(copyText ? { copyText } : {}) });
    } catch (err) {
      setSend({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="picker">
      <div className="picker-controls">
        <input
          type="search"
          className="input"
          placeholder="Search products (e.g. olive oil)"
          aria-label="Search products"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="input" aria-label="Category" value={category ?? ""} onChange={(e) => setCategory(e.target.value || null)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="picker-status" aria-live="polite">
        {result.status === "loading" ? <LoadingState label="Searching…" /> : null}
        {result.status === "error" ? <p className="state error" role="alert">Search failed: {result.message}</p> : null}
        {result.status === "ready" && result.products.length === 0 ? (
          <p className="state">No products match. Try fewer or different words.</p>
        ) : null}
        {result.status === "ready" && result.products.length > 0 ? (
          <p className="stats">Showing {result.products.length} of {result.total}</p>
        ) : null}
      </div>

      <ul className="result-list" aria-label="Search results">
        {result.products.map((p) => (
          <li key={p.productId}>
            <label>
              <input type="checkbox" checked={isSelected(p)} onChange={() => toggleProduct(p)} />
              <span className="result-name">{p.name}</span>
              <span className="id">{p.productId}</span>
              <span className="result-meta">{p.category} · {p.basePrice} TND</span>
            </label>
          </li>
        ))}
      </ul>

      <fieldset className="stores">
        <legend>Stores <span className="id">(none selected = all stores)</span></legend>
        <div className="chip-row">
          {stores.map((s) => (
            <label key={s.storeId} className={`chip-toggle${storeIds.includes(s.storeId) ? " on" : ""}`}>
              <input type="checkbox" checked={storeIds.includes(s.storeId)} onChange={() => toggleStore(s.storeId)} />
              {s.city}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="picker-footer">
        <div className="chip-row" aria-label="Selected products">
          {selected.length === 0 ? <span className="id">Nothing selected yet</span> : null}
          {selected.map((p) => (
            <button key={p.productId} type="button" className="chip" aria-label={`Remove ${p.name}`} onClick={() => toggleProduct(p)}>
              {p.name} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="primary"
          disabled={selected.length === 0 || send.status === "sending"}
          onClick={() => void confirm()}
        >
          {send.status === "sending" ? "Sending…" : "Use these products"}
        </button>
      </div>

      {send.status === "sent" ? (
        <div role="status">
          <p className="state ok">{send.note}</p>
          {send.copyText ? <CopyBox text={send.copyText} /> : null}
        </div>
      ) : null}
      {send.status === "error" ? <p className="state error" role="alert">Could not send: {send.message}</p> : null}
    </div>
  );
}

/** Read-only box + Copy button. The clipboard API can be blocked inside a sandboxed iframe, so the text is also
 *  selectable by hand (click selects everything). */
function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copybox">
      <textarea readOnly rows={3} value={text} aria-label="Message to paste into the chat" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="chip"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
