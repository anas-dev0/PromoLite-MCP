// NEVER console.log here: stdout is the protocol channel. Use console.error (stderr) for logs.
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";

await createServer().connect(new StdioServerTransport());
console.error("promolite MCP server running on stdio");
