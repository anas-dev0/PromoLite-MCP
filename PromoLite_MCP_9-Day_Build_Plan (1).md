# PromoLite MCP: 9-Day Build Plan (v2)

Nov 15, 2026 · @anas aouini · replaces the 7-day plan of Nov 10

## What changed from v1

| Change | Why |
| --- | --- |
| Package versions pinned to the v2 SDK line; all code snippets updated | `npm install` now pulls `ext-apps` 2.x, which does not pair with the old `@modelcontextprotocol/sdk` imports v1 used |
| Smoke test of an official example in Claude Desktop on Day 0 | Find out on the first evening whether views render on your machine, not on Day 3 |
| Streamable HTTP moved from Day 6 to Day 3 | basic-host only accepts server URLs, so you need HTTP before you can test your first view |
| View HTML read from a path next to the module, not a relative path | Claude Desktop starts the server from a different working directory |
| New Day 6: promotions calendar with clash highlighting, plus a standalone "Cora panel" page | The calendar is a named deliverable and "which promotions clash" is the offer's first example question; the panel page demos the stretch goal |
| Old Day 6 split in two: tests (Day 7), Docker + Nginx + CSP + public deploy (Day 8) | It was two days of work |
| Public URL | A recruiter can add your server to Claude in 30 seconds |
| Compatibility report now covers ChatGPT, Gemini, VS Code and Cursor | The offer names them; v1 skipped the hard ones |
| Day 5 check for the app-only tool corrected | The Inspector lists app-only tools; hiding them is the host's job |

## Overview

In 9 working days (plus one setup evening) you build **PromoLite MCP**: a TypeScript MCP server over a small fake retail promotions dataset, whose answers show up in Claude as interactive views (a sortable table, a trend chart, a product picker, a promotions calendar). It is a miniature of Cognira's "Interactive MCP Apps for PromoAI's Agent Cora" topic.

**What you will have at the end**

- A public GitHub repo with a working MCP server and four MCP App views.
- A **public HTTPS URL** anyone can add to Claude as a custom connector.
- A **compatibility report** across six hosts, with screenshots or evidence for each.
- One component library rendered on two surfaces: inside AI apps, and in a standalone "Cora panel" web page.
- Tests (Vitest + Testing Library), Docker Compose behind Nginx, a strict Content Security Policy.
- A README with a demo GIF and one line for your CV.

**Final architecture**

```text
 AI app (Claude, VS Code, ...)            Browser
   chat  ──  sandboxed iframe             "Cora panel" page
     │        (your view, one HTML file)       │
     │  MCP over HTTPS                         │  MCP over HTTPS
     ▼                                         ▼
 ┌──────────────── Nginx (reverse proxy, limits, headers) ────────────────┐
 │                         /mcp  →  app:3000                               │
 └─────────────────────────────────────────────────────────────────────────┘
     ▼
 MCP server (Node, TypeScript)
   tools:  top_promotions · sales_trend · pick_products · promo_calendar
           search_products_ui (app-only)
   ui:// resources:  table · trend · picker · calendar
     ▼
 data.ts (pure functions)  →  CSV files (synthetic)
```

Claude Desktop can also start the same server directly over stdio (Days 1-2). Everything below the AI app runs in Docker Compose from Day 8.

**Gaps it closes**

| Cognira asks for | Your status today | Closed on |
| --- | --- | --- |
| MCP (servers, tools, resources) | Used tool calling, never built an MCP server | Days 1-2 |
| MCP Apps (interactive views) | New | Days 3-6 |
| Views that call the server directly | New | Day 5 |
| Promotions calendar, clash questions | New | Day 6 |
| Theming, light and dark | Partial (React) | Day 4 |
| Shared component library (stretch goal) | New | Days 4 and 6 |
| Automated testing | Not on your CV | Day 7 |
| Vite, Nginx | Vite yes, Nginx no | Days 3 and 8 |
| Web security: iframes, CSP | New | Days 3 and 8 |
| Compatibility report (Claude, ChatGPT, Gemini, VS Code) | New | Day 9 |

**Rules for the week**

1. Each day ends with something that runs. If a day overflows, cut scope, never skip the commit.
2. Commit at least twice a day with clear messages. Recruiters read commit history.
3. Keep a `NOTES.md` file: write down every error you hit and how you fixed it. These become your interview stories.
4. MCP Apps is young. When this plan and the official docs disagree, the docs win (links in Resources).
5. Never mix SDK generations (see Day 0, Step 2). Most "it doesn't compile" problems this week will come from that.

**If you run out of time, cut in this order:** the Cora panel page (Day 6), Nginx depth (Day 8), the "revenue" toggle (Day 4). Do not cut the calendar, the public URL or the compatibility report: they are what separates this from a tutorial project.

## Core concepts

Read this once before Day 1 and come back to it whenever a word in the daily steps is unclear. Every concept here comes up in interviews for the Cognira topic.

### MCP (Model Context Protocol)

MCP is a standard way for an AI app to use outside tools and data. Before MCP, every AI app had its own plugin format; with MCP, you write a server once and any compatible app can use it. Think of it as USB for AI tools.

- **Host**: the AI app the user talks to (Claude, Claude Desktop, VS Code, ChatGPT).
- **Client**: the part of the host that holds one connection to one server.
- **Server**: your program. It advertises what it can do.
- **Tools**: functions the model can decide to call, each with a name, a description and an input schema (`top_promotions(period)`). The description is what the model reads to decide when to call it, so it is effectively a prompt.
- **Resources**: read-only content the server exposes by URI (a file, a document, an HTML page). The model does not "call" them; the host reads them.
- **Transport**: how messages travel. `stdio` = the host starts your server as a child process and talks through stdin/stdout (simplest, local only). **Streamable HTTP** = your server runs as a web service and the host connects over HTTP (needed for basic-host, Docker, Nginx and remote use).
- **JSON-RPC**: the message format underneath. Every request is a JSON object with a method (`tools/list`, `tools/call`, `resources/read`) and params. You rarely write it by hand; the SDK does.

