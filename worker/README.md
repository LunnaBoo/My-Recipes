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

`wrangler dev` uses Miniflare with a local KV store — no login, no network calls
to Cloudflare. The KV id in `wrangler.jsonc` (`00000000000000000000000000000000`)
is only a local placeholder; replace it before deploying.

Type-check and run the end-to-end smoke test:

```bash
npm run check
npm run smoke
```

`npm run smoke` starts its own `wrangler dev` on `127.0.0.1:8787`, waits for it
to be ready, runs the HTTP assertions, prints a PASS/FAIL summary, and always
kills the server on exit. It supplies a placeholder `APK_URL` and
`VERSION_JSON.url` so the download paths are exercised end to end.

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

   The route is deliberately commented in the repository because `wrangler dev`
   does not need it and deploying it requires account/zone access. A plain
   `npx wrangler deploy` without the route still works on the workers.dev
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
  `default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'self'; base-uri 'none'; form-action 'none'`
  and `X-Robots-Tag: noindex, nofollow`.
- The share page has no redirects and no inline JavaScript; `/assets/page.js` is
  the only script and only implements the copy button.
- The API key is a deterrent, not authentication for sensitive data. Shares are
  unlisted bearer links: anyone with the URL can read the recipe.
