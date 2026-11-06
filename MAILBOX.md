# Mailbox — in-app recipe letters

Status: **implemented (phase 1: P1 mailbox + Cartas UI).** Push notifications are phase 2.
`SPEC.md` remains the source of truth for shipped behaviour; this file records the full design.

## 1. What this is

Today a recipe travels as a short link: the sender opens the system share sheet, the
recipient taps the link and gets the **Salvar / Descartar** letter. The mailbox adds a
second delivery channel inside the app:

- The sender picks a **contact** instead of (or in addition to) sharing a link.
- The recipe is published as a normal share, then a **letter** is delivered to the
  recipient's mailbox on the Worker.
- The recipient gets a notification (phase 2) and sees the letter in the **Cartas** tab.
- Tapping a letter opens the existing shared-recipe page, with the same **Salvar /
  Descartar** flow and independent-copy semantics.

It is still a private, two-person-scale notebook. The mailbox is a delivery mechanism, not
a shared recipe library and not sync.

## 2. Agreed decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Addressing | **Contact codes**: public 12-char mailbox address + private secret |
| D2 | Notifications | **Phase 2** (Expo Push/FCM); phase 1 ships the mailbox with a local unread badge |
| D3 | Server storage | **Per-mailbox Durable Object** |
| D4 | Privacy | **P1 — metadata-minimized**: server stores only `{letterId, shareId, sentAt}` per letter; read state local; no server blocks; sender address not stored at rest |
| D5 | Backup | Include mailbox address + secret + read state; restore **only on a fresh install** |
| D6 | Navigation | **Three compact, left-aligned tabs: Receitas / Cartas / Ajustes**; Lixeira moves into Ajustes; Trash is a pushed screen with no tabs |
| D7 | Design | `incoming/mockups/mailbox-nav-final.png` (gitignored reference) |

**Why P1:** it removes the new at-rest social graph and read receipts with almost no extra
complexity. It is not end-to-end encryption; the recipe content remains in the readable
`r:<shareId>` (as today). The stronger options were rejected: P2b is encryption theater
(the server can re-derive the metadata from the readable share), and P2 (encrypted content,
no public share) would break the web fallback, WhatsApp preview, link forwarding and the
existing dedupe/update flow. See §14.

## 3. Goals

- Send a recipe to a known person without leaving the app.
- Give the recipient a durable inbox of received letters, with read/unread state.
- Reuse the existing share payload, import letter, dedupe and update-copy logic.
- Keep the no-accounts model: an unguessable mailbox address is the identity.
- Work when the recipient is offline: the letter waits on the server and the app shows it
  on the next refresh.
- Never lose the ability to receive: the mailbox identity is restorable from a backup.

## 4. Non-goals (v1)

- No accounts, email, phone number, password, or login screen.
- No recipe sync or collaborative editing; saving a letter still creates an independent copy.
- No chat, comments, reactions, or read receipts shown to the sender.
- No web mailbox; recipients without the app keep using the existing share link.
- No multi-recipient send in v1 (one contact per send; multi-select later).
- No attachments, photos, or tags.
- No server-side blocking (see §9).
- No mailbox deletion/rotation UI in v1 (phase 3).
- No server-side search of letters.

## 5. Identity model

### 5.1 Address and secret

Each install owns one mailbox:

- `address`: 12 chars from the existing share alphabet
  (`abcdefghjkmnpqrstuvwxyz23456789`), generated with a CSPRNG. Public; give it to people
  who may send to you.
- `secret`: 32 random bytes, hex-encoded. Private read token. It never leaves the device
  except in the `Authorization` header and the backup.

Why two values: if the address alone could read the mailbox, everyone you allow to send to
you could also read your inbox. Sending needs the address; reading/marking/removing needs
the secret.

The Worker stores only `sha256(secret)`, never the raw secret. Comparison is timing-safe.
The address is **not** a key fingerprint and does not change if the secret is rotated later.

