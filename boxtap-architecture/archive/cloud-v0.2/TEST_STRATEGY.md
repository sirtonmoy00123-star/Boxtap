# BoxTap — Test Strategy

Goal: prove the things that would hurt users most — someone else seeing their boxes, wrong stock totals, lost data, and payments that don't unlock (or unlock for free).

## 1. Test layers

| Layer | Tool | What it covers | Runs |
| --- | --- | --- | --- |
| Database | pgTAP on local Supabase | RLS for every table × role (owner, staff, other user, anon); triggers (stock totals, limits, undo rules); constraints | Every PR |
| Unit | Vitest | Outbox logic, Zod schemas, label PDF layout maths, i18n keys complete in `en` and `bn` | Every PR |
| Integration | Vitest + local Supabase | `sync_push` / `sync_pull` round trips, webhook handlers with recorded Stripe payloads | Every PR |
| End-to-end | Playwright (Chromium + WebKit, phone viewport) | Sign-up → first box → print → scan → search; Seller +/− with undo; share link revoke | Every PR (smoke), nightly (full) |
| Device | Real phones: one low-cost Android (2–3 GB RAM), one iPhone | Speed budgets (N-02), camera scan, PWA install, offline | Before each release |
| Print | Avery L7165 and L7163 on 3 printers | Alignment, every QR scans | Before Phase 1 launch and after any label change |
| Load | k6 against staging | 50 parallel phones syncing; `sync_pull` never misses rows (audit D3) | Before Phase 2 pilot |

## 2. Critical scenarios (must pass before the phase ships)

| # | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| 1 | User B requests user A's item by id through the REST API | Empty result | 1 |
| 2 | Signed-out scan of a valid code | Box number only | 1 |
| 3 | Scan of a spare or deleted box's label | "Not linked" | 1 |
| 4 | Create box 13 on Home Free (online and offline) | Upgrade screen; offline box shows "needs Move Pass" after sync | 1 |
| 5 | Two box creations at the same moment at box 12 | Exactly one succeeds | 1 |
| 6 | Airplane mode: open a box viewed earlier | Contents and photos show | 1 |
| 7 | Stripe webhook delivered twice | One payment, one entitlement | 1b |
| 8 | Webhook with a bad signature | 400, nothing written | 1b |
| 9 | Pass ends | Everything viewable; new boxes blocked (H-06) | 1b |
| 10 | Revoke a share link, reload the shared page | 410 at once | 1b |
| 11 | Removalist link | No item names or photos | 1b |
| 12 | Phone A and B offline, each sells 1 of the last 1, both sync | `on_hand = −1`, "Check stock" shown, ledger shows both | 2 |
| 13 | Same sync batch sent three times (flaky network) | Counted once | 2 |
| 14 | Undo within 10 s; undo of someone else's movement as staff | First works; second refused | 2 |
| 15 | Booked → Packed; Booked → Cancel | Available and on-hand correct in both | 2 |
| 16 | Move 3 of 10 to another box | Source 7, target 3, two ledger rows, one transaction | 2 |
| 17 | Nightly reconciliation after 10,000 random movements | Zero mismatches | 2 |
| 18 | Bangla speaker sells one item without English (S-10) | Done unaided | 2 (pilot) |
| 19 | Staff opens product with cost price | Cost not returned | 3 |
| 20 | Removed staff member's phone syncs | Workspace data deleted from phone | 3 |

## 3. Quality gates

- CI blocks merge on: typecheck, lint, unit, pgTAP, smoke E2E, "RLS enabled on all tables" check, secrets scan.
- A release needs the device checklist signed off on both phones.
- Never mark a test as skipped to get green; fix or delete it with a reason in the PR.
