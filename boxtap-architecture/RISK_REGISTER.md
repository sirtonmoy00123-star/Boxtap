# BoxTap — Architecture Audit and Risk Register (v2.1, web app, manual keys, Google Drive backup)

## 1. How the audit was done

The seven review passes from the project instructions were run on the web-app draft, **one after another by a single reviewer taking separate specialist perspectives (architecture, database, security, frontend/browser, QA), not by independent agents**. Design-level only; no code exists yet. **Update 2026-11-25 (B-series):** a second pre-build audit ran six **independent specialist reviewer agents** (architecture, security, database, frontend/browser, backend/integrations, QA), each reading the v2.1 docs without seeing the others' conclusions; a lead reviewer merged and checked their findings. The database reviewer ran the schema fragments in SQLite to confirm B8. Earlier audits are in `archive/`; their store- and server-specific findings no longer apply.

## 2. Defects found and fixed

| # | Pass | Problem | Severity | Fix (in the docs) |
| --- | --- | --- | --- | --- |
| W1 | Completeness | iPhone: data typed in a Safari tab is invisible after installing to the home screen (separate storage) | High | Install guide before the 5th box; "Move my data" via backup → restore (ARCHITECTURE §5.1, §6.1) |
| W2 | Reliability | Two tabs opening the same SQLite storage can fail or corrupt writes | High | Web Lock single-writer; second tab shows "open in another tab" |
| W3 | Reliability | A broken release reaches every user at once (no store review) | High | User-accepted updates, Cloudflare instant rollback, safety copy before migrations, release checklist on two real phones |
| W4 | Consistency | Owner-chosen `starts_at` on renewal keys could shorten or double a pass | Medium | End date computed by stacking rule, independent of the dates the owner types (API_CONTRACTS §1.7) |
| W5 | Reliability | Browser storage full could break a save | Medium | Catch quota errors; block new photos, keep text edits; transactions roll back |
| W6 | Reliability | Large phone backups may fail to share | Medium | Download fallback; "without photos" option |
| W7 | Security | A lost `licences.csv` loses the sales record and renewal history | Medium | Keep it in the owner's encrypted backup with the keys; Stripe/bKash histories as second source |
| W8 | Security | App code served from the website: an account takeover could ship malicious code to all users | High | 2FA, branch protection, CI-only deploys, no third-party scripts, strict CSP (SECURITY_MODEL §2, §5) |
| W9 | Completeness | Private windows lose all data on close | Medium | Detect and warn |
| W10 | Consistency | Revoked keys still stacked into the end date | Low | Stacking uses only valid, non-revoked keys |
| W12 | Reliability (v2.1) | Google token lasts ~1 h with no refresh token in the browser; silent sync would stop | High | Queue kept in `drive_outbox`; "Tap to back up" chip (silent renew corrected by B3) |
| W13 | Consistency (v2.1) | Two devices restored from the same Drive would overwrite each other's snapshots | High | `device.lock` single writer, checked before each snapshot (ADR-020) |
| W14 | Reliability (v2.1) | Free 15 GB Google storage is shared with Gmail and Photos and may be full | Medium | Pause photos, keep small snapshots, banner |
| W15 | Security (v2.1) | Unencrypted Drive copies would expose stock and photos to anyone with the account or a shared link | High | Encrypt on device before upload; random names |
| W16 | Security (v2.1) | Google script breaks the "no third-party scripts" rule | Medium | Load only on demand; CSP limited to Google hosts; documented exception |
| A1 | Reliability (pre-build audit) | A phone clock once set years ahead poisoned `max_seen_at` and locked paid users out for good | High | Server `Date` header may lower it (API_CONTRACTS §4) |
| A2 | Consistency | "Non-extractable" backup key could not be wrapped into every file (WebCrypto limit) | High | Wrap once at setup, store the wrapped blob (API_CONTRACTS §6) |
| A3 | Reliability | Whole-file AES-GCM of a large backup can run out of memory on iPhone | Medium | 1 MB chunked encryption |
| A4 | Reliability | With "last 7 snapshots" every 15 min, a mistake or corrupted database replaced all good copies within 2 hours; "Erase all data" could upload an empty database | **Critical** | Day/week retention, "Before big change" copy, integrity check before upload, sync stops before erase |
| A5 | Consistency | Restored snapshot carried the old device's sync tables and device id | High | Device-local tables emptied in snapshots |
| A6 | Consistency | Lock relied on ETag conditional writes that Drive v3 may not offer | Medium | Compare `device_id`; snapshot also names its device |
| A7 | Completeness | Photos never uploaded showed "Still downloading" forever after restore | Medium | Manifest marks uploaded; clear message |
| A8 | Completeness | A strict `Cross-Origin-Opener-Policy` would silently break Google sign-in | Medium | Header set to `same-origin-allow-popups` |
| B1 | Consistency (security, frontend) | CSP had no `'wasm-unsafe-eval'` and no `img-src blob: data:`, so SQLite, Argon2id and zxing could not load and photos would not show: the app would not start | **Critical** | CSP completed (SECURITY_MODEL §2); E2E runs with the real `_headers` |
| B2 | Reliability (QA, architecture) | On a new phone the user onboards as new, then taps Connect: Connect overwrote `device.lock` and uploaded a near-empty database under a new key, so the real backup became "old" and the folder held two keys | **Critical** | First screen offers Restore; Connect checks for an existing backup first; never writes into a folder with another `key_id` (API_CONTRACTS §6.2 rule 1) |
| B3 | Consistency | "Silent renew" of the Google token does not exist in a browser (each request opens a pop-up that needs a tap) and the token is memory-only, so "automatic backup while open" was overstated | High | Docs now say one tap per session and after each hour; chip only when changes wait; owner chose one tap per session, no server (2026-11-25) |
| B4 | Reliability | `drive.file` access belongs to the OAuth client; "new client ID, users reconnect once" would orphan every user's backups. Previews on the production client could reach users' files | High | Protect and never replace the client; separate test client; restore from a downloaded folder as last resort (SECURITY_MODEL §4, §6.2 rule 7) |
| B5 | Reliability | Lock had no generation and snapshot order relied on device clocks: a stale or clock-skewed device could become "newest", prune good copies, or take over with older data | High | Lock `generation`, `snapshot_seq` in `appProperties`, re-check after upload, takeover compares data age (§6.2 rules 2–3) |
| B6 | Reliability (database, QA) | Restore had no rule for a different schema version and no recovery from a kill mid-replace; photo downloads had no persisted queue; A5 missed `meta` and could lower config `seq` | High | Version-aware, crash-safe restore with marker; `download` queue; `meta` and `seq` handled (§6.2 rules 4–5) |
| B7 | Security | "Show recovery code" meant the code was stored on the device; with the wrapped blob it decrypts every backup forever. Rotation left old-key files readable | High | Code never stored; "Change" / "New recovery code"; `key_id` in headers; old-key files deleted after rotation |
| B8 | Consistency (tested in SQLite) | `sm_no_delete` blocked every workspace erase, because SQLite removes the parent row before the cascade | High | `WHEN EXISTS (… deleted_at IS NULL)`; re-tested: live ledger still protected, erase works |
| B9 | Reliability | Deleting the folder in Drive only trashes it; uploads kept succeeding into the trash and showed "Backed up" until Google emptied it | High | Check `trashed`, `trashed=false` in every list, "Restore from trash" |
| B10 | Reliability | Lost replies made duplicate files; resuming a resumable upload after a restart would mix two encryptions and corrupt the photo | High | Multipart with `files.generateIds`; 409 = done; `upload_url` removed |
| B11 | Security | Config could be served from the service-worker cache (revocations never arrive) and its stale `Date` could lower trusted time; `Date` is unreadable on Google responses | High | Config network-only, `no-store`, out of precache; time never below signed `issued_at`; Drive time from `modifiedTime` |
| B12 | Completeness (frontend) | Safari can't encode WebP and returns PNG over 600 KB, so every iPhone photo save would fail; full-size decoding of 48 MP photos can crash low-cost phones | High | Resize on decode; JPEG fallback; `photos.mime` |
| B13 | Reliability | (a) Android camera scans open a second tab that can't open the database while a frozen tab holds it; (b) a user who unticks Drive on the consent screen got endless backoff | High | (a) Old tab releases the database on lock loss, new tab retries; (b) `hasGrantedAllScopes`, branch on 403 reason |
| B14 | Reliability | Android Chrome may not grant persistent storage and can evict the whole site on a full phone; install was only pushed on iPhone | High | Check `persisted()` at every start; banner; Android install before the 5th box |
| B15 | Security / cost | File header not authenticated (old snapshot could be made to look newest, huge KDF values crash restore); snapshots uncompressed and every 15 min on mobile data | Medium | Header as AAD, KDF caps, compress before encrypt, hourly on mobile data |
| B16 | Planning | Drive estimated at ~10 h and Phase 0 at ~15 h; realistic about 40 h and 30 h | High (schedule) | Re-estimated; Drive split into two slices, the photo slice can move after the day-60 gate (IMPLEMENTATION_ROADMAP) |

