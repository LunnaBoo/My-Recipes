# PLAN.md

Remaining work and release order. `SPEC.md` defines behaviour; this file tracks what is
actually built and what comes next.

Last updated: 2026-11-06

## Shipped

**Infrastructure**
- Worker on `r.lunna.boo`: `POST/GET/PUT/DELETE /api/recipes/:id`, `/r/:id` share page,
  `/` install page, `/.well-known/assetlinks.json`, `/app/latest.apk`, `/app/version.json`,
  `/assets/page.js`, `robots.txt`. 212 smoke assertions passing.
- KV storage, HTTPS-only redirect, per-IP Durable Object write limit (20 writes/hour),
  hardened response headers (CSP `frame-ancestors`, `X-Frame-Options`, `Permissions-Policy`),
  real keystore fingerprint published.
- Domain confirmed on Cloudflare Registrar (auto-renew, expires 2027-05-07).

**App (v1 build, versionCode 1)**
- Parchment shell, folder tabs, home list with search + Todas/Fixadas, recipe view.
- Editor (plain), paste-import with WhatsApp → Markdown conversion, 30-day trash (data layer).
- Share via short link + system share sheet; import letter with Salvar/Descartar.
- Importer dedupe ("Você já tem esta receita" / "Esta receita é sua"), update-copy.
- In-app updater: manifest check, download with progress, installer handoff, permission recovery.
- Parchment `ActionSheet` and `ConfirmDialog` replacing all native alerts.
- Settings: display name, manual update check.

**Repository**
- Public at `github.com/LunnaBoo/My-Recipes`. Secret scanning + push protection enabled.
- `scripts/preflight.sh` runs on pre-push via `core.hooksPath`.

## Releases

### v2 — shipped (versionCode 2)
Released 2026-11-05 as `v1.1.0`.
- [x] Bump `versionCode` to 2, `version` to 1.1.0.
- [x] EAS preview build; verify signer fingerprint before publishing.
- [x] GitHub Release with asset `myrecipes.apk`.
- [x] Point `APK_URL` at `releases/latest/download/myrecipes.apk`; set `VERSION_JSON`
      (versionCode 2, size, notes); deploy; verify `/app/latest.apk` and `/app/version.json`.
- [x] Manual install on both phones (last manual install — updater takes over after this).

### v3 — unreleased UI fixes already committed
- [x] FAB plus drawn as SVG (was off-centre glyph).
- [x] Action sheet: drag handle and cancel row removed.
- [x] Corner ivy no longer cut by the search field (ivy scaled, 42px top inset).
- [ ] Visual pass on a device: the 42px inset changes every ScreenFrame screen.

### v3 — features (versionCode 3)
- [x] **Backup export/import** — zip with `recipe-index.json` + `recipes/*.md`; import merges by
      id and reports conflicts. Needed before a third person installs.
- [x] **Trash screen** — list with "expira em N dias", restore, delete forever, empty state.
- [x] **Seals** — six photographic wax stamps (`bee`, `cat`, `leaf`, `moon`, `mushroom`, `sea`)
      plus photo. The picker and photo re-encode store the seal in `profile`; shares send
      `senderSeal`; the Worker validates, stores, and renders it on the web page and in the
      import letter. Legacy `sun`/`star`/`owl` still render; fallback is `cat`.
- [x] Editor toolbar (bold, italic, heading, list, checkbox, rule) + Editar/Pré-visualizar toggle — `b71e5dd`.

### v4 — polish (versionCode 4)
Shipped across `1.3.0` and `1.4.0`; the unchecked items below move to a later build.
- [x] Custom launcher icon: black line-art on parchment, adaptive foreground + monochrome layer.
- [ ] Splash still uses the Expo template art.
- [x] Six bundled photographic wax stamps replacing the line-art sigils (WebP, alpha, real
      silhouettes); legacy sigils still render.
