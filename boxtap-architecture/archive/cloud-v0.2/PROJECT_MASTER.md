# BoxTap — Project Master

Last updated 2026-11-23 · Owner: Sirajus

## Objective

One app, two modes. **Home:** Australian movers and storage users find anything in their boxes without opening them. **Seller:** Bangladeshi jewellery sellers know what's in stock in every box in 3 seconds. One codebase, one shared core.

## Status

| Item | State |
| --- | --- |
| Requirements | *BoxTap 2-in-1 App Requirements* (2026-11-22), plus gap review (2026-11-23) — gap ideas accepted in direction by the owner |
| Architecture | **Draft 0.2 (owner decisions added), design-reviewed, awaiting owner approval** |
| Code | Not started; implementation not yet authorised |

## Architecture in one paragraph

A React + TypeScript installable web app (PWA) on Cloudflare Pages talks to one Supabase Postgres database in Sydney. Every row belongs to a workspace, and row-level security in the database decides who sees what. Stock is an insert-only ledger with totals maintained by the database. Phones keep a local copy for offline use and sync through an idempotent outbox, so retries never double-count. About eight small Edge Functions handle the signed-out label scan, share links, payments (Stripe now; SSLCommerz/bKash and Google Play later), emails and scheduled jobs.

## Documents

| File | What it holds |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System and module diagrams, frontend/backend stack, key flows, infrastructure, traceability |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | ER diagram, SQL DDL, triggers, limits, offline sync protocol, data lifecycle |
| [API_CONTRACTS.md](API_CONTRACTS.md) | RPCs, Edge Functions, error codes, storage paths, versioning |
| [SECURITY_MODEL.md](SECURITY_MODEL.md) | Trust boundaries, role matrix, RLS policies, threat model, privacy, launch checklist |
| [ADR.md](ADR.md) | 15 decisions with alternatives |
| [RISK_REGISTER.md](RISK_REGISTER.md) | Audit findings (12 fixed), remaining risks, what testing must prove |
| [TEST_STRATEGY.md](TEST_STRATEGY.md) | Test layers, 20 critical scenarios, quality gates |
| [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) | Phases 0–3, steps, dependencies, acceptance criteria |

## Owner decisions (2026-11-23)

| # | Question | Answer | Recorded in |
| --- | --- | --- | --- |
| 1 | Jewellery type | Any type: per-piece and gold/silver by weight | ADR-012 |
| 2 | Bangladesh data hosting rules | None apply; host in Sydney | ADR-003 |
| 3 | Booked tap in the pilot | Yes | ADR-013 |
| 4 | Catalogue image in Phase 2 | Yes | ADR-015 |
| 5 | Storage users after 12 months | Renew the Move Pass | ADR-014 |

No open decisions remain.

## Next steps

- [ ] Owner reviews and approves this architecture (or asks for changes)
- [x] Owner answers the open decisions (2026-11-23)
- [ ] Owner authorises Phase 0 implementation and names the GitHub repository
