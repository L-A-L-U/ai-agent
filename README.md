# AI Ops Agent — `ai.lalu.dev`

Conversational AI agent with **real tool-use** over a live homelab. Ask it about
server metrics, SSH intrusion attempts, attack geography or portfolio traffic —
and watch it invoke read-only tools in real time, with visible traces.

> Built as part of [lalu.dev](https://lalu.dev) by Luis Eduardo García Jiménez.
> Live demo: **[ai.lalu.dev](https://ai.lalu.dev)**

---

## Stack

- **Next.js 15** (App Router, server actions, NDJSON streaming)
- **TypeScript** strict + **Tailwind CSS**
- **OpenAI SDK** pointing at **Groq** (compatible API) — Llama 3.3 70B at 700+ tok/sec
- **5 typed tools** that hit the homelab over HTTP — read-only by design
- **Per-IP rate limiting** + **daily token budget** as guardrails
- **Streaming responses** — tokens, tool_use events and tool_result traces are pushed
  as NDJSON for the client to render incrementally

## Why is this interesting?

Most "AI portfolio" demos call OpenAI with a static prompt and call it a day.
This one wires a real LLM to **real, live infrastructure** — every call you see
in the UI corresponds to an HTTP request to my homelab's API. The agent can:

- `get_metrics` — live CPU / RAM / disk / uptime from the server
- `get_ssh_attempts` — recent failed SSH logins (anonymized)
- `get_threats` — fail2ban-blocked IPs over the last 24h
- `get_geo` — geographic distribution of attackers
- `get_visitors` — traffic to the portfolio

All of it read-only. No mutation, no destructive ops. The tools are typed
schemas the model fills in; the runtime dispatches them with a 5s timeout each.

## Architecture

```
Client (browser)
    │  POST /api/chat  (NDJSON stream)
    ▼
Next.js route handler
    │
    ├─ rate-limit  (per IP)
    ├─ token budget (daily)
    │
    └─ tool-use loop (max 6 iterations)
         │
         Groq Chat API  ──── stream chunks ───▶ client
              │
              tool_calls ─▶ dispatch to homelab API
                                   │
                                   ▼
                          security.lalu.dev/api/*
```

The loop pushes 4 event types over NDJSON:
- `text_delta` — assistant token deltas
- `tool_use` — model decided to call a tool
- `tool_result` — the homelab API replied
- `done` — final usage stats

## Run locally

Prereqs: Node 20+, a Groq API key (free at [console.groq.com](https://console.groq.com/keys)).

```bash
git clone https://github.com/L-A-L-U/ai-agent.git
cd ai-agent
cp .env.example .env.local
# Edit .env.local and set GROQ_API_KEY
npm install
npm run dev
# Open http://localhost:3000
```

## Deploy

There's a `Dockerfile` (multi-stage, ~250 MB final image) ready for any host
that runs Docker — VPS, bare metal, Fly.io, Railway, etc. Default port is 3000.

```bash
docker build -t ai-agent .
docker run --env-file .env.local -p 3000:3000 ai-agent
```

In production at `ai.lalu.dev` it runs behind nginx + Cloudflare Tunnel; the
nginx config disables proxy buffering on `/api/chat` so streaming works.

## Configuration

| env var                       | required | default                          | description                                         |
|-------------------------------|----------|----------------------------------|-----------------------------------------------------|
| `GROQ_API_KEY`                | yes      | —                                | API key from console.groq.com                       |
| `AI_AGENT_DAILY_TOKEN_BUDGET` | no       | `200000`                         | Hard cap on tokens spent per day                    |
| `SECURITY_API_BASE`           | no       | `https://security.lalu.dev/api`  | Where the tools fetch homelab data from             |

If you fork this and run it against your own infra, point `SECURITY_API_BASE`
at your own endpoint that exposes the same `/metrics`, `/ssh-attempts`, `/geo`,
`/threats`, `/visitors` shape — or just edit `lib/tools/` to match what you have.

## Project layout

```
app/
  layout.tsx
  page.tsx
  api/
    chat/route.ts      ← streaming endpoint, tool-use loop
lib/
  llm.ts               ← Groq client wrapper
  tools/
    index.ts           ← tool dispatch + schemas
  rate-limit.ts        ← in-memory per-IP limiter
  budget.ts            ← daily token budget guard
  system-prompt.ts
  types.ts
public/
Dockerfile             ← multi-stage build
next.config.ts
tailwind.config.ts
```

## License

MIT — do whatever you want, just don't claim you built it.

## Author

**Luis Eduardo García Jiménez** — DevSecOps & AI Automation
- [lalu.dev](https://lalu.dev)
- [contacto.lalu@gmail.com](mailto:contacto.lalu@gmail.com)
- [LinkedIn](https://www.linkedin.com/in/luisgarcia-devsecops)
