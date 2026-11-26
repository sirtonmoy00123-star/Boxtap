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
| 1.7b Google Drive backup (snapshots + photos) | Done against a fake Drive; real Google check on devices pending; "Use this device instead" and the iPhone redirect fallback not yet | sync/photo queue tests; weekly photo check re-uploads photos deleted in Drive |
| 1b Paid keys (licence entry, payment links, renewal reminders) | Skipped for now by the owner (2026-11-25) | |
| 2 Seller: stock ledger (sell, restock, booked, packed, cancel, damaged, returned, undo 24 h, count, move), item details incl. jewellery fields, low-stock list | Done, with the in-stock catalogue picture and Bangla text on labels (drawn by the browser, placed in the PDF) | stock tests, Seller E2E |
| 3 Seller Pro extras: cost/profit, reports, orders, variants | Built ahead of the pilot at the owner's request (2026-11-26), including Excel export (Items, Sales, Orders sheets) | reports/orders/variants/xlsx tests; Pro E2E on a preview build |
| Removalist Phase 1 (foundation): schema v6, `can()` per type, teal, onboarding, Jobs tab, job Bin/archive | Done on branch `feature/removalist-mode` (not merged, not pushed) | v6 migration and trigger tests, jobs/licensing tests, `e2e/removalist.spec.ts` incl. axe |
| Removalist Phase 2 (boxes and furniture pieces in a job, job rooms, quick add, job labels) | Done on branch `feature/removalist-mode` (not merged, not pushed) | `pieces.test.ts`, `jobLabels.test.ts` (fit on both sheets), `e2e/removalist.spec.ts` |
| Removalist Phases 3-7 (load check, condition and sign-off, volume, PDFs/crew mode, finish) | Not started | `docs/removalist-plan.md` §10 |
| 1.8 Offline, update prompt, launch | Update prompt and precache done; offline E2E and launch not yet | |

## Rulings made during the build (deviations from the docs, with cost if wrong)

1. **Live workspace delete guard.** Added trigger `ws_no_live_delete`: SQLite removes the parent row before cascading, so the documented `sm_no_delete` could not stop a direct delete of a live workspace (tested). Cost if wrong: none expected; erase must set `deleted_at` first, as the doc already says.
2. **Seller Free photo limit** uses `home_photos_per_box` (config has no seller value). Cost: the owner may want a separate number; add a config field.
3. **Deleting a room** is not binned; its boxes keep working with no room. Cost: a mistaken room delete loses only the room name.
4. **i18n** is a small typed dictionary over `en.json`/`bn.json` instead of i18next. Same files, easy to switch. Bangla strings need a native speaker's review.
5. **Backup payload container** is a simple length-prefixed format (`BTPK1`) instead of zip. Cost: a backup can't be opened with a zip tool (it is encrypted anyway).
6. **No-OPFS fallback** runs SQLite in memory with a clear "can't store data" banner; the IndexedDB driver from ADR-003 is not built yet. Cost: browsers without OPFS can't keep data.
7. **Label PDF text**: Latin text uses the built-in PDF font; any other line (e.g. Bangla) is drawn on a canvas by the browser, which shapes it correctly, and placed in the PDF as a 300 dpi picture. Cost: that text isn't selectable in the PDF.
8. **Recovery code** uses the BIP39 English word list (checksum catches most typos).

9. **Restoring from the bin is never gated by free limits** (H-06). A Home Free user can end up with 13 boxes after a restore; new boxes stay blocked.
10. **Memory fallback is narrowed**: only when OPFS is missing or fails outright. A file held by another tab is retried; a failed restore swap or a failed open of the real file shows an error instead of an empty app.

11. **Schema versions**: v1 was released with the first live test site (2026-11-25). v2 fixes phones set up then (adds photos.drive_file_id only if missing) and stores sale price and cost on each movement; v3 adds orders; v4 adds products and variant labels. Restore validation compares tables by columns and triggers/indexes by exact SQL. Cost if wrong: a crafted backup could drop CHECK constraints on its tables; triggers can still never be added.
12. **Paid-plan preview switch**: VITE_PREVIEW_PAID_PLANS=1 unlocks Move Pass and Seller Pro in a build, for testing while licence keys are skipped. It must not be set for real customers. Run the Pro browser tests with: VITE_PREVIEW_PAID_PLANS=1 npm run build && PRO_E2E=1 npx playwright test e2e/pro.spec.ts.
13. **Orders and Undo**: booking, packing or unbooking an item that sits in an open or packed order can't be undone from the item page; change it from the order. Cost: also blocks undoing a manual booking of that item while such an order exists.
14. **Lost recovery code**: the Drive link is closed and the old folder is left (renamed when the next connect starts a new folder), not deleted. Cost: old encrypted files stay in the user's Drive until they delete them.

