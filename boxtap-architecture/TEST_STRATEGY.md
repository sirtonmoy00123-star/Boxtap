# BoxTap — Test Strategy (v2.1, web app, manual keys, Google Drive backup)

Goal: prove what would hurt users most (lost data, wrong stock totals) and the owner most (keys that don't work, or work when they shouldn't).

## 1. Test layers

| Layer | Tool | Covers | Runs |
| --- | --- | --- | --- |
| Unit | Vitest | `can()`, stacking of keys, `trustedNow()`, key and config verification, label PDF maths, i18n keys complete in `en` and `bn` | Every PR |
| Database | Vitest + SQLite WASM in Node | Constraints, ledger triggers, append-only triggers, FTS, migrations from every past version | Every PR |
| Crypto | Vitest with known-answer vectors | Ed25519, AES-256-GCM, Argon2id parameters, backup round trip | Every PR |
| Owner tools | Vitest | `licence.ts issue/revoke`, `config.ts sign` produce files the app accepts | Every PR |
| End-to-end | Playwright: Chromium, WebKit, Firefox; phone and desktop sizes | Main journeys, offline mode, two-tab lock, update prompt | Every PR (smoke), nightly (full) |
| Real devices | Low-cost Android (Chrome), iPhone (Safari tab and home-screen app), desktop | Install, camera scanning, storage persistence over 2+ weeks, backups via share sheet | Before each release; long-run check once per phase |
| Print | Avery L7165/L7163 on 3 printers | Alignment; every QR scans in the app | Before Phase 1 launch |
| **(v2.1)** Drive contract | Vitest with a fake Drive API (MSW) | Upload queue, retries, 401/403/404/429 handling, lock checks, snapshot pruning, no token in storage | Every PR |
| **(v2.1)** Drive real | A test Google account, manual on real devices | Sign-in in Safari tab, iPhone home-screen app, Android, desktop; restore on a second device | Before each release that touches sync **or the schema** |
| **(audit)** Drive contract, real API | Nightly suite against a test Google account and the **test** OAuth client | Real Drive behaviour a fake can't copy: listing lag after create, 409 on reused IDs, trash, 403 reasons | Nightly |
| **(audit)** Fault injection | Playwright + a harness that kills the worker or goes offline at each step | Every step of snapshot, upload, takeover and restore | Nightly |
| **(audit)** Production headers | E2E run against `wrangler pages dev` with the real `_headers` (CSP) | App starts, WASM loads, photos show | Every PR |

## 2. Critical scenarios

| # | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| 1 | Close and reopen the browser, restart the phone | All data still there | 1 |
| 2 | iPhone home-screen app unused for 14 days | Data still there | 1 |
| 3 | Airplane mode after first load | Whole app works | 1 |
| 4 | Open BoxTap in a second tab | "Open in another tab"; no corruption | 1 |
| 5 | Private window | Warning banner shown | 1 |
| 6 | Scan own label in the app (Chrome native, Safari WASM) | Box opens | 1 |
| 7 | Scan someone else's label | "This box isn't in your BoxTap" | 1 |
| 8 | Open a label link in a browser with no data | Landing message only | 1 |
| 9 | Back up on phone → restore on another device with the recovery code | Everything back, including photos | 1 |
| 10 | Restore with a wrong recovery code | Clear error, nothing changed | 1 |
| 11 | Storage full while adding a photo | Photo refused with a message; database intact | 1 |
| 12 | Add box 13 on Home Free | Upgrade screen with payment link | 1 |
| 13 | Paste a valid Move Pass key | Unlocked, "Licensed to …" shown, works offline | 1b |
| 14 | Forged, expired, wrong-`kid`, or revoked key | Rejected with the right message | 1b |
| 15 | Two 12-month keys | End date = first end + 12 months | 1b |
| 16 | Device clock set back 1 year | Paid plan treated as ended, warning | 1b |
| 17 | Older config (lower `seq`) | Ignored | 1b |
| 18 | New release deployed while the app is open | "New version" prompt; data intact after update and migration | Every release |
| 19 | Sell, undo within 10 s, undo after 24 h | First works; second refused | 2 |
| 20 | Booked → Packed; Booked → Cancel | Correct on-hand and available | 2 |
| 21 | Move 3 of 10 to another box | Source 7, target 3, two ledger rows | 2 |
| 22 | Close the tab in the middle of a stock change | Saved fully or not at all; ledger check clean | 2 |
| 23 | Bangla speaker sells one item without English (S-10) | Done unaided | 2 (pilot) |
| 24 | (v2.1) Connect Drive on iPhone home-screen app | Signed in; folder created; first snapshot uploaded | 0 spike, 1 |
| 25 | (v2.1) Add 50 photos, close the app half-way, reopen | Remaining uploads resume; no duplicates in Drive | 1 |
| 26 | (v2.1) Lose phone: restore from Drive on a new device with the code | All boxes back in < 1 min; photos follow | 1 |
| 27 | (v2.1) Restore on device B, then open device A | A stops syncing with the "used by another device" message | 1 |
| 28 | (v2.1) Google storage full; token expired; folder deleted; access revoked | Right banner each time; no data lost on the device | 1 |
| 29 | (v2.1) Open a Drive file from the Google Drive website | Unreadable; names reveal nothing | 1 |
| 30 | (v2.1) Wrong recovery code on Drive restore | Clear error, nothing changed | 1 |
| 31 | (audit B2) New phone: onboard as new, then Connect Drive that already holds a backup | "Restore it" offered first; old backup never overwritten; never two keys in one folder | 1 |
| 32 | (audit B5) Lost phone found again after restore on a new phone; old phone tries "Use this device instead" | Warned that Drive is newer; newer snapshot kept | 1 |
| 33 | (audit B5) Device clock set a year ahead, then corrected | Snapshot order and retention unchanged (sequence, not time) | 1 |
| 34 | (audit B6) Restore a snapshot from every past schema version, and one from a future version | Older: migrated; future: "Update BoxTap first" | Every release |
| 35 | (audit B6) Kill the app at each step of a restore | Next start finishes or rolls back; no half-restored data | 1 |
| 36 | (audit B9) Delete the BoxTap folder in the Drive website | Trash detected; "Restore from trash" offered; no "Backed up" while trashed | 1 |
| 37 | (audit B10) Lose the network after a photo upload but before the reply | No duplicate file in Drive | 1 |
| 38 | (audit B12) Take a photo on iPhone Safari and on a 48 MP Android camera | Saved under 600 KB; no crash | 1 |
| 39 | (audit B8) Erase a Seller workspace with stock movements | Erased fully; live workspaces' ledgers still undeletable | 2 |
| 40 | (audit B7) Change and renew the recovery code | Old code stops working on new files; old-key files removed from Drive | 1 |
| 41 | (audit) Erase all data with Drive connected; "Before big change" after deleting half the boxes; restore an older snapshot | Empty DB never uploaded; previous copy kept; older snapshot restores | 1 |

## 3. Quality gates

- CI blocks merge on: typecheck, lint (incl. the `SET on_hand` rule), unit, database, crypto, owner-tool tests, smoke E2E in all three engines, secret scan.
- A release needs the real-device checklist on Android Chrome and an iPhone home-screen app.
- Never skip a failing test to get green.
