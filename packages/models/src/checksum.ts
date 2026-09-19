/** SHA-256 helpers built on Web Crypto (available in browsers and Node 20). */

export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  // Copy into a fresh ArrayBuffer so SharedArrayBuffer-backed views are accepted.
  const bytes = new Uint8Array(view.byteLength);
  bytes.set(view);
  return toHex(await crypto.subtle.digest('SHA-256', bytes.buffer));
}

export class ChecksumMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
    readonly label: string,
  ) {
    super(`Checksum mismatch for ${label}: expected ${expected}, got ${actual}`);
    this.name = 'ChecksumMismatchError';
  }
}

export async function verifySha256(
  data: ArrayBuffer | Uint8Array,
  expected: string,
  label = 'file',
): Promise<void> {
  const normalized = expected.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Invalid expected sha256 for ${label}: ${expected}`);
  }
  const actual = await sha256Hex(data);
  if (actual !== normalized) throw new ChecksumMismatchError(normalized, actual, label);
}