Also fixed as Medium/Low in the same pass: OAuth redirect `state` + audience check and static `oauth.html` outside the service worker (B17); separate preview client; leaked-licence-key allow-list by full-key hash (B18); `oauth2.googleapis.com` in CSP; bin-purge order with savepoints; `journal_mode = DELETE`, sized sahpool, `trusted_schema = OFF`; NFC text and Bangla digits; `updated_at` never moves back; full-quota snapshot handling; permanent deletes; random Drive file names; ledger-check repair before upload; stale docs references (W11, ADR counts, test counts).

Re-run after fixes: consistency, reliability and security passes repeated on the changed parts.

**Pre-build audit, 2026-11-25 (v2.1):** all ten documents re-read end to end after the Google Drive change, in the seven passes from the project instructions. As before, **done one after another by a single reviewer taking each specialist view, not by independent agents.** Findings A1–A8 above; all fixed in the docs.

**B-series result:** B1–B16 fixed in the docs; the consistency, reliability and security passes were re-run on every changed section, and no Critical or High design defect is known to remain open. This does **not** mean the design is bug-free: several fixes rest on browser and Google behaviour marked Assumption, which the Phase 0 spikes must confirm. No code exists and nothing has been tested on a device. Medium items still open are listed in §3 (R16–R20).