- [ ] Drop x86 ABIs to roughly halve the 100 MB APK.
- [x] Write rate limit: 20 writes/hour/IP via a per-IP Durable Object counter (SPEC §5).
- [ ] `og:image` static card for link previews.
- [ ] Serve the APK from the Worker/R2 instead of redirecting to GitHub, if Releases ever
      becomes a constraint.
- [ ] Script to regenerate `worker/src/seals.ts` and `worker/src/appIcon.ts` from the app art.
- [ ] Share import: log the underlying fetch failure and add a "Copiar link" fallback on the
      offline state.

### Themes — after v4, deliberately last
Decided 2026-11-05: two extra themes, built only after the v3/v4 work.

- [ ] Refactor `theme` from module-level imports to a `ThemeProvider` + `useTheme()`.
      Ornaments currently read `theme.colors.*` at module scope and must take colours
      from the provider instead.
- [ ] **Candlelit** — dimmed parchment, dark brown desk, brighter gold (DESIGN.md §8).
- [ ] **Second theme — concept TBD** (the user has a direction in mind; define it before building).
- [ ] Picker in Ajustes, persisted in `profile`, applied without a restart.

Decision: **the launcher icon never changes.** One icon, one identity. Theme affects the
in-app look only — no `activity-alias` icon switching, no app restart on theme change.

### v3 progress notes
- Worker seal support is **deployed**: `senderSeal` validated, stored, re-checked on read, rendered as a stamp, legacy sigil, or circular photo. 212 smoke assertions.
- App backup/import + trash shipped in `d4acf80` (55 tests).
- All v3 features are implemented and released as 1.2.0 (versionCode 3) on 2026-11-05.

## Verification debt

These have never run on a device and need a phone pass:

- [ ] App Links: does `https://r.lunna.boo/r/<id>` open the app? If not, does the page's
      "Abrir no app" work?
- [ ] Updater: download progress, installer handoff, "install unknown apps" recovery.
- [ ] Parchment layout at 360dp and 200% font scale, including the 42dp corner-ivy inset and the 16dp home side-ivy band.
- [ ] ActionSheet/ConfirmDialog stacking and dismissal.
- [ ] Seal stamps: picker grid, 28/56/108/110 dp silhouettes, and WebP bundling on a real device.
- [ ] Own-recipe cream card and home side-branch alignment at 360dp and 200% font scale.
- [ ] Android share page: three-action bar and APK download in Chrome and WhatsApp.
- [ ] Share-link import: one device showed "Sem conexão" while the API was healthy; capture logcat if it recurs.
- [ ] Launcher icon under the OEM adaptive mask (art at 62% of the 1024 canvas; reduce to 60% if clipped).
- [ ] Seal picker cells on wide screens (31% + aspect-ratio leaves a large empty tile at ≥430dp).
- [ ] Share sheet message format in WhatsApp.

## Open questions

1. Should the shared message include the recipe text as well as the link? Currently link-only.
2. Default seal for someone who never picks one — neutral wax seal or the first sigil?
3. Is a custom photo seal acceptable to download on link open, or should it be opt-in per share?
4. "N passos" line — should it also carry time or servings?

## Release log

| Version | versionCode | Date | Notes |
|---|---|---|---|
| 1.0.0 | 1 | 2026-11-04 | First APK: local recipes, sharing, import letter. |
| 1.1.0 | 2 | 2026-11-05 | Parchment menus/dialogs, dedupe fix, re-publish, updater. |
| 1.2.0 | 3 | 2026-11-05 | Seals, backup/import, trash, editor toolbar + preview, UI fixes. |
| 1.3.0 | 4 | 2026-11-06 | Wax stamp seals, custom launcher icon. |
| 1.3.1 | 5 | 2026-11-06 | Larger share-letter seal and Settings preview. |
| 1.4.0 | 6 | 2026-11-06 | Own-recipe card, home side branches, imported-recipe copy cleanup. |