### 5.2 Registration

The app generates `address` + `secret` locally on first mailbox use and calls
`POST /api/mailboxes` with both plus the current display name/seal. The server validates the
formats, creates the Durable Object at `address`, stores
`{ address, secretHash, name, seal, createdAt }`, and returns `201 { address }`.

If the address exists with the same secret hash, return `200` (idempotent retry). If it
exists with a different hash, return `409 address_taken`; the app retries with a new address.
The app stores both values in the local `mailbox` table and includes them in the backup.

### 5.3 Contacts

A contact is local only:

```ts
type Contact = {
  id: string;              // local UUID
  address: string;         // the other person's public mailbox address
  displayName: string;     // resolved from their profile, editable locally
  sealJson: string | null; // resolved snapshot, decorative
  createdAt: number;
  lastSentAt: number | null;
};
```

Adding a contact:

1. Paste the address (bare code; trim/lowercase).
2. `GET /api/mailboxes/:address/profile` → `{ name, seal }` (public by address).
3. Confirm the name/seal, save locally.
4. If the address does not exist: "Endereço não encontrado."

The address is shared out of band, like a phone number: Settings → **Seu endereço** →
**Copiar endereço** / system share sheet with a short message.

## 6. Server design

### 6.1 Durable Object per mailbox

Binding `MAILBOXES` → class `Mailbox`, migration tag `v2` (the rate limiter is `v1`).

DO storage:

```ts
type MailboxMeta = {
  address: string;
  secretHash: string;      // sha256(secret), hex
  name: string;            // 0-40 chars
  seal: unknown | null;    // validated seal payload
  createdAt: number;
  updatedAt: number;
};

type Letter = {
  id: string;              // 12-char id
  shareId: string;         // r:<shareId> in KV
  sentAt: number;
};
```

Keys: `meta`, `letters` (array, newest first), `pushTokens` (array, max 3).

There is **no** `readAt`, `senderAddress`, `title`, `stepCount`, `senderName`, `senderSeal`
or `blocked` list in the stored letter. The list endpoint joins the share at read time (the
Worker can already read it) and returns the display fields to the authenticated recipient.

### 6.2 API

`X-App-Key` is the existing shared write key. `Authorization: Bearer <secret>` is the
mailbox owner token. `profile` is public by address.

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| POST | `/api/mailboxes` | app key | create mailbox; body `{ address, secret, name, seal }`; 201/200/409 |
| GET | `/api/mailboxes/:address/profile` | none | `{ name, seal }`; 404 if missing |
| PUT | `/api/mailboxes/:address` | owner | update name/seal |
| PUT | `/api/mailboxes/:address/push` | owner | register `{ token, platform }`; replace same token, cap 3 |
| GET | `/api/mailboxes/:address/letters` | owner | `{ letters }`; newest first; joins the share; unread is computed locally |
| POST | `/api/mailboxes/:address/letters` | app key + sender owner | body `{ shareId, senderAddress }`; `X-Idempotency-Key`; append a letter |
| DELETE | `/api/mailboxes/:address/letters/:letterId` | owner | remove letter |

There is **no** `POST .../read` endpoint and **no** blocks endpoints. Read state is local.

**List response.** Each item is the stored `{ id, shareId, sentAt }` plus display fields
joined from `r:<shareId>`:

```json
{
  "id": "l8k2m9x1q4",
  "shareId": "f8k2m9x1q4",
  "sentAt": 1762300000000,
  "title": "GUIA: COMO PREPARAR FEIJÃO",
  "stepCount": 12,
  "sender": "Lucas",
  "senderSeal": { "kind": "sigil", "id": "cat" },
  "available": true
}
```

If the share is missing or revoked, `available: false` and the display fields are omitted.
The app keeps the last known values locally so the row does not disappear.

**Send validation.** `POST .../letters`:

