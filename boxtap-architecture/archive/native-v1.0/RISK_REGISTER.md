# BoxTap — Architecture Audit and Risk Register (v1.0, local-first)

## 1. How the audit was done

The seven review passes from the project instructions (functional completeness, logical consistency, security, reliability, performance, maintainability, adversarial) were run on the local-first draft. **They were done one after another by a single reviewer taking separate specialist perspectives (architecture, database, security, mobile, QA), not by independent agents.** This is design-level validation only; no code exists yet.

The cloud audit (12 defects) is in `archive/cloud-v0.2/RISK_REGISTER.md`; most of its defects do not apply to a single-device app (no sync, no RLS, no webhooks).

## 2. Defects found and fixed

| # | Pass | Problem | Severity | Fix (applied in the docs) | New problems? |
| --- | --- | --- | --- | --- | --- |
| L1 | Reliability | After an iPhone restore from iCloud, or a key-store glitch, the database could exist without its key and the app would fail to open | High | iOS Keychain class that migrates with encrypted backups; Android DB excluded from Auto Backup; "DB but no key" opens the Restore screen (ADR-003) | None |
| L2 | Performance | Weekly backup re-zipping hundreds of MB of photos would be slow and fail on cheap phones | High | Incremental photo backup: each photo encrypted once; weekly backup writes only the DB snapshot and new photos; background task, resumable (API_CONTRACTS §7) | More files in the backup folder (acceptable) |
| L3 | Completeness | A Move Pass bought on Android doesn't unlock BoxTap on an iPhone (and the reverse) | Medium | Documented limitation; restore works within the same store. Cross-store licences would need an own licence server (Option C) | — |
| L4 | Consistency | Move Pass renewal as a one-time Google product can't be bought twice and isn't restorable after consumption | High | Google Play **prepaid** subscription plan (top-ups extend); iOS non-renewing subscription with end date computed from transaction history (ADR-008) | Prepaid plan support in the chosen billing plugin must be verified in Phase 0 |
| L5 | Consistency | SQLite cannot stop code from writing `on_hand` directly | Medium | Single writer (stock repository), lint rule, daily ledger self-check that repairs the cache | None |
| L6 | Security | Phone clock set backwards could extend paid plans | Medium | `trustedNow()` with high-water mark and 48 h tolerance (API_CONTRACTS §5) | Rare false alarm if the clock is genuinely wrong; free features unaffected |
| L7 | Reliability | Pilot licence keys bound to install ID break after a reinstall | Low | Install ID kept in Keychain on iOS (survives reinstall); on Android the owner reissues the key (10 pilot sellers) | None |
| L8 | Security | An old config with higher free limits could be replayed | Medium | Monotonic `seq` check | None |
| L9 | Reliability | A failed database migration on update could lock the user out | Medium | Safety copy before migration; recovery screen can still write a raw backup | None |
| L10 | Completeness | iOS sometimes opens Universal Links in Safari | Medium | "Open in BoxTap" button with `boxtap://` scheme on the landing page | None |
| L11 | Security | Edited database rows could fake an entitlement | Medium | Entitlements re-verified from the signed original at every start | None |
| L12 | Completeness | Restoring onto a phone with data: merge or replace was undefined | Medium | Replace, after confirmation and an automatic safety backup | None |

Re-run after fixes: consistency, security and reliability passes repeated on the changed parts. No Critical or High defects remain open in the design.

## 3. Remaining risks

| ID | Risk | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | Users lose a phone with no backup and lose everything | Medium | High for that user, reputational for BoxTap | Recovery code at setup, auto-backup, banners; clear wording in onboarding and store listing | Accepted (owner's local-first choice) |
| R2 | Movers want two phones (couples packing) and sellers want staff | Medium | Medium | Measure in pilot; sync add-on (user's own cloud folder or encrypted relay) is designed for (ADR-005) | Accepted |
| R3 | Cracked app versions unlock Pro | Low–Medium | Low (low price) | Signed records, minification; accept residual | Accepted |
| R4 | Store rules change (external payments, commission) | Medium | Medium | Billing isolated in the `entitlements` module; Option C (own licence server) documented | Accepted |
| R5 | iOS needs a Mac or cloud builds; US$99/year | High | Low | Cloud build free tier, or Android-first launch | **Owner to confirm iPhone at launch** |
| R6 | No usage analytics → activation targets can't be measured | High | Medium | Store console metrics + pilot interviews; optional opt-in ping later | Accepted |
| R7 | Store review delays urgent fixes | Medium | Medium | Phased rollouts; config switches can turn a broken feature off without a release | Accepted |
| R8 | Billing plugin doesn't support Play prepaid plans or StoreKit 2 fully | Medium | High for Phase 1b | Spike in Phase 0; fallback is a thin custom Capacitor plugin | Open (Phase 0 spike) |
| R9 | FTS5 trigram not available in the SQLCipher build | Low | Low | Check in Phase 0; `LIKE` fallback is fast enough for a few thousand rows | Open (Phase 0 spike) |
| R10 | Gold/silver sellers expect live gold-rate pricing | Medium | Low | Optional weight/purity fields; add later only if asked (ADR-012) | Accepted |
| R11 | Solo founder capacity across two modes and two stores | High | High | Phase gates and kill criteria unchanged | Accepted |

## 4. What implementation testing must still prove

- Encrypted DB cannot be opened without the key; backup restore works on a fresh phone with only the file and the recovery code.
- Restore purchases recreates the right plans and end dates on a new phone (both stores, including stacked Move Pass renewals).
- Clock rollback, replayed config and forged licence keys are all rejected.
- Weekly backup of 500 photos completes on a low-cost Android phone without freezing the app.
- Box page < 2 s and +/− < 0.5 s on a low-cost Android phone (N-02); with local data these should be far faster.
- Labels print aligned on Avery L7165/L7163 and scan straight into the app on Android and iPhone.