### Tool results: text vs structured content

A tool returns `content` (text the model reads) and can also return `structuredContent` (typed JSON). The model uses the text; your views use the JSON. Rule for this project: **always return a complete text answer**, so hosts that cannot show views still work. Cognira asks for exactly this.

### MCP Apps

MCP Apps is an official MCP extension (SEP-1865, stable spec dated 2026-01-26) that lets a tool's answer come with a small web app the host shows inside the chat. The flow:

1. Your server registers a **UI resource** at a `ui://` URI (for example `ui://promolite/table`). Its MIME type is `text/html;profile=mcp-app` and its body is one HTML page.
2. Your tool's metadata points at it: `_meta.ui.resourceUri = "ui://promolite/table"`.
3. The model calls the tool. The host sees the link, fetches the HTML, and renders it in a **sandboxed iframe** in the chat.
4. The host pushes the tool's input and result into the iframe. Your view draws them.
5. The view can call tools on your server through the host with `app.callServerTool(...)`, with no model in the loop. Tools marked `_meta.ui.visibility: ["app"]` are meant for views only: a compliant host leaves them out of the list it gives the model.

The official package `@modelcontextprotocol/ext-apps` has four parts: the `App` class for views, React hooks (`/react`: `useApp`, `useHostStyles`), server helpers (`/server`: `registerAppTool`, `registerAppResource`), and a bridge for people building hosts (`/app-bridge`, which you will not need).

### Sandboxed iframes and CSP

An **iframe** is a web page inside another web page. **Sandboxed** means the host restricts what it can do: it cannot read the host's cookies, touch the chat page, or open popups freely. It talks to the host only through `postMessage` (messages passed between windows), which the `App` class wraps for you.

**CSP (Content Security Policy)** is a list of rules telling the browser where a page may load scripts, styles, images and network calls from. In MCP Apps, your resource declares which outside domains it needs (`_meta.ui.csp`, with lists like `connectDomains` and `resourceDomains`); anything not declared is blocked. That is why the plan bundles everything into a single HTML file: no outside loads, nothing to whitelist.

### Vite and single-file builds

Vite is a fast build tool for frontend code: it turns your React/TypeScript into plain JS/CSS. With the plugin `vite-plugin-singlefile`, it inlines everything into one `.html` file, which is exactly what a UI resource needs.

### Nginx

Nginx is a web server often placed in front of an app as a **reverse proxy**: the public talks to Nginx, Nginx forwards to your Node server. It handles things your app should not: compression, request size limits, rate limits, security headers. On Day 8 you put it in front of your MCP server.

### Vitest and Testing Library

Vitest is a test runner that understands TypeScript and Vite out of the box. Testing Library renders a React component in a fake browser (jsdom) and lets you test it the way a user sees it ("click the column header, expect the first row to change"), not by poking at internals.

### Your three test hosts

- **MCP Inspector** (`npx @modelcontextprotocol/inspector`): connects to your server, lists tools and resources, lets you call them by hand. Recent versions also have an Apps tab that renders views. Use it every day.
- **basic-host**: the reference host in the `ext-apps` repo. Renders a view in a sandboxed iframe like a real host. It connects by URL, so your server must speak HTTP.
- **Claude Desktop / claude.ai**: the real thing, used as the final check each day.

## Day 0 (one evening): setup, versions, smoke test, data

**Goal:** tools installed, versions pinned, proof that views render on your machine, a realistic fake dataset on disk. About 3 hours.

### Step 1: install tools

- [x] Node.js 20 LTS or newer (`node -v`), npm comes with it.
- [x] Git, and a GitHub account (you have both).
- [x] Docker Desktop (you already use Docker Compose).
- [x] VS Code with the ESLint and Prettier extensions.
- [x] Claude Desktop, so you can test your server in a real host.

### Step 2: create the repo and pin versions

```bash
mkdir promolite-mcp && cd promolite-mcp
git init
npm init -y
npm install @modelcontextprotocol/ext-apps@^2 \
  @modelcontextprotocol/server@^2 @modelcontextprotocol/client@^2 \
  @modelcontextprotocol/node@^2 @modelcontextprotocol/express@^2 \
  zod@^4.2.0 express cors
npm install -D typescript tsx @types/node @types/express @types/cors
npx tsc --init
```

In `tsconfig.json`, set `"target": "ES2022"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"strict": true`, `"outDir": "dist"`. In `package.json`, add `"type": "module"`. Commit `package-lock.json`.

**Concept: two SDK generations.** As of mid-November 2026 there are two lines, and they do not mix:

| Line | Packages | Imports look like |
| --- | --- | --- |
| **v2 (this plan)** | `ext-apps@^2` + `@modelcontextprotocol/server`, `/client`, `/node`, `/express` at `^2` + `zod@^4.2` | `from "@modelcontextprotocol/server"` |
| v1 (older tutorials) | `ext-apps@^1` + `@modelcontextprotocol/sdk@^1` | `from "@modelcontextprotocol/sdk/server/mcp.js"` |

Most blog posts and many AI-generated snippets still use v1 imports. If you paste one into this project it will not compile. When you copy code, check the import paths first. If v2 blocks you badly, the fallback is to switch the whole project to the v1 line, never half of it.

**Concept: why `zod`?** Zod describes the shape of data in TypeScript and checks it at runtime. The MCP SDK uses Zod schemas to declare each tool's inputs, and turns them into the JSON Schema the model reads. One definition gives you types, validation and documentation.

### Step 3: smoke test (30 min, do not skip)

Before writing any code, prove that MCP Apps render on your machine:

1. Follow "Try an example MCP App in Claude Desktop" in Anthropic's MCP Apps docs (link in Resources). It connects one of the SDK's example servers through `claude_desktop_config.json`.
2. Ask Claude something that triggers the example tool. You should see a view in the chat.

