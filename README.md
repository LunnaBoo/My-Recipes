# My Recipes

Private, two-person recipe notebook for Android. Markdown notes stored locally, shared as
short links that open the app — or render as a web page if the app isn't installed.

- Product and technical spec: [`SPEC.md`](./SPEC.md)
- Worker (short links, share page, APK hosting): [`worker/`](./worker)
- Android app: `app/` (Expo, not scaffolded yet)

Share host: `https://r.lunna.boo/<id>`

## Status

| Milestone | Scope | State |
|---|---|---|
| M0 | Worker, KV, assetlinks, deploy | in progress |
| M1 | Local app: list, editor, paste-import, search, trash, backup | not started |
| M2 | Share + import flow, web page | not started |
| M3 | Deep-link verification, updates, polish | not started |

## Security

- **No secrets in the repository.** The share API write key is injected at build time from the EAS
  environment variable `EXPO_PUBLIC_APP_KEY`; local development reads `app/.env` (gitignored).
  The signing keystore lives in `app/credentials/` and is never tracked.
- **Preflight gate.** `scripts/preflight.sh` scans tracked files and history for the live worker key,
  private keys, and common token formats. Enable it in a fresh clone with:

  ```bash
  git config core.hooksPath scripts/git-hooks
  ```

  It runs automatically before every push.
- **GitHub-side protection.** Secret scanning and push protection are enabled on this repository.
- The write key is still extractable from any installed APK by design; the Worker's rate limiting and
  size caps are the abuse brake, not the key.
