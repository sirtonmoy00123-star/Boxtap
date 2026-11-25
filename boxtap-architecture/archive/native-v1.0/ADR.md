# BoxTap — Architecture Decision Records (v1.0, local-first)

Status key: **Accepted**, **Proposed**, **Open**, **Superseded**. Labels: **Fact**, **Assumption**, **Recommendation**, **Open decision**.
The cloud decisions (v0.2) are kept in `archive/cloud-v0.2/ADR.md`.

---

## ADR-001 — Local-first app with no backend database

**Status:** Accepted (owner, 2026-11-23, decision card: "Local-first, one device per user"). Supersedes cloud ADR-001, 003, 005.
**Context:** Owner goals: data on the user's device, no Supabase/Firebase, owner controls licensing, lowest running cost, offline core.

| Option | Running cost | Multi-device | Owner effort | Chosen |
| --- | --- | --- | --- | --- |
| A. Local-first, one device per workspace | ≈ US$10/month fixed | No (later via sync) | Lowest | **Yes** |
| B. Local-first + encrypted sync relay | ≈ US$10/month + small usage | Yes | +30–40 h | Later, if the pilot shows need |
| C. Cloud (Supabase) | US$30–40/month, grows | Yes | Medium | No (archived) |

**Consequences:** no accounts, no server database, no live share links, no desktop version in the MVP. Users own their backups (ADR-016).

## ADR-002 — Capacitor app for Android and iPhone

**Status:** Accepted. iPhone from day 1 is an **Assumption** (Australia is iPhone-heavy); Android-only first is possible if the Apple fee or a Mac is a blocker.
**Decision:** React 18 + TypeScript + Vite, packaged with Capacitor 6 as native apps on Google Play and the App Store.
**Alternatives:** PWA only (browser storage can be cleared by the browser or the user, and store billing is unavailable: rejected); React Native / Flutter (rewrites the planned UI, fewer reusable web skills: rejected).
**Consequences:** a Mac or a cloud build service is needed for iOS builds; each release passes store review (about 1–3 days, Assumption).

## ADR-003 — Encrypted SQLite on the phone

**Status:** Accepted
**Decision:** `@capacitor-community/sqlite` with SQLCipher (AES-256). A random 256-bit database key is created at first launch and stored in the Android Keystore / iOS Keychain. Photos are WebP files in the app's private folder.
**Consequences:** the database is unreadable if copied off the phone. The OS's own backups cannot be relied on to restore the key (Android Keystore keys are never backed up — Fact), so the database file is excluded from Android Auto Backup and BoxTap makes its own backups (ADR-016). On iOS the key uses a Keychain accessibility class that migrates with encrypted device backups (not `ThisDeviceOnly`). If the app ever finds a database but no key, it opens the Restore screen instead of failing (audit L1).

## ADR-004 — Stock is an append-only ledger (kept)

**Status:** Accepted (unchanged in principle)
**Decision:** `stock_movements` is insert-only; SQLite triggers keep `items.on_hand` and `items.reserved` in step. Undo is a compensating movement. A self-check runs at app start once a day and rebuilds totals from the ledger if they differ.
**Why it still matters on one device:** it gives full history and undo, protects against app crashes mid-update (one transaction), and makes future sync safe.

## ADR-005 — One device per workspace; sync-ready IDs

**Status:** Accepted
**Decision:** a workspace lives on one phone. All IDs are UUID v7 generated on the phone and every row keeps `updated_at`, so a later sync option (user's own cloud folder, or an encrypted relay) can be added without changing the data model.
**Consequences:** family packing on two phones and seller staff accounts (S-11 two phones, S-22) are out of the MVP.

## ADR-006 — The stock unit is an item in one location (kept)

**Status:** Accepted. Same design as before: the same design in two boxes is two `items` rows sharing a `product_id`; moving stock = two movements in one transaction.

## ADR-007 — QR labels use app links and are looked up on the phone

**Status:** Accepted. Supersedes cloud ADR-007.
**Decision:** labels encode `https://boxtap.app/b/CODE`. With the app installed, Android App Links and iOS Universal Links open BoxTap directly, which looks the code up in its own database. Without the app, the static page says "This is a BoxTap label" with store buttons. A BoxTap user scanning someone else's label sees "This box isn't in your BoxTap".
**Consequences:** better privacy than the cloud plan; nothing about box contents ever leaves the phone. Codes are made on the phone (10 random Crockford base32 characters).

## ADR-008 — Store billing, verified on the phone

**Status:** Accepted. Supersedes cloud ADR-008.
**Decision:** Google Play Billing and Apple StoreKit 2. The app verifies the store's signed purchase data on the phone (Google: purchase signature with the app's Play public key; Apple: StoreKit 2 signed transactions — Fact). Plans:

| Plan | Google Play | App Store |
| --- | --- | --- |
| Move Pass (12 months, buy again to renew) | **Prepaid** subscription base plan, 1 year (top-ups extend it) | Non-renewing subscription; end date computed from transaction history |
| Seller Pro monthly / yearly | Auto-renewing subscription (bKash available in Bangladesh, per requirements source; re-check) | Auto-renewing subscription |

Entitlements are recomputed from the store's purchase history, so **Restore purchases** works on a new phone.
**Consequences:** stores take 15% (small-business programmes, re-check); Stripe and SSLCommerz drop out of the MVP because in-app digital unlocks generally must use store billing (Assumption, rules are changing; re-check before launch).

## ADR-009 — Owner control with signed licence keys and a signed config file

**Status:** Accepted
**Decision:**
- **Signed config** `https://boxtap.app/config/v1.json`: plans, free limits, feature switches, minimum app version, revoked licence keys. Signed with the owner's Ed25519 private key; the app holds the public key. The app fetches it at most once a day when online, accepts only a valid signature and a `seq` higher than the one it has.
- **Licence keys** for pilots, promotions and gifts: generated by a small script on the owner's computer, signed with the same private key (separate key ID). Pilot keys are bound to an install ID the seller sends to the owner.
- The private key never goes online. It is backed up offline in two places (Recommendation: password manager + printed copy).

## ADR-010 — Labels and PDFs are generated on the phone (kept)

**Status:** Accepted. `pdf-lib` + QR library; Avery L7165 / L7163; insurance PDF in chunks.

## ADR-011 — Search with SQLite FTS5

**Status:** Accepted. Supersedes cloud ADR-011.
**Decision:** FTS5 virtual table over item name, `alt_name` (Bangla/Banglish), notes and location name, using the `trigram` tokenizer for typo tolerance and partial words. Requires SQLite 3.34+ inside the SQLCipher build (Assumption to verify in Phase 0; fallback is `LIKE` over a few hundred rows, still under 1 second).

## ADR-012 — Jewellery type: support every kind (kept)

**Status:** Accepted (owner, 2026-11-23). Optional `pricing_mode`, `weight_grams`, `purity`, `making_charge`; seller types the price; no live gold rate.

## ADR-013 — Booked (reserved) stock in the pilot (kept)

**Status:** Accepted (owner, 2026-11-23). `reserved` changed only by `booked`, `unbooked`, `shipped` movements. Available = `on_hand − reserved`.

## ADR-014 — Storage users renew the Move Pass

**Status:** Accepted (owner, 2026-11-23). Updated for local-first: renewal is a new purchase of the same plan (Play prepaid top-up / App Store non-renewing subscription), extending from the current end date. Reminders are **local notifications** 14 days before and on the end day, with a Renew button. Renewal rate is read from the store consoles.

## ADR-015 — "In stock" catalogue image in Phase 2 (kept)

**Status:** Accepted (owner, 2026-11-23). Drawn on the phone with Canvas, shared through the system share sheet.

## ADR-016 — User-owned encrypted backups with a recovery code

**Status:** Accepted
**Decision:**
- At setup the app shows a **12-word recovery code** and asks the user to write it down (skippable but repeatedly reminded).
- A random backup key encrypts backups (AES-256-GCM). It is stored in the Keystore/Keychain for automatic backups, and a copy is wrapped with a key derived from the recovery code (Argon2id) inside every backup file.
- Automatic backup when the app opens and the last backup is over 7 days old, to a folder the user picked once: Android via the Storage Access Framework (Google Drive or any folder), iPhone via the app's iCloud Drive container or the Files app.
- "Back up now", "Restore from backup", and a banner when the last backup is over 14 days old.
**Consequences:** a lost phone without a backup or without the recovery code means lost data. This is the main cost of local-first and is shown clearly during setup.

## ADR-017 — No tracking SDKs; store consoles for business numbers

**Status:** Accepted
**Decision:** installs, purchases, renewals, refunds and retention come from Google Play Console and App Store Connect (free). Crashes from the stores' own crash reports. No third-party analytics in the MVP. An opt-in anonymous usage ping can be considered later.
**Consequences:** activation targets in the requirements ("lists items for 5+ boxes") cannot be measured directly; the pilot and interviews replace them.

## ADR-018 — Static website on Cloudflare Pages

**Status:** Accepted
**Decision:** one free static site serves: label landing page, `/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association`, `/config/v1.json`, privacy policy (English and Bangla), support page.

## Superseded cloud decisions

Cloud ADR-001 (Supabase), 003 (hosting), 005 (server outbox), 007 (browser scan), 008 (webhooks), 009 (cost table for staff) are superseded. Cloud ADR-009's idea (cost price hidden from staff) returns when staff and sync are added.
