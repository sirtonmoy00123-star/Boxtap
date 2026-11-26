# BoxTap — Architecture Decision Records (v2.1, web app, manual licence keys, Google Drive backup)

Status key: **Accepted**, **Proposed**, **Open**, **Superseded**. Labels: **Fact**, **Assumption**, **Recommendation**, **Open decision**.
Earlier versions: `archive/cloud-v0.2/` (Supabase) and `archive/native-v1.0/` (Capacitor + app stores).

---

## ADR-001 — Local-first, one device per workspace, no server at all

**Status:** Accepted (owner, 2026-11-23: "Local-first, one device per user"; then "Fully manual keys for now").
**Decision:** all user data lives in the browser storage of one device. There is **no backend, no database server, no licence server and no server code**. The only thing on the internet is a static website.
**Consequences:** no accounts, no live share links, no automatic payments or renewals, no multi-device sync in the MVP. IDs stay sync-ready (ADR-005) so a later sync or licence service can be added without changing the data model.

## ADR-002 — Progressive Web App served from the owner's website

**Status:** Accepted (owner, 2026-11-23). Supersedes native v1.0 ADR-002.
**Decision:** React 18 + TypeScript + Vite, `vite-plugin-pwa` (Workbox) for the service worker and web app manifest, hosted on Cloudflare Pages at `boxtap.app`. Works in any modern browser and installs to the home screen on Android, iPhone and desktop.
**Consequences:** no app-store fees or commission; instant updates; desktop is back in scope. iPhone limits apply (ARCHITECTURE §6).

## ADR-003 — SQLite in the browser (WebAssembly + OPFS)

**Status:** Accepted
**Decision:** the official SQLite WebAssembly build (`@sqlite.org/sqlite-wasm`) running in a Web Worker, stored in the Origin Private File System with the `opfs-sahpool` storage driver, which does not need special cross-origin server headers (Fact per SQLite docs; verify in Phase 0). Photos are stored as separate OPFS files. The app calls `navigator.storage.persist()` to ask the browser not to evict data.
**Fallback:** browsers without OPFS support get an IndexedDB-backed SQLite driver (e.g. `wa-sqlite`), slower but the same schema.
**Why SQLite rather than plain IndexedDB:** the stock ledger relies on transactions, triggers, constraints and full-text search; the same schema was already designed and reviewed.

## ADR-004 — Stock is an append-only ledger (kept)

**Status:** Accepted. Triggers keep `on_hand` / `reserved` in step; undo is a compensating movement; a daily self-check rebuilds totals from the ledger.

## ADR-005 — Sync-ready IDs (kept)

**Status:** Accepted. UUID v7 IDs made in the browser; `updated_at` on every row.

## ADR-006 — The stock unit is an item in one location (kept)

**Status:** Accepted.

## ADR-007 — In-app QR scanner; label links open the web app route

**Status:** Accepted. Supersedes native v1.0 ADR-007.
**Decision:** labels encode `https://boxtap.app/b/CODE`. The **Scan** button inside BoxTap is the main path: camera via `getUserMedia`, decoding with the browser's `BarcodeDetector` where available (Android Chrome) and `zxing-wasm` elsewhere (Safari). When a label is opened as a link in the same browser that holds the data (Android Chrome, desktop), the app route `/b/CODE` looks the code up locally. When it opens in a browser with no BoxTap data (typically iPhone camera → Safari, whose storage is separate from the home-screen app — Fact), the page says "Open BoxTap and tap Scan" and shows nothing else.

## ADR-008 — Manual licence keys, sold by payment link and bKash

**Status:** Accepted (owner, 2026-11-23: "Fully manual keys for now").
**Decision:**
- **Selling:** Stripe **Payment Links** (no code, hosted by Stripe) for Australian card payments; **bKash** (personal or merchant number, run by the partner) for Bangladesh.
- **Issuing:** after a payment, the owner (or partner) runs a small local tool that creates an Ed25519-signed licence key and sends it by email or WhatsApp. The buyer pastes it or scans its QR code into BoxTap.
- **What a key holds:** plan, start and end dates, licensee name/email (shown in Settings as "Licensed to …"), key ID. Keys are **not bound to a device**, so they work after a reinstall or on a replacement phone. Sharing is discouraged by the visible licensee name and controlled by revocation in the signed config.
- **Fixed terms instead of recurring billing:** Move Pass 12 months; Seller Pro 1, 3, 6 or 12 months. A new key for the same plan extends from the current end date.
**Trade-off accepted:** the owner's original wish for automatic recurring subscriptions is not met in this phase; renewals are reminders + a new key. The upgrade path is a small licence service (PWA_PROPOSAL Option A) when manual work becomes too much (Recommendation: at about 30 sales a month).

## ADR-009 — Owner control with a signed config file (kept, simplified)

