# BoxTap — System Architecture (v1.0, local-first)

Version 1.0 · 2026-11-23 · Based on the requirements doc (2026-11-22), the gap review, the owner's decisions, and the local-first choice made on 2026-11-23.
Decisions: [ADR.md](ADR.md). The earlier cloud design is in `archive/cloud-v0.2/`.

## 1. Summary

BoxTap is a **native app for Android and iPhone** (React + TypeScript inside Capacitor). Each user's boxes, items, photos and stock live in an **encrypted SQLite database on their phone**. There is **no backend database and no server code**. The owner controls money and features through **app-store billing** (verified on the phone), **signed licence keys** and a **signed config file** served from a free static website. Users keep their data safe with **encrypted backups to their own Google Drive or iCloud**.

Fixed running cost: about **US$115–130 a year** (Apple US$99/year, domain, Google's one-time US$25), plus 15% store commission on sales. Nothing grows with the number of users.

## 2. Context

```mermaid
flowchart LR
  subgraph Phone [User's phone]
    APP[BoxTap app]
    DB[(Encrypted SQLite<br/>+ photo files)]
    APP --> DB
  end
  U1[Home user: Mia, Raj] --> APP
  U2[Seller: Nusrat, Tom] --> APP
  X[Anyone scanning a label] --> WEB
  APP -- "purchase, restore" --> STORES[Google Play / App Store]
  APP -- "daily, when online" --> WEB[boxtap.app static site<br/>Cloudflare Pages<br/>config.json, app-link files,<br/>label landing page]
  APP -- "weekly encrypted backup" --> UC[User's Google Drive /<br/>iCloud Drive / Files]
  OWNER[Owner's computer<br/>Ed25519 private key] -- "signs config.json" --> WEB
  OWNER -. "sends signed pilot / promo keys" .-> U2
```

**Nothing the user enters ever leaves the phone**, except inside backups the user controls (encrypted) and files the user chooses to share (PDF, images, CSV).

## 3. Module boundaries

```mermaid
flowchart TB
  subgraph Core [Shared core]
    DATA[data<br/>SQLite, migrations, repositories]
    WS[workspaces<br/>Home / Seller on this phone]
    LOC[locations + labels<br/>QR codes, PDF printing]
    ITEM[items + photos + search]
    ENT[entitlements<br/>store receipts, licence keys,<br/>signed config, limits]
    BAK[backup<br/>recovery code, export, restore]
    I18N[i18n<br/>English, Bangla, currency, dates]
    NOTIF[local notifications]
    SHARE[share out<br/>PDF, image, CSV]
  end
  subgraph Home [Home mode]
    ROOMS[rooms, flags, spot]
    MOVE[packed / moved / unpacked<br/>arrival check]
    INS[insurance PDF]
  end
  subgraph Seller [Seller mode]
    STOCK[stock ledger: +/−, booked, undo]
    LOW[low stock list + notification]
    COUNT[count mode, move between boxes]
    CAT[in-stock catalogue image]
    PRO[Pro: products, variants, costs, orders, reports]
  end
  Home --> Core
  Seller --> Core
```

Rules: mode modules may use core modules, never the other way round. Screens never touch SQL directly; they call repositories in `data`. Every premium check goes through one function, `can(feature)`, in `entitlements`.

| Module | Owns | Phase |
| --- | --- | --- |
| data | SQLite connection, encryption key, migrations, repositories | 0 |
| workspaces | `workspaces` | 1 (Home), 2 (Seller) |
| locations + labels | `rooms`, `locations`, `labels`, PDF labels, scanner | 1 |
| items | `items`, `photos`, FTS index | 1 |
| entitlements | `entitlements`, `licence_keys`, `app_config`, `time_guard` | 1 (free limits), 1b (billing) |
| backup | backup files, recovery code | 1 |
| share out | PDF/image/CSV via share sheet | 1b |
| stock | `stock_movements`, triggers | 2 |
| seller-pro | `products`, `variants`, `orders`, reports | 3 |

## 4. Technology

| Concern | Choice | Notes |
| --- | --- | --- |
| UI | React 18 + TypeScript + Vite, Tailwind | Planned screens reused |
| Native shell | Capacitor 6 | Android + iOS from one codebase |
| Database | `@capacitor-community/sqlite` with SQLCipher | ADR-003 |
| Key storage | Android Keystore / iOS Keychain via a secure-storage plugin | Key never leaves the phone |
| State | TanStack Query over local repositories | Same patterns as before, no network |
| Forms | React Hook Form + Zod | |
| QR scanning | ML Kit barcode scanning plugin (Android, iOS) | Fast, works offline |
| App links | Android App Links + iOS Universal Links | ADR-007 |
| PDF / labels | `pdf-lib` + `qrcode` | ADR-010 |
| Images | Native camera → resize to 1600 px WebP (~200 KB) + 400 px thumbnail | |
| Search | SQLite FTS5 trigram | ADR-011 |
| Billing | Capacitor wrapper over Google Play Billing Library and StoreKit 2 (e.g. `cordova-plugin-purchase` or a thin custom plugin) | ADR-008; no RevenueCat |
| Signatures | `@noble/ed25519` (licence keys, config) | Small, audited library |
| Backups | `@noble/ciphers` AES-256-GCM, Argon2id (WASM) for the recovery code | ADR-016 |
| Notifications | Capacitor Local Notifications | Low stock, pass ending, backup reminder |
| i18n | i18next, `en.json`, `bn.json`, Noto Sans Bengali bundled | |
| Crash reports | Play Console vitals, Xcode Organizer | ADR-017 |

## 5. Key flows

### 5.1 Scan a label

```mermaid
sequenceDiagram
  participant C as Phone camera
  participant OS as Android / iOS
  participant App as BoxTap
  participant W as boxtap.app (static)
  C->>OS: https://boxtap.app/b/K7Q2M9XR4T
  alt BoxTap installed
    OS->>App: open via App Link / Universal Link
    App->>App: find label code in local DB
    alt code is mine
      App-->>C: Box 12 · Kitchen · contents
    else not mine
      App-->>C: "This box isn't in your BoxTap"
    end
  else not installed
    OS->>W: open page
    W-->>C: "This is a BoxTap label" + store buttons + Open in BoxTap (no data)
  end
```

### 5.2 Sell one piece (Seller)

```mermaid
sequenceDiagram
  participant U as Nusrat
  participant App as BoxTap
  participant DB as Encrypted SQLite
  U->>App: scan Box 7, tap − on "Jhumka red"
  App->>DB: BEGIN; INSERT stock_movements(id, item, −1, 'sold'); COMMIT
  DB->>DB: trigger: on_hand 12 → 11
  App-->>U: 11 left · Undo (10 s)
  Note over DB: No network involved
```

### 5.3 Buy or restore a plan

```mermaid
sequenceDiagram
  participant U as User
  participant App as BoxTap
  participant S as Google Play / App Store
  U->>App: Get Move Pass
  App->>S: launch purchase
  S-->>App: signed purchase / transaction
  App->>App: verify signature on the phone
  App->>App: recompute entitlements from all purchases
  App-->>U: Move Pass active until 23 Nov 2027
  Note over U,App: New phone: Restore purchases → same recompute
```

### 5.4 Back up and restore

```mermaid
sequenceDiagram
  participant App as BoxTap (old phone)
  participant F as User's Drive / iCloud folder
  participant N as BoxTap (new phone)
  App->>App: zip DB export + photos
  App->>App: encrypt with backup key; add backup key wrapped by recovery code
  App->>F: write boxtap-2026-11-30.btbak (keeps last 4)
  N->>F: user picks the newest file
  N->>N: user types 12-word recovery code
  N->>N: unwrap backup key, decrypt, import, new local DB key
```

## 6. Infrastructure

| Piece | Where | Cost |
| --- | --- | --- |
| Source code, CI | GitHub (free private repo) + GitHub Actions | US$0 (free minutes) |
| Android builds | GitHub Actions (Linux) | US$0 |
| iOS builds | Owner's Mac, or a cloud build service's free tier (Assumption: Codemagic ~500 min/month) | US$0 if within free tier |
| Static site + config | Cloudflare Pages | US$0 |
| Distribution and billing | Google Play (US$25 once), App Store (US$99/year) | Fixed |
| Pilot distribution | Google Play internal / closed testing track | US$0 |

**Release flow:** merge to `main` → CI builds and tests → upload to Play internal track and TestFlight → test on two real phones → promote to production. Config changes: owner edits `config.json`, signs it with the local script, commits; Cloudflare Pages deploys.

## 7. Requirement traceability

| Requirement | Local-first design |
| --- | --- |
| C-01 sign-up | Replaced: no account; choose Home or Seller on first launch (< 1 min) |
| C-02 workspaces | Several workspaces on one phone, never mixed |
| C-03 boxes, 30-day bin | `deleted_at` + daily purge at app start |
| C-04/05 private QR | ADR-007 |
| C-06 fast entry, G1 contents photo | Unchanged |
| C-07 search < 1 s | FTS5 |
| C-08 labels | Unchanged |
| C-09 offline | Everything offline |
| C-10 photos | Compressed on phone; stored locally |
| C-11 billing, enforced limits | Store billing + `can(feature)`; limits from signed config |
| C-12 language files | Unchanged |
| C-13 export, delete | CSV/backup export; uninstall or "Erase all data" |
| C-14 admin KPIs | Store consoles (ADR-017) |
| H-04 Move Pass | Play prepaid plan / App Store non-renewing subscription |
| H-05 share link | **Replaced** by PDF/image share (no revoke) |
| H-06 never lose access | Expired plans block only new boxes/photos, never reading or export |
| H-07 insurance PDF | Unchanged |
| H-08 reminder emails | Local notifications |
| S-01 to S-10 | Unchanged, on device |
| S-11 offline, two phones | Offline yes; **two phones deferred** (ADR-005) |
| S-21 low-stock push | Local notification |
| S-22 staff | **Deferred** until sync |
| S-25 catalogue image | Unchanged |
| S-27 Play Store | Now the main channel from Phase 1 |
| N-01 devices | Android + iPhone; **desktop deferred** |
| N-07 security | [SECURITY_MODEL.md](SECURITY_MODEL.md) |
| N-10 backups | ADR-016 |
