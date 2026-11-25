# BoxTap — Pre-build Architecture Audit (2026-11-25)

Baseline: architecture v2.1 (local-first PWA, manual licence keys, encrypted Google Drive backup), including the Drive thread's first audit fixes A1–A8. Design review only: no code exists and nothing was tested on a device.

## How it was done

- Six **independent specialist reviewer agents** (architecture, security, database, frontend/browser, backend/integrations, QA) each read the full v2.1 doc set without seeing the others' conclusions. A lead reviewer merged, de-duplicated and checked their findings.
- The project's seven review passes were applied: completeness, consistency, security, reliability, performance, maintainability and adversarial.
- The database reviewer ran the schema fragments in SQLite. The fix for B8 was re-tested: a live ledger still cannot be deleted, and erasing a workspace now works.
- After the fixes, the consistency, reliability and security passes were re-run on every changed section.

## Result

| Severity | Found | Fixed in docs | Left open |
| --- | --- | --- | --- |
| Critical | 2 (B1, B2) | 2 | 0 |
| High | 14 (B3–B14, B16; B15 rated Medium) | 14 | 0 design defects; owner decided B3: one tap per session |
| Medium/Low | about 25 | most (see RISK_REGISTER §2 note) | R16–R20 in RISK_REGISTER §3 |

The A1–A8 fixes were reviewed. A4 (retention), A2 and A8 hold. A5 and A6 were incomplete and are now finished by B6 and B5. A1 was tightened by B11. A7 was improved by B6, so photos are matched against Drive itself.

## The two Critical findings

1. **B1. The app would not start.** The Content Security Policy blocked WebAssembly, which SQLite, Argon2id and the QR decoder need. It also blocked photo blob images. The CSP is now complete, and tests run with the real headers.
2. **B2. A new phone could overwrite the real backup.** A user who set up the new phone as "new" and then tapped Connect replaced the Drive lock and uploaded an empty database under a new key. Now the first screen offers Restore, Connect looks for an existing backup first, and the app never writes into a folder made with another key.

## Where the fixes are

- Most Drive rules: `API_CONTRACTS.md §6.2`, recorded as ADR-022.
- Full table: `RISK_REGISTER.md §2`, rows B1–B16.
- New tests: `TEST_STRATEGY.md`, scenarios 31–41 and three new test layers.
- Re-estimate: `IMPLEMENTATION_ROADMAP.md`. Phase 0 is now about 30 h (was 15 h) and Phase 1 about 90 h (was 58 h).

## Owner decisions raised

1. **Google token (B3).** Browser-only sign-in cannot renew silently, so Drive backup needs one tap per app session (and after each hour). **Owner chose: one tap per session, no server (2026-11-25).** The alternative is a free, stateless Cloudflare Worker token exchange that makes backups fully automatic, at the cost of adding a small server.
2. **Recovery code (B7).** It is no longer stored, so Settings cannot show it again. Users can change it with the old code, or create a new one.

## What must still be proven in Phase 0 and Phase 1

Several fixes depend on browser and Google behaviour that is marked Assumption:

- tap-only token renewal
- pop-up or redirect sign-in in the iPhone home-screen app
- `files.generateIds`, then a 409 error when an ID is reused
- trash semantics
- Safari photo encoding
- Android `persist()`
- releasing the tab lock from a frozen tab

The list is in `RISK_REGISTER.md §4`. The design is not "bug-free"; it has no known open Critical or High design defects.
