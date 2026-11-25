# BoxTap — Contracts: Licensing, Config, Backups, Links (v2.1, web app, manual keys, Google Drive backup)

There is no server API. These are the formats and rules that the app, the owner's tools and the static website must agree on. Earlier versions: `archive/`.

## 1. Entitlement logic: `can(feature)`

```ts
type Plan = 'move_pass' | 'seller_pro';
type Feature = 'add_box' | 'add_item' | 'add_photo' | 'share_pdf' | 'insurance_pdf'
             | 'variants' | 'cost_profit' | 'orders' | 'reports' | 'excel';
function activePlans(now: Date): Set<Plan>     // from entitlements, each key re-verified at start
function can(feature: Feature, ctx: { workspace: Workspace; counts: Counts }): Allowed | Blocked
```

1. `now = trustedNow()` (§5).
2. A plan is active if a valid key for it has `starts_at ≤ now < ends_at`, the key is not revoked in config, and its signature verifies.
3. Move Pass unlocks Home workspaces; Seller Pro unlocks Seller workspaces on this device.
4. Free limits come from the signed config; built-in defaults: Home 12 boxes, 1 photo per box; Seller 50 items.
5. **Reading, searching, exporting and backing up are never blocked** (H-06).
6. `Blocked` reasons: `limit_boxes`, `limit_items`, `limit_photos`, `pro_only` → upgrade screen.
7. Several keys for the same plan stack: the effective end date is computed like a pass renewal: `end = ends_at of the first key`; each later key adds its length from `max(end, its starts_at)`.

## 2. Licence keys

```
BTK1.<base64url(payload)>.<base64url(signature)>
payload = {
  "v": 1, "kid": "lic-2026", "id": "lk_01JDX…",          // unique key id (UUID v7)
  "plan": "move_pass" | "seller_pro",
  "months": 12,                                            // length used for stacking
  "starts_at": "2026-12-01", "ends_at": "2027-12-01",
  "licensee": "Mia T. · mia@example.com",                  // shown in Settings as "Licensed to …"
  "ref": "stripe:pi_3Q… | bkash:9A7B…",                    // payment reference for the owner's records
  "note": "pilot" | "promo" | null
}
signature = Ed25519(owner_licence_private_key, utf8(base64url(payload)))
```

- Shown to the buyer as text (for email/WhatsApp) **and** as a QR code; the app accepts paste or scan.
- Not bound to a device (ADR-008), so it works after a reinstall or on a new phone.
- Rejected if: bad signature, unknown `kid`, `id` in the config's `revoked_keys`, or expired (an expired key is kept and shown as "Ended on …").
- Plans and prices (starting points, owner can change in config): Move Pass 12 months A$12.95; Seller Pro 1 month ৳199, 3 months ৳549, 6 months ৳1,049, 12 months ৳1,990 (the 3- and 6-month prices are suggestions).

### 2.1 Owner tools (run on the owner's computer)

| Command | What it does |
| --- | --- |
| `npx tsx tools/keys.ts init` | Creates the two Ed25519 key pairs (`cfg-YYYY`, `lic-YYYY`) in an encrypted local file; prints the public keys to put in the app |
| `npx tsx tools/licence.ts issue --plan move_pass --months 12 --licensee "Mia T. · mia@example.com" --ref stripe:pi_…` | Signs a key, prints text + saves a QR PNG, appends a row to `licences.csv` |
| `npx tsx tools/licence.ts revoke lk_…` | Adds the id to the revocation list in `config.json` |
| `npx tsx tools/config.ts sign` | Bumps `seq`, signs `config.json`, writes `public/config/v1.json` for deploy |