15. **Full-page sign-in hand-off**: /oauth puts the checked token in sessionStorage (same tab) for the seconds until the app starts and removes it. Cost: a deviation from "token never in storage"; the window is seconds and same-tab only.
16. **Rescue copy** is the raw, unencrypted database file, offered only when the database can't open. Not tested in a browser (a broken database can't be forced in the E2E suite).
17. **Sales before schema v2** have no stored price or cost, so reports count them with no revenue. The ledger is append-only, so they can't be backfilled. Only affects test data from 2026-11-25.
18. **WebKit E2E retry**: Playwright's Windows WebKit build sometimes drops the tap on Print labels after scrolling; one retry is allowed there only. Chromium and phone-sized Chrome pass without retries.
19. **Owner step for the full-page sign-in**: the Google client needs the redirect URI <site>/oauth (for example https://boxtap.sirtonmoy00123.workers.dev/oauth) under Authorized redirect URIs.
20. **Excel on by default**: features.excel is true in the built-in config now that Excel export exists; a signed config can still turn it off.
21. **Weekly photo check** (DATABASE_SCHEMA §5 step 5): once a week per device, the app lists the Drive photos folder and re-queues uploads for photos whose Drive copy is gone. It never deletes Drive files it doesn't recognise, because an older snapshot may still point at them. Cost if wrong: orphan photo files use some of the customer's Drive space.

## Second independent review, 2026-11-26

A fresh reviewer found 19 issues. Fixed with tests: photos in Drive not recorded in snapshots (critical); order and item stock drifting (critical; schema v5 links order movements); binning items in open orders; variants mixed when moved and missing names; v1 backups from the in-between build refused; erase leaving the before-restore copy; box page losing typing; count below booked; binned photos blocking the queue; UTC report days; Seller CSV columns and file name; double taps; uncaught errors; no confirm before deleting; iPhone safe areas; touch targets and labels; silent self-check failures; iPhone share after long work. Not fixable: finding 12 (see ruling 17).

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
- ~~`migrate()` must make a safety copy before any migration~~ Done in Removalist Phase 1: the worker keeps `/before-migrate.sqlite3`.
- `pack()` does not bound name or entry sizes on write.
- Licensing end to end (licence keys and signed config in `can()`) is Phase 1b and not wired yet.

## Design system applied (2026-11-26)

The owner approved the UI design system (ADR-023, `boxtap-architecture/DESIGN_SYSTEM.md`). Built on branch `design-system`.

What changed:

- **Foundations.** `src/index.css` holds the colour tokens (§2, light, dark, more contrast, Seller indigo through `data-mode="seller"` on `<html>`), the typography (§3) and the Tailwind 4 theme (§9 in `@theme`: the default palette, radii and font sizes are replaced, not extended). Every old class (`bg-blue-700`, `text-slate-500`, `text-sm`, `rounded-xl` …) was moved to tokens; the built CSS has no default colours left. `viewport-fit=cover` was already set; the top bar, tab bar, Scan button and sheets use `env(safe-area-inset-*)`. Focus ring 2 px accent. Reduced motion turns slides into fades; reduced transparency (and Android) gets a solid tab bar, iPhone a blurred one (`data-platform`).
- **Fonts.** Noto Sans Bengali 400 and 600, Bangla subset only, self-hosted in `public/fonts` (woff2, `font-display: swap`, Bangla `unicode-range`, SIL OFL licence copied beside them). Taken from the `@fontsource/noto-sans-bengali` 5.3.0 package files; not added as a dependency.
- **Icons.** `lucide-react` added (24 px, 1.75 stroke, hidden from screen readers; the words beside them speak).
- **Navigation.** 3-tab bottom bar (Home: Boxes, Rooms, Settings; Seller: Stock, Booked, Settings) and a floating 56 px Scan button above it, on top-level screens. At 1024 px and wider the tabs become a left sidebar. Detail screens push with a back button.
- **Boxes list.** Large title, search field under it, inset grouped box cards: label tag chip (box number, 10 px radius, 2 px accent border, QR corner mark), name, room · where, item count, Fragile and Open first badges with icon + word. Backup status banner with one action (min-width 60 px). Empty state: one sentence + one primary button ("Add your first box"). Add box is the + in the top bar.
- **Box screen.** Autosaves name, where and notes 500 ms after typing stops, with a "Saved" footnote (`role=status`); also saves at once when leaving the screen or hiding the app. Save button removed. "Move box to Bin" is a danger text button at the bottom, followed by a 5 s toast "Box 12 moved to Bin · Undo" (no confirm dialog). Fragile / Open first are toggle chips; the move status is a segmented control.
- **Rooms tab** (new): rooms with box counts; a room opens its boxes and can be renamed. **Booked tab** (Seller, new): items with booked stock, plus Orders.
- **Settings tab**: inset grouped lists; the Bin is now a row here (with labels and backup). Bin and Print labels go back to Settings.
- **Scan view**: full screen camera, rounded guide, close (top left) and torch (top right, only when the camera has one), "Box 12 found" announced through `role=status`, the guide turns the success colour and the label tag appears, then the box opens. Vibrates on Android only.
- **Language.** All new text is in `en.json` and `bn.json`. Bangla mode shows Bangla digits on screen (`Intl.NumberFormat('bn-BD')` through `t()` placeholders and `num()`); stored data and inputs keep Western digits. English dates read "26 Nov 2026". `<html lang>` follows the list language.
- **Sheets.** Upgrade and install guide open as bottom sheets with a grabber.

Rulings made while applying it (cost if wrong):

20. **Secondary buttons: grey fill with `--accent-on-grey` (owner decision 2026-11-26).** Accent text on surface-2 is 4.4:1, below WCAG AA (§8), and axe failed it. A first fix used white with a hairline border. The owner chose instead to keep the grey fill (`--surface-2`) and add a darker label token, `--accent-on-grey`: light #004FA8 / Seller #4644B8, dark #409CFF / #9593FF, more contrast #003A80 / #2B2980, more contrast + dark #80BFFF / #C0BFFF. It is in `src/index.css`, the Tailwind theme (`text-accent-on-grey`) and DESIGN_SYSTEM §2 and §5. The backup banner's action button now matches it too (grey fill, `--accent-on-grey` label, no border, min-width 60 px, centred label; owner decision 2026-11-26).
21. **Two extra fixed colours**: `scrim` (dimmed backdrop behind sheets) and `camera` (black scan view), defined as tokens in the theme, not themed.
22. **Spacing keeps Tailwind 4's 4 px step** instead of a fixed list: it gives exactly §9's values (1=4px … 14=56px) and keeps the existing classes working.
23. **Removing a single item still asks first** (confirm). Only the box delete moved to Undo, as approved. Cost: inconsistent with §5 until items get Undo too.
24. **Booked tab** lists items with booked stock by reading every box (no new query). Fine for pilot sizes; needs an indexed query for big shops.

Pending (not built in this round):

- Full grouped-list restyle of the item, photos, Drive, catalogue, orders, reports, labels and restore screens: they use the tokens now, but keep their older layout.
- Swipe to Bin on rows (the button alternative exists), skeleton loading after 300 ms, sheets asking before discarding typed text, the "guide shrinks into the label tag" animation is a simple fade.
- Phase 0 checks from DESIGN_SYSTEM §10 on real devices (iPhone Larger Text, Noto Sans Bengali on budget Android, tab-bar blur), and an automated contrast check in CI (axe runs in E2E now).
- **Bangla strings for native review**: `home.empty`, `home.addFirst`, `home.backupAction`, `home.searchClear`, `nav.*`, `box.saving`, `box.binned`, `box.restored`, `box.details`, `box.status`, `rooms.*`, `booked.*`, `settings.more`, `settings.binHint`, `scan.close`, `scan.torch`, `scan.found`, `scan.opening`.

Tests (2026-11-26, this branch):

- `npm run check`: typecheck, lint (0 errors; the same 9 warnings as before), unit tests 250 passed (3 new for Bangla digits and dates), build OK.
- E2E `chromium` + `mobile-chrome`: 62 passed, 8 skipped (Pro tests need a preview build; the WebKit-only banner test), 0 failed. Before the change: 69 passed incl. WebKit, 1 WebKit failure (below).
- E2E selectors changed only where the design moved things: the box screen waits for the "Saved" footnote instead of tapping Save (2 tests); the bin test opens the Bin from Settings and returns through the Boxes tab. New E2E tests: Undo after Move box to Bin; autosave when leaving at once; tabs, Rooms and Bangla digits; Seller indigo and tabs; scan view Close; an axe WCAG 2.2 AA check of the Box and Boxes screens (`@axe-core/playwright`, dev only).
- E2E `webkit` (it ran before, so it was run again): 22 passed, 12 skipped (no OPFS in the Windows build, Chromium-only tests), 1 flaky: "export CSV, then erase all data" timed out waiting for the download once and passed on its allowed retry (ruling 18). The same kind of WebKit download timeout failed the removalist test in the run before this change; that test passes now.

Re-run after the `--accent-on-grey` change (ruling 20), 2026-11-26: `npm run check` passed (250 unit tests, 0 lint errors); E2E chromium + mobile-chrome + webkit together: 85 passed, 20 skipped, 0 failed, 0 flaky, including the axe WCAG 2.2 AA check.

## Removalist mode, Phase 1 (2026-11-26)

Plan: `docs/removalist-plan.md` (approved by the owner, answers in §11). Branch `feature/removalist-mode`, made from local main with its 3 unpushed commits. Not merged, not pushed, not deployed.

Built:

- **Schema v6** (`src/core/db/schemaV6.ts`). `workspaces` (type adds `removalist`) and `entitlements` (plan adds `removalist_pro`) are rebuilt. `migrate()` has a rebuild path: foreign keys OFF outside the transaction, the rebuild, a `foreign_key_check` before commit, then foreign keys back ON. Triggers whose body names `workspaces` (`sm_no_delete`, `ws_no_live_delete`) are dropped and re-created from their own stored SQL, so they stay identical. All Removalist tables from plan §4.2 and all triggers from §4.3 are in v6 now, so later phases should need no new migration.
- **Safety copy before migrating**: the worker copies the database to `/before-migrate.sqlite3` when `user_version` is below the app's, and puts it back if migration fails. Erase all data removes it. The OPFS pool reserves 14 slots (was 12).
- **Bin**: jobs are binned with their boxes and pieces at one timestamp and restored together (never gated). The Bin lists jobs; a job's own boxes are not listed separately. The purge removes jobs binned over 30 days ago and skips anything a lock protects.
- **Licensing**: `can()` picks the plan from an explicit table (`PLAN_FOR`), with no fallback to Seller. New: `add_job` (Free: 2 active jobs), `add_condition_photo` (3 Free / 10 Pro per piece per stage), `logo_branding` (Pro). The new config fields are optional, with built-in defaults, so configs signed before v6 still verify. `VITE_PREVIEW_PAID_PLANS=1` also unlocks `removalist_pro`. Removalist PDFs and sharing, boxes, items, viewing, search, export, backup, restore and Bin restore are never gated.
- **UI**: teal under `data-mode="removalist"`: light #00737A (5.6:1 on white), on-grey #00666C (5.4:1 on #E5E5EA), dark #40C8E0 text with #00737A fills, more contrast #00585E. axe passes. The third Start card is "Removalist business". Onboarding steps: business details (name and phone required) → country (AU: AUD and m³; BD: BDT, ft³ by default or m³) → data warning → recovery code (skipped if this phone already has a backup key) → optional trucks (three editable example rows, 20/30/45 m³). The 22 starter volume items are seeded, and Standard carton is the default box size. Tabs: Jobs · Scan · Settings. Jobs list: filters, search, status chip, piece/loaded progress. New/edit job form. The job screen has the Overview (tel: and maps links, status change behind a confirm). The other sections are placeholders marked "Coming in the next update". Settings has Business details, Trucks, the Volume list ("Starter values — adjust to your own experience") and "Add another list → Removalist business".

Rulings (cost if wrong):

25. **Extra v6 columns not in plan §4.2:** `volume_catalogue.kind` (box/furniture), `business_profile.default_box_item_id` and `jobs.truck_id`. Added now so Phases 2 and 5 need no migration. Cost: none if unused.
26. **`locations.job_id`, `rooms.job_id` and the event/record links to a box are `ON DELETE CASCADE`**, so the 30-day purge of a binned job removes its pieces in one step. A live job can't be hard-deleted (`jobs_no_live_delete`).
27. **`job_events` is append-only while its job is live.** Once the job has been in the Bin for 30 days, the purge may remove its events with it. Cost: the load history of a deleted job goes with the job, as the Bin promises.
28. **A rebuild migration fails only on new broken links** (count before vs after), so a link that was already broken can't block every future upgrade.
29. **Move date** is stored as local date and time without a zone ("2026-12-03T08:30"). "Today" uses the phone's local date.
30. **Job filters:** no chip selected = all open jobs; Upcoming = Booked; Today = moving today and not Closed; In progress = Packing, Loaded or Delivered; Closed = Closed or archived. Archived and Closed jobs don't count toward the free limit. Status can be set to any value by hand, after a confirm.
31. **Removalist Settings** hides Print labels (job labels come in Phase 2) and the list-name field (the business name is edited in Business details, which renames the list too).
32. **Truck capacity** is always typed and stored in m³, also when the unit is ft³. On-screen ft³ comes with Volume (Phase 5).
33. **Removalist CSV export** uses the Home CSV for now. The job CSV comes in Phase 6.
34. **Piece photo limit** (owner: decide later) is the config value `removalist_photos_per_piece`, with a placeholder of 3 Free / 10 Pro.

Not tested automatically: the worker's put-back of `/before-migrate.sqlite3`, which runs only in a browser with an old database file. The unit tests show that a failing v6 migration changes nothing (one transaction) and that foreign keys come back ON.

Tests (2026-11-26):

- Before (main + plan commit): `npm run check` 256 unit tests passed, lint 0 errors / 9 warnings. E2E chromium + webkit + mobile-chrome: 85 passed, 20 skipped, 0 failed.
- After: `npm run check` passed, 289 unit tests (then 290 with the failing-migration test, unit run only), lint 0 errors / the same 9 warnings. E2E chromium + webkit + mobile-chrome: 103 passed, 20 skipped, 0 failed, 0 flaky. The 18 new runs are the 6 tests in `e2e/removalist.spec.ts` × 3 browsers (onboarding + job create/search/filter/status/Bin/restore; free job limit; Settings pages; adding Removalist from Settings skips the code; Home and Seller first launch unchanged; axe on the Jobs, job and new-job screens). All existing Home and Seller tests pass unchanged.

**Bangla strings for native review (Removalist):** `setup.removalist`, `setup.removalistHint`, `nav.jobs`, every `rm.*` key, `upgrade.limit_jobs`, `upgrade.removalistPro`, and the 22 Bangla names in `src/core/repo/removalist/catalogue.ts`. All were written by Claude.

## Removalist mode, Phase 2 (2026-11-27)

The owner said "go" for Phase 2 (pieces and labels). Branch `feature/removalist-mode`; not merged, not pushed.

Built:

- **Boxes and furniture pieces in a job** (`src/core/repo/removalist/pieces.ts`). Each one is a normal `locations` row with `job_id`, `is_piece` and `job_seq`, so the Home box screen, contents, photos, autosave, labels and the Bin all work unchanged. Numbers restart per job and per kind ("Box 1, Box 2…" and "Piece 1, Piece 2…"); the workspace-wide number stays internal.
  - New boxes get the default box size (Standard carton), which can be changed. A furniture piece can link to a furniture type from the volume list.
  - Adding the first box or piece moves the job from Booked to Packing.
- **Quick add**: "+ 10 boxes" makes 10 numbered empty boxes in one transaction, through `can()` (Removalist has no box limit).
- **Rooms per job**: `rooms.job_id`. The box screen of a job box lists and adds only that job's rooms ("Destination room"). The repo refuses a room from another job.
- **Box screen in job context**: "Box 3 · J-0042 · Khan", the box-size or furniture-type picker, and Back to the job. Furniture shows a sofa icon. Moving a box of a signed job to the Bin shows "This job has a signed report, so its boxes and furniture can't be moved to the Bin."
- **Job screen**: a Boxes and furniture section with counts, the list, "+ Box", "+ Furniture piece", "+ 10 boxes" and Print labels. A warning appears when boxes changed after the last print.
- **Job labels** (`buildJobLabelPdf` in `src/core/labels/pdf.ts`, same pdf-lib code and QR format as Home). Each label has:
  - business name (or the logo: Pro only, L7165 only, only if it fits)
  - "Box 12 of 45" / "Piece 3 of 7", in the list's language
  - "Khan · J-0042"
  - destination room
  - FRAGILE / OPEN FIRST
  - the code

  Non-Latin text is drawn by the browser as a picture, as on Home labels. Print all or chosen boxes, on the default sheet from Business details (new "Label sheet" setting), with a start position.
- **Scanning**: a job box's `/b/<code>` link or a scan opens the box screen in job context. The scan view shows the box's number in the job.
- **Settings → Print labels** is back in Removalist mode and prints blank spare labels. A spare can be stuck onto a job box: the picker names job boxes "Box 3 · J-0042". Bin rows of single job boxes show "Box 3 · J-0042".

Rulings (cost if wrong):

35. **Job labels do not print the box's own name**, only the items in the Phase 2 list. FRAGILE / OPEN FIRST stay in English, as on Home labels; "Box 12 of 45" follows the list's language. Cost: a crew that wants the box name on the label needs one more line (it would fit on L7165).
36. **"of N" is the number of live boxes (or pieces) of that kind in the job when printing.** Numbers are never reused (the unique index includes binned boxes), so after a box is binned, "Box 12 of 11" is possible. The stale-labels warning covers it.
37. **Totals at the last print** are kept in `meta` (key `job_labels_printed:<jobId>`), so no schema change was needed. They travel in backups.
38. **Logo**: the label PDF draws it with Pro on L7165 when the business has one. There is no screen to add a logo yet (the owner said no logo step in onboarding, and Phase 2 did not include a logo upload). Needs an owner decision on when to add it.
39. **Box or Furniture** is chosen with two add buttons ("+ Box", "+ Furniture piece") instead of a switch on a form. The kind can't change afterwards, because its number belongs to that kind.
40. **The room line is dropped first** if a label runs out of room. The fit tests show it still fits on both sheets with long Latin and long Bangla text.

**Bangla strings for native review (Phase 2):** `rm.box.*`, `rm.piece.*`, `rm.pieces.*`, `rm.add.*`, `rm.labels.*`, `rm.label.box`, `rm.label.piece`. All were written by Claude.

Tests (2026-11-27):

- Before (Phase 1 end): 290 unit tests, 103 browser passed, 20 skipped.
- After: `npm run check` passed, 310 unit tests (+20: pieces, job rooms, quick add all-or-none, label data and "of N", label fit on both sheets with long and Bangla text, logo only on L7165), lint 0 errors / the same 9 warnings. E2E chromium + webkit + mobile-chrome: 114 passed, 21 skipped, 0 failed (the extra skip is the new job-box link test on Windows WebKit, which has no lasting storage; earlier runs showed two timing faults in the tests, now fixed by waiting for the screen to change). New: quick add + single box + 2 furniture pieces → labels PDF downloads, then the stale warning; a Bangla customer name prints as a drawn picture; a job box link opens in job context; axe on the pieces section, a job box and the labels screen. All existing Home and Seller tests pass unchanged.

## Test environment limits (not counted as passes)

- **Firefox E2E:** Windows on this computer blocks Playwright's Firefox binary from running ("Permission denied"). Not a BoxTap failure; needs the binary allowed, or a CI runner.
- **WebKit E2E on Windows:** Playwright's Windows WebKit build has no OPFS sync access handles, so BoxTap falls back to memory there. Storage tests are skipped with that reason. Real Safari (iOS 17+) must be checked on an iPhone (spike R6).

## Needs the owner

- GitHub repository name (nothing is pushed yet).
- Google Cloud project + OAuth clients (production and test) for Drive backup (Assumption 11, R15).
- Real-device checks: iPhone home-screen app and Safari tab, low-cost Android, desktop; label print on 3 printers.
- `npx tsx tools/keys.ts init` on the owner's computer before any licence key or signed config can verify.
