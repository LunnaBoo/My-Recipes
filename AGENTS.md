# AGENTS.md

Working notes for anyone (human or agent) touching this repository.

## What this is

A private recipe notebook for a handful of people. Android APK, sideloaded — no Play Store.
A Cloudflare Worker on `r.lunna.boo` provides short share links, a web fallback page,
mailbox delivery, and APK/version hosting. Recipes live on the phone; share links and
mailbox delivery metadata touch the server.

## Layout

```
app/        Expo (React Native, TypeScript) — the Android app
worker/     Cloudflare Worker (TypeScript) — share links, web page, APK hosting
design/     HTML mockups (parchment UI) — reference, not shipped
SPEC.md     product + technical spec (source of truth for behaviour)
DESIGN.md   visual system (palette, type, components, RN notes)
PLAN.md     remaining work and release order
MAILBOX.md  mailbox feature spec (P1 server, Cartas UI, phase 2 push)
```

## Commands

```bash
# app
cd app && npm run check      # tsc --noEmit
cd app && npm test           # node:test, pure logic only
cd app && npx expo config --type public

# worker
cd worker && npm run check
cd worker && npm run smoke   # starts local wrangler dev, 212 assertions
cd worker && npx wrangler deploy

# release
cd app && npx eas-cli build -p android --profile preview --non-interactive
```

There is no device or emulator here. Native behaviour (installer handoff, App Links,
gestures) can only be verified on a phone.

## Non-negotiable constraints

- **No tags.** Removed from v1 on purpose — no column, no chips, no payload field.
- **Seals are ids, never markup.** Built-in stamps only (`bee`, `cat`, `leaf`, `moon`,
  `mushroom`, `sea`). The art is WebP bundled in the app and inlined as a data URI on the web
  page; the payload carries just the id. Legacy ids (`sun`, `star`, `owl`) stay renderable for
  old recipes but are not selectable. Uploaded seals are JPEG/PNG, ≤32 KB, magic-byte checked.
  SVG is refused.
- **Same signing key forever.** `app/credentials/android-release.jks`. Losing it means every
  user must uninstall and lose local data. Never commit it; it is gitignored.
- **`versionCode` only goes up.** Android refuses downgrades, so a bad release is fixed by
  shipping a higher number.
- **Migrations are additive.** Never drop a column in a released schema.
- **Deep link is `https://r.lunna.boo/r/<id>`.** Intent filter uses `pathPrefix: "/r/"` so the
  install page still opens in a browser. `assetlinks.json` must match the keystore fingerprint.
- **Worker output is server-rendered and locked down:** CSP `default-src 'none'`,
  `script-src 'self'` (only `/assets/page.js`), no external fonts or images, every interpolation
  escaped, markdown pre-escaped so recipes can never inject HTML.
- **UI is pt-BR**, tokens only from `src/theme`, no new hex literals outside `app.json`.
- **One launcher icon, forever.** Do not add `activity-alias` icon switching. Themes change the
  in-app look only; the launcher icon is the app's fixed identity.
- **`theme` is a module-level constant today.** Do not add a second palette until it is refactored
  to a `ThemeProvider` + `useTheme()` — the SVGs read colours at module scope.

## Security model

- The write key is injected at build time via the EAS env var `EXPO_PUBLIC_APP_KEY`. It is not
  in the repo. Local dev reads `app/.env` (gitignored). It is still extractable from any APK —
  the real brakes are size caps, unguessable share ids, and the update signature check.
- `scripts/preflight.sh` blocks secrets. Enable in a fresh clone:
  `git config core.hooksPath scripts/git-hooks`.
- GitHub secret scanning + push protection are enabled on the repo.
- Share links are unlisted, not private: anyone with the URL can read the recipe.
- Mailbox (1.5.x): each install has an unguessable address + secret. The Worker stores only
  `{letterId, shareId, sentAt}` per letter (P1); read state stays on the phone and the sender
  address is not stored at rest. The secret is stored hashed.

## Conventions

- Strings in `src/i18n/pt-BR.ts`; no hardcoded copy in components.
- New screens inherit `ScreenFrame` (parchment shell). Sheets and dialogs use `ActionSheet`
  and `ConfirmDialog` — never `Alert.alert`, which renders a stock system dialog.
- Repository functions own SQL; screens never build SQL.
- Pure logic goes in `src/lib/*` with no RN imports so it can be unit tested in Node.
- Commit messages describe behaviour, not files.

## Release process

1. Bump `expo.android.versionCode` (and `version` for a meaningful release) in `app/app.json`.
2. Build the preview APK with EAS (queue can take 30–40 min).
3. Download the artifact; verify its signer matches `app/credentials/` before publishing.
4. Upload it to a GitHub Release with the stable asset name `myrecipes.apk`.
5. Update `APK_URL` and `VERSION_JSON` (versionCode, versionName, url, size, notes) in
   `worker/wrangler.jsonc`; `npx wrangler deploy`.
6. Verify `https://r.lunna.boo/app/latest.apk` redirects to the new asset and
   `/app/version.json` reports the new versionCode.
