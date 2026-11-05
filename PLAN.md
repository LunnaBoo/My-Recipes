# PLAN.md

Remaining work and release order. `SPEC.md` defines behaviour; this file tracks what is
actually built and what comes next.

Last updated: 2026-11-05

## Shipped

**Infrastructure**
- Worker on `r.lunna.boo`: `POST/GET/PUT/DELETE /api/recipes/:id`, `/r/:id` share page,
  `/` install page, `/.well-known/assetlinks.json`, `/app/latest.apk`, `/app/version.json`,
  `/assets/page.js`, `robots.txt`. 111 smoke assertions passing.
- KV storage, HTTPS-only redirect, rate caps in code, real keystore fingerprint published.
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

## Next releases

### v2 — shipped (versionCode 2)
Released 2026-11-05 as `v1.1.0`.
- [x] Bump `versionCode` to 2, `version` to 1.1.0.
- [x] EAS preview build; verify signer fingerprint before publishing.
- [x] GitHub Release with asset `myrecipes.apk`.
- [x] Point `APK_URL` at `releases/latest/download/myrecipes.apk`; set `VERSION_JSON`
      (versionCode 2, size, notes); deploy; verify `/app/latest.apk` and `/app/version.json`.
- [x] Manual install on both phones (last manual install — updater takes over after this).

### v3 — features (versionCode 3)
- [ ] **Backup export/import** — zip with `recipe-index.json` + `recipes/*.md`; import merges by
      id and reports conflicts. Needed before a third person installs.
- [ ] **Trash screen** — list with "expira em N dias", restore, delete forever, empty state.
- [ ] **Seals** — `Seu selo` picker with six sigils + photo; store in `profile`; send
      `senderSeal` in the share payload; Worker validation + storage; render on the web page
      and in the import letter; fall back to the default star.
- [ ] Editor toolbar (bold, italic, heading, list, checkbox, rule) + Editar/Pré-visualizar toggle.

### v4 — polish (versionCode 4)
- [ ] Custom launcher icon + splash (currently Expo template art).
- [ ] Drop x86 ABIs to roughly halve the 100 MB APK.
- [ ] Cloudflare edge rate-limit rule on `POST /api/recipes` (spec: 20 writes/hour/IP).
- [ ] `og:image` static card for link previews.
- [ ] Serve the APK from the Worker/R2 instead of redirecting to GitHub, if Releases ever
      becomes a constraint.

## Verification debt

These have never run on a device and need a phone pass:

- [ ] App Links: does `https://r.lunna.boo/r/<id>` open the app? If not, does the page's
      "Abrir no app" work?
- [ ] Updater: download progress, installer handoff, "install unknown apps" recovery.
- [ ] Parchment layout at 360dp and at 200% font scale.
- [ ] ActionSheet/ConfirmDialog stacking and dismissal.
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
