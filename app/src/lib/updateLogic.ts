/**
 * Pure update-manifest rules.
 *
 * Kept free of React Native imports so the release logic can be tested with
 * plain Node. Anything that touches the network, disk, or the Android
 * installer lives in `updater.ts`.
 */

export type UpdateManifest = {
  versionCode: number;
  versionName: string;
  url: string;
  notes?: string;
  /** Expected APK size in bytes, when the release manifest publishes it. */
  size?: number;
};

function isAbsoluteHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * Strictly validates the JSON served at `/app/version.json`.
 *
 * A malformed manifest is treated as "no update" rather than risking a partial
 * or insecure install. Optional fields must still have the right type when
 * present.
 */
export function parseManifest(json: unknown): UpdateManifest | null {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;

  const record = json as Record<string, unknown>;
  const versionCode = record.versionCode;
  const versionName = record.versionName;

  if (
    typeof versionCode !== 'number' ||
    !Number.isInteger(versionCode) ||
    versionCode <= 0
  ) {
    return null;
  }

  if (typeof versionName !== 'string' || versionName.trim().length === 0) {
    return null;
  }

  if (!isAbsoluteHttpsUrl(record.url)) return null;

  if (
    record.notes !== undefined &&
    (typeof record.notes !== 'string' || record.notes.trim().length === 0)
  ) {
    return null;
  }

  if (
    record.size !== undefined &&
    (typeof record.size !== 'number' ||
      !Number.isFinite(record.size) ||
      record.size <= 0)
  ) {
    return null;
  }

  return {
    versionCode,
    versionName: versionName.trim(),
    url: record.url,
    ...(record.notes !== undefined ? { notes: record.notes.trim() } : {}),
    ...(record.size !== undefined ? { size: record.size } : {}),
  };
}

/** Android only installs an APK when its versionCode is strictly greater. */
export function isNewer(manifest: UpdateManifest, current: number): boolean {
  return manifest.versionCode > current;
}

function fixedOne(value: number): string {
  const text = value.toFixed(1);
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

/** Human-readable download size for the dialog (B, KB or MB). */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${fixedOne(bytes / 1024)} KB`;
  return `${fixedOne(bytes / (1024 * 1024))} MB`;
}
