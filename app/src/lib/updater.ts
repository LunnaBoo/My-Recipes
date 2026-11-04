import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

import { getMeta, setMeta } from '../db/repository';
import { getApiConfig } from './config';
import { isNewer, parseManifest, type UpdateManifest } from './updateLogic';

const REQUEST_TIMEOUT_MS = 10_000;
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_DIRECTORY_FILE = 'update.apk';

export const LAST_UPDATE_CHECK_KEY = 'last_update_check';

export type UpdateErrorCode = 'offline' | 'corrupt' | 'permission' | 'server';

/** Typed failure so Settings can explain the manual check without string matching. */
export class UpdateError extends Error {
  readonly code: UpdateErrorCode;

  constructor(code: UpdateErrorCode, message: string) {
    super(message);
    this.name = 'UpdateError';
    this.code = code;
  }
}

export type UpdateCheck =
  | { status: 'update'; manifest: UpdateManifest }
  | { status: 'current'; currentCode: number }
  | { status: 'unknown' };

async function requestManifest(): Promise<UpdateManifest> {
  let endpoint: string;
  try {
    endpoint = `${getApiConfig().apiBase}/app/version.json`;
  } catch {
    throw new UpdateError('server', 'missing API configuration');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (error) {
    throw new UpdateError(
      'offline',
      error instanceof Error ? error.message : 'network request failed',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new UpdateError('server', `update manifest failed with ${response.status}`);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new UpdateError('server', 'invalid update manifest');
  }

  const manifest = parseManifest(json);
  if (!manifest) throw new UpdateError('server', 'invalid update manifest');
  return manifest;
}

/** Auto-check friendly: any failure simply means "nothing to show". */
export async function fetchUpdateManifest(): Promise<UpdateManifest | null> {
  try {
    return await requestManifest();
  } catch {
    return null;
  }
}

/**
 * Reads the installed build number.
 *
 * `expoConfig.android.versionCode` is baked into the app at build time; Expo Go
 * and development clients may not expose it, so fall back to the native build
 * version when it is available.
 */
export function currentVersionCode(): number | null {
  const configured = Constants.expoConfig?.android?.versionCode;
  if (typeof configured === 'number' && Number.isInteger(configured) && configured > 0) {
    return configured;
  }

  const native = (Constants as unknown as { nativeBuildVersion?: string | number })
    .nativeBuildVersion;
  if (native === undefined || native === null) return null;

  const parsed = Number(native);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Manual check. Throws a typed `UpdateError` so Settings can show the exact
 * reason (offline, bad manifest, …). Callers that must not throw should use
 * `fetchUpdateManifest` / `fetchLatestUpdate`.
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const manifest = await requestManifest();
  const current = currentVersionCode();
  if (current === null) return { status: 'unknown' };

  return isNewer(manifest, current)
    ? { status: 'update', manifest }
    : { status: 'current', currentCode: current };
}

/** Convenience: the newer manifest, or null when current/unknown/offline. */
export async function fetchLatestUpdate(): Promise<UpdateManifest | null> {
  try {
    const result = await checkForUpdate();
    return result.status === 'update' ? result.manifest : null;
  } catch {
    return null;
  }
}

/** Records the attempt even when it fails, so the 24 h window still applies. */
export async function recordUpdateCheck(now = Date.now()): Promise<void> {
  try {
    await setMeta(LAST_UPDATE_CHECK_KEY, String(now));
  } catch (error) {
    console.warn('[update] could not record check time:', error);
  }
}

/**
 * Home-screen launch check: at most once per 24 h, never throws and never
 * downloads. A failed attempt still counts, avoiding a retry loop on a bad
 * connection.
 */
export async function checkForUpdateIfDue(now = Date.now()): Promise<UpdateManifest | null> {
  let last: number | null = null;
  try {
    const raw = await getMeta(LAST_UPDATE_CHECK_KEY);
    last = raw === null ? null : Number(raw);
  } catch (error) {
    console.warn('[update] could not read last check:', error);
  }

  if (
    last !== null &&
    Number.isFinite(last) &&
    last <= now &&
    now - last < UPDATE_CHECK_INTERVAL_MS
  ) {
    return null;
  }

  await recordUpdateCheck(now);
  return fetchLatestUpdate();
}

function updateFilePath(): string {
  if (!FileSystem.cacheDirectory) {
    throw new UpdateError('server', 'cache directory unavailable');
  }
  return `${FileSystem.cacheDirectory}${UPDATE_DIRECTORY_FILE}`;
}

function downloadFailure(error: unknown): UpdateError {
  if (error instanceof UpdateError) return error;

  const message = error instanceof Error ? error.message : '';
  const looksLikeNetwork =
    /network|timeout|socket|connect|resolve|internet|econn/i.test(message);
  return new UpdateError(looksLikeNetwork ? 'offline' : 'corrupt', message || 'download failed');
}

/**
 * Downloads the APK into the cache directory and reports 0..1 progress.
 *
 * When the manifest publishes `size`, a mismatch is treated as a corrupt
 * download and the file is deleted.
 *
 * Note on integrity: we deliberately do not hash the APK in JS. Android's
 * package installer verifies the APK signature before installing and refuses
 * anything not signed with this app's key, so downloading 100 MB into JS just
 * to re-hash it would add cost without adding trust. HTTPS protects transport;
 * the signature protects the install.
 */
export async function downloadApk(
  manifest: UpdateManifest,
  onProgress?: (progress: number) => void,
): Promise<string> {
  const destination = updateFilePath();

  try {
    await FileSystem.deleteAsync(destination, { idempotent: true });
  } catch {
    // A stale cache file is harmless; the download overwrites it.
  }

  let lastReported = -1;

  let result: FileSystem.FileSystemDownloadResult | undefined;
  try {
    const resumable = FileSystem.createDownloadResumable(
      manifest.url,
      destination,
      {},
      (data) => {
        const expected = data.totalBytesExpectedToWrite;
        if (!onProgress || expected <= 0) return;

        const progress = Math.min(1, Math.max(0, data.totalBytesWritten / expected));
        if (progress !== lastReported) {
          lastReported = progress;
          onProgress(progress);
        }
      },
    );

    result = await resumable.resumeAsync();
  } catch (error) {
    throw downloadFailure(error);
  }

  if (!result || result.status < 200 || result.status >= 300) {
    throw new UpdateError('server', `download failed with ${result?.status ?? 'unknown'}`);
  }

  if (manifest.size !== undefined) {
    let info: FileSystem.FileInfo;
    try {
      info = await FileSystem.getInfoAsync(destination);
    } catch (error) {
      throw new UpdateError(
        'corrupt',
        error instanceof Error ? error.message : 'could not inspect download',
      );
    }

    if (!info.exists || info.size !== manifest.size) {
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {});
      throw new UpdateError('corrupt', 'downloaded APK size does not match the manifest');
    }
  }

  onProgress?.(1);
  return destination;
}

/**
 * Hands the cached APK to the system installer. Android shows the final
 * confirmation sheet; the user's tap there is the second and last tap.
 *
 * The only expected failure is the missing "install unknown apps" grant, so
 * every throw is surfaced as a `permission` error that the dialog turns into a
 * shortcut to the system settings screen.
 */
export async function installApk(fileUri: string): Promise<void> {
  let contentUri: string;
  try {
    contentUri = await FileSystem.getContentUriAsync(fileUri);
  } catch (error) {
    throw new UpdateError(
      'permission',
      error instanceof Error ? error.message : 'could not expose APK to installer',
    );
  }

  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: 'application/vnd.android.package-archive',
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    });
  } catch (error) {
    throw new UpdateError(
      'permission',
      error instanceof Error ? error.message : 'install intent failed',
    );
  }
}

/** Opens this app's "install unknown apps" screen. */
export async function openInstallPermissionSettings(): Promise<void> {
  const packageUri = 'package:com.lunnaboo.myrecipes';

  try {
    await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
      data: packageUri,
    });
  } catch (error) {
    // Some Android skins do not expose the per-app source screen; the app
    // details page is the closest safe fallback.
    try {
      await IntentLauncher.startActivityAsync('android.settings.APPLICATION_DETAILS_SETTINGS', {
        data: packageUri,
      });
    } catch {
      throw new UpdateError(
        'permission',
        error instanceof Error ? error.message : 'could not open settings',
      );
    }
  }
}
