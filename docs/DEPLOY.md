# Deployment

Three ways to run PromoLite MCP, from simplest to public.

> **Status of this guide.** The local Docker Compose route is the one the project's tests and checks were built around.
> The two public routes (container platform, VPS) are written from the platforms' documented behaviour but were **not
> deployed from this repository by the author of this guide**: platform UIs and free tiers change, so check their current
> docs before following them step by step.

## 1. Local, no Docker

```bash
npm ci
npm run build          # server (dist/server) + views (dist/views)
npm run start:http     # http://127.0.0.1:3000/mcp
```

Use `127.0.0.1`, not `localhost`: Node-based clients resolve `localhost` to IPv6 first and the server listens on IPv4.

## 2. Local, Docker Compose (server behind Nginx)

```bash
docker compose up --build
# MCP endpoint:  http://127.0.0.1:8080/mcp     health: http://127.0.0.1:8080/health
```

Only Nginx is published (port 8080). The app container is reachable only on the private Compose network. The stack:

```
client ──> nginx :8080 ──> app :3000          (limits, headers, 404 for everything but /mcp and /health)
```

Test it with the MCP Inspector over **Streamable HTTP** at `http://127.0.0.1:8080/mcp`.

### Test on a clean clone

"Works on my machine" usually means a file that was never committed. Prove it does not:

```bash
git clone <your-repo-url> /tmp/promolite-check && cd /tmp/promolite-check
docker compose up --build
```

### Configuration

Settings are environment variables. Put them in a `.env` file next to `docker-compose.yml`:

| Variable | Default | Meaning |
|---|---|---|
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` | Hostnames the `Host` header may carry. **Add your public hostname.** |
| `CORS_ORIGINS` | *(empty)* | Extra browser origins allowed to call `/mcp` (exact `scheme://host:port`). Local dev tools are always allowed. |
| `RATE_LIMIT_PER_MINUTE` | `300` | Per-client limit in the app (Nginx has its own: 10 req/s). `0` turns it off. |
| `TRUST_PROXY` | `1` in Compose | How many proxy hops to trust for the client IP. Set it to the real number of proxies in front, or the limiter sees one client. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` in the image | Where the app listens. |

## 3. Public HTTPS URL

You need a stable `https://<host>/mcp`. A local address cannot be used as a custom connector: Claude connects from
Anthropic's servers, which cannot reach your machine.

### Route A: a container platform (fastest)

Render, Fly.io, Railway and similar platforms run a Docker image and give you HTTPS. Check their current free tiers (and the
GitHub Student Developer Pack for credits).

1. Create a new service from this repository using the Dockerfile at `docker/Dockerfile` (build context: the repository root).
2. Set the environment variables:
   - `ALLOWED_HOSTS` = your service's public hostname (for example `promolite-mcp.onrender.com`). Without it, every request is
     rejected with `403`: the image only trusts `localhost` by default.
   - `TRUST_PROXY` = `1` (the platform's proxy is one hop).
   - The platform usually provides `PORT`; the app reads it.
3. Set the health check path to `/health`.
4. There is no Nginx here: the platform's proxy does TLS, and the app's own rate limit (`RATE_LIMIT_PER_MINUTE`), body limit and
   Host/Origin checks apply. Your Compose + Nginx setup remains the documented self-hosting path.
5. If the platform **sleeps idle containers**, say so in the README ("the first call may take about 30 seconds"), so a visitor
   does not conclude the server is broken.

### Route B: a small VPS with Caddy (closest to the Compose setup)

1. Point a domain (or a free subdomain from a service such as DuckDNS) at the VPS.
2. On the VPS: install Docker, clone the repository, create `.env` with `ALLOWED_HOSTS=localhost,127.0.0.1,<your-domain>`.
3. Run `docker compose up -d --build`.
4. Add TLS in front of Nginx. Caddy obtains and renews certificates by itself:

   ```
   # /etc/caddy/Caddyfile
   your-domain.example {
       reverse_proxy 127.0.0.1:8080
   }
   ```

   Because Caddy now sits in front of Nginx, Nginx would see Caddy's address as the client. Give Nginx the real client address
   by adding these two lines to the `server { }` block of `docker/nginx.conf` (use your Docker network range):

   ```
   set_real_ip_from 172.16.0.0/12;
   real_ip_header   X-Forwarded-For;
   ```

   and keep `TRUST_PROXY=1` (one proxy, Nginx, in front of the app).

### Add it to Claude

1. Open Claude's connector settings and choose **Add custom connector**.
2. Enter `https://<your-host>/mcp`.
3. Start a new chat, enable the connector, and ask: *"Which promotions clash in June 2025?"*

(Menu names change between Claude versions; follow the current Anthropic documentation for custom connectors.)

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `403` on every request | The hostname you call is not in `ALLOWED_HOSTS`. |
| `403 Origin not allowed` from a web page | The page's origin is not in `CORS_ORIGINS`. |
| `429` | Rate limit hit (`Retry-After` tells you when to retry). |
| `413` | Request body over the limit (64 KB). |
| Inspector cannot connect to `http://localhost:...` | Use `127.0.0.1` (IPv6 vs IPv4). |
| Views do not appear | The image was built without views: check `docker compose build` logs for the `build:views` step. |
