# BoxTap — Architecture Decision Records

Status key: **Accepted** (recommended and built into this architecture), **Proposed** (needs the owner's confirmation), **Open** (cannot be decided without more information).

Labels used in all BoxTap docs: **Fact** (verified or well-established), **Assumption** (to test), **Recommendation**, **Open decision**.

---

## ADR-001 — Modular monolith on a managed backend (Supabase)

**Status:** Accepted
**Context:** One founder, ~150–200 build hours across phases, two modes sharing ~80% of logic, very low running-cost target. The requirements doc already assumes Supabase.

| Option | Pros | Cons | Monthly cost (approx.) |
| --- | --- | --- | --- |
| **A. Supabase (Postgres + Auth + Storage + Edge Functions + RLS)** | One vendor, row-level security in the database, SQL, daily backups on Pro, local dev CLI | Vendor coupling for Auth/Storage; Edge Functions are Deno | Free → US$25 Pro |
| B. Firebase | Mature offline SDK for Firestore | NoSQL makes the stock ledger and reports harder; rules language weaker than SQL for counting/limits | Pay-as-you-go |
| C. Custom Node API + managed Postgres | Full control | Must build auth, storage, rate limits, admin yourself; more hours and more ops | US$20–50 + time |
| D. Microservices | — | Unjustified for this scale | High |

**Decision:** A. One Postgres database, one frontend app, a small set of Edge Functions for things that need secrets (payments, share links, signed-out scan, email, push).
**Consequences:** All business rules that protect data live in SQL (RLS, constraints, triggers, RPC functions), so a buggy client cannot break them. Keep vendor-specific code behind thin adapters (`auth`, `storage`, `payments`) so it can be replaced.

## ADR-002 — Installable web app (PWA) first, Android wrapper later

**Status:** Accepted
**Context:** QR labels must open from any phone camera; Bangladesh is ~90% Android (Fact, StatCounter); Australia is iPhone-heavy; no native iOS app in scope.
**Decision:** React + TypeScript single-page PWA built with Vite. Phase 3 wraps the same PWA as an Android app with a Trusted Web Activity (Bubblewrap) for Google Play billing.
**Alternatives rejected:** React Native/Flutter (two build pipelines, QR deep links harder, more hours); Next.js server rendering (not needed: almost every screen is private and signed-in; the one public page is served by an Edge Function).
**Consequences:** iOS treats a home-screen PWA as a separate browser context from Safari (Fact). A label scanned with the iPhone camera opens Safari, not the installed app. Mitigation in ADR-007.

## ADR-003 — Hosting: Cloudflare Pages for the frontend, Supabase Sydney region

**Status:** Accepted (owner, 2026-11-23: no data-hosting rules apply). Sydney hosts both modes.
**Decision:** Static frontend on Cloudflare Pages (free tier permits commercial use, global CDN, good latency to Dhaka). Supabase project in `ap-southeast-2` (Sydney).
**Trade-off:** Dhaka → Sydney round trip is roughly 150–250 ms (Assumption). Acceptable because Seller writes are saved on the phone first and synced in the background (ADR-005).
**Owner's decision (2026-11-23):** no hosting rules apply, so no second region is planned. Background kept for reference: Bangladesh's Personal Data Protection Ordinance (gazetted Nov 2025) may contain data-localisation rules. Confirm with a local lawyer before the Seller pilot. If localisation is required, the fallback is a second Supabase project in `ap-south-1` (Mumbai) — only if Mumbai is acceptable to the law — with the same schema; workspaces are already isolated, so this is a deployment change, not a redesign.

## ADR-004 — Stock is an append-only ledger; cached totals are maintained by the database

**Status:** Accepted
**Context:** Requirement S-03 and the doc's rule: quantity changes only through `stock_movements`.
**Decision:**
- `stock_movements` is insert-only (no UPDATE/DELETE grants). Each row carries a client-generated UUID as primary key.
- An `AFTER INSERT` trigger updates `items.on_hand` and `items.reserved` in the same transaction.
- Undo = a new compensating movement (`reason = 'undo'`, `reverses_id` = original), never a delete.
- A nightly job recomputes totals from the ledger and logs any mismatch (N-10).
**Why not compute totals on every read:** search and box pages would sum thousands of rows on cheap phones over slow networks. The cache plus nightly proof gives speed and correctness.

## ADR-005 — Offline-first writes with an idempotent outbox

**Status:** Accepted
**Decision:** The client stores a local copy of opened workspaces in IndexedDB (Dexie). Every change goes into a local outbox with its UUID, then syncs via one RPC (`sync_push`). The server inserts with `ON CONFLICT (id) DO NOTHING`, so a retried batch never double-counts. Reads pull changes since a cursor (`sync_pull`).
**Conflict rules:**
- Stock: never conflicts — movements from two phones simply add up. If the result drops `on_hand` below zero, the server accepts it, marks the item `oversold`, and shows the owner a "check this item" alert. Rejecting a sale that already happened in the real world would make the record wrong.
- Names, notes, flags, photos: last write wins per field, using server time of receipt. Rare and low-harm.
**Consequence:** Phase 1 (Home) needs only offline *viewing*; the outbox ships in Phase 2 but the client data layer is designed for it from day 1.

## ADR-006 — The stock unit is an item in one location

**Status:** Accepted
**Context:** S-08 (move between boxes) and S-20 (variants later) must not force a rewrite of the ledger.
**Decision:** An `items` row lives in exactly one location and holds its own stock. The same design in two boxes is two `items` rows sharing a `product_id`. Moving 3 of 10 pieces = two movements in one transaction (−3 on the source row, +3 on the target row, creating the target row if needed).
**Phase 3:** `products` (the design) and variants (colour/size) are added as grouping tables; every variant-in-a-box is still an `items` row, so `stock_movements` never changes shape.

## ADR-007 — In-app scanner as the main scan path; browser scan as a fallback

**Status:** Accepted (fixes gap G2)
**Decision:**
- The app's own Scan button uses the camera inside the app (BarcodeDetector API where available, e.g. Android Chrome; `zxing-wasm` fallback elsewhere). This keeps the user in their signed-in app context.
- A camera scan outside the app opens `https://boxtap.app/b/CODE` in the browser. If the browser has a session, it shows contents; otherwise it shows the box number and a one-tap magic-link sign-in that returns to the same box.
- Sessions use long-lived refresh tokens so a person signs in once per browser context.

## ADR-008 — Payments are confirmed only by server-side webhooks

**Status:** Accepted
**Decision:** Plans change only when an Edge Function receives a verified provider event: Stripe webhook signature; SSLCommerz IPN + server-side validation API call; Google Play Real-time Developer Notifications + Play Developer API purchase check. Each provider event ID is stored with a unique constraint, so replays do nothing. The browser never sets a plan.
**Entitlements** are a separate table derived from payments, so a refund or chargeback can end a plan without touching other data.

## ADR-009 — Cost price stored in an owner-only table

**Status:** Accepted
**Context:** Staff must not see cost prices (roles table in requirements). Postgres RLS works per row, not per column.
**Decision:** `item_costs (item_id, cost_price)` with an owner-only RLS policy. Staff queries never join it.

## ADR-010 — Labels and PDFs are generated on the phone

**Status:** Accepted
**Decision:** Label sheets (Avery L7165 / L7163) and the insurance inventory PDF are built in the browser with `pdf-lib` + a QR library. No server rendering cost; works offline once data is loaded.
**Risk:** large insurance PDFs with many photos may be slow on cheap phones → generate in chunks and use thumbnails (H-07 is a Home/Australia feature, where phones are usually stronger — Assumption).

## ADR-011 — Search: Postgres trigram on the server, local index on the phone

**Status:** Accepted
**Decision:** Server: `pg_trgm` GIN index over item name, `alt_name` (Bangla/Banglish, gap G8), notes, and location name. Phone: MiniSearch over the locally cached workspace, so search works offline and returns in well under 1 second for 400+ items (C-07).

## ADR-012 — Jewellery type: support every kind

**Status:** Accepted (owner, 2026-11-23: "any type of jewellery")
**Decision:** Every item is still counted in pieces. Items get optional jewellery fields from Phase 2: `pricing_mode` (`per_piece` | `by_weight`), `weight_grams`, `purity` (free text such as 22K, 21K, 18K, 925 silver) and `making_charge`. Imitation/fashion pieces use only `per_piece` and never see the extra fields; gold and silver sellers switch them on in workspace settings.
**Out of scope for now:** live gold-rate pricing and automatic price calculation from weight. The seller types the price. Recorded so the screens stay simple for most sellers.
**Consequence:** additive columns only; the stock ledger is unchanged.

## ADR-013 — Booked (reserved) stock in the pilot

**Status:** Accepted (owner, 2026-11-23; fixes gap G3)
**Decision:** `reserved` counter on items, changed only by movements with reasons `booked`, `unbooked`, `shipped`. Available = `on_hand − reserved`. Smallest version for the pilot: a Booked tap and a Packed tap. No orders table until Phase 3 (S-24).

## ADR-014 — Storage users renew the Move Pass

**Status:** Accepted (owner, 2026-11-23: "renew")
**Decision:** There is no separate Storage plan. The Move Pass (A$12.95, 12 months) can be bought again at any time; a new pass starts when the current one ends (audit D9), so renewing early loses nothing. Reminder emails 14 days before and on the end day (H-08) carry a one-tap Renew button.
**Why one-time renewal rather than an automatic subscription (Recommendation):** it matches the "pay once" promise movers like, needs no subscription management or cancellation flows, and keeps Stripe set-up the same as Phase 1b. An auto-renew option can be added later if many users renew.
**Metric added:** Move Pass renewal rate, tracked in the admin view (it doubles as the Home retention metric for storage users like Raj).

## ADR-015 — "In stock" catalogue image moves to Phase 2

**Status:** Accepted (owner, 2026-11-23)
**Decision:** S-25 ships in the Seller pilot. The phone draws a shareable image (grid of photos, name, price, "in stock") with the Canvas API, from local data, and hands it to the system share sheet for Facebook or WhatsApp. No server work; the share link version stays in Phase 3.