If the view renders, local development in Claude Desktop works and you can use it all week. If you only get text, write down the Claude Desktop version and what you saw in `NOTES.md`, and plan to test views through basic-host and the Inspector during the week and through a public URL (tunnel, Day 3) in Claude. Either way you now know, and it costs you 30 minutes instead of a lost Day 3.

### Step 4: plan the folders

```text
promolite-mcp/
  data/            the CSV files
  src/server/      MCP server code
  src/views/       React views (one folder per view, plus shared/)
  src/panel/       standalone "Cora panel" page (Day 6)
  tests/           Vitest tests
  docker/          Dockerfile, nginx.conf
  docs/compat/     screenshots for the compatibility report
```

### Step 5: generate the dataset

Write a small script `scripts/generate-data.ts` that creates four CSV files with a fixed random seed (so the data is the same every run):

| File | Columns | Size |
| --- | --- | --- |
| `products.csv` | product\_id, name, category, base\_price | \~60 products in 6 categories |
| `stores.csv` | store\_id, city, region | \~8 stores (use Tunisian cities) |
| `sales.csv` | date, product\_id, store\_id, units, price, promo\_id | 52 weeks × products × stores |
| `promotions.csv` | promo\_id, name, type, discount\_pct, start, end, **category**, **region** | \~25 promos (percent off, BOGO, bundle) |

Make the numbers believable: units rise during a promo (+30% to +120%), drop slightly the week after ("post-promo dip"), and have a seasonal bump (Ramadan, back to school, end of year).

**New in v2:** each promotion has a `category` and a `region` (or "all"). Deliberately generate **4-5 clashes**: two promotions on the same category whose dates overlap in the same region. The Day 6 calendar needs them, and they make the demo tell a story.

**Concept: why fake data?** You cannot use real client data, and a generated dataset is reproducible: anyone who clones your repo gets the same results. Say this explicitly in the README; it shows you think about data privacy.

### End of day check

- [ ] The official example view renders in Claude Desktop (or you have noted that it does not, and why).
- [ ] `npx tsx scripts/generate-data.ts` creates the four CSV files.
- [ ] First commit pushed: `chore: project setup and synthetic dataset`.

## Day 1: your first MCP server (text only)

**Goal:** a server with one working tool, tested in MCP Inspector. No UI yet. Learn the protocol first; views come on Day 3.

### Morning: understand before coding (1-2 h)

1. Read the MCP "Architecture" and "Tools" pages on modelcontextprotocol.io. Note in `NOTES.md`, in your own words: what is a host, a client, a server, a tool.
2. Skim the TypeScript SDK README for the v2 packages. Find `McpServer`, `registerTool` and `StdioServerTransport`.
3. Open the Inspector once, with an example server, just to see what it shows.

### Afternoon: build a hello-world server (2-3 h)

Split the code in two files from the start, because Day 3 adds a second transport:

`src/server/server.ts` builds the server and registers tools:

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export function createServer() {
  const server = new McpServer({ name: "promolite", version: "0.1.0" });

  server.registerTool(
    "ping",
    {
      description: "Health check. Returns pong and the server time.",
      inputSchema: z.object({ name: z.string().optional() }),
    },
    async ({ name }) => ({
      content: [{ type: "text", text: `pong ${name ?? ""} at ${new Date().toISOString()}` }],
    })
  );

  return server;
}
```

`src/server/stdio.ts` starts it over stdio:

```ts
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";

await createServer().connect(new StdioServerTransport());
```

Check the exact shape of `registerTool` and `inputSchema` against the official Quickstart; the import paths above are the v2 ones the Quickstart uses.

Run it in the Inspector:

```bash
npx @modelcontextprotocol/inspector npx tsx src/server/stdio.ts
```

In the Inspector: connect, open Tools, call `ping`, read the raw JSON-RPC messages in the history panel.

**Concept: never `console.log` in a stdio server.** With stdio, stdout *is* the protocol channel. A stray `console.log` injects garbage into the JSON-RPC stream and the host disconnects. Log with `console.error` (stderr) instead. Almost everyone hits this once; write it in `NOTES.md` when you do.

### Evening: first real tool (1-2 h)

Add `top_promotions` that reads `promotions.csv` and `sales.csv` and returns, as text, the 5 promotions with the highest uplift for a period. Keep the logic naive for now (load CSVs with a small parser such as `csv-parse`, compute in plain TypeScript).

**Load the CSVs from a path next to the code, not a relative path:**

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = path.join(ROOT, "data");
```

A relative path like `"data/sales.csv"` works in your terminal and fails when Claude Desktop starts the server, because the working directory is different. Use the same `ROOT` for the view HTML on Day 3.

**Concept: uplift.** Uplift = units sold during the promo divided by the usual units without promo (the baseline), minus 1. A 0.6 uplift means +60%. Use the average of the 4 weeks before the promo as baseline. This is the core metric of promotion analytics and Cognira's whole business, so be able to explain it.

### End of day check

- [ ] `ping` and `top_promotions` both work in the Inspector.
- [ ] You can explain what `tools/list` and `tools/call` do.
- [ ] Commit: `feat: stdio MCP server with ping and top_promotions`.

## Day 2: data layer, three tools, connect to Claude

**Goal:** clean code split into layers, three tools with validated inputs and structured output, and the server answering questions inside Claude Desktop.

### Morning: separate data from protocol (2 h)

Move all CSV loading and calculations into `src/server/data.ts`, with plain functions that know nothing about MCP:

- `topPromotions(from, to, limit)` returns an array of `{ promoId, name, type, discountPct, uplift, incrementalUnits }`.
- `salesTrend(productId, storeId?)` returns `{ week, units, price, promoId | null }[]`.
- `searchProducts(query, category?)` returns matching products.

The tool handlers in `server.ts` only validate input, call these functions and format the answer.

**Concept: why layers?** Pure functions are easy to test (Day 7) and reuse. If Cognira later swaps the CSV for a database, only `data.ts` changes. Interviewers ask "how would you test this?"; this is the answer.

### Midday: three tools with structured output (2-3 h)

For each tool, return both a readable text answer and the raw data:

