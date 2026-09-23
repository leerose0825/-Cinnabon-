// Cinnabon VIP AI assistant proxy (Cloudflare Worker).
//
// Holds the Anthropic API key so it never ships to the browser. The browser
// owns the conversation and runs the tools (member data lives in its
// localStorage); this Worker only forwards the conversation to Claude with a
// fixed system prompt, model and tool list, so a caller cannot swap them out.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5";
const MAX_MESSAGES = 40;
const MAX_BODY_BYTES = 64 * 1024;

const SYSTEM_PROMPT = `You are the customer service assistant inside the "Cinnabon VIP · 共享股東" membership app for the Cinnabon outlet at Fun Mall, Phnom Penh, Cambodia. You talk with one logged-in member at a time.

Language: reply in the language the member writes in (English, 中文 or ភាសាខ្មែរ). Use Traditional Chinese for Chinese. Write plain text only, no Markdown, and keep replies short enough to read on a phone.

How the program works:
- Top up (儲值): the member submits a deposit on the Top Up page with a payment method (ABA Transfer, Cash or KHQR) and a reference. Staff approve or reject it. Until approved it shows as pending and no money is credited.
- Deposit bonus when approved: $100 or more gets +$15, $50 or more gets +$7, less than $50 gets +$2. The amount plus the bonus goes into stored value.
- Tier depends on the member's total approved deposits: VIP from $100, Gold from $50, otherwise Silver.
- Revenue sharing: staff record the store's daily revenue; a share of it (usually 5%) becomes a reward pool that is split among members as reward points, weighted by stored value plus points and a tier boost (VIP x1.35, Gold x1.15, Silver x1.0).
- 1 point = $1 when redeeming. Available balance = stored value + points. Redeeming in store uses points first, then stored value.
- Inviting a friend with an invite code gives both sides +2 points. Setting a birthday on the birthday itself gives +2 points once a year.
- This is a prepaid membership program. Rewards are for in-store use only. It is not an investment product: never describe it as an investment, promise returns, or predict future rewards.

Use the tools to look up this member's own account and records instead of guessing; never invent balances, dates or statuses. You cannot move money, approve deposits, redeem, or change account details. When the member wants to do something, tell them which page to use, and use open_app_page when that helps. For problems you cannot resolve (a deposit stuck pending for a long time, a wrong balance, a lost password, complaints), ask them to contact the staff at the Cinnabon counter in Fun Mall.`;

// Tools run in the browser against the logged-in member's own data.
const TOOLS = [
  {
    name: "get_my_account",
    description:
      "Get the logged-in member's account: name, member ID, tier, total approved deposits, stored value, reward points, available balance, invite code, referral count and birthday.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: "get_my_records",
    description:
      "Get the logged-in member's recent records, newest first. deposits: top-up requests with status pending/approved/rejected. rewards: revenue-share points received. redeems: in-store redemptions.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["deposits", "rewards", "redeems"] },
        limit: { type: "integer", description: "How many records to return, 1-20." },
      },
      required: ["kind", "limit"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "open_app_page",
    description:
      "Switch the app to one of its pages so the member can act there. home: balances; deposit: top up; redeem: spend balance in store; invite: invite code; history: records; profile: settings and logout.",
    input_schema: {
      type: "object",
      properties: {
        page: { type: "string", enum: ["home", "deposit", "redeem", "invite", "history", "profile"] },
      },
      required: ["page"],
      additionalProperties: false,
    },
    strict: true,
  },
];

function corsHeaders(env, request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const headers = { "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
  if (allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

// The browser may only send user/assistant turns. Rejecting anything else
// keeps callers from injecting operator-level instructions.
function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return false;
  if (messages[0].role !== "user") return false;
  return messages.every(
    (m) => m && (m.role === "user" || m.role === "assistant") && (typeof m.content === "string" || Array.isArray(m.content)),
  );
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/chat") return json({ error: "not_found" }, 404, cors);
    if (!cors["Access-Control-Allow-Origin"]) return json({ error: "origin_not_allowed" }, 403, cors);

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "conversation_too_long" }, 413, cors);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_json" }, 400, cors);
    }
    if (!validMessages(body.messages)) {
      const tooLong = Array.isArray(body.messages) && body.messages.length > MAX_MESSAGES;
      return json({ error: tooLong ? "conversation_too_long" : "invalid_messages" }, tooLong ? 413 : 400, cors);
    }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    try {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "low" },
        system: SYSTEM_PROMPT,
        // Caches the growing conversation so each tool round trip re-reads it cheaply.
        cache_control: { type: "ephemeral" },
        tools: TOOLS,
        messages: body.messages,
        // On a safety decline, re-run on Anthropic's recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      return json({ content: response.content, stop_reason: response.stop_reason }, 200, cors);
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429, cors);
      if (error instanceof Anthropic.BadRequestError) {
        console.error("Bad request:", error.message);
        return json({ error: "bad_request" }, 400, cors);
      }
      if (error instanceof Anthropic.APIError) {
        console.error(`API error ${error.status}:`, error.message);
        return json({ error: "upstream_error" }, 502, cors);
      }
      throw error;
    }
  },
};
