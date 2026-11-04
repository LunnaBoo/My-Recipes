import { ptBR } from '../i18n/pt-BR';

/** Share ids are 12 chars from the server's lowercase base32 alphabet. */
export const SHARE_ID_RE = /^[a-z2-9]{12}$/;

export const SHARE_HOST = 'r.lunna.boo';

export function isValidShareId(value: string): boolean {
  return SHARE_ID_RE.test(value);
}

/**
 * Extracts a share id from a full `https://r.lunna.boo/r/<id>` link (trailing
 * slash and query string allowed) or from a bare 12-char id.
 */
export function parseShareUrl(textOrUrl: string): string | null {
  const value = textOrUrl.trim();
  if (value.length === 0) return null;

  if (isValidShareId(value)) return value;

  const match = /^https:\/\/([^/?#]+)\/r\/([^/?#]+)\/?([?#].*)?$/i.exec(value);
  if (!match) return null;
  if (match[1].toLowerCase() !== SHARE_HOST) return null;

  const id = match[2];
  return isValidShareId(id) ? id : null;
}

/** Message handed to the system share sheet (SPEC §6.2). */
export function buildShareMessage(title: string, steps: number, url: string): string {
  return `${title} · ${ptBR.stepsLabel(steps)}\n${url}`;
}
