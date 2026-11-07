# My Recipes — Android app

Local-first recipe notebook for Android. React Native + Expo (SDK 58), TypeScript,
Expo Router, SQLite/FTS5, and plain Markdown files on disk.

The app implements the v1 surface — parchment shell, recipe list and editor, paste-import,
sharing, the **Cartas** mailbox, trash, and settings — plus backup export/import and the
in-app updater. Current release: 1.5.3 (versionCode 10).

## Prerequisites

- **Node.js 22** and npm.
- For running on a phone: an Android device with [Expo Go](https://expo.dev/go), or a
  development build installed on the device.
- For building an APK: an Expo account and [EAS CLI](https://docs.expo.dev/build/setup/)
  (`npm install -g eas-cli`). A local JDK/Android SDK is **not** required for cloud builds.
- Config plugins in `app.json` (minSdk 26, FTS5, App Links) only take effect in a
  development/production build, not in Expo Go.

## Run

```bash
cd app
npm install       # first time only
npm start         # Expo dev server; press "a" to open on a connected Android device
```

## Test and type-check

```bash
npm test          # node --test with tsx; pure logic only, no native modules
npm run check     # tsc --noEmit
```

## Build a preview APK

```bash
eas build -p android --profile preview
```

> Not run here — needs an Expo login and an Android toolchain in the cloud.
> The `preview` profile in `eas.json` produces an installable APK.

The app uses a local keystore for release signing (see `SPEC.md` §10); configure it with
`eas credentials` before shipping, and make sure its SHA-256 matches the Worker's
`assetlinks.json`.

## Deep links

`app.json` already carries the Android App Links intent filter for
`https://r.lunna.boo` with `autoVerify: true`, plus the `myrecipes://` custom scheme as a
fallback. The Worker must serve
`https://r.lunna.boo/.well-known/assetlinks.json` with the signing certificate
fingerprint for verification to succeed.

## Layout

```
src/app/          Expo Router routes (src/app is supported directly)
src/components/   ScreenFrame (parchment shell), ActionBar, ActionSheet, ConfirmDialog, Seal
src/db/           SQLite schema, migrations, FTS5 detection, repositories (recipes + mailbox)
src/storage/      Markdown bodies at <documentDirectory>/recipes/<id>.md
src/lib/          Pure, unit-tested logic (step count, paste-import, numbered lists, seals,
                  sharing, mailbox, backup, updater)
src/theme/        DESIGN.md tokens
src/fonts/        useAppFonts()
src/i18n/         pt-BR strings
test/             node:test suites (142 tests)
```

SQLite stores the index only; the Markdown files are the source of truth. Search uses
FTS5 when the SQLite build provides it, and falls back to an in-app `LIKE`-style scan
otherwise. The active path is logged at startup.