```ts
return {
  content: [{ type: "text", text: formatAsMarkdownTable(rows) }],
  structuredContent: { rows },
};
```

Declare an `outputSchema` with Zod so the shape of `structuredContent` is documented. Export the Zod schemas and their inferred types from one file (`src/server/schemas.ts`): the views import the same types on Days 3-6, so server and views can never disagree about a field name.

Write good descriptions, because the model chooses tools by reading them. Compare:

- Weak: `"Gets promotions."`
- Strong: `"Ranks promotions by sales uplift between two dates. Use when the user asks which promotions performed best or worst. Dates are ISO (YYYY-MM-DD)."`

Validate everything with Zod: dates in order, `limit` between 1 and 50, unknown product IDs return a clear error message (`isError: true`) instead of crashing.

**Concept: errors the model can use.** A tool error should explain what went wrong and how to fix it ("Unknown product P999. Call search\_products first."). The model reads it and often recovers by itself.

### Afternoon: connect to Claude Desktop (1 h)

Add your server to Claude Desktop's config (`claude_desktop_config.json`, opened from Settings > Developer):

```json
{
  "mcpServers": {
    "promolite": {
      "command": "npx",
      "args": ["tsx", "/full/path/to/promolite-mcp/src/server/stdio.ts"]
    }
  }
}
```

If the server does not start (common on Windows, where `npx` is a `.cmd` file), build to JavaScript and point the config at Node directly: `"command": "node", "args": ["C:/full/path/dist/server/stdio.js"]`. Read the server log from Settings > Developer when something fails.

Restart Claude Desktop and ask: "Which promotions worked best in Q2?", "Show the sales trend for olive oil in Sfax", "Find dairy products". Watch which tool it picks and with which arguments.

### Evening: improve from what you saw (1 h)

Where Claude picked the wrong tool or wrong arguments, rewrite the descriptions and try again. Note each change and its effect in `NOTES.md`: this is prompt engineering for tools, and a strong interview story.

### End of day check

- [ ] Three tools work in the Inspector and in Claude Desktop.
- [ ] Bad inputs return clear errors, never a crash.
- [ ] Commit: `feat: data layer and three validated tools`.

## Day 3: HTTP entry point and first view, a sortable promotions table

**Goal:** the server also speaks Streamable HTTP, and when a host calls `top_promotions`, a sortable table appears instead of only text. This is the day you learn MCP Apps, so go slowly.

### Morning, part 1: add the HTTP entry point (1 h)

Create `src/server/http.ts`, following the official Quickstart's `main.ts`:

```ts
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import cors from "cors";
import { createServer } from "./server.js";

const app = createMcpExpressApp();
app.use(cors());

app.post("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(3000, () => console.log("PromoLite MCP on http://localhost:3000/mcp"));
```

This is **stateless** mode: no sessions, a fresh server per request. It is the simplest setup and the one that behaves best behind a proxy. Load the CSVs once at module level in `data.ts`, not per request. Add scripts: `"dev:http": "tsx watch src/server/http.ts"` and `"dev:stdio": "tsx src/server/stdio.ts"`.

Test: `npx @modelcontextprotocol/inspector`, choose Streamable HTTP, connect to `http://localhost:3000/mcp`.

**Concept: when HTTP?** stdio only works when the host runs on the same machine and starts your server. A real product like Cora runs remotely, for many users, so it speaks HTTP. HTTP is also what basic-host, Nginx and claude.ai's custom connectors need.

### Morning, part 2: study the official example (1 h)

1. Read the MCP Apps overview and the official **Quickstart** end to end.
2. Clone `modelcontextprotocol/ext-apps`. In `examples/basic-host`, run `npm install && npm start` and open `http://localhost:8080`. This is **basic-host**, a reference host for testing views locally without Claude.
3. Open one example server's code and find the three pieces: the `ui://` resource, the tool's link to it, and the `App` object in the view. Draw the flow in `NOTES.md`.

### Midday: set up the view build (1-2 h)

```bash
npm install react react-dom
npm install -D vite @vitejs/plugin-react vite-plugin-singlefile @types/react @types/react-dom
```

Create `src/views/table/index.html`, `main.tsx` and `PromoTable.tsx`, and a `vite.config.ts` that uses `viteSingleFile()` and outputs to `dist/views/table.html`. One build per view (pass the view name through an environment variable and loop in an npm script).

**Structure every view in two layers.** This matters on Day 6:

- `PromoTable.tsx`: a plain React component that takes `rows` as props. It knows nothing about MCP.
- `main.tsx`: a thin wrapper that connects the `App`, receives the tool result and passes it down as props.

**Concept: why one single HTML file?** The host loads your view from an MCP resource, not from a web server. There is no URL to fetch `main.js` from, and the CSP blocks outside domains anyway. Inlining all JS and CSS into the HTML removes both problems.

### Afternoon: register the app tool and resource (2 h)

Use the server helpers from `@modelcontextprotocol/ext-apps/server` (verify the signatures in the Quickstart):

```ts
const TABLE_URI = "ui://promolite/top-promotions";
const VIEWS_DIR = path.join(ROOT, "dist/views");

registerAppResource(server, "Top promotions table", TABLE_URI, {},
  async () => ({
    contents: [{ uri: TABLE_URI, mimeType: RESOURCE_MIME_TYPE,
                 text: await fs.readFile(path.join(VIEWS_DIR, "table.html"), "utf8") }],
  }));

registerAppTool(server, "top_promotions", {
  description: "...",
  inputSchema: z.object({ from: z.string(), to: z.string(), limit: z.number().optional() }),
  _meta: { ui: { resourceUri: TABLE_URI } },
}, handler);
```

The handler stays the same as Day 2: text in `content`, rows in `structuredContent`.

### Evening: write the view wrapper (2 h)

In `main.tsx`, create the app and listen for the result. **Set handlers before you connect**, or you can miss the first notification:

```ts
const app = new App({ name: "PromoLite table", version: "0.1.0" });
app.ontoolresult = (result) => setRows(result.structuredContent?.rows ?? []);
await app.connect();
```

