# My Recipes — Cloudflare Worker

Serves the short share links (`/r/:id`), the write/read API, Android App Links
(`/.well-known/assetlinks.json`), the APK redirect, and the pt-BR install page.

Everything here is local-first: no Cloudflare account is needed to run the code
or the smoke test.

## Requirements

- Node.js 22+
- npm

## Local development

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars   # optional; wrangler.jsonc has a dev key fallback
npm run dev                      # http://127.0.0.1:8787
```

`wrangler dev` uses Miniflare with local KV and Durable Object stores — no login,
no network calls to Cloudflare. The bindings in `wrangler.jsonc` are the real
production ones; local dev never touches them.

Type-check and run the end-to-end smoke test:

```bash
npm run check
npm run smoke
```

`npm run smoke` starts its own `wrangler dev` on `127.0.0.1:8787`, waits for it
to be ready, runs the HTTP assertions (212 of them, including the mailbox
suite), prints a PASS/FAIL summary, and always kills the server on exit. It
supplies a placeholder `APK_URL` and `VERSION_JSON.url` so the download paths
are exercised end to end.

## API quick reference

All bodies are JSON. Writes require `X-App-Key`.

```bash
KEY=dev-only-change-me
BASE=http://127.0.0.1:8787

# Create
curl -sS -X POST "$BASE/api/recipes" \
  -H "X-App-Key: $KEY" \
  -H "Content-Type: application/json" \
  --data-binary '{
    "title": "GUIA: COMO PREPARAR FEIJÃO",
    "body": "1. Coloque 1 batata grande.\n2. Cozinhe.\n3. Seja feliz.",
    "tags": ["feijao", "brasileiro"],
    "sender": "Lucas"
  }'

# Read
curl -sS "$BASE/api/recipes/<id>"

# Revoke (writes a 30-day tombstone, then 410)
curl -sS -X DELETE "$BASE/api/recipes/<id>" -H "X-App-Key: $KEY"
```

Optional `X-Idempotency-Key` makes a retried POST return the original id for 24
hours.

## Mailboxes (phase 1)

An in-app letter is delivered to a recipient's mailbox instead of (or in
addition to) a share link. Each mailbox is one Durable Object (`MAILBOXES`
binding, class `Mailbox`, migration `v2`), keyed by the 12-char address.

Auth is two-layered:

- `X-App-Key` — the existing shared write key, required to create a mailbox and
  to send a letter.
- `Authorization: Bearer <secret>` — the mailbox owner token (32 random bytes,
  hex). Required to read/update the recipient's own mailbox and, for a send, to
  prove ownership of the sender address.

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| POST | `/api/mailboxes` | app key | `{ address, secret, name, seal }`; 201 new, 200 same secret, 409 `address_taken` |
| GET | `/api/mailboxes/:address/profile` | none | `{ name, seal }`; 404 if missing |
| PUT | `/api/mailboxes/:address` | owner | update `{ name, seal }` |
| PUT | `/api/mailboxes/:address/push` | owner | `{ token, platform }`; replaces the same token, keeps 3 |
| GET | `/api/mailboxes/:address/letters?before=&limit=` | owner | `{ letters }`, newest first, 50 default / 100 max; `before` is a `sentAt` ms cursor |
| POST | `/api/mailboxes/:address/letters` | app key + sender owner | `{ shareId, senderAddress }` + `X-Idempotency-Key`; appends a letter |
| DELETE | `/api/mailboxes/:address/letters/:letterId` | owner | 204 |

There is deliberately **no** read-state endpoint and **no** blocks endpoint;
read state lives on the phone.

```bash
# Create a mailbox (address + secret are generated on the device)
curl -sS -X POST "$BASE/api/mailboxes" \
  -H "X-App-Key: $KEY" -H 'Content-Type: application/json' \
  --data-binary '{
    "address": "aaaaaaaaaaaa",
    "secret": "<64 hex chars>",
    "name": "Lucas",
    "seal": { "kind": "sigil", "id": "cat" }
  }'

# Send a letter to another mailbox
curl -sS -X POST "$BASE/api/mailboxes/bbbbbbbbbbbb/letters" \
  -H "X-App-Key: $KEY" \
  -H "Authorization: Bearer <sender secret>" \
  -H "X-Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' \
  --data-binary '{"shareId":"<id>","senderAddress":"aaaaaaaaaaaa"}'

# Read the inbox
curl -sS "$BASE/api/mailboxes/bbbbbbbbbbbb/letters" \
  -H "Authorization: Bearer <recipient secret>"