**Status:** Accepted
**Decision:** `https://boxtap.app/config/v1.json`, Ed25519-signed on the owner's computer, fetched at most once a day: free limits, feature switches, price list and payment links shown in the app, revoked key IDs, minimum app version. Monotonic `seq`. Two offline keys: config key and licence key (separate key IDs).

## ADR-010 — Labels and PDFs generated in the browser (kept)

**Status:** Accepted. `pdf-lib` + QR library; Avery L7165/L7163; insurance PDF in chunks.

## ADR-011 — Search with SQLite FTS5 (kept)

**Status:** Accepted. FTS5 with the `trigram` tokenizer, included in the official WASM build (Assumption, verify in Phase 0); `LIKE` fallback.

## ADR-012 — Jewellery: any type (kept) · ADR-013 — Booked tap in the pilot (kept) · ADR-015 — Catalogue image in Phase 2 (kept)

**Status:** Accepted (owner, 2026-11-23). Unchanged.

## ADR-014 — Storage users renew the Move Pass

**Status:** Accepted (owner, 2026-11-23). Updated: renewal = buy a new 12-month key, which extends from the current end date. In-app reminders 14 days before and on the end day, with the payment link and a "copy my details" button for the email to the owner.

## ADR-016 — User-owned encrypted backups, started by the user on phones

**Status:** Accepted. Supersedes native v1.0 ADR-016 for phones.
**Decision:**
- 12-word recovery code at setup (kept); AES-256-GCM backup encryption; backup key wrapped by Argon2id of the recovery code (kept).
- **Phones:** "Back up now" builds the encrypted `.btbak` file and opens the share sheet (Web Share API with files) so the user can save it to Files, Google Drive or iCloud Drive, or downloads it where sharing is not supported. Browsers cannot save files silently in the background (Fact), so the app shows a reminder banner when the last backup is over 7 days old.
- **Desktop Chrome/Edge:** the user picks a folder once (File System Access API); the app then saves backups there automatically when opened.
- Photos are included incrementally where a folder is available (desktop); on phones each backup file contains the database and all photos (accepted size cost; photos ~200 KB each).
- **v2.1 (2026-11-25):** this manual file backup stays as the fallback for people without Google, and for a copy kept off Google. The main backup is now Google Drive (ADR-020).

## ADR-020 — Encrypted backup and sync to the user's own Google Drive