`licences.csv` (owner's sales record): `issued_at, key_id, plan, months, starts_at, ends_at, licensee, ref, amount, currency, note`. Kept in a private folder with backups; never in the public repository.

### 2.2 Owner runbook: selling a key

1. Customer taps Upgrade in BoxTap → sees the price and either the Stripe Payment Link (Australia) or the bKash number (Bangladesh), plus "Copy my details" (name/email they type, and the app version).
2. Customer pays. Stripe emails the owner a payment notice; bKash shows the transaction ID to the partner.
3. Owner checks the payment, runs `licence.ts issue`, sends the key text + QR by email or WhatsApp. Target: within 24 hours.
4. For a renewal, the same steps; the new key's `starts_at` = the old key's `ends_at` if still active, else today.
5. Refund: refund in Stripe/bKash, then `licence.ts revoke` and `config.ts sign` + deploy.

## 3. Signed config file

`https://boxtap.app/config/v1.json`, fetched at most once a day when online.

```json
{
  "body": {
    "seq": 7,
    "issued_at": "2026-12-01T00:00:00Z",
    "min_app_version": "1.0.0",
    "free_limits": { "home_boxes": 12, "home_photos_per_box": 1, "seller_items": 50 },
    "plans": {
      "move_pass":  { "photos_per_parent": 5, "offers": [{ "months": 12, "price": "A$12.95", "pay": "https://buy.stripe.com/…" }] },
      "seller_pro": { "photos_per_parent": 5, "offers": [{ "months": 1, "price": "৳199", "pay": "bkash:01XXXXXXXXX" }] }
    },
    "features": { "catalogue_image": true, "insurance_pdf": true, "excel": false },
    "revoked_keys": ["lk_01JD…"],
    "messages": { "en": null, "bn": null }
  },
  "kid": "cfg-2026",
  "sig": "base64url(Ed25519(owner_config_private_key, canonical_json(body)))"
}
```

Rules: **(audit B11)** `/config/*` is excluded from the service-worker precache and fetched network-only with `cache: 'no-store'`, so revocations and price changes arrive between releases; the built-in copy is refreshed only on release tags, so a config-only deploy does not change the app bundle or trigger an update prompt; verify signature; accept only a higher `seq` (a restore never lowers the stored `seq`); lowering a free limit never hides existing data; `min_app_version` shows an update banner (the service worker normally updates the app on its own). The app ships with a built-in copy of the last config so it works before the first fetch.

## 4. Trusted time (`trustedNow()`)

`trustedNow() = max(device_clock, time_guard.max_seen_at)`, where `max_seen_at` is updated from the device clock and the `Date` header of the config fetch. If the device clock is more than 48 hours behind `max_seen_at`, paid plans are treated as ended until the clock is fixed or a fresh config fetch succeeds; free features keep working. **Audit fix A1 (tightened by B11):** a successful **network-only, `cache: 'no-store'`** fetch of `boxtap.app/config/v1.json` sets `max_seen_at` to that response's `Date` header **even if that is lower**, but never below the signed `config.issued_at`; Drive time comes from the server-set `modifiedTime` in a Drive JSON response, because `Date` is not readable on cross-origin responses (Fact). Cached responses are never used for time, so a phone whose clock was once set years ahead is not locked out for good. `max_seen_at` is device-local and is not overwritten by a restore. This raises the bar; it cannot stop someone who edits browser storage (SECURITY_MODEL §3).

## 5. Label link format

`https://boxtap.app/b/<CODE>`, CODE = 10 characters from `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.
- The service worker serves the app for `/b/*`; the app looks the code up in local SQLite.
- With no BoxTap data in this browser, the page shows: "This is a BoxTap label. Open BoxTap and tap Scan", plus a link to the install guide. No data, no tracking of codes.

## 6. Backup file format (`.btbak`)

```
magic "BTBAK2" | header JSON (length-prefixed) | encrypted payload
header  = { created_at, app_version, schema_version, key_id, kdf: {alg: "argon2id", salt, m: 65536, t: 3, p: 1},
            wrapped_key_by_recovery, nonce }     // (audit B7/B15) key_id added; header bytes are the AES-GCM AAD;
                                                 // restore refuses kdf.m > 131072 or t > 6 (stops a crafted header crashing the device)
payload = AES-256-GCM(backup_key, zip(db_export.sqlite, photos/*, manifest.json))
```

- `backup_key` is random. **Audit fix A2:** WebCrypto can only wrap an extractable key, so at setup the app generates the raw key once, wraps it with Argon2id(recovery code), stores that **wrapped blob**, then imports a **non-extractable** copy into IndexedDB for daily use and discards the raw bytes. Every file carries the stored wrapped blob, so backups never ask for the recovery code.
- **Audit fix A3:** the payload is encrypted in 1 MB chunks (AES-256-GCM, nonce = file nonce ‖ chunk counter, last chunk flagged), so large backups encrypt and decrypt as a stream instead of in memory (iPhone memory limits). Same for `.btdb` and `.btph`.
- **Phones:** "Back up now" → file → Web Share (save to Files / Drive / iCloud Drive / send to self) or download.
- **Desktop Chrome/Edge:** automatic save to a chosen folder via File System Access API when the app opens and the last backup is over 7 days old; keeps the last 4.
- **Restore:** replaces all data after confirmation, making a safety backup first; works across browsers and devices (e.g. Safari tab → iPhone home-screen app).
- Size guide: 300 photos ≈ 60 MB per backup (Assumption at ~200 KB a photo).
- v2.1: this file is the **fallback** backup. The main backup is Google Drive (§6.1).

### 6.1 Google Drive backup and sync (ADR-020)

**Sign-in.** Google Identity Services token client, loaded from `https://accounts.google.com/gsi/client` only after the user taps "Connect Google Drive".

```ts
google.accounts.oauth2.initTokenClient({
  client_id: OWNER_CLIENT_ID,                      // public value, in the app build
  scope: 'https://www.googleapis.com/auth/drive.file',
  callback: (t) => drive.setToken(t.access_token, t.expires_in),   // memory only
});
```

- First connect: user taps the button (pop-ups need a tap, Fact). In the token callback, check `google.accounts.oauth2.hasGrantedAllScopes(t, DRIVE_FILE)`; if the user unticked Drive on the consent screen, show "BoxTap needs Drive permission to back up" (audit B13).
- **Renewals (audit B3):** `requestAccessToken({ prompt: '' })` still opens a pop-up and must run from a tap, so there is no silent renewal (Assumption, strong; Phase 0 spike). The token is memory-only, so a tap is needed **once per app session and again after each hour**. The chip appears only when uploads are waiting: "3 changes not backed up · Tap to back up". Owner chose this tap model for the MVP (2026-11-25). Later option: a stateless Cloudflare Worker token exchange that keeps a refresh token encrypted on the device.
- iPhone home-screen app: if the pop-up fails (Phase 0 spike, R11), use a full-page redirect to Google's OAuth endpoint with `response_type=token`, a random `state` saved in `sessionStorage`, and `redirect_uri=https://boxtap.app/oauth`; the token comes back in the URL fragment to a tiny static `oauth.html` (excluded from the service worker's navigation fallback), is accepted only if `state` matches and the token's audience is this client ID, is removed from the address bar at once, and is handed to the app by `BroadcastChannel` (audit B17). Unsaved form input is saved as a draft before redirecting.
- Stored on the device: the Google account email (shown in Settings) and the Drive folder ID. Never the token.

**Folder layout** (all names random except the README; nothing reveals box or item names):

```
My Drive/BoxTap Backup/
  README.txt                  plain text: "Encrypted BoxTap backup. Restore at boxtap.app with your 12-word recovery code."
  device.lock                 encrypted { device_id, device_name, generation, taken_at }; appProperties: generation, device_id
  snapshots/
    s-<random>.btdb           encrypted, compressed database snapshot, ~14 kept (3 newest + daily 7 days + weekly 4 weeks)
                              appProperties: snapshot_seq, generation, device_id, key_id, schema_version (no user text)
  photos/
    <random>.btph             encrypted photo (full size), appProperties: photo_ref (random, stored in photos.drive_ref)
                              — thumbnails are rebuilt on restore; names are random, not UUID v7 (which leak time)
```

**File format.** Same header as `.btbak` (magic `BTDB1` / `BTPH1`, `app_version`, `schema_version`, `key_id`, `kdf`, `wrapped_key_by_recovery`, `nonce`; header bytes used as AAD), then `AES-256-GCM(backup_key, bytes)` in 1 MB chunks; snapshots are compressed (`CompressionStream('gzip')`) **before** encryption (audit B15). Each file can be decrypted alone with the recovery code. The snapshot holds the SQLite export plus `photo_manifest` (photo id → SHA-256 of the plain photo, and whether it was uploaded), so restore knows which photos belong. **Audit fix A5 (completed by B6):** device-local tables (`drive_link`, `drive_outbox`, `backup_state`, `time_guard`) and the device fields of `meta` (`install_id`, `device_hint`) are emptied in the snapshot copy; restore creates them fresh with a new `device_id`. `app_config` keeps the higher `seq` of the device and the snapshot.

**Upload rules.**

| What | When | How |
| --- | --- | --- |
| Database snapshot | 2 minutes after the last change, at most every 15 minutes; also on "Sync now" and when the app goes to the background (`visibilitychange`, best effort) | Made with `VACUUM INTO` inside the database worker (consistent copy); uploaded only if `PRAGMA quick_check` and the ledger check pass; if the ledger check fails, the totals are repaired from the ledger, re-checked, then uploaded, and the status chip says so (never a silent stop). Compressed, encrypted, then multipart upload (400 items ≈ 1–2 MB before compression, Assumption). On mobile data, where the browser can tell, at most one snapshot an hour. **Retention (audit fix A4):** keep the newest 3, plus the last snapshot of each of the past 7 days, plus one per week for 4 weeks (about 14 files). If boxes or items drop by more than half since the previous snapshot, that previous one is kept as "Before big change" for 30 days |
| Photo | Once, after it's saved; never re-uploaded (photos don't change) | **(audit B10)** Multipart upload (photos are ~200 KB; Google recommends multipart up to 5 MB, Fact). The Drive file ID is reserved first with `files.generateIds` and stored in `drive_outbox`; the file is created with that `id`, so a retry that gets 409 "already exists" counts as done and duplicates cannot happen. 3 at a time; backoff 30 s → 1 h |
| Photo deleted | When the 30-day bin purges it, and only once no kept snapshot older than the purge still lists it | Permanently delete its `.btph` with `files.delete` (not trash, which still uses quota). The weekly check also deletes any `.btph` that no kept snapshot lists |
| Erase all data | Settings → Erase all data | **Sync stops first**, so an empty database is never uploaded. Asks: "Also delete your Google Drive backup?" (default: keep) |
| `device.lock` | On connect (only after the B2 check) and on restore | Write with `generation` + 1; before each snapshot, read it and compare `device_id`; if another device holds it, stop and show the message below. **Audit fix A6:** Drive v3 has no reliable conditional write (Assumption, verify in the spike), so a few-second race is possible; each snapshot also records its `device_id`, and a device that sees a newer snapshot from another device also stops |

- Mobile data: setting **"Upload photos only on Wi-Fi"**, on by default where the browser can tell (Network Information API, Chrome on Android). Safari can't tell, so iPhone shows "Pause photo uploads" instead (Fact: Safari has no `navigator.connection`).
- Status in Settings and on the home screen: "Backed up to Google Drive · 5 min ago · 12 photos waiting".

**Errors.**

| Drive answer | App does |
| --- | --- |
| 401 (token ended) | Pause uploads; "Tap to back up" chip when changes are waiting (B3) |
| 403 `storageQuotaExceeded` | Stop photo uploads; a full Drive refuses **every** upload (Fact), so to keep one current snapshot the app deletes its oldest kept daily/weekly snapshot (never "Before big change") before uploading; banner "Your Google storage is full" with link to Google One |
| 403 `rateLimitExceeded` / `userRateLimitExceeded`, 429 | Exponential backoff with jitter |
| 403 `insufficientPermissions` or any other 403 reason | Stop and show "Reconnect Google Drive" (never back off forever; audit B13) |
| Folder **trashed** in the Drive website (audit B9) | Deleting in Drive only moves the folder to trash, and uploads still succeed there (Fact). Before each snapshot the app reads the folder's `trashed` field, and every `files.list` uses `trashed=false`. A trashed folder counts as missing: "Your BoxTap backup is in the Google Drive trash" with "Restore it from trash" (link) or "Start a new backup folder" |
| 404 folder or file missing (deleted for good) | Recreate the folder and re-upload everything on the next sync, after telling the user |
| Access removed in the Google account | Treat as disconnected; banner "Google Drive disconnected · Reconnect" |
| Lock held by another device | "Your Google Drive backup is now used by *Raj's iPhone*. This device has stopped syncing." Buttons: "Use this device instead" (takes the lock, asks twice) · "Disconnect" |

**Restore.** New device → "Restore from Google Drive" (offered on the first screen, before a recovery code is made; audit B2) → sign in → app lists snapshots in `BoxTap Backup` (`drive.file` sees files made by the same app on any device, Fact) → ordered by `snapshot_seq` within the newest `generation`, not by clock → 12-word recovery code → crash-safe, version-aware replace (§6.2) → takes `device.lock` (`generation` + 1) → photos download in the background from a persisted queue (`drive_outbox` op `download`), newest boxes first; photos are matched by listing `photos/` once, not only by the manifest flag; a photo still on its way shows "Still downloading"; **(audit fix A7)** a photo the manifest marks as never uploaded, or that Drive does not have, shows "This photo wasn't backed up" instead of waiting forever. Older snapshots (about 14, see retention) can be chosen if the newest is bad. Sync runs only in the tab holding the Web Lock (ARCHITECTURE §6.1, W2). No snapshot is uploaded until a restore has finished.

**Disconnect.** Settings → Disconnect Google Drive: stops syncing, forgets the email and folder ID, calls `google.accounts.oauth2.revoke`. Files stay in Drive (the user owns them); the screen says how to delete the folder.

### 6.2 Backup safety rules (pre-build audit B-series, ADR-022)

These rules close the Critical and High findings B2–B10 and B15 (RISK_REGISTER §2).

1. **Connect safety (B2).** First launch offers three choices: "New to BoxTap", "Restore from Google Drive", "Restore from a backup file". A recovery code is made only for "New". On Connect, the app lists `BoxTap Backup` folders it can see (`trashed=false`). If one holds snapshots, the user must choose **"Restore it"** (default) or **"Start a new backup folder"** (the old folder is renamed `BoxTap Backup (old <date>)` and never written to). The app never writes into a folder whose snapshots carry a different `key_id` from this device's key.
2. **Lock generation and snapshot order (B5).** `device.lock` holds `generation`; each takeover writes `generation + 1`. Each snapshot's `appProperties` hold `generation`, `snapshot_seq` (this device's last seq + 1; a restore continues from the restored seq + 1), `device_id`, `key_id` and `schema_version`. Before each upload the device re-reads the lock and its own `generation`; after the upload it reads the lock again and, if it lost the lock meanwhile, deletes its own new snapshot. "Newest", retention and restore order use (`generation`, `snapshot_seq`), never device clocks or UUID v7 times. Retention prunes only snapshots of the current generation; the last snapshot of each older generation is kept for 30 days.
3. **Takeover check (B5).** "Use this device instead" first compares this device's last `snapshot_seq`/`generation` with Drive's newest. If Drive is newer, the default is "Restore the newer copy here"; replacing it needs typed confirmation ("REPLACE"), and Drive's newer snapshot is kept as "Before big change" for 30 days.
4. **Version-aware restore (B6).** A snapshot or `.btbak` whose `schema_version` is higher than the app knows is refused with "Update BoxTap first" (the app offers the update). A lower one is migrated on the imported copy. `PRAGMA trusted_schema = OFF` while importing, and `sqlite_master` is compared with the expected schema for that version (an untrusted file cannot bring its own triggers).
5. **Crash-safe restore (B6).** Restore writes into a new database file, runs the migrations, `quick_check` and the ledger check, then sets a `restore_pending` marker and swaps files. At every start the app checks the marker and either finishes the swap or rolls back to the safety copy. Photo downloads are queued in `drive_outbox` (op `download`) so a kill mid-restore resumes. Before writing, `navigator.storage.estimate()` must show room for the database twice; otherwise "Free up space on this phone to restore".
6. **Idempotent uploads (B10).** Photos and snapshots use multipart uploads with IDs reserved by `files.generateIds`; no resumable sessions, so no half-written file can mix two encryptions. Temp files from an interrupted `VACUUM INTO` are deleted at start.
7. **Restore from downloaded files (B4).** If the BoxTap OAuth client is ever lost, or Drive is unreachable, the user can download the `BoxTap Backup` folder from the Drive website (a zip) and pick it in "Restore from a backup file"; the app reads `.btdb` and `.btph` files directly with the recovery code.
8. **Change detection (B5 support).** Every repository write bumps `meta.change_seq`; a snapshot is due when `change_seq` > the seq in the last uploaded snapshot. The "Before big change" check (A4) also looks at total `on_hand` and photo count, not only boxes and items.

## 7. Share-out formats

| Share | Contents | Plan |
| --- | --- | --- |
| Family box list PDF | Box number, room, items, thumbnails | Move Pass |
| Removalist PDF | Box number, room, fragile / open first only (G11) | Free |
| Insurance PDF | Box by box, items, values, photos | Move Pass |
| In-stock image | Photo grid, name, price, "in stock" | Seller (free) |
| CSV export | All rows of a workspace | Free, always (C-13) |