```

A send is rejected when the share is missing (`404 not_found`) or revoked
(`410 revoked`), when the recipient has 500 letters (`409 mailbox_full`), or
when the recipient already received 60 letters in the last hour
(`429 rate_limited`). A retry with the same `X-Idempotency-Key` returns the
letter created by the first attempt for 24 hours.

### Privacy at rest (P1)

A stored letter is exactly `{ id, shareId, sentAt }`. The mailbox object also
stores `{ name, seal, sha256(secret) }` and up to three push tokens. It does
**not** store the sender address, the recipe title/step count, the sender
name/seal or read state. The list/send responses join the display fields from
`r:<shareId>` at read time, so a missing or revoked share simply comes back as
`available: false`. This is metadata minimisation, not end-to-end encryption:
the recipe body is still readable in KV, exactly like a share link.

## Deploy runbook

1. Log in and install dependencies:

   ```bash
   cd worker
   npm install
   npx wrangler login
   ```

2. Create the KV namespace:

   ```bash
   npx wrangler kv namespace create RECIPES
   ```

   Copy the returned `id` into `kv_namespaces[0].id` in `wrangler.jsonc`.

3. Set the production write key. Either replace the placeholder `APP_KEY` in the
   `vars` block with a long random value, or remove that var and store it as a
   secret:

   ```bash
   npx wrangler secret put APP_KEY
   ```

   Use the same value in the Android app and in `X-App-Key: ...`.

4. Fill the remaining vars in `wrangler.jsonc`:

   - `ASSETLINKS_JSON` — the real Digital Asset Links array, as a single-line
     JSON string. It must include the SHA-256 fingerprint of the release
     keystore and package `com.lunnaboo.myrecipes`.
   - `APK_URL` — absolute HTTPS URL of the current APK. `/app/latest.apk`
     redirects there with a 302. If it is empty, the endpoint returns 404.
   - `VERSION_JSON` — `{"versionCode":1,"versionName":"1.0.0","url":"...","notes":""}`
   - `SITE_NAME` — display name, normally `My Recipes`.

5. Attach `r.lunna.boo` and deploy. Uncomment the `routes` block in
   `wrangler.jsonc`:

   ```jsonc
   "routes": [
     { "pattern": "r.lunna.boo", "custom_domain": true }
   ],
   ```

   Then deploy. The custom domain creates its proxied DNS record automatically
   because `lunna.boo` is already on this Cloudflare account.

   ```bash
   npx wrangler deploy
   ```

   The first deploy also applies the Durable Object migrations from
   `wrangler.jsonc` (`v1` RateLimiter, `v2` Mailbox). No extra dashboard step
   is needed for the write limit or the mailbox binding.

   The route is active for production; `wrangler dev` does not need it. A plain
   `npx wrangler deploy` without zone access still works on the workers.dev
   hostname for a first check.

6. Verify:

   ```bash
   BASE=https://r.lunna.boo

   curl -i "$BASE/robots.txt"
   curl -i "$BASE/.well-known/assetlinks.json"
   curl -i "$BASE/app/version.json"
   curl -i "$BASE/app/latest.apk"       # 302 (or 404 before APK_URL is set)
   curl -i "$BASE/"                     # pt-BR install page
   curl -i "$BASE/r/<id>"               # share page
   curl -sS "$BASE/api/recipes/<id>"    # JSON, 404/410 when appropriate
   ```

   Check that `https://r.lunna.boo/.well-known/assetlinks.json` is reachable at
   the host root and that its fingerprint matches the APK signing certificate.
   On a device, `adb shell pm get-app-links com.lunnaboo.myrecipes` should show
   `verified`.

## Files

```text
src/index.ts      fetch router, API, headers, routes
src/page.ts       share page, install page, error page, inline CSS
src/markdown.ts   safe markdown -> HTML and WhatsApp-flavored copy text
src/util.ts       ids, escaping, validation, step counting
src/rateLimiter.ts per-IP Durable Object: 20 writes/hour sliding window
src/mailbox.ts    per-mailbox Durable Object: meta, letters, push tokens
src/seals.ts      generated seal WebP data URIs (app/assets/seals/*.webp)
src/appIcon.ts    generated install-hero icon data URI
test/smoke.sh     local end-to-end test
```

`seals.ts` and `appIcon.ts` are generated modules. Rebuild them from the app
art whenever the stamps or launcher icon change; do not hand-edit the base64.

## Security notes

- Every interpolation is HTML-escaped. Markdown source is escaped **before**
  parsing, so a recipe cannot inject HTML or scripts.
- HTML responses send
  `default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  plus `X-Frame-Options: DENY`, `Permissions-Policy`, and
  `X-Robots-Tag: noindex, nofollow`.
- `POST /api/recipes` is limited to 20 writes/hour/IP by a per-IP Durable Object.
  Local requests without `CF-Connecting-IP` are not limited.
- Mailbox letters are metadata-minimised (P1): the server stores only
  `{ id, shareId, sentAt }` per letter plus `{ name, seal, sha256(secret) }` and
  push tokens per mailbox. Sending requires the app key **and** the sender's own
  secret; reading requires the recipient's secret. Read state never leaves the
  phone, and there is no server-side block list.
- A mailbox caps at 500 stored letters and 60 letters/hour/recipient; sending
  also consumes the shared 20 writes/hour/IP budget.
- `/app/latest.apk` only redirects to an `https:` `APK_URL`.
- The share page has no redirects and no inline JavaScript; `/assets/page.js` is
  the only script and only implements the copy button.
- The API key is a deterrent, not authentication for sensitive data. Shares are
  unlisted bearer links: anyone with the URL can read the recipe.
