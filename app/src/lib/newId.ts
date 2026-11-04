type RandomSource = {
  getRandomValues?: <T extends Uint8Array>(array: T) => T;
};

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const source = (globalThis as { crypto?: RandomSource }).crypto;

  if (source && typeof source.getRandomValues === 'function') {
    source.getRandomValues(bytes);
    return bytes;
  }

  // Hermes does not expose Web Crypto on every device. Math.random is a weaker
  // fallback, but ids are local-only and never used as secrets.
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }

  return bytes;
}

/** RFC 4122 version 4 UUID. */
export function newId(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));

  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
