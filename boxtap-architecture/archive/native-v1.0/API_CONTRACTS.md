# BoxTap — Contracts: Licensing, Billing, Config, Backups, Links (v1.0, local-first)

There is no server API. These are the **formats and rules** that the app, the owner's tools, the stores and the static site must agree on. The earlier cloud API is in `archive/cloud-v0.2/API_CONTRACTS.md`.

## 1. Entitlement logic: `can(feature)`

One function decides every premium check. Screens never check plans themselves.

```ts
type Plan = 'move_pass' | 'seller_pro';
type Feature = 'add_box' | 'add_item' | 'add_photo' | 'share_pdf' | 'insurance_pdf'
             | 'variants' | 'cost_profit' | 'orders' | 'reports' | 'excel';

function activePlans(now: Date): Set<Plan>          // from entitlements table, after re-verifying raw_signed
function can(feature: Feature, ctx: { workspace: Workspace; counts: Counts }): Allowed | Blocked
```

Rules:
1. `now` = `trustedNow()` (§5), never the raw phone clock alone.
2. A plan is active if any verified entitlement for it has `starts_at ≤ now < ends_at + grace` (grace from config, default 3 days for auto-renewing subscriptions, 0 for Move Pass).
3. Move Pass unlocks Home workspaces; Seller Pro unlocks Seller workspaces on this phone.
4. Free limits come from config (§3); built-in defaults if no config has ever loaded: Home 12 boxes, 1 photo per box; Seller 50 items.
5. **Reading, searching, exporting and backing up are never blocked** (H-06).
6. `Blocked` carries a reason code the UI maps to the upgrade screen: `limit_boxes`, `limit_items`, `limit_photos`, `pro_only`.

## 2. Store products

| Product ID | Store type | Plan | Length | Price (starting point) |
| --- | --- | --- | --- | --- |
| `move_pass_12m` | Google Play: subscription with a **prepaid** base plan, P1Y | move_pass | 12 months, top-up extends | A$12.95 |
| `move_pass_12m` | App Store: non-renewing subscription | move_pass | 12 months (app computes end date) | A$12.95 |
| `seller_pro_monthly` | Auto-renewing subscription (both stores) | seller_pro | 1 month | ৳199 / about A$9.95 |
| `seller_pro_yearly` | Auto-renewing subscription (both stores) | seller_pro | 1 year | ৳1,990 |

Prices are set per country in each store console. Store consoles handle tax, refunds and receipts.

### 2.1 Verification on the phone

| Store | What the app receives | How it is verified | End date |
| --- | --- | --- | --- |
| Google Play | `Purchase` JSON + signature | RSA signature check with the app's Play licence public key (built into the app) | Subscription expiry from Play Billing (`queryPurchasesAsync` for active subs); prepaid plan expiry from the purchase details |
| App Store | StoreKit 2 `Transaction` (JWS) | Signature chain to Apple's root certificate (StoreKit 2 `VerificationResult.verified`) | Auto-renewing: `expirationDate`. Non-renewing: computed (below) |

**Move Pass end date on iOS (non-renewing):** sort all verified `move_pass_12m` transactions by purchase date; `end = purchase_1 + 12 months`; for each later purchase, `end = max(end, purchase_n) + 12 months`. The same rule is used for Google prepaid top-ups if the store does not return the end date directly. Because it is computed from the store's history, **Restore purchases** on a new phone gives the same answer.

Refunds and revocations: entitlements are recomputed from the store at every app start when online (Play: `queryPurchasesAsync`; Apple: `Transaction.currentEntitlements` and `revocationDate`). A refunded purchase disappears from the active set.

## 3. Signed config file

URL: `https://boxtap.app/config/v1.json` (static, Cloudflare Pages). Fetched at most once a day when online and on "Restore purchases".

```json
{
  "body": {
    "seq": 7,
    "issued_at": "2026-12-01T00:00:00Z",
    "min_app_version": "1.0.0",
    "free_limits": { "home_boxes": 12, "home_photos_per_box": 1, "seller_items": 50 },
    "plans": { "move_pass": { "photos_per_parent": 5 }, "seller_pro": { "photos_per_parent": 5 } },
    "grace_days": { "seller_pro": 3, "move_pass": 0 },
    "features": { "catalogue_image": true, "insurance_pdf": true, "excel": false },
    "revoked_keys": ["lk_01JD…"],
    "messages": { "en": null, "bn": null }
  },
  "kid": "cfg-2026",
  "sig": "base64url(Ed25519(owner_config_private_key, canonical_json(body)))"
}
```

