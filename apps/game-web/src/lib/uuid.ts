type CryptoSource = {
  randomUUID?: () => string;
  getRandomValues?: (values: Uint8Array) => Uint8Array;
};

/**
 * UUID v4 for player keys and command ids. `crypto.randomUUID` exists only in
 * secure contexts (HTTPS or localhost); plain-HTTP LAN access must still work,
 * so fall back to `getRandomValues`, which is available on insecure origins.
 */
export function createUuid(source: CryptoSource = globalThis.crypto): string {
  if (source.randomUUID !== undefined) {
    return source.randomUUID();
  }
  if (source.getRandomValues === undefined) {
    throw new Error('No cryptographic random source is available');
  }

  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