## 3. Remaining risks

| ID | Risk | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | Users lose data (lost phone, cleared browser, deleted iPhone icon) without a recent backup | Medium | High | Recovery code, weekly banner, "last backup" on home screen, onboarding warning; **(v2.1)** Google Drive backup (one tap per session, B3) | Accepted (local-first); much lower once Drive is connected |
| R2 | Technical users bypass licence checks in the browser | High (for that group) | Low–Medium | Low prices, signed keys, revocation; licence service later if needed | Accepted |
| R3 | Manual key issuing doesn't scale and delays customers | Medium | Medium | 24-hour promise; move to the licence service at about 30 sales a month (Recommendation); optionally a one-time 48-hour unlock after "I've paid" (**owner decision**) | Open |
| R4 | No automatic recurring billing; renewals depend on reminders | High | Medium (revenue) | Multi-month Seller Pro keys; in-app reminders 14 days before the end | Accepted |
| R5 | iPhone users skip home-screen install | Medium | High for those users | Strong guide; on iPhone the app asks users to install before entering a licence key (it checks `display-mode: standalone`) | Accepted |
| R6 | OPFS / FTS5 behaviour differs across browsers | Medium | Medium | Phase 0 spikes on Safari 17+, Chrome, Firefox; IndexedDB fallback; `LIKE` fallback | Open (Phase 0) |
| R7 | One device per workspace limits couples and seller staff | Medium | Medium | Measure in pilot; sync add-on later (IDs ready) | Accepted |
| R8 | Owner's signing keys lost or leaked | Low | High | Offline backups, next-year keys shipped in the app | Accepted |
| R9 | Solo founder capacity | High | High | Phase gates and kill criteria unchanged | Accepted |
| R10 | Australian Consumer Law and tax obligations for direct sales | Low | Medium | Clear refund policy page; GST registration only from A$75,000 turnover (Fact); accountant check | Open |
| R11 | (v2.1) Google sign-in pop-up fails inside the iPhone home-screen app | Medium | High for iPhone users | Phase 0 spike; redirect sign-in fallback; else iPhone keeps file backups | Open (Phase 0) |
| R12 | (v2.1) Google changes or restricts `drive.file`, the token model or consent rules | Low | High | Thin `CloudBackup` interface so another target (file, Dropbox, OneDrive) can be added; file fallback always works | Accepted |
| R13 | (v2.1) Users think "Drive connected" means "always backed up", but uploads only run while the app is open **and after a tap each session** (B3) | Medium–High | Medium | Status chip with time of last backup and waiting changes; onboarding line "BoxTap backs up while it's open, after one tap"; optional Worker token exchange (owner decision) | Accepted (owner chose one tap per session, 2026-11-25) |
| R16 | (audit) Bangla text in labels and PDFs renders wrongly: `pdf-lib` does not shape Bengali conjuncts (Fact) | High for Seller mode | Medium | Draw Bangla strings on a canvas and embed as images; ship the full Bengali font block | Open (Phase 2 spike) |
| R17 | (audit) First load is ~4–5 MB of WASM, fonts and libraries on Bangladeshi mobile data; Argon2id may take 3+ s on low-cost Android | Medium | Medium | Precache only the core; fetch zxing, pdf-lib, Argon2 in the background; progress during key derivation | Open (Phase 0 measure) |
| R18 | (audit) FTS5 trigram finds nothing for queries under 3 characters (tested), e.g. box "22" or "চু" | High | Low–Medium | `LIKE` on items for short queries; FTS triggers documented and tested | Open (Phase 1) |
| R19 | (audit) Cross-workspace references are not prevented by the schema (an item can point to another workspace's box) | Low | Medium | Composite FKs `(workspace_id, id)` before Phase 2 | Open |
| R20 | (audit) Manual sales: payments can't be matched to customers and one bKash transaction could get two keys; a bKash personal number for business may breach bKash terms | Medium | Medium | Order code in Stripe `client_reference_id` / bKash reference; `licence.ts issue` refuses a reused `ref`; check bKash merchant terms | Open (Phase 1b) |
| R14 | (v2.1) Users lose the recovery code; Drive backup is then unreadable | Medium | High | Confirm 3 words at setup; printable recovery sheet with Bangla captions; reminder in Settings; owner cannot help (by design). Warn against screenshots, which sync to Google Photos in the same account and collapse the two factors to one | Accepted |
| R15 | (v2.1) Google OAuth app review delays launch | Low | Medium | `drive.file` is non-sensitive, so only brand verification is expected (Assumption, re-check); start the consent-screen setup in Phase 0 | Open |

## 4. What implementation testing must still prove

- SQLite on OPFS keeps data across browser restarts, app updates and weeks of no use, on iPhone home-screen app, Android Chrome and desktop browsers.
- Two tabs never corrupt the database.
- Backup → restore works across devices and browsers (including Safari tab → installed iPhone app).
- Forged, revoked and expired keys are rejected; stacking gives the right end dates.
- Camera scanning works in Safari (WASM) and Chrome (native) on real phones; labels print aligned and scan.
- Speed: box page < 2 s, +/− < 0.5 s on a low-cost Android phone (N-02).
- (v2.1/audit) Google token renewal really needs a tap in each browser (B3), and pop-up or redirect sign-in works in the iPhone home-screen app (R11).
- (audit) Drive v3 behaviour the design assumes: `files.generateIds` + 409 on reuse, `appProperties` filtering, trash semantics, quota errors (B9, B10).
- (audit) Restore across schema versions, kills mid-restore, takeover by a stale device, clock skew (tests 31–35).
- (audit) The app starts under the production CSP; Safari photo encoding; Android `persist()` and tab-lock steal (B1, B12–B14).