1. Verify the sender's secret against `mailbox:<senderAddress>`.
2. Reject if the recipient has 500 letters (`409 mailbox_full`).
3. Look up `r:<shareId>` in KV. If missing → `404`, revoked → `410`.
4. Append `{ id, shareId, sentAt }`; store `idem:letter:<key>` → letter id for 24 h.
   A retry with the same key returns the existing letter.
5. Return `201 { letter }` with the same joined display fields as the list.
6. Phase 2: send a push to the recipient's tokens; drop `DeviceNotRegistered` tokens.

The sender address is used only for authentication; it is not stored with the letter.

**Rate limits.** Reuse the existing per-IP limiter for the write key:

- mailbox create and send: the existing 20/hour/IP write budget,
- send: additionally 60/hour/recipient (enforced by the mailbox DO),
- push register: phase 2; add its own limit when push lands.

### 6.3 Push (phase 2)

- Worker env: `PUSH_ENABLED` (false in dev/smoke), `EXPO_PUSH_URL` (default
  `https://exp.host/--/api/v2/push/send`), optional `EXPO_ACCESS_TOKEN`.
- Payload is deliberately generic for privacy:
  `{ to, title: "Nova carta", body: "Você recebeu uma receita.", data: { letterId }, channelId: "letters" }`.
- The recipe title/sender are shown only inside the app.
- On `DeviceNotRegistered`, remove that token from the mailbox.

## 7. App design

### 7.1 Local schema (migration v3)

```sql
CREATE TABLE IF NOT EXISTS mailbox (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  address TEXT NOT NULL,
  secret TEXT NOT NULL,
  registered_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY NOT NULL,
  mailbox_address TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  seal_json TEXT,
  created_at INTEGER NOT NULL,
  last_sent_at INTEGER
);

CREATE TABLE IF NOT EXISTS letters (
  letter_id TEXT PRIMARY KEY NOT NULL,
  share_id TEXT NOT NULL,
  title TEXT,
  step_count INTEGER,
  sender_name TEXT,
  sender_seal TEXT,
  sent_at INTEGER NOT NULL,
  read_at INTEGER,          -- local source of truth; never sent to the server
  available INTEGER NOT NULL DEFAULT 1,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_letters_sent_at ON letters(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_letters_read_at ON letters(read_at);
```

`letters` is a cache of the server list plus the local read state. On mailbox focus:

1. `GET /letters` (newest first, `before`/`limit`; default 50, max 100).
2. Upsert by `letter_id`, update display fields and `available`; keep the last known
   display fields when an unavailable letter carries none.
3. Remove local letters absent from the server response **only after a complete fetch**
   (`syncLetters(..., { complete: true })`); a partial page must never prune.
4. Unread count = `COUNT(*) WHERE read_at IS NULL`.

`mailbox` is a singleton. If it is missing, the app registers lazily on the first mailbox
action (open tab, add contact, or send), not on launch.

### 7.2 Modules

- `src/lib/mailbox.ts` — pure: address/secret format, letter normalization, unread count,
  contact validation, backup identity rules.
- `src/lib/mailboxApi.ts` — HTTP calls (register, profile, list, send, remove, push token).
- `src/db/mailboxRepository.ts` — SQL for `mailbox`, `contacts`, `letters`.
- `src/lib/newMailboxId.ts` — CSPRNG address + secret; **no `Math.random` fallback**.

### 7.3 Navigation change (D6)

The app moves from **Receitas / Lixeira / Ajustes** to **Receitas / Cartas / Ajustes**:

- `FolderTabs` becomes **compact and left-aligned**: remove `flex: 1` from `tabHit`, use
  `flex: 0 0 auto` with `minWidth: 76–80` and comfortable horizontal padding, keep the
  44–48 dp hit height. The remaining row space stays empty.
- `FolderTabKey` becomes `'recipes' | 'mailbox' | 'settings'`.
- Tab colours: Receitas `oliveTab`, Cartas `mauveTab`, Ajustes `tanTab`.
- `Cartas` carries the unread badge. The `mailboxCount` prop replaces `trashCount` on
  `FolderTabs`.
