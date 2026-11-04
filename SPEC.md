# My Recipes — v1 Spec

A private, two-person recipe notebook for Android: markdown notes, local-first, share a
recipe as a short link that opens the app on the other phone with **Salvar / Descartar** —
or, if the app isn't installed, shows the recipe as a normal web page.

Status: draft, pre-implementation.

Locked decisions:
- Android-only APK (sideload), no Play Store, no iOS.
- One-way sharing: sender → recipient, recipient gets an independent copy.
- Short links backed by a single Cloudflare Worker; text-only recipes.
- No photos, ever, in v1 or after (deliberate: keeps links short and the app small).
- **No tags in v1.** No chip row, no tag field, no tag payload. Search, pinned, and recents
  carry organization at this scale; tags can return later as an additive field.
- **Sender seals:** each person picks one of six built-in ink sigils (cat, moon, sun, star,
  mushroom, owl) or uploads a photo. The seal travels with every recipe they share.
- No revocation UI in v1; revoke via `curl`/`wrangler` if ever needed.
- Share preview card: title = recipe name, subtitle = "N passos".
- App name: **My Recipes**. UI language: **Português (pt-BR)**.
- WhatsApp-style `*bold*` is converted to Markdown on paste; stored notes are CommonMark.
- v1 includes paste-import for existing WhatsApp recipes, and a 30-day trash.
- Domain: `lunna.boo` (Cloudflare Registrar, already on Cloudflare DNS). Share host `r.lunna.boo`.

---

## 1. Goals / non-goals

### v1 goals
- Write and edit recipes in Markdown with a live preview.
- Paste an existing WhatsApp message and get a titled recipe with steps counted.
- Find them fast: full-text search, pinned recipes, recent list.
- Share a recipe as a **short URL** (~12 chars) that opens the app on the recipient's phone,
  with a WhatsApp preview card showing the recipe name and step count.
- Recipient sees a preview and chooses **Salvar** (independent copy) or **Descartar**.
- **No dead links:** if the app isn't installed (or App Links fails), the same URL renders the
  recipe as a readable web page with an install link and a "copy recipe" button.
- Never lose data: trash with restore, export/import backup, survive app reinstall.
- Ship as a signed APK; updates are a link, not a store.

### v1 non-goals
- No accounts, no login screen, no sync, no collaborative editing.
- No photos or image attachments (any version).
- No Play Store, no iOS, no web app for editing.
- No collections/folders, no meal planning, no shopping list.
- No tags, no tag chips, no tag filter.
- No multi-user sharing beyond "anyone with the link can read it".
- No server-side search or server-side authoring.
- No automatic redirect from the web page into the app (see §5.2).

### v2 candidates (design for, don't build)
- Cook mode: step-by-step, big text, screen stays on, ingredient checklist.
- Two-way send (she shares back) — nearly free if the format is shared.
- Serving scaler, ingredient parsing.
- "Last opened" stats on shares.
- English UI (string table already isolated).

---

## 2. Architecture at a glance

```
Android app (Expo / RN, TS)                Cloudflare Worker (one zone)
┌──────────────────────────┐               ┌───────────────────────────────┐
│ SQLite index + FTS5      │  POST /api   │ /api/recipes   write (secret) │
│ .md files (source truth) │ ───────────► │ /api/recipes/:id  read JSON   │
│ trash (deleted_at)       │              │ /r/:id         page + OG tags │
│ export .zip              │ ◄─────────── │ /.well-known/assetlinks.json  │
└──────────────────────────┘   GET /api   │ /app/latest.apk, version.json │
                                          │ KV: recipe json, counters     │
                                          └───────────────────────────────┘
```

Why a Worker instead of a static host:
- App Links require `https://<host>/.well-known/assetlinks.json` at the **host root**.
  A Worker route serves that from the same zone; a subpath static host cannot.
- Short links (`/r/abc123`) need server state; KV is enough.
- The same deploy serves the APK and `version.json`, so updates need no extra service.
- The `/r/:id` page is the web fallback, so one URL covers both audiences.

### 2.1 One URL, two behaviors (no redirect)

There is no redirect chain and no user-agent sniffing. The OS routes the URL:

| State | What the user sees |
|---|---|
| App installed, App Links verified | The app opens directly; the browser is never involved |
| App installed, verification failed | Browser page + **"Abrir no app"** button (intent://) |
| App not installed | Browser page with the full recipe, install link, and copy button |
| App installed after clicking | The old link now opens the app; nothing goes stale |
| Link inside WhatsApp | Same URL; WhatsApp may open its in-app browser first, where the page's button covers it |

Rationale for *not* auto-redirecting from the page: a JS redirect fires on every tap that
reaches the browser (including WhatsApp's in-app browser and preview prefetches), causing a
visible flash and, on some devices, a loop. App Links already handle the installed case natively
and earlier than any page code could.

---

## 3. Domain status (confirmed)

- `lunna.boo` is registered at **Cloudflare Registrar**, registered 2026-05-07, expires
  **2027-05-07**, status `clientTransferProhibited` (normal).
- Nameservers are already Cloudflare's (`reese.ns.cloudflare.com`, `sureena.ns.cloudflare.com`)
  — **no registrar migration needed**.
- `.boo` is HSTS-preloaded, so HTTPS is mandatory at every level. No plain-HTTP fallback exists;
  a broken TLS config takes the links down entirely.
- Renewal: keep auto-renew on. Lapse kills every shared link and breaks App Links verification.

Remaining setup, all in one place:
1. Log in to `dash.cloudflare.com` (the account that owns the domain).
2. `wrangler login`, create the KV namespace, attach `r.lunna.boo` as a Worker custom domain
   (the proxied DNS record is created automatically).
3. Deploy; verify `/`, `/r/<id>`, and `/.well-known/assetlinks.json`.

---

## 4. Data model

### 4.1 Local (device)

`recipes` (SQLite, index only — files are the source of truth)

| field | type | notes |
|---|---|---|
| id | TEXT PK | UUIDv4, client-generated |
| title | TEXT | required, 1–120 chars |
| file_path | TEXT | `recipes/<id>.md` |
| step_count | INTEGER | derived from body, cached |
| created_at | INTEGER | epoch ms |
| updated_at | INTEGER | epoch ms |
| deleted_at | INTEGER NULL | non-null = in trash |
| source_share_id | TEXT NULL | set when imported |
| source_name | TEXT NULL | sender display name |
| source_seal | TEXT NULL | sender seal JSON, as received |
| imported_at | INTEGER NULL | |
| content_hash | TEXT | sha256 of body, for dedupe |
| pinned | INTEGER | 0/1 |

`profile` (single row): `display_name` and `seal_json` — the identity you share.

`shares` (which recipes have been published)

| field | type | notes |
|---|---|---|
| share_id | TEXT PK | server id |
| recipe_id | TEXT | FK |
| published_at | INTEGER | |
| revoked_at | INTEGER NULL | |

On disk:
```
files/recipes/<uuid>.md          # markdown body only, no frontmatter
files/backups/export-<ts>.zip    # manual export
```

Title lives in SQLite, not in the file, so the body stays pure markdown. The editor shows a
title field above the body; on import, a leading title line is lifted into the title field.

**Step counting** (used for the preview card and cards): number of lines matching
`^\s*\d+[.)]\s`; if zero, number of lines matching `^\s*[-*]\s`. Cached in `step_count`,
recomputed on save. The feijão example yields 12.

**Trash:** `DELETE` sets `deleted_at`; the trash screen lists items with "expira em N dias",
offers restore and permanent delete, and a purge job removes anything older than 30 days on
app launch. Backups exclude trash. Search and lists filter `deleted_at IS NULL`.

### 4.2 Server (KV)

Key `r:<shareId>` → JSON:

```json
{
  "id": "f8k2m9x1q4",
  "v": 1,
  "title": "GUIA: COMO PREPARAR FEIJÃO",
  "body": "1. Coloque 1 batata grande...\n12. Seja feliz",
  "stepCount": 12,
  "sender": "Lucas",
  "senderSeal": { "kind": "sigil", "id": "cat" },
  "createdAt": 1762300000000
}
```

Constraints: `body` ≤ 64 KB, `title` ≤ 120 chars, total value ≤ 128 KB
(self-imposed; KV's hard limit is 25 MB). No TTL — shares persist until revoked.

`shareId`: 12 chars from a base32 alphabet with no `0/O/1/I`, ~10^18 space — unguessable in
practice, short enough to type.

### 4.3 Sender seals

A seal is a per-person mark shown on every recipe that person shares. Two shapes, both carried
inside the share payload:

```json
{ "kind": "sigil", "id": "cat" }
```

```json
{ "kind": "image", "mime": "image/jpeg", "data": "<base64>" }
```

- **Sigils** are one of six bundled ids: `cat`, `moon`, `sun`, `star`, `mushroom`, `owl`.
  Rendered from local SVG assets, so they add nothing to the wire.
- **Images** are chosen once in Settings, cropped square, and re-encoded by the app to
  256×256 JPEG (quality ~0.8, target ≤ 32 KB). Re-encoding strips EXIF, so location data
  never leaves the phone.
- Server validation: `kind` must be `sigil` or `image`; sigil ids must be in the allowlist;
  `mime` must be `image/jpeg` or `image/png`; base64 must decode to ≤ 32 KB; the bytes must
  match the declared magic number. **SVG, GIF, and WebP are rejected.** The server never echoes
  raw input — it rebuilds the data URI from the validated MIME and bytes.
- Rendering: the seal sits inside the wax rim. An unknown sigil id or a missing seal falls back
  to the default seal. A seal is decoration; nothing depends on it for meaning.

---

## 5. Server API and the web page

All JSON. Write auth: `X-App-Key: <secret>` (one shared key compiled into the APK).
Deterrent, not real security — accepted, since the worst case is KV spam.

| Method | Path | Auth | Behavior |
|---|---|---|---|
| POST | `/api/recipes` | key | validate, compute `stepCount`, generate `shareId`, store, return `{id, url}` |
| GET | `/api/recipes/:id` | none | JSON payload; `404` if missing, `410` if revoked |
| GET | `/r/:id` | none | the HTML page (below) |
| DELETE | `/api/recipes/:id` | key | delete the KV value (revoke) |
| GET | `/.well-known/assetlinks.json` | none | static, from config |
| GET | `/app/version.json` | none | `{versionCode, versionName, url, notes, sha256}` |
| GET | `/app/latest.apk` | none | the APK |
| GET | `/` | none | install page (QR deferred until an APK exists) |

Behavior details:
- `POST` is idempotent per client attempt via optional `X-Idempotency-Key`; a retried share
  returns the existing id instead of creating a duplicate.
- Rate limit: one Cloudflare rate-limiting rule on `POST /api/recipes` (20 writes/hour/IP).
  Enforced at the edge, not in code — KV counters are eventually consistent and would lie.
- `GET /r/:id` sets `X-Robots-Tag: noindex, nofollow`; `/robots.txt` disallows everything.
- Headers: `Cache-Control: private, max-age=300` on HTML, `no-store` on JSON.
- Errors: `{error: "not_found" | "revoked" | "too_large" | "unauthorized"}`.

### 5.1 `/r/:id` page — the WhatsApp preview

1. Meta tags:
   - `<title>` and `og:title` → **recipe name**
   - `og:description` → **"12 passos · por Lucas"** (drop either half if unknown)
   - `og:site_name` → "My Recipes", `og:type` → "article", `og:url` → canonical share URL
   - `twitter:card` → "summary"
   - `og:image` → static branded card served by the Worker — **deferred**; the card
     renders title + description only until the asset exists
   - `<meta name="robots" content="noindex,nofollow">`
2. Server-rendered HTML, readable on mobile, **no JavaScript required for the content**.
3. Revoked/missing: "Esta receita não está mais disponível", HTTP 404/410.

WhatsApp caches previews aggressively; keep the page stable and never change share URLs.

### 5.2 `/r/:id` page — the no-app experience

Order of the page, top to bottom:

1. Sender seal, title, "12 passos · por Lucas" (seal as inline SVG or a data-URI image).
2. Rendered markdown, full recipe (not a teaser — this is the same content the app would show).
3. **Copiar receita** — copies WhatsApp-flavored text (`*bold*`, numbered lines). Works with a
   JS clipboard call; without JS the text is still selectable.
4. **Abrir no app** — `intent://r.lunna.boo/<id>#Intent;scheme=https;package=<pkg>;
   S.browser_fallback_url=<current url>;end`, with `myrecipes://` as a second attempt. Hidden
   on non-Android user agents.
5. **Baixar o app (APK)** — with three screenshots and numbered steps covering "allow install
   from this source" and the Play Protect "install anyway" warning.
6. Tiny footer: who sent it, when, and what the app is.

No automatic redirect to the app (§2.1). No login, no paywall, no cookie banner.

---

## 6. Screens and flows

UI strings live in `src/i18n/pt-BR.ts`; no hardcoded copy in components (keeps English open for
v2). Dates and plurals via `Intl` with `pt-BR`.

### 6.1 Recipe list (home)
- Search bar (title + body, debounced, SQLite FTS5).
- Filter row: **Todas** / **Fixadas** — two segments, no tag chips.
- Cards: title, first body line, "N passos", pin indicator; long-press → share/delete.
- FAB opens two actions: **Nova receita** and **Colar receita**.
- Header menu: Lixeira, Ajustes.
- Empty state: "Nenhuma receita ainda. Cole sua primeira."

### 6.2 Recipe view
- Rendered markdown, scrollable, generous type (this is read while cooking).
- Top bar: Editar, Compartilhar, Copiar texto, Mais (pin, excluir).
- Imported copies show: "Importada de <sender> em <date>".
- **Compartilhar** → publish (reuse `share_id` if present) → share sheet with:
  `GUIA: COMO PREPARAR FEIJÃO · 12 passos\nhttps://r.lunna.boo/f8k2m9x1q4`
- **Copiar texto** → WhatsApp-flavored text (`*bold*`, numbered lines).
- **Excluir** → moves to trash with an "Desfazer" snackbar.

### 6.3 Editor
- Title field and markdown body field only.
- Toolbar: bold, italic, heading, list, checkbox, divider.
- Toggle: Editar / Pré-visualizar.
- Autosave on blur + explicit Salvar; draft survives process death.
- Validation: non-empty title, body ≤ 64 KB, warn on unsaved changes.

### 6.4 Paste-import ("Colar receita")

The fastest path from an existing WhatsApp message to a saved recipe.

Input: one big paste field, plus a live parsed preview (title, step count, first lines).
Parsing rules:

| Input | Result |
|---|---|
| First non-empty line, stripped of `*`, `_`, `#`, and surrounding `--`/`—`, ≤120 chars | becomes the title and is removed from the body |
| First non-empty line longer than 120 chars | title = first 120 chars; body keeps the line |
| Remaining text | body, verbatim |
| `*text*` (balanced, no inner `*`) | → `**text**` |
| `~text~` | → `~~text~~` |
| `_text_`, numbered lists, bullets, quotes | unchanged (same syntax in both dialects) |

Example:

```
*-- GUIA: COMO PREPARAR FEIJÃO --*   →  title: GUIA: COMO PREPARAR FEIJÃO
1. Coloque 1 batata grande...        →  body:
5. ... *(MENOS O SAL)* ...                1. Coloque 1 batata grande...
12. Seja feliz                            5. ... **(MENOS O SAL)** ...
                                          12. Seja feliz
                                     →  step_count: 12
```

Buttons: **Criar receita** / **Cancelar**. The original paste is discarded after creation; the
normalized markdown is what gets stored.

### 6.5 Import preview (shared link)
- Entry points: App Link intent (`/r/:id`), "Abrir no app" on the page, or pasting a link in
  the import screen.
- Shows: the sender's seal, title, "12 passos", rendered body, "enviado por <sender>".
- Buttons: **Salvar** (primary) / **Descartar** (secondary). No editing before saving.
- After Salvar: "Receita salva" + navigate to the recipe.
- Already imported (`source_share_id` match): "Você já tem esta receita" with **Ver receita**
  and, if the server hash differs, **Atualizar cópia** — never silently overwrite local edits;
  updating replaces the body and keeps the local id.
- Needs network. Offline: "Sem conexão — tentar de novo", link kept in the retry state.

### 6.6 Trash
- List of deleted recipes with "expira em N dias".
- Restore, or delete permanently (confirm).
- 30-day auto-purge on launch.

### 6.7 Settings
- Display name (used as `sender`).
- **Seu selo:** the six sigils in a grid (one selected) plus **Enviar imagem** (circle crop,
  re-encode to 256×256 JPEG). A live preview shows the seal as it will appear on shares.
- Export backup (zip) / Import backup.
- Check for updates → compares `version.json`, offers the APK link.
- App version, share-domain info, "Apagar tudo" (double confirm).
- No share management / revoke UI in v1.

---

## 7. Edge cases

| Case | Behavior |
|---|---|
| Recipient has no app | Page shows the full recipe, copy button, and APK install steps |
| App installed, App Links unverified | Browser page; "Abrir no app" still works |
| Link opened inside WhatsApp | In-app browser shows the page; the page's button opens the app |
| Link pasted manually | Import screen accepts a full URL or bare id |
| Recipe already imported | "Já tem esta receita" + Ver / Atualizar |
| Sender edits after sharing | Re-publish in place (same `share_id`); recipient sees the newer copy on next import |
| Sender deletes locally | Existing share keeps working; no automatic revoke |
| Share revoked | `410`; page says unavailable; import screen explains |
| Body over the limit | Block share with a clear message, offer "share as text" |
| Unknown seal id | Falls back to the default seal; the recipe still renders |
| Oversized or non-image seal | Rejected in Settings at save time; the last valid seal is kept |
| Seal photo on a slow connection | The letter renders immediately, the seal appears when the payload arrives |
| Offline share attempt | Fail cleanly with retry; never a half-published state |
| Offline link open | Page is cached by the browser only if previously visited; otherwise a network error |
| App reinstalled | Restore from backup zip; server shares unaffected |
| Same recipe shared twice | Reuse `share_id`; show "Link copiado" |
| Paste of a non-recipe message | Still imports (title + body); user can discard |
| Deleted by accident | Trash, 30 days, restore |

---

## 8. Security and privacy

- Shares are **unlisted, not private**: anyone with the link can read the recipe. Random 12-char
  ids make guessing impractical, but the link is a bearer token. Say so in the app's about text.
- No personal data on the server beyond an optional first name.
- No analytics, no third-party SDKs.
- Seals: sigils come from a fixed allowlist; uploaded seals are capped at 32 KB, magic-byte
  checked, and served with a server-chosen `Content-Type` plus `nosniff`. SVG is never accepted.
- The write key is compiled into the APK and extractable. Accepted: abuse risk is KV spam,
  mitigated by rate limiting and size caps. If it ever matters, add a per-device token.
- HTTPS only (HSTS-preloaded TLD); Cloudflare terminates TLS.
- Revocation deletes the KV value, so the link dies immediately.

---

## 9. Backup, updates, and data safety

- Export: zip containing `recipe-index.json` + `recipes/*.md` (trash excluded). Import merges by
  id and reports conflicts.
- Android auto-backup enabled (`allowBackup` + backup rules for the files dir).
- Update flow: check `version.json` on launch (max once/day) and in Settings. New version →
  dialog → browser download → Android installer. `REQUEST_INSTALL_PACKAGES` needed only if we
  download in-app; v1 hands off to the browser.
- Keystore: generated once, stored in a password manager + encrypted offline copy. Same key for
  every release; its SHA-256 must match `assetlinks.json`.

---

## 10. Build and signing plan

- Stack: Expo (React Native, TypeScript).
  - `expo-sqlite` (FTS5), `expo-file-system`, `expo-linking`, `expo-clipboard`,
    `expo-sharing`, `expo-document-picker`.
  - Markdown: a maintained RN renderer (validate at M1); editing is a plain `TextInput`.
- `app.json`: name "My Recipes", package id `com.lunnaboo.myrecipes`, intent filter for
  `https://r.lunna.boo` with `autoVerify`, custom scheme `myrecipes://` as fallback.
- Signing: `eas build -p android --profile preview` → APK. Use **local credentials** (our own
  keystore) rather than EAS-managed, so the fingerprint stays under our control and exportable.
- targetSdk current, minSdk 26 (Android 8+), monotonic `versionCode`.
- Distribution: direct APK link + QR on the Worker's `/` page.
- Optional later: `build.sh` that runs the EAS build and uploads `latest.apk` + `version.json`.

This machine has no JDK/Android SDK, so EAS cloud build is the low-friction path. Local native
builds stay possible later without changing the app.

---

## 11. Milestones

**M0 — Infrastructure**
Keystore generated and backed up → Worker skeleton deployed to `r.lunna.boo` → `/`,
`/r/<id>`, and `/.well-known` reachable → `assetlinks.json` filled with the real fingerprint.

**M1 — Local app (no sharing)**
List, editor, markdown preview, search, pinned, trash, paste-import, step count, seals,
export/import
backup. Signed APK on both phones for a week. Gate: does writing recipes here feel better than
WhatsApp?

**M2 — Sharing**
`POST/GET /api`, share sheet message, web page with OG tags + no-app experience, import preview
with Salvar/Descartar, dedupe, `410` handling.

**M3 — Polish**
App Links verification on real devices, update prompt, empty/error states, install page
screenshots, icon.

Rationale: M1 is usable on its own. If M2's deep links prove painful on her device, the app is
still worth keeping — and the web page means no link is ever wasted.

---

## 12. Open questions

1. Should "Salvar" keep the share back-link, enabling "Atualizar cópia" later? (Spec says yes
   via `source_share_id`.)
2. Should the share message include the recipe text too, or stay link-only? (Spec says link-only.)
3. Default seal when someone never picks one: a neutral wax seal, or the first sigil?
4. The recipient downloads the seal image when they open the link. Acceptable, or should a
   custom photo seal be opt-in per share?

