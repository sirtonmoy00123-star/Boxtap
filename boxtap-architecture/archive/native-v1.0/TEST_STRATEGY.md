# BoxTap — Test Strategy (v1.0, local-first)

Goal: prove what would hurt users most — lost data, wrong stock totals, other people reading their data — and what would hurt the owner most: paid features unlocking without payment, or payments that don't unlock.

## 1. Test layers

| Layer | Tool | Covers | Runs |
| --- | --- | --- | --- |
| Unit | Vitest | `can()`, `trustedNow()`, licence key and config verification, Move Pass end-date maths, label PDF layout, i18n keys complete in `en` and `bn` | Every PR |
| Database | Vitest + SQLite (sql.js or better-sqlite3 with the same schema) | Constraints, ledger triggers, append-only triggers, FTS triggers, migrations from every past version | Every PR |
| Crypto | Vitest with known-answer vectors | Ed25519, AES-256-GCM, Argon2id parameters, backup format round trip | Every PR |
| UI end-to-end | Playwright against the web build (same React code) | Main journeys with a fake billing adapter | Every PR (smoke), nightly (full) |
| Native | Maestro flows on Android emulator and iOS simulator | Camera permission, app links, billing sandbox, notifications, backup to a folder | Before each release |
| Device | One low-cost Android (2–3 GB RAM), one iPhone | Speed budgets, real camera scans, real backups to Drive/iCloud | Before each release |
| Store sandbox | Play licence testers, Apple sandbox / StoreKit config file | Purchase, renew, refund, restore, lapse | Before Phase 1b and each billing change |
| Print | Avery L7165 and L7163 on 3 printers | Alignment; every QR opens the app | Before Phase 1 launch |

## 2. Critical scenarios

| # | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| 1 | Copy the database file off the phone and open it | Cannot be read | 1 |
| 2 | Fresh phone: restore from `.btbak` with the recovery code | All boxes, items, photos back | 1 |
| 3 | Restore with a wrong recovery code | Clear error, nothing changed | 1 |
| 4 | App finds a database but no key | Restore screen, no crash | 1 |
| 5 | Scan own label with the phone camera (Android and iPhone) | App opens on that box | 1 |
| 6 | Scan someone else's label | "This box isn't in your BoxTap" | 1 |
| 7 | Scan with BoxTap not installed | Static page, no data, store buttons | 1 |
| 8 | Add box 13 on Home Free | Upgrade screen; nothing lost | 1 |
| 9 | Weekly backup with 500 photos on a cheap phone | Completes in the background; app stays usable | 1 |
| 10 | Buy Move Pass in sandbox | Active within 10 s, offline afterwards | 1b |
| 11 | Buy Move Pass twice | End date extends by 12 months from the first end date | 1b |
| 12 | Reinstall and Restore purchases | Same plans and dates | 1b |
| 13 | Refund in sandbox, reopen online | Plan ends; data stays readable | 1b |
| 14 | Set phone clock back 1 year | Paid plans treated as expired, warning shown | 1b |
| 15 | Old config file with higher limits | Ignored | 1b |
| 16 | Forged / expired / revoked / wrong-install licence key | Rejected with the right message | 2 |
| 17 | Sell, undo within 10 s, undo after 24 h | First works; second refused | 2 |
| 18 | Booked → Packed; Booked → Cancel | Correct on-hand and available | 2 |
| 19 | Move 3 of 10 to another box | Source 7, target 3, two ledger rows | 2 |
| 20 | Kill the app in the middle of a stock change | Either fully saved or not at all; ledger check finds no mismatch | 2 |
| 21 | Bangla speaker sells one item without English (S-10) | Done unaided | 2 (pilot) |
| 22 | Update the app with a schema migration over real pilot data | Data intact | Every release |

## 3. Quality gates

- CI blocks merge on: typecheck, lint (including the `SET on_hand` rule), unit, database, crypto, smoke E2E, secret scan.
- A release needs the native and device checklists signed off on both phones.
- Never skip a failing test to get green; fix it or remove it with a reason in the PR.