- **Lixeira moves into Ajustes** as a row with the trash count badge. The Trash screen is a
  pushed screen with a back header ("Lixeira") and **no folder tabs**.
- The Trash route can stay at `/trash`; only the tab entry disappears.
- `index.tsx`, `mailbox.tsx` and `settings.tsx` load the unread count on focus and pass it
  to `FolderTabs`; `settings.tsx` also loads `countTrashed()` for the Lixeira row.
- The active-tab raised state must stay obvious on every tab (the mockup's Início frame is
  slightly subtle; verify in the build).

### 7.4 Screens and flows

**Cartas tab (mailbox list)**

- Header: **Caixa de entrada**.
- Row: sender seal (larger than the old 28 dp list seal; designer to finalize, roughly
  40–44 dp), sender name, recipe title, step count, relative sent time, gold dot when
  unread. Unavailable letters show "Carta indisponível."
- Tap: mark read locally (optimistic) → `/r/<shareId>?letter=<letterId>&from=mailbox`.
- Long-press: **Marcar como lida / não lida**, **Remover carta**.
- Pull-to-refresh; offline shows cached letters + a "Sem conexão" note.
- Empty: "Nenhuma carta ainda. Compartilhe uma receita com um contato."

**Send flow (recipe view)**

- Tapping **Enviar** opens an `ActionSheet`:
  - **Enviar para um contato** (primary) → recipient picker (seal + name).
  - **Compartilhar link** (secondary) → existing system share sheet.
- If there are no contacts: "Adicione um contato em Cartas → Contatos." with a shortcut.
- On contact select:
  1. Ensure a mailbox exists (register if not).
  2. Publish or re-publish the share exactly as today (`createShare` / `updateShare`).
  3. `POST /api/mailboxes/<address>/letters` with `{ shareId, senderAddress }`.
  4. Snackbar: "Carta enviada para <name>."
- The existing link-only share path remains unchanged.

**Letter view**

- Reuse `app/r/[id].tsx`; add optional `letter` and `from` params.
- On mount with `letter`: mark read locally (best effort).
- `Salvar` → save the independent copy, navigate to the recipe; the letter stays.
- `Descartar` → return to the mailbox (because `from=mailbox`); the letter stays until
  explicitly removed.
- Already imported / own recipe / newer copy states are unchanged.

**Contatos**

- Reached from the Cartas header or Settings.
- Top card: **Seu endereço** with copy and share actions.
- **Adicionar contato**: paste address → resolve profile → confirm name/seal → save.
- Row: seal, name, address, last sent; long-press: edit name, remove.

**Settings**

- Row **Caixa de entrada** → address screen.
- Row **Lixeira** with the trash count → `/trash`.
- Phase 2: **Notificações** toggle (permission state + "Abrir ajustes" when denied).

**Trash**

- Pushed screen with a back header, no tabs. Behaviour unchanged otherwise.

### 7.5 Notifications (phase 2)

- Add `expo-notifications` + `expo-device`; configure an Android channel **Cartas**.
- Ask for permission the first time the mailbox is opened, not on launch.
- On permission: `getExpoPushTokenAsync({ projectId })` → `PUT /api/mailboxes/:address/push`.
- Re-register on token refresh.
- Tap: `router.push('/r/<shareId>?letter=<letterId>&from=mailbox')`. The share id is in the
  local letter cache, so the push payload only needs `letterId`.
- Cold start: `getLastNotificationResponseAsync()` in `_layout.tsx` after the router is ready.
- Badge: `setBadgeCountAsync(unreadCount)` on mailbox refresh.
- Permission denied: the mailbox still works; show a Settings hint.
- **Build setup:** FCM requires `google-services.json` / EAS FCM credentials. The project
  currently has no push dependencies or FCM config.