(Or use the `useApp` hook from `/react`.) Render a table with clickable headers that sort ascending/descending, uplift shown as a percentage, and a promo-type badge. Keep it plain CSS for now.

**Concept: the view's lifecycle.** The iframe loads, performs a handshake with the host (`ui/initialize`), then receives the tool input and the tool result as notifications. Your view must render a loading state until data arrives, and must not assume the result is already there at startup.

### Test loop (use this order every day from now on)

1. `npm run build:views`, then `npm run dev:http`.
2. **basic-host**: open `http://localhost:8080`, point it at `http://localhost:3000/mcp`, call the tool, check the view.
3. **Inspector**: check the text answer (and the Apps tab, if your version has it).
4. **Claude**: depending on your Day 0 smoke test, either Claude Desktop over stdio (restart it after each rebuild), or a tunnel: `cloudflared tunnel --url http://localhost:3000` gives a temporary HTTPS URL you add to Claude as a custom connector (`<url>/mcp`). A `localhost` address cannot be added as a connector, because Claude connects from Anthropic's servers.

If the tool runs in Claude but no view appears, open Claude Desktop's developer tools (see Anthropic's MCP Apps troubleshooting page) and look at the console of the iframe before changing code.

### End of day check

- [ ] The table renders and sorts in basic-host.
- [ ] Asking Claude "best promotions in Q2" shows your sortable table.
- [ ] You can explain the five-step MCP Apps flow from the Core concepts section without notes.
- [ ] Commits: `feat: streamable HTTP entry point` and `feat: interactive promotions table view`.

## Day 4: chart view, theming and text fallback

**Goal:** a sales trend chart that marks promo weeks, both views matching the host's light or dark theme, and a clean answer in hosts that cannot show views.

### Morning: the trend chart (3 h)

```bash
npm install recharts
```

Build `src/views/trend/` for `sales_trend`: a line of weekly units, promo weeks shaded, a tooltip showing units, price and promo name. Link the tool to `ui://promolite/sales-trend` as on Day 3. Same two layers: `TrendChart.tsx` takes props, `main.tsx` wires the `App`.

Give the chart a fixed height. A responsive chart inside an iframe with no height renders at zero pixels, which looks like a blank view.

Add one small interaction: a toggle between "units" and "revenue". It runs entirely inside the view (no server call), which shows the difference between view state and server data.

**Concept: choosing a chart.** A quantity over time is a line. Promo periods are context, so draw them as a background band, not as a second line. Being able to justify chart choices is exactly what "building charts and data tables for the web" means in the offer.

### Midday: the shared component library (1 h)

Create `src/views/shared/` with a `Card`, a `Badge`, a `formatPct` helper, loading/empty/error states and your CSS variables. Both views import from it. Move `PromoTable` and `TrendChart` here too (`shared/components/`), leaving only the thin `main.tsx` wrappers in each view folder. On Day 6 a second surface imports the same components, which is Cognira's stretch goal in miniature.

### Afternoon: follow the host theme (2 h)

Hosts tell the view their theme and style variables (colors, fonts, light/dark). Read the "host context" and styling sections of the ext-apps docs; in React the `useHostStyles` hook applies them.

- Define every color as a CSS variable (`--bg`, `--text`, `--accent`, `--grid`), with fallbacks.
- Map them to the host's variables when present.
- Test both themes: switch Claude between light and dark and check the chart axis and grid stay readable.

**Concept: why follow the host?** A view that ignores the theme looks like an ad pasted into the chat. Cognira explicitly asks for "styling that follows each AI app's theme, in light and dark mode".

### Evening: the text fallback (1 h)

Check that every tool still returns a complete, readable text answer (a markdown table for promotions, a short summary for the trend: peak week, average uplift during promos). Test by calling the tools in the Inspector and reading only the text. If the text alone answers the question, you are done.

### End of day check

- [ ] Trend chart shows in Claude, promo weeks visible, toggle works.
- [ ] Both views readable in light and dark.
- [ ] Text answers are complete without views.
- [ ] Commit: `feat: trend chart, shared components, host theming`.

## Day 5: the product picker, views that call the server

**Goal:** a picker where the user searches and selects exact products and stores, with each search calling your server directly, and the final choice handed back to the conversation. Cognira lists "views that call the server directly, skipping the AI model" as a core deliverable.

### Morning: app-only tools (2 h)

Register a new tool `search_products_ui` (reuse the search logic) and mark it as callable only by views:

```ts
_meta: { ui: { visibility: ["app"] } }
```

**Concept: why hide tools from the model?** Some tools exist only to serve the UI (search as you type, pagination). Showing them to the model wastes its context and tempts it to call them for no reason.

**Concept: who does the hiding?** Your server still returns the tool in `tools/list`, with its visibility metadata. A host that supports MCP Apps is the one that leaves it out of what the model sees. So the Inspector **will** list `search_products_ui`, and that is correct. What you check in the Inspector is that the `_meta` is there; what you check in Claude is that the model does not know the tool.

### Midday: build the picker view (3 h)

Link a model-visible tool `pick_products` ("Opens a picker so the user can choose exact products and stores") to `ui://promolite/picker`. In the view:

```ts
const result = await app.callServerTool({
  name: "search_products_ui",
  arguments: { query, category },
});
setResults(result.structuredContent?.products ?? []);
```

Features:

- Search box with a **debounce** of \~250 ms (wait until the user stops typing before calling, so you do not send a request per keystroke).
- Ignore stale responses: if the user typed again before a response arrived, drop the old one.
- Category filter, checkbox list, selected items shown as removable chips.
- Loading and "no results" states, and an error message if the call fails.

### Afternoon: hand the choice back (2 h)

When the user clicks "Use these products", the conversation needs to know. Look in the ext-apps docs at the view-to-host requests (`sendMessage`, `updateModelContext`) and pick the one that fits:

