# BoxTap — Project Master

Last updated 2026-11-23 · Owner: Sirajus

## Objective

One app, two modes. **Home:** Australian movers and storage users find anything in their boxes without opening them. **Seller:** Bangladeshi jewellery sellers know what's in stock in every box in 3 seconds. Local-first: users own their data on their phones; the owner controls licences and subscriptions at the lowest running cost.

## Status

| Item | State |
| --- | --- |
| Requirements | Requirements doc (2026-11-22) + gap review + owner decisions (2026-11-23) |
| Architecture | **v1.0 local-first, design-reviewed. Direction chosen by the owner on 2026-11-23; full design awaiting approval** |
| Cloud design | v0.2, superseded; kept in `archive/cloud-v0.2/` |
| Code | Not started; implementation not yet authorised |

## Architecture in one paragraph

A React + TypeScript app packaged with Capacitor for Android and iPhone. All data lives in an encrypted SQLite database on the phone; there is no backend database or server code. Stock is an append-only ledger. Payments go through Google Play and the App Store, verified on the phone from the stores' signed records. The owner controls plans, limits and feature switches with an Ed25519-signed config file on a free static site, and issues signed licence keys for pilots and promotions. Users keep encrypted backups in their own Google Drive or iCloud, protected by a 12-word recovery code. Fixed cost about US$115–130 a year plus 15% store commission.

## Documents

| File | What it holds |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Context, modules, technology, key flows, infrastructure, traceability |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | On-phone SQLite schema, triggers, rules, self-checks |
| [API_CONTRACTS.md](API_CONTRACTS.md) | Entitlement logic, store products, signed config, licence keys, trusted time, label links, backup format |
| [SECURITY_MODEL.md](SECURITY_MODEL.md) | Trust boundaries, data protection, licence protection, key management, store checklist |
| [ADR.md](ADR.md) | 18 decisions with alternatives |
| [RISK_REGISTER.md](RISK_REGISTER.md) | Audit (12 defects fixed), remaining risks, what testing must prove |
| [TEST_STRATEGY.md](TEST_STRATEGY.md) | Test layers, 22 critical scenarios, quality gates |
| [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) | Phases 0–3 with acceptance criteria |
| [LOCAL_FIRST_PROPOSAL.md](LOCAL_FIRST_PROPOSAL.md) | The options comparison that led to this design |

## Owner decisions

| Date | Question | Answer | Recorded in |
| --- | --- | --- | --- |
| 2026-11-23 | Jewellery type | Any type | ADR-012 |
| 2026-11-23 | Booked tap in pilot | Yes | ADR-013 |
| 2026-11-23 | Catalogue image in Phase 2 | Yes | ADR-015 |
| 2026-11-23 | Storage users after 12 months | Renew the Move Pass | ADR-014 |
| 2026-11-23 | Architecture direction | Local-first, one device per user | ADR-001 |

## Assumptions made while waiting (owner may change)

1. iPhone and Android both at launch (US$99/year Apple fee, Mac or cloud builds) — ADR-002
2. Store billing only; Stripe and SSLCommerz dropped for now — ADR-008
3. Users own their backups; the app automates and reminds — ADR-016
4. No desktop/browser version for now — ADR-001

## Next steps

- [ ] Owner approves architecture v1.0 (or asks for changes)
- [ ] Owner confirms the 4 assumptions above
- [ ] Owner creates a GitHub repository and authorises Phase 0
