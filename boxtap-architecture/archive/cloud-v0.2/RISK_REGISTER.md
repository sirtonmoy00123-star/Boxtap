# BoxTap — Architecture Audit and Risk Register

## 1. How the audit was done

The seven review passes from the project instructions (functional completeness, logical consistency, security, reliability, performance, maintainability, adversarial) were run on draft 0.1 of the architecture. **They were done one after another by a single reviewer taking separate specialist perspectives (architecture, database, security, backend, frontend, QA), not by independent agents.** Independent agent reviews can be run on request.

This is design-level validation only. No code exists yet, so nothing here has been proven by tests.

## 2. Defects found and fixed

| # | Pass | Problem | Root cause | Severity | Fix (applied in the docs) | New problems from the fix? |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | Consistency | Items could be inserted with any `on_hand`, bypassing the ledger | Insert grant covered all columns | High | Column-level insert grant; opening stock is an `opening` movement (SECURITY_MODEL §3) | None |
| D2 | Consistency | `reserved` clamped at 0 made cached totals differ from the ledger, so nightly reconciliation would always fail | Clamp in trigger | High | Removed clamp; negative values flagged as "Check stock" (DATABASE_SCHEMA §5.1) | UI must handle negative numbers (added to TEST_STRATEGY) |
| D3 | Reliability | `sync_pull` by `change_seq` can skip rows: a transaction that took seq 101 may commit after one that took seq 102, and the phone has already moved past 101 | Sequence values are assigned before commit | High | Pull overlaps: the phone asks from `since_seq − 1000` and upserts idempotently; server also returns `max_seq` capped below the oldest in-progress transaction (`pg_snapshot_xmin(pg_current_snapshot())` mapped to seq) | Slightly more data per pull (small) |
| D4 | Consistency | Two offline phones both create "Box 13" → unique `(workspace_id, number)` fails; worse, a renumbered box no longer matches its printed label | Box numbers assigned on the phone | High | Box numbers are allocated by the server. Labels are printed online (codes come from the server anyway), and printing a batch creates the boxes with numbers. A box created offline shows as "New box" and gets its number on sync, before its label can be printed | Offline box creation can't print until online (acceptable: printing needs a printer and usually Wi-Fi) |
| D5 | Security / cost | Unlimited free Home workspaces per account → 12 free boxes each, unlimited | Limit counted per workspace only | High | `create_workspace` allows one free workspace per type per account; more require a paid plan | None |
| D6 | Reliability | Offline mutations inside a rejected box (plan limit) would fail with confusing FK errors | Dependent mutations | Medium | `sync_push` rejects dependants with `parent_rejected`; app shows one message: "Box 13 needs Move Pass" with Upgrade | None |
| D7 | Security | Staff could undo another person's movement | Undo check only by item | Medium | `validate_stock_movement` trigger: reversed movement must be the caller's own, or caller is owner | None |
| D8 | Consistency | Hard delete after 30 days fails for Seller items that have movements (FK) | Ledger rows reference items | Medium | Purge job skips items with movements; they stay archived (hidden) for history | Archived rows grow slowly (negligible) |
| D9 | Billing | Buying Move Pass twice stacks two entitlements with overlapping dates | Entitlement start = now | Medium | New entitlement starts at the later of now and the current `ends_at` (extends the pass) | None |
| D10 | Security | Removed staff keep the workspace data cached on their phone | Offline cache | Medium | On `not_member` from `sync_pull`, the app deletes that workspace's local data. Residual: a phone kept offline still holds it (documented) | None |
| D11 | Performance | Trigram index on an expression is unused if `search` builds a different expression | Expression mismatch | Low | `search` RPC uses the identical expression; covered by an `EXPLAIN` test | None |
| D12 | Completeness | Rate limiting "in the Edge Function" had no mechanism | Supabase has no per-IP limiter | Medium | Cloudflare rate-limiting rule in front of `/api/scan/*` and `/api/share/*` | Cloudflare becomes part of the request path for those routes (already hosting the app) |

Re-run after fixes: consistency, security and reliability passes were repeated on the changed parts. No Critical or High defects remain open in the design.

## 3. Remaining risks

| ID | Risk | Likelihood | Impact | Mitigation / owner action | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | Bangladesh data law requires local hosting | Low (owner confirmed no rules apply) | High | Decided: Sydney (ADR-003); schema stays region-portable if rules ever change | Closed |
| R2 | iPhone PWA quirks: separate Safari/home-screen storage, push only for installed apps on iOS 16.4+, storage eviction after weeks unused | High | Medium | In-app scanner (ADR-007); server is the source of truth; test on real iPhones every release | Accepted |
| R3 | Bangladesh payment route depends on the partner's merchant account and trade licence | Medium | High for Phase 3 revenue | Start the SSLCommerz/bKash paperwork during Phase 2; Play billing as fallback (15% fee, re-check) | Open |
| R4 | Solo founder capacity: two modes, two markets | High | High | Phase gates and kill criteria unchanged; shared core first; no Phase 3 before the pilot passes | Accepted |
| R5 | Offline conflicts produce negative stock and confuse sellers | Medium | Medium | "Check stock" flag + count mode; measure frequency in pilot | Accepted |
| R6 | Photo storage cost grows faster than revenue | Low | Medium | Client compression (~200 KB), per-plan photo limits, monthly storage report | Accepted |
| R7 | Supabase vendor lock-in | Low | Medium | Plain Postgres schema and SQL functions; thin adapters for auth/storage | Accepted |
| R8 | Gold/silver sellers expect automatic price from the daily gold rate | Medium | Low | Optional weight/purity fields now; auto pricing only if pilot sellers ask (ADR-012) | Accepted |
| R9 | Label print alignment varies by printer | Medium | Low | Alignment test page + 1 mm offset setting in print dialog | Accepted |
| R10 | Email magic links land in spam (Bangladesh Gmail, Australian ISPs) | Medium | Medium | Dedicated sending domain with SPF/DKIM/DMARC; password sign-in also offered | Accepted |

## 4. What implementation testing must still prove

- RLS blocks every cross-workspace and cross-role access (automated, per table, per role).
- Two phones offline for hours, both selling the same item, sync to the correct totals with no duplicates.
- `sync_pull` never misses a row under concurrent writes (load test with parallel writers).
- Box page < 2 s on 4G and +/− < 0.5 s on a low-cost Android phone (N-02), measured on a real device.
- Printed labels align on Avery L7165/L7163 from at least three printers, and every QR scans.
- Stripe replayed/duplicated webhooks never double-grant.