- `sendMessage` posts a message into the chat as if the user wrote it ("Show the sales trend for P012 and P031 in Tunis"), so the model continues with it.
- `updateModelContext` quietly gives the model context for its next turn without a visible message.

Try both, keep one, and write in `NOTES.md` why. Hosts differ in which of these they support and whether they ask the user to confirm; note what each host did, because it goes into the Day 9 report.

**Concept: the round trip.** Model calls `pick_products` → view opens → view calls the server directly while the user searches (no model, fast, cheap) → user confirms → view hands the selection back → model calls `sales_trend` with exact IDs. The model never has to guess product IDs from a vague name.

### End of day check

- [ ] Typing in the picker returns results in under half a second.
- [ ] In the Inspector, `search_products_ui` carries `_meta.ui.visibility: ["app"]`.
- [ ] In Claude, asking "what tools do you have from PromoLite?" does not list `search_products_ui`.
- [ ] Confirming a selection leads Claude to the next step with the exact IDs.
- [ ] Commit: `feat: product picker with app-only search tool`.

## Day 6: promotions calendar with clash detection, and the Cora panel page

**Goal:** answer the offer's own example question, "which promotions clash?", with a calendar view; then prove the component library works on a second surface. The morning and midday are the priority. The panel page is the first thing to cut if you are behind.

### Morning: clash logic and tool (2-3 h)

In `data.ts`:

- `promoCalendar(from, to, category?)` returns the promotions active in the period, each with `{ promoId, name, type, discountPct, start, end, category, region }`.
- `findClashes(promos)` returns pairs `{ a, b, category, region, overlapStart, overlapEnd, overlapDays }`.

Define a clash precisely and write the definition in the README: **two promotions on the same category, in the same region (or one of them is "all"), whose date ranges overlap by at least one day.** Two date ranges overlap when `a.start <= b.end && b.start <= a.end`.

Register `promo_calendar` ("Shows promotions on a calendar for a period and flags clashes: promotions on the same category and region whose dates overlap. Use when the user asks what is planned, or which promotions clash or overlap."). Link it to `ui://promolite/calendar`.

The text answer must stand alone: a list of promotions by start date, then a "Clashes" section ("Dairy, Tunis: *Ramadan Dairy -20%* overlaps *Yogurt BOGO* for 6 days, 12-17 March"), or "No clashes in this period."

**Concept: why this view?** Cognira's description says Cora answers questions "like which promotions clash with an event". A planner's real job is avoiding two promotions cannibalising each other. Showing that you understood the business question, not only the protocol, is what a recruiter remembers.

### Midday: the calendar view (3 h)

Build it by hand with CSS grid; no calendar library:

- One row per category, columns are days (or weeks for long periods), each promotion a horizontal bar from start to end, coloured by promo type.
- Bars involved in a clash get a visible marker (outline plus an icon, not colour alone), and the overlapping days are shaded.
- Clicking a bar opens a detail card (the shared `Card`) with discount, dates and what it clashes with.
- Previous / next month buttons that call the server directly with `app.callServerTool({ name: "promo_calendar", ... })`. This is a second, different use of view-to-server calls: navigation, not search.
- A "Clashes only" toggle (view state, no server call).

Use the shared theme variables so it follows light and dark like the others.

### Afternoon: the Cora panel page (2 h, optional)

Cognira's stretch goal is "one component library shared by PromoAI's Cora own chat panel and the external AI apps". Demonstrate it:

- `src/panel/`: a normal Vite React page (not single-file, not an MCP App) standing in for Cora's own panel.
- It connects to your `/mcp` endpoint with `@modelcontextprotocol/client` over Streamable HTTP, calls `top_promotions`, `sales_trend` and `promo_calendar`, and renders the results with the **same** `PromoTable`, `TrendChart` and calendar components from `src/views/shared/`.
- A row of buttons is enough ("Best promotions Q2", "Calendar for March"). No chat, no model.

Because the components only take props, the only new code is the wrapper that fetches data. Put a screenshot of the same component in Claude and in the panel side by side in the README.

**Concept: one library, two surfaces.** Inside an AI app the data arrives from the host through `App`; in Cora's own panel it arrives from a normal API call. If components depend on neither, both surfaces share them. This is why Days 3-4 insisted on the two-layer structure.

### End of day check

- [ ] "Which promotions clash in March?" shows the calendar in Claude with clashes marked.
- [ ] The text answer lists the same clashes.
- [ ] Month navigation works without a model turn.
- [ ] (Optional) The panel page renders the shared components from the same server.
- [ ] Commits: `feat: promotions calendar with clash detection` and `feat: standalone panel sharing the component library`.

## Day 7: automated tests

**Goal:** a test suite that covers data, protocol and views, and runs in CI.

