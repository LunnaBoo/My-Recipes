import { getRandomValues } from 'expo-crypto';

import { buildMailboxIdentity, type MailboxIdentity } from './mailbox';

/**
 * Mailbox identity generation (MAILBOX.md §5.1, §7.2).
 *
 * The construction lives in `buildMailboxIdentity` so it can be tested in Node;
 * this module only supplies the device byte source. Both values are secrets in
 * different ways — the secret is the read token, and the address is the
 * unguessable identity — so entropy comes from `expo-crypto`'s
 * `Crypto.getRandomValues`. There is deliberately no `Math.random` fallback: a
 * weak address would be guessable and a weak secret would be brute-forceable.
 */

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  getRandomValues(bytes);
  return bytes;
}

/** New public address + private read secret. Never reuse an existing pair. */
export function newMailboxIdentity(): MailboxIdentity {
  return buildMailboxIdentity(randomBytes);
}
