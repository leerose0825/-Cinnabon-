# Cinnabon AI assistant proxy

A Cloudflare Worker that sits between the app and the Claude API, so the
Anthropic API key never reaches the browser.

```
index.html (chat UI + tools)  ──POST /chat──▶  Worker (holds API key)  ──▶  Claude API
        ▲   runs tool calls against localStorage          │
        └──────────────── content + stop_reason ◀─────────┘
```

- The browser keeps the conversation and runs the agent loop. When Claude asks
  for a tool (`get_my_account`, `get_my_records`, `open_app_page`), the page
  runs it against the logged-in member's own data and sends the result back.
- The Worker fixes the model, system prompt and tool list, only accepts
  `user`/`assistant` turns, caps a conversation at 40 messages / 64 KB, and
  only answers pages listed in `ALLOWED_ORIGINS`.

## Deploy

```bash
cd ai-proxy
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY   # paste the key when asked
npx wrangler deploy                          # prints https://cinnabon-ai-proxy.<you>.workers.dev
```

Then set `AI_PROXY_URL` near the top of the AI ASSISTANT section in
`../index.html` to that URL and push. Until it is set, the chat shows
"AI assistant is not set up yet".

If the app is served from somewhere other than
`https://leerose0825.github.io`, add that origin to `ALLOWED_ORIGINS` in
`wrangler.toml`.

## Costs and abuse

Every question costs API usage. The origin check stops other websites from
using the proxy from a browser, but it does not stop scripts calling it
directly. Before a real launch, add a
[Cloudflare rate limiting rule](https://developers.cloudflare.com/waf/rate-limiting-rules/)
on the Worker route and set a spend limit in the Anthropic Console.

## Local development

```bash
npx wrangler dev   # serves on http://localhost:8787
```

Put `ANTHROPIC_API_KEY=...` in `.dev.vars` (git-ignored), add
`http://localhost:8000` to `ALLOWED_ORIGINS`, serve the app with
`python3 -m http.server 8000` from the repo root, and point `AI_PROXY_URL`
at `http://localhost:8787`.
