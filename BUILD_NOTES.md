# BoxTap build notes

Living record of the implementation against `boxtap-architecture/IMPLEMENTATION_ROADMAP.md`. Started 2026-11-25.

## How to run

```
npm install
npm run dev            # Vite dev server (note: does not apply _headers)
npm run check          # typecheck + lint + unit tests + build
npm run build && npx playwright test --project=chromium --project=webkit --project=mobile-chrome
```

E2E runs against `wrangler dev` (Workers static assets, `wrangler.jsonc`), so the real `_headers` CSP applies (audit B1). Hosting: Cloudflare Workers static assets, deployed by Workers Builds from GitHub; static-asset requests are free and unlimited.

Owner tools (on the owner's computer only; secrets go to `owner-private/`, which git ignores):

```
npx tsx tools/keys.ts init            # once: creates cfg-YYYY and lic-YYYY keys, writes public keys into the app
npx tsx tools/licence.ts issue --plan move_pass --months 12 --licensee "Name · email" --ref stripe:pi_…
npx tsx tools/licence.ts revoke lk_…
npx tsx tools/config.ts sign          # writes public/config/v1.json
```

## Status by roadmap step

| Step | State | Evidence |
| --- | --- | --- |
| Phase 0 repo, Vite/React/TS/Tailwind/PWA, ESLint, Vitest, Playwright | Done | `npm run check` green |
| Phase 0 SQLite WASM + OPFS sahpool + FTS5 trigram | Done in Chromium; Safari/Firefox not yet proven | E2E; Node DB tests incl. Bangla trigram search |
| Phase 0 Web Lock single tab + persistent storage | Done | E2E critical test 4 (Chromium) |
| Phase 0 owner tools keys/licence/config | Done | `tools/owner.test.ts`, CLI smoke run |
| Phase 0 security headers | Done in `public/_headers` | E2E checks CSP header and app start |
| Phase 0 camera + zxing scan spike | Code done; real-device check pending | QR decode unit test with zxing |
| Phase 0 Google sign-in spike + Cloud project | Test OAuth client made by the owner; live test site on Cloudflare Workers; real-device sign-in check pending | |
| 1.1 First launch (restore choices first, mode, language, recovery code) + install guide | Done | E2E |
| 1.2 Rooms, boxes, items, photos, 30-day bin, rename room, arrival check | Done | repo tests, E2E |
| 1.3 Labels + PDF | Done; print test on 3 printers pending | layout/PDF tests, E2E download |
| 1.4 In-app scanner + `/b/:code` | Done; real-device scan pending | E2E link tests |
| 1.5 Search | Done | 400 items < 1 s test |
| 1.6 Free limits via `can()` | Done (built-in config; signed config fetch is Phase 1b) | service tests, E2E critical test 12 |
| 1.7 Backup and restore (file), CSV export, Erase all data | Done, with photos | crypto/snapshot tests, E2E round trip |
| 1.7b Google Drive backup (snapshots + photos) | Done against a fake Drive; real Google check on devices pending; "Use this device instead" and the iPhone redirect fallback not yet | sync/photo queue tests |
| 1.8 Offline, update prompt, launch | Update prompt and precache done; offline E2E and launch not yet | |

## Rulings made during the build (deviations from the docs, with cost if wrong)

1. **Live workspace delete guard.** Added trigger `ws_no_live_delete`: SQLite removes the parent row before cascading, so the documented `sm_no_delete` could not stop a direct delete of a live workspace (tested). Cost if wrong: none expected; erase must set `deleted_at` first, as the doc already says.
2. **Seller Free photo limit** uses `home_photos_per_box` (config has no seller value). Cost: the owner may want a separate number; add a config field.
3. **Deleting a room** is not binned; its boxes keep working with no room. Cost: a mistaken room delete loses only the room name.
4. **i18n** is a small typed dictionary over `en.json`/`bn.json` instead of i18next. Same files, easy to switch. Bangla strings need a native speaker's review.
5. **Backup payload container** is a simple length-prefixed format (`BTPK1`) instead of zip. Cost: a backup can't be opened with a zip tool (it is encrypted anyway).
6. **No-OPFS fallback** runs SQLite in memory with a clear "can't store data" banner; the IndexedDB driver from ADR-003 is not built yet. Cost: browsers without OPFS can't keep data.
7. **Label PDF text** uses built-in Latin fonts; non-Latin characters print as "?" until a Bangla font subset is embedded (Phase 2). Box number and QR always print.
8. **Recovery code** uses the BIP39 English word list (checksum catches most typos).

9. **Restoring from the bin is never gated by free limits** (H-06). A Home Free user can end up with 13 boxes after a restore; new boxes stay blocked.
10. **Memory fallback is narrowed**: only when OPFS is missing or fails outright. A file held by another tab is retried; a failed restore swap or a failed open of the real file shows an error instead of an empty app.

## Independent review, 2026-11-25

A separate reviewer read the whole codebase against the docs. It reported 13 findings. Fixed, each with a test that failed first, or a browser check where only a browser can show it:

- Crafted backup could bring its own trigger past the schema check (`sqlite`-prefixed names, writable_schema). Now every schema row is compared, and foreign keys are checked. (3 new tests)
- Tab take-over could silently open an empty in-memory database. Now it retries, then says "close the other window".
- Memory fallback could hide the real database. Now it fails visibly.
- Restore kept no safety copy. Now `/before-restore.sqlite3` holds the previous database, and a failed swap puts it back.
- "Last backup" was recorded even if the share sheet was cancelled. Now it is recorded only after the file was shared or downloaded.
- Bin restore was blocked by the free limit (H-06). Now it is never blocked.
- Purge unlinked labels from boxes it had to keep. Now labels stay, and those archived boxes are hidden from the bin.
- Restoring an item whose box is binned revived its photos. Fixed.
- Owner tools: customer names starting with `=`, `+`, `-` or `@` are neutralised in `licences.csv`. Signing or revoking without `config.json` is refused, so `seq` cannot restart and be ignored by every app.

Deferred (recorded, not fixed yet):

- Purge may report photo file names from a rolled-back savepoint (finding 8). It matters once photos exist.
- Restore holds the backup in memory 4–5 times (finding 13). It must stream before photos go into backups (iPhone memory).
- "Undo restore" button using the kept safety copy. A recovery screen that exports the raw database when it can't open.
- `migrate()` must make a safety copy before any migration once schema v2 exists (DATABASE_SCHEMA §2, L9).
- `pack()` does not bound name or entry sizes on write.
- Licensing end to end (licence keys and signed config in `can()`) is Phase 1b and not wired yet.

## Test environment limits (not counted as passes)

- **Firefox E2E:** Windows on this computer blocks Playwright's Firefox binary from running ("Permission denied"). Not a BoxTap failure; needs the binary allowed, or a CI runner.
- **WebKit E2E on Windows:** Playwright's Windows WebKit build has no OPFS sync access handles, so BoxTap falls back to memory there. Storage tests are skipped with that reason. Real Safari (iOS 17+) must be checked on an iPhone (spike R6).

## Needs the owner

- GitHub repository name (nothing is pushed yet).
- Google Cloud project + OAuth clients (production and test) for Drive backup (Assumption 11, R15).
- Real-device checks: iPhone home-screen app and Safari tab, low-cost Android, desktop; label print on 3 printers.
- `npx tsx tools/keys.ts init` on the owner's computer before any licence key or signed config can verify.
