# BoxTap — Project Master

Last updated 2026-11-25 · Owner: Sirajus

## Objective

One app, two modes. **Home:** Australian movers and storage users find anything in their boxes without opening them. **Seller:** Bangladeshi jewellery sellers know what's in stock in every box in 3 seconds. A web app from the owner's own website: local-first, no app stores, no paid backend, owner-controlled licences, lowest possible cost.

## Status

| Item | State |
| --- | --- |
| Requirements | Requirements doc (2026-11-22) + gap review + owner decisions (2026-11-23) |
| Architecture | **v2.1 web app (PWA), local-first, manual licence keys, encrypted Google Drive backup. Pre-build audits done 2026-11-25 (A1–A8, then independent specialist reviews B1–B16, all Critical/High fixed in the docs); awaiting owner approval** |
| Earlier designs | Cloud v0.2 and native app-store v1.0, superseded; kept in `archive/` |
| Code | Not started; implementation not yet authorised |

## Architecture in one paragraph

BoxTap is a Progressive Web App on `boxtap.app` (Cloudflare Pages, static files only). Each user's data lives in a SQLite database inside their browser's storage (WebAssembly + OPFS), so the app works offline and nothing is stored on a server. Stock is an append-only ledger. The owner sells plans through a Stripe Payment Link (Australia) and bKash (Bangladesh), then sends a signed licence key made with a tool on their own computer; a signed config file on the website sets free limits, feature switches, prices and revoked keys. Users can connect their own Google Drive: BoxTap keeps an encrypted copy of all data and photos there while the app is open (one tap per session to allow Google access), and a new phone restores from it with a 12-word recovery code. An encrypted backup file remains the fallback. Fixed cost about US$15 a year.

## Documents

| File | What it holds |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Context, modules, technology, flows, browser limits, edge cases, traceability |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | SQLite schema, triggers, rules, self-checks, lifecycle |
| [API_CONTRACTS.md](API_CONTRACTS.md) | `can()`, licence key format, owner tools and runbook, signed config, trusted time, label links, backup format |
| [SECURITY_MODEL.md](SECURITY_MODEL.md) | Trust boundaries, data and licence protection, key management, checklist |
| [ADR.md](ADR.md) | 22 decisions (ADR-001 to ADR-022) |
| [RISK_REGISTER.md](RISK_REGISTER.md) | Audits: W1–W16, A1–A8, B1–B16 fixed; remaining risks |
| [TEST_STRATEGY.md](TEST_STRATEGY.md) | Test layers, 41 critical scenarios |
| [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) | Phases 0–3 |
| [PWA_PROPOSAL.md](PWA_PROPOSAL.md) | Options compared for the web app and payments |

## Owner decisions

| Date | Question | Answer | Recorded in |
| --- | --- | --- | --- |
| 2026-11-23 | Jewellery type | Any type | ADR-012 |
| 2026-11-23 | Booked tap in pilot | Yes | ADR-013 |
| 2026-11-23 | Catalogue image in Phase 2 | Yes | ADR-015 |
| 2026-11-23 | Storage users after 12 months | Renew the Move Pass | ADR-014 |
| 2026-11-23 | Architecture direction | Local-first, one device per user | ADR-001 |
| 2026-11-23 | Distribution | Own website as a PWA; no app stores | ADR-002 |
| 2026-11-23 | Payments and licences | Fully manual keys for now | ADR-008 |
| 2026-11-25 | Drive permission (audit B3) | One tap per session, no server | ADR-020 |
| 2026-11-25 | Customer storage | Customers keep data and photos in their own Google Drive (design: device stays main store, Drive is encrypted copy) | ADR-020 (proposed) |

## Assumptions to confirm

1. iPhone users must add BoxTap to the home screen. Backups go to Google Drive if connected; otherwise "Back up now" (ARCHITECTURE §6).
2. No downloadable Android app file (APK) for now.
3. Seller Pro sold as 1-, 3-, 6- and 12-month keys instead of automatic monthly billing.
4. One anonymous, cookieless count of "first box created" for the day-60 checkpoint.
5. Optional one-time 48-hour unlock after "I've paid" while waiting for a key — **not included** unless the owner wants it.
6. (v2.1) Drive files are **encrypted** (unreadable in the Drive website). Readable photo copies are not offered.
7. (v2.1) Drive backup is free on every plan, not a paid feature.
8. (v2.1) Google Drive is the only cloud in the MVP (no iCloud, Dropbox or OneDrive).
9. (v2.1) Backups run only while BoxTap is open; photo uploads on Android default to Wi-Fi only.
10. (v2.1) Household or staff sharing through Drive stays out of the MVP (ADR-021, open for later).
11. (v2.1) The owner creates a free Google Cloud project and OAuth consent screen in Phase 0, keeps it protected from deletion, and never replaces its client ID (audit B4).
12. (audit B3) Drive backup needs one tap per app session (and after each hour) to give BoxTap a Google token. **Decided by owner 2026-11-25: one tap per session, no server.** A free Cloudflare Worker token exchange stays a later option.
13. (audit B7) The recovery code is never stored on the device, so Settings cannot show it again; users can change it with the old code or make a new one.
14. (audit B16) Phase 0 ≈ 30 h and Phase 1 ≈ 90 h (was 15 h and 58 h).

## Next steps

- [ ] Owner approves architecture v2.1 (or asks for changes) and confirms the assumptions
- [ ] Owner creates a GitHub repository and authorises Phase 0