App rules:
- Verify `sig` with the built-in public key for `kid`. Unknown `kid` or bad signature → ignore the file.
- Accept only `seq` greater than the stored one (stops replay of an old, more generous config).
- `issued_at` also feeds the trusted-time check (§5).
- Free limits apply to **new** additions only; lowering a limit never hides or deletes existing boxes.
- `min_app_version` higher than the installed version → a non-blocking "Please update" banner (a blocking screen only if the owner sets `"force": true` for a security fix).

## 4. Licence keys (pilots, promos, gifts)

Format (shown to the user as a QR code or a short text block they paste):

```
BTK1.<base64url(payload)>.<base64url(signature)>
payload = {"kid":"lic-2026","id":"lk_01JD…","plan":"seller_pro","starts_at":"2026-12-01",
           "ends_at":"2027-03-01","install":"9F3K2Q","note":"pilot"}
```

- Signed with the owner's licence private key (Ed25519, separate from the config key).
- `install` (optional): first 6 characters of the phone's install ID, shown in Settings → About. Pilot keys are always bound; promo keys may be unbound but short (≤ 3 months).
- The app rejects keys that are expired, revoked in config, or bound to another install.
- Owner tool: `tools/licence.ts` run with Node on the owner's computer: `npx tsx tools/licence.ts --plan seller_pro --months 3 --install 9F3K2Q`. The private key is read from a local file outside the repository.

## 5. Trusted time (`trustedNow()`)

Protects expiry dates from a phone clock set backwards.
- `time_guard.max_seen_at` = the latest time ever seen from the phone clock, store responses, or the config's HTTP `Date` header.
- `trustedNow() = max(phone_clock, max_seen_at)`.
- If the phone clock is more than 48 hours behind `max_seen_at`, the app shows "Your phone's date looks wrong" and treats paid plans as expired until the date is fixed or an online check succeeds. Free features keep working.

## 6. Label link format

`https://boxtap.app/b/<CODE>` where CODE = 10 characters from `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.
- The landing page also has an **Open in BoxTap** button using the custom scheme `boxtap://b/<CODE>`, for the cases where iOS opens the link in Safari instead of the app (audit L10).
- Static site rules: `/b/*` returns the landing page (no data, no logging of codes beyond Cloudflare's standard anonymous request logs).
- `/.well-known/assetlinks.json` (Android App Links, package `app.boxtap`, release signing-key fingerprint) and `/.well-known/apple-app-site-association` (`applinks` for `/b/*`).

## 7. Backup file format (`.btbak`)

```
magic "BTBAK1" | header JSON (length-prefixed) | encrypted payload
header = { "created_at", "app_version", "schema_version", "workspaces": n,
           "kdf": { "alg": "argon2id", "salt", "m": 65536, "t": 3, "p": 1 },
           "wrapped_key_by_recovery": base64, "nonce": base64 }
payload = AES-256-GCM(backup_key, zip(db_export.sqlite, manifest.json))
```
Photos are backed up **incrementally** (audit L2): each photo is encrypted once with the same `backup_key` into `BoxTap Backup/photos/<photo_id>.btph` and never rewritten. A weekly backup writes only the new database snapshot plus new photos, so it stays small and fast. `manifest.json` lists the photo files each snapshot needs; photos no longer referenced by any of the last 4 snapshots are deleted.
Backups run as a background task with a progress bar and can resume after interruption.
- `db_export.sqlite` is a plain (unencrypted inside the encrypted payload) SQLite copy made with `VACUUM INTO`, so restore works across app versions via normal migrations.
- The app keeps the last 4 backups in the chosen folder.
- Restore **replaces** everything on the phone after a confirmation, and makes a safety backup of the current data first (audit L15).
- Restore: read header → user enters recovery code → Argon2id → unwrap `backup_key` → decrypt → check `schema_version` ≤ app's → import → generate a new local database key.

## 8. Share-out formats

| Share | Contents | Mode |
| --- | --- | --- |
| Box list PDF (family) | Box number, room, items, thumbnails | Home (Move Pass) |
| Removalist PDF | Box number, room, fragile/open-first only (gap G11) | Home (free) |
| Insurance PDF | Box by box, items, values, photos | Home (Move Pass) |
| In-stock image | Photo grid, name, price, "in stock" | Seller |
| CSV export | All rows of a workspace | Both, always free (C-13) |
