/**
 * Turns the picker's selection into the message that goes back to the conversation.
 * Pure function (easy to test): the model needs EXACT product IDs, so IDs are always included.
 */
import type { Product, Store } from "../../server/schemas.js";

export function buildSelectionMessage(products: Product[], stores: Store[]): string {
  const items = products.map((p) => `${p.name} (${p.productId})`).join(", ");
  const where = stores.length ? stores.map((s) => `${s.city} (${s.storeId})`).join(", ") : "all stores";
  const many = products.length > 1;
  return (
    `Show the sales trend for ${many ? "each of these products" : "this product"}: ${items}. ` +
    `Store${stores.length > 1 ? "s" : ""}: ${where}.`
  );
}
