/**
 * The ONLY MCP-specific code of the standalone panel: a normal MCP client over Streamable HTTP.
 * In an AI app, data reaches the view through the host (`App`). Here there is no host and no iframe: the page
 * itself calls the server. The shared components cannot tell the difference, because they only take props.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { z } from "zod";

// 127.0.0.1, not "localhost": Node-side clients resolve localhost to IPv6 first and the server listens on IPv4.
// (A browser would cope, but keeping one convention avoids a nasty surprise.) Override with ?server=https://host/mcp
const DEFAULT_URL = "http://127.0.0.1:3000/mcp";

export function serverUrl(): string {
  return new URLSearchParams(window.location.search).get("server") ?? DEFAULT_URL;
}

let connecting: Promise<Client> | undefined;

/** One connection, created lazily and reused by every call. */
function connect(): Promise<Client> {
  connecting ??= (async () => {
    const client = new Client({ name: "promolite-panel", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl())));
    return client;
  })().catch((err) => {
    connecting = undefined; // allow a retry after a failure
    throw err;
  });
  return connecting;
}

/** Calls a tool and validates its structuredContent with the SAME Zod schema the server uses. */
export async function callTool<S extends z.ZodType>(name: string, args: Record<string, unknown>, schema: S): Promise<z.infer<S>> {
  const client = await connect();
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) {
    const text = (res.content as { type: string; text?: string }[]).map((c) => c.text ?? "").join(" ");
    throw new Error(text || "The server returned an error.");
  }
  const parsed = schema.safeParse(res.structuredContent);
  if (!parsed.success) throw new Error("Unexpected data shape from the server.");
  return parsed.data;
}
