# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this is

**Cinnabon VIP · 共享股東** is a single-file, front-end-only prototype of a
membership / stored-value / points-sharing ("共享股東" = shared-shareholder)
mobile web app for a Cinnabon outlet in a "Fun Mall" (Phnom Penh, Cambodia).
It is a demo/mock-up: there is **no backend**. All state lives in the
browser's `localStorage`.

The UI is trilingual — English · 中文 (Traditional Chinese) · ភាសាខ្មែរ
(Khmer) — and styled as a mobile-first app.

## Repository layout

The app itself is **one file**; the only other code is the AI assistant proxy:

```
index.html      # HTML + CSS + JavaScript, ~1450 lines, all inline
ai-proxy/       # Cloudflare Worker that holds the Anthropic API key (see its README)
```

The app has no build system, no package manager, no dependencies to install,
no tests, and no CI. The only external resource is Google Fonts (loaded via
`<link>`). The file is served as a static page (deployed to GitHub Pages at
`https://leerose0825.github.io/-Cinnabon-`).

### Structure within `index.html`

| Lines (approx) | Section |
| --- | --- |
| `1–8` | `<head>`, fonts |
| `9–274` | `<style>` — all CSS, using CSS custom properties (`:root` vars) |
| `276–701` | `<body>` markup: screens + tabs + bottom nav + AI chat button |
| `702–1393` | `<script>` — all application logic |
| `1395–end` | Modal overlays (birthday, share, AI assistant) |

## Running / developing

- **Run it:** open `index.html` in a browser, or serve the directory
  (`python3 -m http.server`) and visit it. No install step.
- **Reset state:** the app persists to `localStorage` under the key
  `cinnabon_vip_v3`. Clear it (DevTools → Application → Local Storage, or the
  in-app Admin "Reset All" button) to reseed default demo data.
- Because everything is inline in one file, edits are made directly in
  `index.html`. There is no bundler or transpile step — write plain
  browser-compatible HTML/CSS/ES6.

## Application architecture

### Screens vs. tabs

- Top-level **screens** (`.screen`): `loginScreen`, `registerScreen`,
  `appScreen`. Exactly one has `.active`; `switchScreen(id)` toggles them.
- Inside `appScreen`, **tabs** (`.content` divs) are toggled with
  `switchTab(tabId, btn)` by setting `display`:
  `homeTab`, `depositTab`, `redeemTab`, `inviteTab`, `historyTab`,
  `profileTab`, and `adminTab`.
- A fixed bottom `.navbar` drives tab switching. The admin tab has no nav
  button; it's reached from the profile menu or via admin login.

### Data layer (localStorage)

- `DB_KEY = "cinnabon_vip_v3"` — bump this string if the schema changes so
  stale data reseeds.
- `dbLoad()` reads + parses the DB, seeding `getDefaultDB()` on first run.
- `dbSave(db)` serializes back to `localStorage`.
- The DB object shape:
  ```js
  {
    members:  [ { id, name, phone, pass, deposit, stored, points, tier,
                  inviteCode, streak, referrals, monthPts, created,
                  birthday?, birthdayClaimedYear? } ],
    deposits: [ { id, memberId, phone, amount, status } ],   // status: pending|approved|rejected
    revenues: [ { id, date, amount, rate, pool } ],
    rewards:  [ { id, memberId, name, date, amount, revenueId } ],
    redeems:  [ { id, memberId, name, date, amount } ]
  }
  ```

### Auth

- `currentUser` (module-level global) holds the logged-in member, or an
  admin sentinel object with `isAdmin:true`.
- **Member login:** matches `phone` + `pass` against `db.members`. Seeded
  members use password `111111` (e.g. phone `012100001`).
- **Admin login:** hard-coded `099999999` / `admin888` → renders `adminTab`.
- Registration (`doRegister`) creates a member, grants a join bonus, and
  credits the referrer if a valid invite code is entered.

### Core business logic (the "共享股東" model)

Members top up ("deposit") real money into **stored value**; a revenue-sharing
pool distributes **points** proportional to each member's weighted holdings.

