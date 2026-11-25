# BoxTap — API Contracts

There is no hand-written REST server. The app talks to Supabase in three ways:

1. **PostgREST table access** (`supabase.from('items').select(...)`) for simple reads and edits, protected by RLS.
2. **RPC functions** (`supabase.rpc('sync_push', {...})`) for multi-row business actions.
3. **Edge Functions** (`/functions/v1/...`), reached through `https://boxtap.app/api/*` (a Cloudflare Pages Function that applies rate limits and forwards), for public endpoints, secrets and third parties.

All inputs are validated twice: Zod on the phone (for fast feedback) and SQL constraints / function checks on the server (for safety). Shared TypeScript types are generated with `supabase gen types`.

## 1. Error format

RPCs and functions raise or return errors with a stable `code` the app maps to a translated message:

```json
{ "error": { "code": "plan_limit_boxes", "message": "Free plan allows 12 boxes", "details": { "limit": 12 } } }
```

| Code | Meaning | App shows |
| --- | --- | --- |
| `not_authenticated` | No or expired session | Sign-in screen, then returns to the same page |
| `not_member` / RLS empty result | No access to that workspace | "This box belongs to someone else" |
| `plan_limit_boxes` / `plan_limit_items` / `plan_limit_photos` | Limit reached | Upgrade screen (never for pilot workspaces) |
| `validation_failed` | Bad input | Field-level message |
| `stale_undo` | Undo window passed | "Too late to undo; use a count instead" |
| `rate_limited` | Too many requests | "Try again in a minute" |
| `provider_error` | Payment provider failed | "Payment didn't go through; you were not charged" (only when true) |

## 2. RPC functions

| Function | Input | Output | Who | Idempotent |
| --- | --- | --- | --- | --- |
| `create_workspace` | `{type, name, country}` | `{workspace_id}` | Any signed-in user | No (one call per tap; button disabled while pending) |
| `create_label_batch` | `{workspace_id, count ≤ 140}` | `{codes: string[]}` | Owner/staff | No (spare codes are harmless) |
| `attach_label` | `{code, location_id, retire_old: bool}` | `{ok}` | Owner/staff | Yes |
| `sync_push` | `{workspace_id, mutations: Mutation[] ≤ 200}` | `{accepted: uuid[], rejected: {id, code}[], max_seq}` | Members | **Yes** (by mutation id) |
| `sync_pull` | `{workspace_id, since_seq}` | `{rows: {table: Row[]}, max_seq, has_more}` | Members | Yes (read) |
| `move_stock` | `{from_item_id, to_location_id, qty, movement_ids: [uuid, uuid]}` | `{from_on_hand, to_item_id, to_on_hand}` | Seller members | **Yes** (by movement ids) |
| `count_box` | `{location_id, counts: {item_id: int}, movement_ids: {item_id: uuid}}` | `{changed: int}` | Seller members | **Yes** |
| `search` | `{workspace_id, q, limit ≤ 50}` | `[{item_id, name, location_number, room_or_spot, available}]` | Members | Yes |
| `set_move_status` | `{location_ids, status}` | `{updated}` | Home owner | Yes |
| `soft_delete` / `restore` | `{table, id}` | `{ok}` | Owner | Yes |
| `export_workspace` | `{workspace_id}` | JSON for CSV | Owner, recent re-auth | Yes |
| `log_event` | `{workspace_id, name, props}` | `{}` | Members | No (KPIs tolerate rare duplicates) |

`Mutation`:
```ts
type Mutation =
  | { id: string; table: 'stock_movements'; op: 'insert'; row: {
      item_id: string; on_hand_delta: number; reserved_delta: number;
      reason: StockReason; reverses_id?: string; device_id: string; happened_at: string; note?: string } }
  | { id: string; table: 'locations' | 'items' | 'rooms' | 'photos'; op: 'upsert'; row: Record<string, unknown>; fields: string[] };
```
`fields` lists which fields the user changed, so last-write-wins applies per field, not per row.

## 3. Edge Functions

### `GET /api/scan/:code` → `scan-public`
Signed-out label lookup. Rate-limited.
```json
200 { "status": "linked", "box_number": 12, "workspace_type": "home" }
200 { "status": "not_linked" }      // spare label, deleted box or deleted account
404 { "error": { "code": "unknown_code" } }
```
Never returns names, items, photos, rooms or owner details.

### `GET /api/share/:token` → `share-view`
```json
200 { "scope": "family", "title": "Mia's move", "boxes": [{ "number": 4, "room": "Kitchen", "open_first": true,
       "items": ["Kettle", "Mugs"], "photo_urls": ["https://...signed..."] }] }
200 { "scope": "removalist", "boxes": [{ "number": 4, "room": "Kitchen", "fragile": true, "open_first": true }] }
410 { "error": { "code": "link_revoked_or_expired" } }
```
Response headers: `Cache-Control: no-store` so revocation is immediate (H-05).

### `POST /api/billing/checkout` → `stripe-checkout`
```json
in  { "workspace_id": "uuid", "plan": "move_pass" }
out { "checkout_url": "https://checkout.stripe.com/..." }
```
Price IDs come from server config, never from the request. Requires owner.

### `POST /api/billing/stripe-webhook` → `stripe-webhook`
Handles `checkout.session.completed`, `charge.refunded`, `charge.dispute.created`. Steps: verify signature → insert `provider_events` (conflict = already processed, return 200) → check amount/currency match the plan → write `payments` + `entitlements` → mark processed. Returns 200 only after the transaction commits, so Stripe retries on failure.

### Phase 3: `POST /api/billing/bd-init`, `POST /api/billing/bd-ipn`, `POST /api/billing/play-rtdn`
Same pattern: verify with the provider's server-side validation API before granting. Store currency `BDT`.

### `POST /api/account/delete` → `account-delete`
Requires a session re-authenticated within 10 minutes. Marks the profile for deletion, signs out all sessions; the daily job purges data after 30 days unless the user cancels.

## 4. Storage

| Bucket | Path | Access |
| --- | --- | --- |
| `photos` (private) | `workspaces/{workspace_id}/{photo_id}.webp` and `..._thumb.webp` | Upload: member of `{workspace_id}`, ≤ 600 KB, image MIME. Read: signed URL (1 h) created for members or by `share-view` |
| `exports` (private) | not used — exports are generated on the phone | — |

## 5. Versioning

- The app sends `X-App-Version`. RPCs that change shape get a new name (`sync_push_v2`); old versions stay for 60 days because PWAs update in the background and some phones lag behind.
- Database migrations are always additive first (add column → backfill → switch app → remove old column in a later release).