## 8. Security and privacy (P1)

The server stores:

- mailbox metadata: address, display name, seal, secret **hash**, push tokens;
- letters: `{ letterId, shareId, sentAt }` only.

The server does **not** store the sender address, title, step count, sender name/seal or
read state with the letter. It can read the share at list time (as it can today), so the
recipe content is not protected from the server. Read state never leaves the phone.

- Addresses are unguessable (31¹² ≈ 7.9×10¹⁷); the secret is a separate read token.
- Sending requires the app write key **and** the sender's mailbox secret, so a leaked app
  key alone cannot spoof a sender address.
- Reading requires the recipient's secret; the public profile exposes only name/seal.
- Rate limits + the per-mailbox cap mitigate abuse. There is no server-side block list.
- Push payloads are generic; the recipe title stays in the app.
- The backup contains the mailbox secret, so a backup grants inbox access. Restore it only
  when the local `mailbox` table is empty; never overwrite an existing identity.
- No end-to-end encryption. Letters are unlisted metadata, like share links; document this
  in the app's about text.

### 8.1 Spam, plainly

To send a letter, someone needs your **mailbox address**. It is 12 random characters, not
derived from your name, and you only give it to people you trust — like a phone number. A
stranger cannot guess it. The server cannot block a sender in P1 because it deliberately
does not record who sent what; if someone you gave the address to becomes a problem, you can
remove the letter and, if needed, generate a new address and give it to your contacts
(phase 3). For a two-person notebook this is a non-issue. If a block button ever matters,
storing the sender address with the letter is the small privacy trade-off to revisit.

## 9. Edge cases

| Case | Behaviour |
|---|---|
| Recipient has no app | Sender uses **Compartilhar link**; the existing web page covers it |
| Wrong address | Letter goes to whoever owns it; confirm name/seal before sending |
| Unwanted sender | No server block; remove the letter, or rotate the address (phase 3) |
| Sender deletes the recipe locally | The share stays live; the letter still opens |
| Share revoked | Letter remains; opening shows unavailable; list marks `available: false` |
| Duplicate send / network retry | `X-Idempotency-Key` returns the same letter |
| Mailbox full (500) | `409 mailbox_full`; recipient removes letters |
| Offline send | Publish/letter fail cleanly with retry; no half-letter |
| Offline open | Cached list; opening needs network unless the recipe is already local |
| Reinstall | Restore the backup to recover address/secret; letters refetch; read state from backup |
| Backup imported on a fresh install | Adopts the mailbox identity (expected; backups are sensitive) |
| Backup imported with an existing mailbox | Keep the local identity; report "mailbox already set" |
| Two devices, same mailbox | Read state is per-device; up to 3 push tokens |
| Notification permission denied | No push; badge still updates on app open |
| Push token invalid | Removed from the mailbox; no retry loop |

## 10. Backup and migration

- Migrations are additive: v3 adds `mailbox`, `contacts`, `letters`.
- Backup zip gains optional entries (format stays v1, unknown entries are ignored by
  `parseIndex`):
  - `profile.json` → `{ displayName, seal, mailbox: { address, secret } | null }`
  - `mailbox-state.json` → `{ readLetterIds: string[] }` (preserves read state)
  - `contacts.json` → contact rows (no secrets)
- Import rules:
  - recipes: unchanged (local wins, missing bodies reported);
  - profile/mailbox: restore only when the local `mailbox` table is empty;
  - contacts: merge by address; local wins;
  - read state: merge the ids into `letters.read_at` after the mailbox refetch.
- Old app versions ignore the new entries and routes.
- Existing share links and the `r/[id]` page are unchanged.

## 11. Delivery phases

### Phase 1 — Mailbox core (recommended first)

- Server: `Mailbox` DO, mailbox/letter routes, rate limits, smoke tests.
- App: identity, contacts, Cartas tab, the new three-tab navigation, Lixeira in Ajustes,
  send-to-contact, read/remove, backup identity + read state.