- `tierOf(deposit)` → `VIP` (≥100) / `Gold` (≥50) / `Silver` (<50).
- `bonusOf(amount)` → deposit bonus: 15 (≥100) / 7 (≥50) / 2 (<50).
- `boostOf(tier)` → reward multiplier: VIP 1.35 / Gold 1.15 / Silver 1.0.
- `approveDeposit(id)` credits `stored += amount + bonusOf(amount)` and
  recomputes tier.
- `addRevenue()` (admin) creates a revenue record, computes
  `pool = amount * rate/100`, and distributes it to members weighted by
  `(stored + points) * boostOf(tier)`, adding to each member's `points`.
- Redemption (`confirmRedeem` / `doInStoreRedeem`) spends **points first,
  then stored value**. `1 point = $1` for redemption/equivalence display.
- Available balance shown to users = `stored + points`.

### Admin dashboard

`renderAdmin()` shows member/revenue stats, pending deposit approvals
(`approveDeposit`/`rejectDeposit`), and revenue entry (`addRevenue`).
`seedDemo()` regenerates 30 members + 30 days of revenue; `resetAll()` wipes
the DB.

### UI rendering

- `loadUI()` is the single re-render entry point: it re-reads the member from
  the DB and pushes values into DOM nodes by id via `setText(id, value)`.
  Call `loadUI()` after any mutation that changes the current user's data.
- `fmt(n)` formats currency (`$1,234.00`).
- Toasts via `showToast(msg)`; modals via `showModal(id)` / `closeModal(id)`.

### AI assistant (AI 客服)

A chat bubble (`#aiFab`, hidden for admin) opens `#aiModal`. The browser runs
the agent loop in `aiSubmit()`: it posts the whole conversation to
`AI_PROXY_URL + "/chat"`, appends the returned assistant `content` to
`aiMessages` **unchanged** (thinking blocks must be passed back as-is), runs
any `tool_use` blocks with `aiRunTool()`, and repeats (max `AI_MAX_STEPS`).

- Tools are defined in `ai-proxy/src/worker.js` (`TOOLS`) and implemented in
  `aiRunTool()` in `index.html`; keep the two in sync. They are read-only
  over the logged-in member's own data, except `open_app_page`, which only
  switches tabs. Do not add tools that move money or touch other members.
- The system prompt, model and tool list live only in the Worker, so the
  browser cannot change them. Business rules in the system prompt must be
  updated when `tierOf` / `bonusOf` / `boostOf` or redemption logic changes.
- `AI_PROXY_URL = ""` disables the assistant. The chat resets on logout and
  when a different member opens it.

## Conventions & gotchas

- **Everything is global and imperative.** No framework, no modules, no
  reactive state — functions mutate the DB and call `loadUI()`/`renderAdmin()`
  to refresh. Event handlers are inline `onclick="..."` attributes in the
  HTML, so function names are part of the public surface; renaming a function
  means updating its `onclick` sites too.
- **Trilingual copy.** UI text generally appears as `English · 中文 · ខ្មែរ`.
  When editing user-facing strings, keep the three-language pattern
  consistent with surrounding text.
- **CSS uses design tokens** defined in `:root` (`--navy`, `--teal`,
  `--cinna`, `--caramel`, etc.). Reuse these variables rather than
  hard-coding colors; class names are terse and utility-like.
- **This is mock data / a prototype.** Passwords are stored in plaintext in
  `localStorage`, admin creds are hard-coded, and there is no server-side
  validation. Do **not** treat this as production-secure; don't add real
  secrets. It's a UI/UX and business-logic demo.
- The codebase has some dead/legacy fragments (e.g. a removed check-in block
  around the "CHECK-IN" comment, birthday code that awards 2 pts while a
  comment mentions 200). When touching those areas, prefer cleaning up over
  matching the inconsistency, but keep the trilingual + token conventions.
- Bump `DB_KEY` when you change the DB schema, or existing users will load
  incompatible cached data.

## Git workflow

- Default branch: `main`. Deployed via GitHub Pages.
- Commit messages in history are short and imperative
  (e.g. "Update index.html", "Update toast messages for clarity").
- Keep changes scoped to `index.html` (and `ai-proxy/` for assistant work)
  unless intentionally adding new files.