```bash
npm install -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

### Morning: data tests (2 h)

`tests/data.test.ts`, on tiny hand-made CSVs where you know the right answer:

- `topPromotions`: a promo with exactly +50% uplift; empty period; no promos; unknown product.
- `findClashes`: two overlapping promos on the same category → one clash; same dates but different categories → none; ranges that touch on one day → one clash of 1 day; region "all" vs a specific region → clash.

Make `data.ts` accept the data directory as a parameter so tests can point it at fixtures.

### Midday: tool tests (2 h)

`tests/tools.test.ts`: start the server in-process and connect a test client from `@modelcontextprotocol/client` (the SDK provides an in-memory transport pair for this; check the v2 docs for its import path. If you cannot find it quickly, start `http.ts` on a random port in `beforeAll` and connect over HTTP instead). Check that:

- `tools/list` returns the five tools, and `search_products_ui` carries app-only visibility.
- Every model-visible tool returns text **and** structured content.
- Every UI-linked tool's `resourceUri` can be read with `resources/read` and has the MCP App MIME type.
- Bad inputs return `isError` with a helpful message.

### Afternoon: view tests (2-3 h)

- `PromoTable.test.tsx`: render with fake rows, click the "Uplift" header, assert the first row changed.
- `Calendar.test.tsx`: render two clashing promos, assert the clash marker is present; toggle "Clashes only", assert the non-clashing promo disappears.
- `Picker.test.tsx`: mock the `App` object, type three characters quickly, advance fake timers, assert `callServerTool` was called once.
- Chart: jsdom has no layout, so do not test pixels. Test the helpers (data shaping, `formatPct`) and that the toggle switches the series.

Because components take props, most of these tests need no MCP mocking at all.

Add `"test": "vitest run"` to `package.json` and a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs `npm ci`, `npm run build`, `npm test` on every push. A green badge in the README is cheap and visible.

**Concept: the testing pyramid.** Many fast unit tests at the bottom (data), fewer integration tests in the middle (tools over the protocol), a few UI tests on top. Cognira asks for "automated tests for the views and server changes"; this structure covers both.

### End of day check

- [ ] `npm test` passes, with at least 20 tests.
- [ ] CI is green on GitHub.
- [ ] Commit: `test: suite for data, tools and views` and `ci: build and test on push`.

## Day 8: Docker, Nginx, CSP and the public URL

**Goal:** the server running in Docker behind Nginx, a security setup you can explain, and a public HTTPS URL.

### Morning: Docker and Nginx (3 h)

- `docker/Dockerfile`: multi-stage build. Stage 1 installs deps and runs `npm run build` (server + views). Stage 2 copies only `dist/`, `data/` and production deps onto `node:20-alpine`, runs as a non-root user.
- `docker/nginx.conf`: `location /mcp` proxies to `http://app:3000`, with `proxy_buffering off` (MCP responses can stream, and buffering would delay them), a request body size limit, a rate limit (`limit_req`), and security headers.
- `docker-compose.yml`: two services, `app` and `nginx`, only Nginx exposed (port 8080).

Test with the Inspector over HTTP: `http://localhost:8080/mcp`. Then test on a clean clone (`git clone` into a temp folder, `docker compose up`), because "works on my machine" usually means a file that is not committed.

### Midday: CSP and security review (2 h)

