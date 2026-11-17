import { useEffect, useState } from "react";

/**
 * Returns `value`, but only after it has stopped changing for `delayMs`.
 * Typing "olive" fires 5 changes; the debounced value changes once, 250 ms after the last keystroke,
 * so we send ONE request instead of five.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer); // a new keystroke cancels the pending update
  }, [value, delayMs]);
  return debounced;
}