**Status:** Proposed (v2.1, 2026-11-25), awaiting owner approval. Owner request: customers keep their data and all photos in their own Google Drive.
**Context:** phone backups in v2.0 depend on the user remembering "Back up now" (R1). The owner wants storage to be "self-hosted" by the customer, at no cost to the owner.
**Decision:**
- **The device stays the main store** (SQLite in OPFS, ADR-003). Google Drive is a **copy** used to recover after a lost phone, a cleared browser or a deleted iPhone icon, and to move to a new device. Drive is not used as the live database, because the app must work offline and fast, and Drive cannot lock or merge records (Recommendation).
- Opt-in: Settings → **Connect Google Drive**. Sign-in with Google Identity Services (token model, in the browser; no BoxTap server). Scope **`drive.file` only**, so BoxTap can see only the files it created, never the rest of the user's Drive (Fact, [Google scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)).
- Everything is **encrypted on the device before upload** with the same backup key as `.btbak` (ADR-016). Google, the owner and anyone the folder is shared with see only unreadable files with random names.
- Folder `BoxTap Backup` in My Drive: a database snapshot (small, rewritten when data changes; about 14 kept across the last 4 weeks, see API_CONTRACTS §6.1), one encrypted file per photo (uploaded once), and a plain `README.txt`.
- Uploads run while the app is open and online. Browsers cannot upload while the app is closed (Fact for iPhone; Background Sync is Chrome-only, not relied on).
- A Google access token lasts about one hour and the browser gets no refresh token (Fact, token model). **Audit B3:** every token request opens a Google pop-up (or a redirect), and browsers block pop-ups without a tap, so there is **no silent renewal** in practice (Assumption, strong; confirm in the Phase 0 spike). Because the token is held **in memory only**, the honest behaviour is: **one tap per app session, and again after each hour**, before Drive uploads run. The app asks only when there is something to upload ("3 changes not backed up · Tap to back up"), never on an empty queue. Changes wait safely in the queue. An optional upgrade, a free stateless Cloudflare Worker that turns a sign-in code into a refresh token kept encrypted on the device, would make backups fully automatic; it adds a small server. **Owner decision 2026-11-25: one tap per session, no server, for the MVP**; the Worker stays a later option.
- **Single writer:** a `device.lock` file names the device that writes the backup. A second device that restores takes over, and the first one stops syncing with a clear message (one device per user, ADR-001, still holds). **Audit B5:** the lock carries a `generation` number that rises on every takeover, and every snapshot carries `generation` and a monotonic `snapshot_seq` in its Drive `appProperties`; ordering, pruning and "newest" use these numbers, never device clocks (API_CONTRACTS §6.2).
- **Audit B2:** connecting never overwrites an existing backup. First launch offers "I already use BoxTap: restore", and Connect first looks for an existing `BoxTap Backup` folder; if one exists, the user restores it or starts a new, separate folder.
- Restore: on a new device, "Restore from Google Drive" (offered on the first screen) → sign in → 12-word recovery code → database restored in seconds, photos download in the background. Restore is crash-safe and version-aware (API_CONTRACTS §6.2, audit B6).
- Available on **all plans, free included** (Recommendation; it costs the owner nothing and protects every user). Owner decision, see PROJECT_MASTER.
**Consequences:** first third-party script in the app (Google's sign-in library, loaded only when the user connects Drive); CSP opened for Google hosts only; owner sets up a free Google Cloud project and OAuth consent screen once. Running cost stays US$0. iPhone home-screen apps and Google sign-in pop-ups need a Phase 0 spike (R11); if they fail, a redirect sign-in is used, and if that fails too, iPhone users keep manual file backups.
**Rejected:** Drive as the only store (no offline, slow, no merge); unencrypted copies (anyone with the Drive account or a shared link reads all stock and photos); full `drive` scope (sees all user files, needs Google's paid security assessment); iCloud/Dropbox/OneDrive in the MVP (more sign-in work; can be added later behind the same interface).

## ADR-022 — Pre-build audit rules for Drive backup (B-series)

**Status:** Accepted as design fixes (audit 2026-11-25), part of ADR-020's approval.
**Decision:** the rules in API_CONTRACTS §6.2 (connect safety, lock generation and snapshot sequence, version-aware crash-safe restore, idempotent multipart uploads with pre-generated file IDs, trashed-folder detection, no stored recovery code, `key_id` in headers, header as AAD, compression before encryption) are binding for the implementation. Rationale and findings: RISK_REGISTER §2 (B1–B16).

## ADR-021 — Household and staff sharing through Drive deferred

**Status:** Proposed, deferred. **Open decision for later.**
**Decision:** the MVP keeps one device per user. Sharing a Drive folder does not give two people a live shared list, because two writers would overwrite each other's snapshots. Future options, decided from pilot evidence (R7): (a) a read-only family view from the latest snapshot; (b) real sync with a change log per device (IDs are already UUID v7, ready for it).

## ADR-017 — Business numbers without tracking

**Status:** Accepted. Sales and renewals from the owner's licence log (the key tool appends every key to a local CSV) and the Stripe dashboard; website visits from Cloudflare Web Analytics (free, cookieless). No analytics inside the app.

## ADR-018 — Static website on Cloudflare Pages (kept)

**Status:** Accepted. Serves the app, the landing pages (`/b/*`, install guides), `config/v1.json`, privacy policy (English, Bangla), pricing and how-to-buy pages.

## ADR-019 — No app-level database encryption in the MVP; optional app lock

**Status:** Accepted
**Decision:** rely on the device's own encryption (phones encrypt storage when locked — Fact for modern Android and iOS) and the browser's per-site isolation. Offer an optional **app lock** (PIN) that hides the app's screens after 5 minutes away. Backups are always encrypted.
**Honest limit:** the PIN is a screen lock, not encryption; someone with the unlocked device and browser developer tools could read the data. A fully encrypted database needs a SQLite encryption build for WASM (e.g. SQLite3 Multiple Ciphers) and a passcode at every start; reconsider in Phase 3 if sellers ask.

## ADR-023 — UI design system based on Apple's design principles

**Status:** Accepted by the owner, 2026-11-26.
**Decision:** every screen follows `DESIGN_SYSTEM.md` (colour and type tokens, inset grouped lists, 44 px touch targets, sentence case, the label tag, a floating Scan button). It borrows Apple's Human Interface Guidelines principles, not Apple's brand.
**Owner decisions:**
- Seller mode uses an indigo accent (`data-mode="seller"`), Home mode blue.
- The box screen autosaves (debounced 500 ms, "Saved" footnote); its Save button is removed.
- Home mode gets a Rooms tab (Boxes, Rooms, Settings); the Bin moves inside Settings, with backup and labels.
- Bangla mode shows Bangla digits (`Intl.NumberFormat('bn-BD')`); stored data keeps Western digits.

## Superseded

- Cloud v0.2: ADR-001, 003, 005, 007, 008, 009 (server-side).
- Native v1.0: ADR-002 (Capacitor), 003 (SQLCipher + Keystore), 007 (app links), 008 (store billing), 016 (automatic phone backups).
- v2.0 to v2.1: ADR-016 now covers the manual fallback only; Google Drive backup is ADR-020.
