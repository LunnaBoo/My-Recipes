/**
 * Step counting per SPEC §4.1:
 * count lines matching `^\s*\d+[.)]\s`; if zero, count `^\s*[-*]\s`.
 */
const NUMBERED_RE = /^\s*\d+[.)]\s/;
const BULLET_RE = /^\s*[-*]\s/;

export function stepCount(body: string): number {
  if (!body) return 0;

  const lines = body.split('\n');
  let numbered = 0;
  let bullets = 0;

  for (const line of lines) {
    if (NUMBERED_RE.test(line)) numbered += 1;
    else if (BULLET_RE.test(line)) bullets += 1;
  }

  return numbered > 0 ? numbered : bullets;
}