- No push, no FCM, no new notification permissions.

### Phase 2 — Notifications

- `expo-notifications` + FCM setup, permission flow, token registration, server push,
  tap deep link, badge count.
- Device testing: permission, delivery, cold start, tap routing, token refresh.

### Phase 3 — Polish

- Address rotation, multi-recipient send, QR address exchange, offline outbox,
  retention/expiry, "mark all read", local block by sender address (if the trade-off is
  accepted).

## 12. Effort estimate

- Phase 1: ~4–6 focused days (server DO + routes, app schema/screens, navigation change,
  tests).
- Phase 2: ~2–3 days plus FCM/EAS setup and device testing.
- Total: ~1.5–2 weeks. The notification path is the main schedule risk.

## 13. Open questions

1. **Letter retention:** keep until removed, or auto-expire (e.g. 180 days)?
2. **Discard semantics:** does **Descartar** on a letter also remove it from the mailbox,
   or only return to the list? Recommendation: return to the list; removal is explicit.
3. **Multi-recipient send** in v1 or later? Recommendation: later.
4. **Address rotation UI** in phase 3: generate a new address and tell contacts; keep old
   letters readable locally?
5. **Exact tab dimensions:** the designer's note suggests `minWidth: 76–80`, 16 dp padding,
   left-aligned; confirm against 360 dp and 200% font scale.

## 14. Appendix — privacy options considered

| Option | Server stores | Privacy gain | Verdict |
|---|---|---|---|
| P0 | recipient, sender, title, steps, `readAt`, blocks | baseline | rejected: unnecessary metadata |
| **P1** | recipient + `{letterId, shareId, sentAt}`; read local; no blocks; sender not stored | hides read state and at-rest sender graph | **chosen** |
| P2b | ciphertext + recipient | little: metadata re-derivable from the readable share + public profile | rejected: encryption theater |
| P2 | ciphertext + recipient only | real end-to-end privacy | later: breaks web fallback, WhatsApp preview, link forwarding, dedupe/update |
| P2c | P2 + signatures | only with out-of-band key pinning | rejected |

**If P2 is ever built:** use `@noble/curves` (X25519/Ed25519), `@noble/ciphers`
(XChaCha20-Poly1305), `@noble/hashes` (HKDF/SHA-256) and `expo-crypto` for entropy
(`Crypto.getRandomValues`, not `getRandomBytes`). Pure JS, Hermes-safe, Node-testable; do
not use libsodium native bindings. Derive keys from the existing secret; keep the address
stable.

## 15. Changes to existing code/docs when implemented

- `app/src/components/FolderTabs.tsx`: `FolderTabKey` → `'recipes' | 'mailbox' | 'settings'`;
  remove `trashCount`; add `mailboxCount`; compact left-aligned `tabHit`; new tab list.
- `app/src/app/(tabs)/trash.tsx`: remove `FolderTabs`; add a back header.
- `app/src/app/(tabs)/settings.tsx`: add the **Lixeira** row with the trash count; keep the
  mailbox unread count for the Cartas badge.
- `app/src/app/(tabs)/index.tsx`: load the unread count and pass `mailboxCount`.
- `app/src/app/(tabs)/_layout.tsx` / `app/src/app/_layout.tsx`: register `mailbox` and
  `mailbox/contacts`; keep `/trash`.
- `app/src/app/recipe/[id].tsx`: add the send-to-contact action sheet.
- `app/src/app/r/[id].tsx`: accept `letter` / `from`; mark read locally.
- `DESIGN.md` §4/§5.1/§5.6/§5.7: compact left-aligned tabs, Cartas slot, Lixeira in Ajustes.
- `SPEC.md` §6.1/§6.6/§6.7: the new tab set and Lixeira placement.
- `AGENTS.md`: update the security model (mailbox metadata, P1).
- `PLAN.md`: add the feature and phases.
