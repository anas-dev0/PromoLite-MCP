/**
 * Hands the picker's selection back to the conversation.
 *
 * Two ways to tell the conversation (ext-apps view-to-host requests):
 *   sendMessage        posts a visible user message and the model REPLIES to it (it continues by itself)
 *   updateModelContext silently adds context for the model's NEXT turn (nothing is shown, nothing starts)
 * We prefer sendMessage, because the user expects the next step to happen when they press the button. Hosts declare
 * what they support in their capabilities; if `message` is missing we fall back to updateModelContext and tell the
 * user to continue the conversation. If a host supports neither (e.g. the MCP Inspector), we return the message so the
 * user can paste it into the chat themselves.
 *
 * Takes only the three App methods it needs (a structural type), so tests can pass a plain mock object.
 */
import type { App } from "@modelcontextprotocol/ext-apps";
import { buildSelectionMessage } from "./selection.js";
import type { Selection } from "./components/ProductPicker.js";

export type HandBackApp = Pick<App, "getHostCapabilities" | "sendMessage" | "updateModelContext">;

export async function handBack(app: HandBackApp, selection: Selection): Promise<{ note: string; copyText?: string }> {
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
  return { note: "This host cannot receive a selection from the view. Paste this message into the chat:", copyText: text };
}