1. Confirm your views load nothing external (single-file build, no CDN fonts). Then declare an empty, strict CSP in each UI resource's `_meta.ui.csp` (empty `connectDomains`, empty `resourceDomains`).
2. Experiment: temporarily load a Google Font in one view and watch it get blocked in the browser console. Then remove it. Write what you saw in `NOTES.md`.
3. Never trust tool input: all inputs go through Zod, and no input ever reaches a file path or a shell command.
4. Replace the open `cors()` from Day 3 with an explicit allowlist (your panel page's origin, and localhost for basic-host).
5. Write a short `SECURITY.md`: what the sandbox protects, what your CSP allows (nothing), what Nginx limits, and what is out of scope.

**Be honest in `SECURITY.md` about authentication.** Your public server has none. That is acceptable here only because the data is synthetic and every tool is read-only; say so in those words, and say that a real deployment would put OAuth in front of `/mcp` (stretch goal). An interviewer will respect a stated limit far more than an unmentioned one.

**Concept: defense in depth.** The host's iframe sandbox, your CSP, input validation and Nginx limits are separate layers. If one fails, the others still hold.

### Afternoon: deploy (2-3 h)

You need a stable HTTPS URL that serves `/mcp`. Two routes; pick one:

- **Container platform (fastest).** Deploy the `app` image to a platform that runs a Docker container and gives you HTTPS (Render, Fly.io, Railway and similar; check current free tiers, and the GitHub Student Developer Pack for credits). The platform's own proxy plays Nginx's role there; your Compose + Nginx setup remains the documented self-hosting path.
- **Small VPS (closest to the plan).** Run `docker compose up -d` on a VM and add TLS in front of Nginx (Caddy or certbot with a domain or free subdomain).

Then:

1. Add `https://<your-url>/mcp` to Claude as a custom connector, from a different account or device if you can, and run the full demo flow.
2. Put the URL and the three-step "add it to Claude" instructions at the top of the README.
3. If the platform sleeps idle containers, say so in the README ("first call may take 30 seconds"), so a recruiter does not conclude it is broken.

### End of day check

- [ ] `docker compose up` on a clean clone serves the MCP endpoint through Nginx.
- [ ] Views still work with the strict CSP.
- [ ] The public URL works as a custom connector in Claude.
- [ ] Commit: `feat: Docker, Nginx, strict CSP` and `docs: SECURITY.md and deployment`.

## Day 9: compatibility report, README and demo

**Goal:** turn working code into a portfolio piece a recruiter understands in 60 seconds, with the compatibility report as its strongest section.

### Morning: compatibility report (3 h)

Cognira's deliverable is "a compatibility report for Claude, ChatGPT, Gemini and VS Code". Write yours as `docs/COMPATIBILITY.md`, summarised in the README:

| Host | Version / date tested | Tools | Views render | View → server calls | Theme follows | Hand-back (`sendMessage` / context) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Desktop |  |  |  |  |  |  |  |
| claude.ai (custom connector) |  |  |  |  |  |  |  |
| VS Code + GitHub Copilot |  |  |  |  |  |  |  |
| Cursor |  |  |  |  |  |  |  |
| ChatGPT |  |  |  |  |  |  |  |
| Gemini |  |  |  |  |  |  |  |
| basic-host (reference) |  |  |  |  |  |  |  |
| MCP Inspector |  |  |  |  |  |  |  |

Rules that make the report credible:

- **Date and version on every row.** Host support changes month to month.
- **A screenshot per host** in `docs/compat/`, or the exact reason you could not test.
- **"Could not test" is a valid result if you show your work.** At the time of writing, ChatGPT appears to limit custom MCP servers with Apps to paid workspace plans and remote servers, and Gemini's docs do not describe MCP Apps support. Verify both on the day; if they still hold, record what the vendor's documentation says, link it, and state what your server does there (text fallback). That is a more useful report row than a blank.
- **Record the differences you found**, however small: a host that ignores a style variable, asks for confirmation before `sendMessage`, or caches the view HTML. These are exactly what the intern on this project will spend time on.
- Check the official MCP Apps client list for which hosts claim support today, and compare it with what you observed.

**Concept: graceful degradation.** The server should behave correctly whatever the host can do: full views where supported, a complete text answer elsewhere. Same idea as a website that still works without JavaScript.

### Midday: README (2 h)

Structure:

1. One-sentence pitch, the demo GIF, and **"Try it in Claude in 30 seconds"** with the public URL.
2. Why it exists: "A miniature of an AI agent for promotion analytics, with interactive answers via MCP Apps." Do not present it as affiliated with Cognira or PromoAI.
3. Architecture diagram (Mermaid in the README).
4. Features: 4 tools, 4 views, app-only tool, clash detection, theming, text fallback, shared components on two surfaces.
5. Quick start: `docker compose up`, plus the Claude Desktop config.
6. Testing (CI badge), security (link `SECURITY.md`), compatibility summary table (link the full report).
7. Limits and next steps (from the stretch goals below).

### Afternoon: demo GIF (1 h)

Record 40-60 seconds (ScreenToGif on Windows, or Kap on macOS): ask Claude "which promotions clash in March?" → the calendar appears with clashes marked → ask for the best Q2 promotions → sort the table → open the picker, search "oil", select two products → the trend chart appears with promo weeks shaded. Do one pass in dark mode to show theming.

Lead with the clash question. It is the one from Cognira's own description.

### Evening: publish and update your CV (1 h)

- [ ] Clean the repo: remove debug code, add a license (MIT), tag `v1.0.0`.
- [ ] Pin the repo on your GitHub profile.
- [ ] Add it to your CV as a project. Suggested line: *"PromoLite MCP: TypeScript MCP server with four interactive MCP Apps views (sortable table, trend chart, product picker calling the server directly, promotions calendar with clash detection); one React component library shared by AI hosts and a standalone panel; deployed publicly; compatibility report across 6 hosts; Vitest suite with CI, Docker + Nginx, strict CSP."*
- [ ] Post a short LinkedIn update with the GIF and the public URL.

## Final checklist, interview prep and stretch goals

### Before you apply

- [ ] Repo public, README with GIF and public URL, CI green, `docker compose up` works on a clean machine.
- [ ] The public URL works today (test it again the morning you apply).
- [ ] Compatibility report has a dated row for all four hosts Cognira names.
- [ ] CV updated with the project line (Day 9).
- [ ] Application message mentions it in one sentence with the repo link and the URL.
- [ ] You have reread `NOTES.md` and can tell three "problem I hit and how I fixed it" stories.

### Questions you should be ready to answer

1. **"Explain MCP Apps in 30 seconds."** A tool links to a `ui://` HTML resource; the host renders it in a sandboxed iframe; the view receives the tool result and can call server tools back through the host.
2. **"Why also return text?"** Not every host renders views; the text keeps the server useful everywhere and gives the model something to reason about.
3. **"Why can the picker call the server without the model?"** Speed, cost and precision: searching as you type should not cost a model turn, and exact IDs avoid guessing.
4. **"How do you define a clash?"** Same category, same region, overlapping dates; then explain what you would add with real data (same products, cannibalisation between substitutes, events such as holidays).
5. **"How did you secure the views?"** Sandbox, empty CSP with a single-file build, Zod validation, Nginx limits: defense in depth. And what is missing: authentication.
6. **"How did you test it?"** The pyramid: data unit tests, protocol-level tool tests with a test client, Testing Library for views, CI on every push.
7. **"What differed between hosts?"** Two or three concrete findings from your compatibility report.
8. **"How would the same components work in Cora's own panel?"** Components take props; a thin wrapper per surface supplies the data. Show the panel page.
9. **"What would you do next for Cora?"** OAuth, a real data source, event cards and the alerts inbox, export, more hosts in the report.

### Stretch goals (only if you finish early)

- **Exportable table**: a "Download CSV" button in the table view (check the ext-apps docs for how a view hands a file to the user). In Cognira's deliverables list.
- **OAuth on the HTTP server**: read the MCP authorization spec and protect `/mcp`. Covers the last nice-to-have skill and removes the main limit in `SECURITY.md`.
- **Alerts inbox view**: a list of generated alerts ("uplift below forecast", "clash detected") the user can dismiss, with dismissals sent to the server by an app-only tool. Also in the deliverables list.
- **Python twin**: a minimal version of one tool in Python with the official SDK, to show the "experience with Python" nice-to-have is real.

## Resources

When this plan and these pages disagree, follow the pages: the SDKs change quickly. Versions in this plan were checked against npm on Nov 15, 2026 (`ext-apps` 2.0.4, `@modelcontextprotocol/server` 2.4.0, `zod` 4.6.7).

| What | Use it on |
| --- | --- |
| [MCP Apps Quickstart](https://apps.extensions.modelcontextprotocol.io/api/documents/quickstart.html) (official, v2 packages, stateless HTTP, basic-host) | Days 0, 1 and 3 |
| [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview.md) (official docs, client list) | Days 3 and 9 |
| [MCP Apps Patterns](https://apps.extensions.modelcontextprotocol.io/api/documents/Patterns.html) (app-only tools, CSP, host styles) | Days 4-6 and 8 |
| [Anthropic: add an interactive UI to your MCP server](https://claude.com/docs/connectors/building/mcp-apps/quickstart) (how views render in Claude, tunnels, custom connectors; note it uses the v1 package line) | Days 0 and 3 |
| [Anthropic: troubleshoot MCP Apps](https://claude.com/docs/connectors/building/mcp-apps/troubleshooting) (developer tools in Claude Desktop) | Day 3 onward |
| `modelcontextprotocol/ext-apps` on GitHub (SDK, examples, basic-host) | Day 3 onward |
| modelcontextprotocol.io: Architecture, Tools, Resources, Transports pages | Day 1 |
| TypeScript SDK docs for the v2 packages (`@modelcontextprotocol/server`, `/client`) | Days 1-2 and 7 |
| Vitest and Testing Library docs | Day 7 |
